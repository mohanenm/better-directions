/**
 * Plan a mode: the normal route, the mode's "better" route, and the cost of fun for both.
 * For collecting modes, both the cost-profile route and the collected route are tried, and the
 * more fun one (by the mode's score) wins. Whatever wins is safety-checked against the cap.
 */
import { NORMAL, type Route, type Router } from "../router/astar";
import { blended, plan } from "../router/planner";
import { assertRouteSafe } from "../router/verify";
import { haversineM } from "../router/geometry";
import { hashUnit, mulberry32 } from "../router/rng";
import { FLAT_SPEED_MS } from "../router/time";
import { detourCapSeconds } from "../safety/limits";
import { collectRoute, DETOUR_FACTOR, viaRoute } from "./collect";
import type { FeatureIndex } from "./features";
import { CROSSING_PENALTIES_S, inconvenientModel, MODES, type ModeId } from "./modes";
import { routeName } from "./names";
import { costOfFun, inconvenienceSummary, snackSummary, summarise, type CostOfFun } from "./stats";

export interface ModePlan {
  mode: ModeId;
  seed: number;
  normal: Route;
  better: Route;
  normalStats: CostOfFun;
  betterStats: CostOfFun;
  capSeconds: number;
  strategy: "cost-profile" | "collect" | "chaos-waypoints" | "via-stops" | "normal";
  summary: string;
  name: string;
}

export function planMode(
  router: Router,
  fi: FeatureIndex,
  start: number,
  goal: number,
  modeId: ModeId,
  seed = 1,
  capSeconds?: number,
  long = false,
): ModePlan | null {
  const mode = MODES[modeId];
  const model = mode.cost(fi, seed);
  const base = plan(router, start, goal, model, capSeconds, long);
  if (!base) return null;

  let better = base.better;
  let strategy: ModePlan["strategy"] = base.fellBackToNormal ? "normal" : "cost-profile";
  let betterStats = costOfFun(fi, better);

  if (mode.collect) {
    const collected = collectRoute(router, fi, start, goal, mode, model, base.capSeconds);
    if (collected && collected.timeS <= base.capSeconds) {
      const stats = costOfFun(fi, collected);
      const gain = mode.score(stats) - mode.score(betterStats);
      if (gain > 0 || (gain === 0 && collected.timeS < better.timeS)) {
        better = collected;
        betterStats = stats;
        strategy = "collect";
      }
    }
  }

  if (modeId === "chaos") {
    const wild = chaosWaypointRoute(router, fi, start, goal, model, base.capSeconds, seed);
    if (wild) {
      better = wild;
      betterStats = costOfFun(fi, wild);
      strategy = "chaos-waypoints";
    }
  }

  const normalStats = costOfFun(fi, base.normal);

  if (modeId === "inconvenient") {
    // Wander via a few off-route waypoints too; keep the most annoying route that crosses no
    // more busy roads than the normal one.
    let bestScore = betterStats.busyCrossings <= normalStats.busyCrossings ? mode.score(betterStats) : -Infinity;
    for (let k = 1; k <= 3; k++) {
      const wild = chaosWaypointRoute(router, fi, start, goal, model, base.capSeconds, seed * 31 + k);
      if (!wild) continue;
      const stats = costOfFun(fi, wild);
      if (stats.busyCrossings > normalStats.busyCrossings || mode.score(stats) <= bestScore) continue;
      bestScore = mode.score(stats);
      better = wild;
      betterStats = stats;
      strategy = "chaos-waypoints";
    }
  }

  if (modeId === "inconvenient" && betterStats.busyCrossings > normalStats.busyCrossings) {
    // Inconvenient, not riskier: raise the crossing penalty until it crosses no more than normal.
    let fixed = false;
    for (const penalty of CROSSING_PENALTIES_S.slice(1)) {
      const strict = plan(router, start, goal, inconvenientModel(fi, penalty), base.capSeconds, long);
      if (!strict) break;
      const stats = costOfFun(fi, strict.better);
      if (stats.busyCrossings <= normalStats.busyCrossings) {
        better = strict.better;
        betterStats = stats;
        strategy = strict.fellBackToNormal ? "normal" : "cost-profile";
        fixed = true;
        break;
      }
    }
    if (!fixed) {
      better = base.normal;
      betterStats = normalStats;
      strategy = "normal";
    }
  }

  assertRouteSafe(router.g, better, base.capSeconds);
  const extras =
    modeId === "no-right"
      ? [`${betterStats.leftTurns} left turns, ${betterStats.rightTurns} right`]
      : modeId === "snacks"
        ? snackSummary(betterStats)
        : modeId === "inconvenient"
          ? inconvenienceSummary(betterStats)
          : [];
  return {
    mode: modeId,
    seed,
    normal: base.normal,
    better,
    normalStats,
    betterStats,
    capSeconds: base.capSeconds,
    strategy,
    summary: summarise(normalStats, betterStats, extras),
    name: routeName(fi, modeId, betterStats, better, seed, normalStats),
  };
}

