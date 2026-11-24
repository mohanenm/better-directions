/**
 * Collecting search for modes that should go out of their way (Stairmaster, Park hopper, ...).
 *
 * Greedy insertion: start from the mode's direct route; repeatedly pick the unvisited feature
 * with the best value per extra metre (straight-line estimate), insert it where it adds least,
 * route the two new legs for real, and keep it only if the whole walk still fits the detour cap.
 * Edges already used elsewhere on the route cost extra, so routes loop rather than retrace.
 */
import { NORMAL, type CostModel, type Route, type Router } from "../router/astar";
import { haversineM } from "../router/geometry";
import { FLAT_SPEED_MS } from "../router/time";
import type { FeatureIndex } from "./features";
import type { Collectible, Mode } from "./modes";

export const MAX_WAYPOINTS = 8;
export const MAX_ATTEMPTS = 14;
const REUSE_PENALTY = 3;
/** Reject an insertion if more than this share of the walk would retrace itself. */
export const MAX_RETRACE_SHARE = 0.15;
/** Walking distance is typically this much longer than the straight line (streets, rivers). */
export const DETOUR_FACTOR = 1.3;

interface Stop {
  enter: number;
  exit: number;
  /** Directed edges walked through this stop (empty for start and goal). */
  path: number[];
}

function avoidReuse(model: CostModel, used: Set<number>): CostModel {
  return {
    id: `${model.id}+avoid-reuse`,
    turnAware: model.turnAware,
    minCostPerSecond: model.minCostPerSecond,
    edgeCost: (g, d, t, prev) => model.edgeCost(g, d, t, prev) * (used.has(d >>> 1) ? REUSE_PENALTY : 1),
  };
}

export function collectRoute(
  router: Router,
  fi: FeatureIndex,
  start: number,
  goal: number,
  mode: Mode,
  model: CostModel,
  capSeconds: number,
): Route | null {
  const collect = mode.collect;
  if (!collect) return null;
  const g = fi.g;
  const pt = (n: number) => g.nodeLonLat(n);
  const enterOf = (c: Collectible) => g.tail(c.path[0]!);
  const exitOf = (c: Collectible) => g.head(c.path[c.path.length - 1]!);
  const stops: Stop[] = [{ enter: start, exit: start, path: [] }, { enter: goal, exit: goal, path: [] }];
  const first = router.route(start, goal, model, { maxTimeS: capSeconds });
  if (!first) return null;
  const legs: Route[] = [first];

  const pathTime = (path: number[]) => path.reduce((s, d) => s + router.edgeTime(d), 0);
  const totalTime = () => legs.reduce((s, l) => s + l.timeS, 0) + stops.reduce((s, st) => s + pathTime(st.path), 0);
  const visited = (): Set<string> => {
    const keys = new Set<string>();
    const add = (d: number) => collect.keysOf(fi, d).forEach((k) => keys.add(k));
    legs.forEach((l) => l.dirEdges.forEach(add));
    stops.forEach((s) => s.path.forEach(add));
    return keys;
  };

  const budgetM = (capSeconds * FLAT_SPEED_MS) / DETOUR_FACTOR;
  const startPt = pt(start);
  const goalPt = pt(goal);
  const candidates = collect
    .candidates(fi)
    .filter((c) => haversineM(startPt, pt(enterOf(c))) + haversineM(pt(exitOf(c)), goalPt) <= budgetM);
  const rejected = new Set<string>();
  let seen = visited();

  const maxWaypoints = collect.maxWaypoints ?? MAX_WAYPOINTS;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && stops.length - 2 < maxWaypoints; attempt++) {
    // Best value per extra metre, at the cheapest insertion position.
    let best: { c: Collectible; at: number; ratio: number } | null = null;
    for (const c of candidates) {
      if (rejected.has(c.key) || seen.has(c.key)) continue;
      for (let i = 0; i < stops.length - 1; i++) {
        const a = pt(stops[i]!.exit);
        const b = pt(stops[i + 1]!.enter);
        const extra = (haversineM(a, pt(enterOf(c))) + haversineM(pt(exitOf(c)), b) - haversineM(a, b)) * DETOUR_FACTOR;
        const ratio = c.value / (Math.max(0, extra) + 30);
        if (!best || ratio > best.ratio || (ratio === best.ratio && c.key < best.c.key)) best = { c, at: i, ratio };
      }
    }
    if (!best) break;
    const { c, at } = best;

    const used = new Set<number>();
    legs.forEach((l, i) => i !== at && l.dirEdges.forEach((d) => used.add(d >>> 1)));
    stops.forEach((s) => s.path.forEach((d) => used.add(d >>> 1)));
    c.path.forEach((d) => used.add(d >>> 1));
    // The two new legs may use only what's left of the budget once everything else is counted.
    const legBudget = capSeconds - (totalTime() - legs[at]!.timeS) - pathTime(c.path);
    const [cIn, cOut, prevExit, nextEnter] = [enterOf(c), exitOf(c), stops[at]!.exit, stops[at + 1]!.enter];
    const legs2 =
      routeLegs(router, avoidReuse(model, used), prevExit, cIn, cOut, nextEnter, legBudget) ??
      routeLegs(router, avoidReuse(NORMAL, used), prevExit, cIn, cOut, nextEnter, legBudget);
    if (!legs2) {
      rejected.add(c.key);
      continue;
    }
    const [before, after] = legs2;
    const trialLegs = [...legs.slice(0, at), before, after, ...legs.slice(at + 1)];
    const trialStops = [...stops.slice(0, at + 1), { enter: cIn, exit: cOut, path: c.path }, ...stops.slice(at + 1)];
    if (retraceShare(router, assemble(router, trialStops, trialLegs)) > MAX_RETRACE_SHARE) {
      rejected.add(c.key); // an out-and-back to this feature would be dull
      continue;
    }
    legs.splice(0, legs.length, ...trialLegs);
    stops.splice(0, stops.length, ...trialStops);
    seen = visited();
    seen.add(c.key); // never insert the same feature twice
  }
  return assemble(router, stops, legs);
}

