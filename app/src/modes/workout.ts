/**
 * Workout loops: from a start point and back again within a chosen time, collecting staircases
 * (climbed upwards), hills, or both. Uses the same waypoint search as the collecting modes, with
 * the start as both ends, so every safety check applies.
 */
import type { CostModel, Route, Router } from "../router/astar";
import { assertRouteSafe } from "../router/verify";
import { LOOP_MAX_SECONDS } from "../safety/limits";
import { collectRoute } from "./collect";
import type { FeatureIndex } from "./features";
import { MODES, type Collectible, type Mode } from "./modes";
import { chaosWaypointRoute } from "./plan-mode";
import { costOfFun, type CostOfFun } from "./stats";

import type { WorkoutFocus } from "./options";
export { WORKOUT_FOCUSES, WORKOUT_MINUTES, type WorkoutFocus } from "./options";
/** Loops at least this long prefer lit streets. */
const LIT_FROM_MINUTES = 30;
/** A hill worth a detour climbs at least this much along one way. */
const MIN_HILL_CLIMB_M = 6;
/** Loops may double back more than point-to-point routes: you often come down the way you went up. */
const LOOP_RETRACE_SHARE = 0.35;

interface Hill {
  way: number;
  path: number[];
  climbM: number;
}

const hillCache = new WeakMap<FeatureIndex, Hill[]>();

/** Ways that climb at least MIN_HILL_CLIMB_M, as uphill walking paths. Steps are left to stairs. */
export function hills(fi: FeatureIndex): Hill[] {
  const cached = hillCache.get(fi);
  if (cached) return cached;
  const g = fi.g;
  const byWay = new Map<number, number[]>();
  for (let e = 0; e < g.edgeCount; e++) {
    if (!g.allowedDirs[e] || g.s.edge_steps[e]! > 0) continue;
    const way = g.s.edge_way[e]!;
    const list = byWay.get(way);
    if (list) list.push(e);
    else byWay.set(way, [e]);
  }
  const out: Hill[] = [];
  for (const [way, edges] of byWay) {
    const net = edges.reduce((s, e) => {
      const c = g.climb(e, true);
      return s + (c ? c[0] - c[1] : 0);
    }, 0);
    if (Math.abs(net) < MIN_HILL_CLIMB_M) continue;
    const path = fi.chain(edges, net > 0);
    if (!path) continue;
    const climbM = path.reduce((s, d) => s + (g.climb(d >>> 1, (d & 1) === 0)?.[0] ?? 0), 0);
    if (climbM >= MIN_HILL_CLIMB_M) out.push({ way, path, climbM });
  }
  hillCache.set(fi, out);
  return out;
}

function workoutMode(fi: FeatureIndex, focus: WorkoutFocus): Mode {
  const stairs = MODES.stairs;
  const hillList = hills(fi);
  const hillOfWay = new Map(hillList.map((h) => [h.way, h]));
  const stairCandidates = (): Collectible[] =>
    fi.staircases.map((s) => ({ key: `s:${s.way}`, path: s.climbPath, value: s.climbM * 1.5 + s.steps / 20 }));
  const hillCandidates = (): Collectible[] => hillList.map((h) => ({ key: `h:${h.way}`, path: h.path, value: h.climbM }));
  return {
    id: "stairs",
    name: "Workout",
    tagline: "",
    cost: stairs.cost,
    collect: {
      candidates: () => (focus === "stairs" ? stairCandidates() : focus === "hills" ? hillCandidates() : [...stairCandidates(), ...hillCandidates()]),
      keysOf: (_fi, d) => {
        const way = fi.g.s.edge_way[d >>> 1]!;
        const keys: string[] = [];
        if (fi.staircaseOfWay.has(way)) keys.push(`s:${way}`);
        const hill = hillOfWay.get(way);
        if (hill && hill.path.includes(d)) keys.push(`h:${way}`);
        return keys;
      },
    },
    score: (s) => s.climbM + s.stepsUp / 10,
  };
}

