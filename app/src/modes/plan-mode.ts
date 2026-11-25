/**
 * Plan a mode: the normal route, the mode's "better" route, and the cost of fun for both.
 * For collecting modes, both the cost-profile route and the collected route are tried, and the
 * more fun one (by the mode's score) wins. Whatever wins is safety-checked against the cap.
 */
import type { Route, Router } from "../router/astar";
import { blended, plan } from "../router/planner";
import { assertRouteSafe } from "../router/verify";
import { haversineM } from "../router/geometry";
import { hashUnit, mulberry32 } from "../router/rng";
import { FLAT_SPEED_MS } from "../router/time";
import { collectRoute, DETOUR_FACTOR, viaRoute } from "./collect";
import type { FeatureIndex } from "./features";
import { MODES, type ModeId } from "./modes";
import { routeName } from "./names";
import { costOfFun, snackSummary, summarise, type CostOfFun } from "./stats";

export interface ModePlan {
  mode: ModeId;
  seed: number;
  normal: Route;
  better: Route;
  normalStats: CostOfFun;
  betterStats: CostOfFun;
  capSeconds: number;
  strategy: "cost-profile" | "collect" | "chaos-waypoints" | "normal";
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
): ModePlan | null {
  const mode = MODES[modeId];
  const model = mode.cost(fi, seed);
  const base = plan(router, start, goal, model);
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

  assertRouteSafe(router.g, better, base.capSeconds);
  const normalStats = costOfFun(fi, base.normal);
  const extras =
    modeId === "no-right"
      ? [`${betterStats.leftTurns} left turns, ${betterStats.rightTurns} right`]
      : modeId === "snacks"
        ? snackSummary(betterStats)
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
    name: routeName(fi, modeId, betterStats, better, seed),
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
  const rand = mulberry32(Math.floor(hashUnit(seed, start * 7919 + goal) * 2 ** 32));
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
        const e = Math.floor(rand() * g.edgeCount);
        if (!g.allowedDirs[e]) continue;
        const m: [number, number] = [fi.midLon[e]!, fi.midLat[e]!];
        const via = haversineM(s, m) + haversineM(m, t);
        if (via > direct + spare * target || via < direct + spare * 0.25 * tame) continue;
        vias.push({ node: g.s.edge_from[e]!, along: haversineM(s, m) / via });
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