/** Share of a route's length on edges it walks more than once. */
export function retraceShare(router: Router, route: Route): number {
  const seen = new Set<number>();
  let retraced = 0;
  for (const d of route.dirEdges) {
    const e = d >>> 1;
    if (seen.has(e)) retraced += router.g.s.edge_length_m[e]!;
    seen.add(e);
  }
  return route.lengthM > 0 ? retraced / route.lengthM : 0;
}

/** Two legs a -> b and c -> d whose total time fits the budget, or null. */
function routeLegs(router: Router, m: CostModel, a: number, b: number, c: number, d: number, budget: number): [Route, Route] | null {
  if (budget <= 0) return null;
  const first = router.route(a, b, m, { maxTimeS: budget });
  if (!first) return null;
  const second = router.route(c, d, m, { maxTimeS: budget - first.timeS });
  if (!second || first.timeS + second.timeS > budget) return null;
  return [first, second];
}

function assemble(router: Router, stops: Stop[], legs: Route[]): Route {
  const g = router.g;
  const dirEdges: number[] = [];
  legs.forEach((leg, i) => {
    dirEdges.push(...leg.dirEdges);
    dirEdges.push(...stops[i + 1]!.path);
  });
  const nodes = [stops[0]!.exit];
  let timeS = 0;
  let lengthM = 0;
  for (const d of dirEdges) {
    nodes.push(g.head(d));
    timeS += router.edgeTime(d);
    lengthM += g.s.edge_length_m[d >>> 1]!;
  }
  return { dirEdges, nodes, timeS, lengthM, cost: NaN };
}

/**
 * Route start -> vias... -> goal with the given model, each leg limited to what's left of the
 * cap, avoiding edges already used. Null if it can't fit.
 */
export function viaRoute(router: Router, start: number, vias: number[], goal: number, model: CostModel, capSeconds: number): Route | null {
  const points = [start, ...vias, goal];
  const legs: Route[] = [];
  const used = new Set<number>();
  let spent = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const leg = router.route(points[i]!, points[i + 1]!, avoidReuse(model, used), { maxTimeS: capSeconds - spent });
    if (!leg) return null;
    spent += leg.timeS;
    if (spent > capSeconds) return null;
    leg.dirEdges.forEach((d) => used.add(d >>> 1));
    legs.push(leg);
  }
  const stops: Stop[] = points.map((n) => ({ enter: n, exit: n, path: [] }));
  return assemble(router, stops, legs);
}