/** Climbing is cheap; for longer loops, unlit ways cost more. */
function workoutModel(fi: FeatureIndex, focus: WorkoutFocus, minutes: number): CostModel {
  const preferLit = minutes >= LIT_FROM_MINUTES;
  return {
    id: `workout-${focus}-${preferLit ? "lit" : "any"}`,
    turnAware: false,
    minCostPerSecond: 0.4,
    edgeCost: (g, d, t) => {
      const e = d >>> 1;
      let f = 1;
      const up = g.climb(e, (d & 1) === 0)?.[0] ?? 0;
      if (g.s.edge_steps[e]! > 0 && up > 0 && focus !== "hills") f = 0.4;
      else if (up >= 2 && focus !== "stairs") f = 0.5;
      if (preferLit && fi.lit[e] === 2) f *= 1.6;
      return t * Math.max(0.4, f);
    },
  };
}

export interface WorkoutPlan {
  route: Route;
  stats: CostOfFun;
  focus: WorkoutFocus;
  minutes: number;
  summary: string;
  name: string;
  notes: string[];
}

export function planWorkout(router: Router, fi: FeatureIndex, start: number, minutes: number, focus: WorkoutFocus): WorkoutPlan | null {
  const capSeconds = Math.min(minutes * 60, LOOP_MAX_SECONDS);
  const model = workoutModel(fi, focus, minutes);
  let route = collectRoute(router, fi, start, start, workoutMode(fi, focus), model, capSeconds, { maxRetraceShare: LOOP_RETRACE_SHARE });
  // Nothing to collect nearby, or a short loop: wander instead, keeping the longest that fits.
  let wandered = false;
  if (!route || route.timeS < capSeconds * 0.6) {
    for (let k = 0; k < 6; k++) {
      const wander = chaosWaypointRoute(router, fi, start, start, model, capSeconds, start * 13 + minutes + k);
      if (wander && wander.timeS <= capSeconds && (!route || wander.timeS > route.timeS)) {
        route = wander;
        wandered = true;
      }
    }
  }
  if (!route || route.dirEdges.length === 0) return null;
  assertRouteSafe(router.g, route, capSeconds);
  const stats = costOfFun(fi, route);
  const notes: string[] = [];
  if (wandered && (focus === "stairs" ? stats.staircases === 0 : stats.climbM < 10)) {
    notes.push(focus === "stairs" ? "No staircases are within reach of this start, so the loop just wanders." : "It's flat around here, so the loop just wanders.");
  }
  if (stats.unlitM >= 50) notes.push(`About ${Math.round(stats.unlitM / 10) * 10} m of this loop is on paths tagged as unlit.`);
  if (stats.stepsUnknown > 0) notes.push("Some staircases have no direction in the terrain data, so their steps aren't counted as up or down.");
  const bits = [`${(stats.lengthM / 1000).toFixed(1)} km`];
  if (stats.staircases) bits.push(`${stats.staircases} staircase${stats.staircases === 1 ? "" : "s"}`);
  if (stats.stepsUp) bits.push(`${stats.stepsUp} steps up`);
  if (stats.climbM >= 5) bits.push(`${Math.round(stats.climbM)} m climbed`);
  return {
    route,
    stats,
    focus,
    minutes,
    summary: `A ${Math.max(1, Math.round(stats.timeS / 60))}-minute loop: ${bits.join(", ")}.`,
    name: workoutName(stats, focus, minutes),
    notes,
  };
}

function workoutName(stats: CostOfFun, focus: WorkoutFocus, minutes: number): string {
  if (focus === "stairs" && stats.stepsUp >= 300) return `${stats.stepsUp} Steps, Then Home`;
  if (focus === "stairs") return `The ${minutes}-Minute Stair Loop`;
  if (focus === "hills") return stats.climbM >= 80 ? "Hill Repeats, Roughly" : `The ${minutes}-Minute Hill Loop`;
  return "Up, Down, Repeat";
}