/** Joins consecutive routes end to end. */
export function joinRoutes(routes: Route[]): Route {
  const dirEdges: number[] = [];
  const nodes: number[] = [];
  let timeS = 0;
  let lengthM = 0;
  for (const r of routes) {
    dirEdges.push(...r.dirEdges);
    nodes.push(...(nodes.length ? r.nodes.slice(1) : r.nodes));
    timeS += r.timeS;
    lengthM += r.lengthM;
  }
  return { dirEdges, nodes, timeS, lengthM, cost: NaN };
}

/**
 * A mode's route through stops the user picked, in order. The normal route goes through the same
 * stops, so the detour cap is measured against it; each leg gets its share of that cap.
 */
export function planModeVia(
  router: Router,
  fi: FeatureIndex,
  points: number[],
  modeId: ModeId,
  seed = 1,
  long = false,
): ModePlan | null {
  if (points.length === 2) return planMode(router, fi, points[0]!, points[1]!, modeId, seed, undefined, long);
  const normals: Route[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = router.route(points[i]!, points[i + 1]!, NORMAL);
    if (!leg) return null;
    normals.push(leg);
  }
  const normal = joinRoutes(normals);
  const capSeconds = detourCapSeconds(normal.timeS, long);
  const legs: ModePlan[] = [];
  for (let i = 0; i < normals.length; i++) {
    const share = normal.timeS > 0 ? normals[i]!.timeS / normal.timeS : 1 / normals.length;
    const leg = planMode(router, fi, points[i]!, points[i + 1]!, modeId, seed + i, capSeconds * share, long);
    if (!leg) return null;
    legs.push(leg);
  }
  const better = joinRoutes(legs.map((l) => l.better));
  assertRouteSafe(router.g, better, capSeconds);
  const normalStats = costOfFun(fi, normal);
  const betterStats = costOfFun(fi, better);
  const extras = modeId === "no-right" ? [`${betterStats.leftTurns} left turns, ${betterStats.rightTurns} right`] : modeId === "snacks" ? snackSummary(betterStats) : modeId === "inconvenient" ? inconvenienceSummary(betterStats) : [];
  return {
    mode: modeId,
    seed,
    normal,
    better,
    normalStats,
    betterStats,
    capSeconds,
    strategy: legs.every((l) => l.strategy === "normal") ? "normal" : "via-stops",
    summary: summarise(normalStats, betterStats, extras),
    name: routeName(fi, modeId, betterStats, better, seed, normalStats),
  };
}

/**
 * Random: one or two seeded random waypoints inside the detour budget, joined by legs
 * under the seed's random weights. Same seed + same trip = same route; a new seed is a new
 * adventure. Falls back (fewer waypoints, then none) if a route won't fit the cap.
 */
export function chaosWaypointRoute(
  router: Router,
  fi: FeatureIndex,
  start: number,
  goal: number,
  model: Parameters<typeof viaRoute>[4],
  capSeconds: number,
  seed: number,
): Route | null {
  const g = router.g;
  // Seeded by whole-graph node numbers, so a tiled graph draws the same waypoints.
  const rand = mulberry32(Math.floor(hashUnit(seed, g.globalNode(start) * 7919 + g.globalNode(goal)) * 2 ** 32));
  const s = g.nodeLonLat(start);
  const t = g.nodeLonLat(goal);
  const direct = haversineM(s, t);
  const spare = (capSeconds * FLAT_SPEED_MS) / DETOUR_FACTOR - direct; // straight-line metres to play with
  if (spare < 200) return null;
  const count = rand() < 0.5 ? 1 : 2;
  // Up to four rounds of fresh seeded waypoints, each aiming a little tamer, until one fits.
  for (let round = 0; round < 4; round++) {
    const tame = 1 - 0.2 * round;
    const vias: { node: number; along: number }[] = [];
    for (let k = 0; k < count; k++) {
      const target = (0.5 + 0.4 * rand()) * tame; // share of the spare budget to use
      for (let tries = 0; tries < 400; tries++) {
        // Draw from the whole graph's edge numbers, so a tiled graph draws the same ones; an edge
        // that isn't loaded is outside anything this cap can reach, so it would fail anyway.
        const e = g.localEdge(Math.floor(rand() * g.globalEdgeCount));
        if (e < 0 || !g.allowedDirs[e]) continue;
        // Judge the waypoint itself (the edge's first node), not the edge's middle.
        const node = g.s.edge_from[e]!;
        const m = g.nodeLonLat(node);
        const via = haversineM(s, m) + haversineM(m, t);
        if (via > direct + spare * target || via < direct + spare * 0.25 * tame) continue;
        vias.push({ node, along: haversineM(s, m) / via });
        break;
      }
    }
    vias.sort((a, b) => a.along - b.along);
    // Wild legs first; if they won't fit, tamer legs (time blended in); then fewer waypoints.
    for (let n = vias.length; n >= 1; n--) {
      for (const m of [model, blended(model, 2)]) {
        const r = viaRoute(router, start, vias.slice(0, n).map((v) => v.node), goal, m, capSeconds);
        if (r && r.timeS <= capSeconds) return r;
      }
    }
  }
  return null;
}
