/**
 * The modes. Each is a cost model for the router, plus (for collecting modes) the features worth
 * a detour and a score that says which of two routes is more fun.
 *
 * Costs are multiples of walking time. Discounts make a mode's favourite edges cheap; nothing
 * can make an excluded edge usable, and the detour cap is enforced by the planner, not here.
 */
import type { Graph } from "../graph/graph";
import type { CostModel } from "../router/astar";
import { turnAngleDeg } from "../router/geometry";
import { hashUnit } from "../router/rng";
import type { FeatureIndex } from "./features";
import type { CostOfFun } from "./stats";
import { STRAIGHT_DEG, TURN_DEG, U_TURN_DEG } from "./stats";

/**
 * A way's key for candidates: its OpenStreetMap id, which is the same however much of the map is
 * loaded (local way numbers aren't), so ties between candidates break the same way.
 */
export const wayKey = (fi: FeatureIndex, way: number): string => String(fi.g.s.way_osm_id[way]);

export type ModeId = "buildings" | "trail" | "stairs" | "parks" | "snacks" | "no-right" | "inconvenient" | "chaos";

/** A feature worth a detour: walk to the start of `path`, along it, and on from its end. */
export interface Collectible {
  key: string;
  /** Directed edges to walk through the feature (at least one). */
  path: number[];
  value: number;
}

export interface Mode {
  id: ModeId;
  name: string;
  tagline: string;
  /** Cost model for this mode (seed only matters for chaos). */
  cost(fi: FeatureIndex, seed: number): CostModel;
  /** Collecting modes: candidate features, and the feature keys a directed edge counts toward. */
  collect?: {
    candidates(fi: FeatureIndex): Collectible[];
    keysOf(fi: FeatureIndex, dirEdge: number): string[];
    /** Most features to insert (defaults to the search's MAX_WAYPOINTS). */
    maxWaypoints?: number;
  };
  /** Higher is more fun; compares a cost-profile route with a collected one. */
  score(stats: CostOfFun): number;
}

/** A cost model that scales walking time by a per-edge factor (never below `min`). */
const multiplier = (id: string, min: number, factor: (g: Graph, d: number) => number): CostModel => ({
  id,
  turnAware: false,
  minCostPerSecond: min,
  edgeCost: (g, d, t) => t * Math.max(min, factor(g, d)),
});

// --- Through buildings ---------------------------------------------------------------------------

const buildings: Mode = {
  id: "buildings",
  name: "Through buildings",
  tagline: "Public passages, arcades and shopping centres. Why go round?",
  cost: (fi) =>
    multiplier("buildings", 0.15, (g, d) => {
      const e = d >>> 1;
      const f = g.meta.flags.edge;
      const flags = g.s.edge_flags[e]!;
      if (flags & f.through_building) return 0.15;
      if (g.edgeTags(e)["covered"] === "yes") return 0.3;
      if (flags & f.under_building) return 0.6;
      return fi.isPavedRoad[e] ? 1.3 : 1.0;
    }),
  collect: {
    candidates: (fi) =>
      fi.passages.map((p) => ({
        key: `b:${p.area}`,
        path: [p.dirEdge],
        value: 10 + Math.min(p.lengthM, 200) / 10,
      })),
    keysOf: (fi, d) => {
      const e = d >>> 1;
      return fi.g.s.edge_flags[e]! & fi.g.meta.flags.edge.through_building ? [`b:${fi.g.s.edge_building[e]}`] : [];
    },
  },
  score: (s) => s.buildings * 10 + s.passageM / 10 + s.malls * 5 + s.stations * 3 + s.underBuildings * 0.5,
};

// --- Trails -------------------------------------------------------------------------------------

const trail: Mode = {
  id: "trail",
  name: "Trails",
  tagline: "Dirt and gravel over pavement, wherever there's a choice.",
  cost: (fi) =>
    multiplier("trail", 0.25, (g, d) => {
      const e = d >>> 1;
      if (fi.isTrail[e]) return 0.25;
      if (fi.parkOf[e]) return 0.5;
      return fi.isPavedRoad[e] ? 2.0 : 1.0;
    }),
  collect: {
    candidates: (fi) =>
      fi.trails.map((t) => ({
        key: `t:${wayKey(fi, t.way)}`,
        path: t.path,
        value: Math.max(2, Math.min(t.lengthM, 1500) / 50),
      })),
    keysOf: (fi, d) => (fi.isTrail[d >>> 1] ? [`t:${wayKey(fi, fi.g.s.edge_way[d >>> 1]!)}`] : []),
  },
  score: (s) => s.trailM / 50 + s.trails * 3 + s.parkM / 200,
};

// --- Stairs --------------------------------------------------------------------------------------

const stairs: Mode = {
  id: "stairs",
  name: "Stairs",
  tagline: "Seeks out staircases, mostly going up.",
  cost: (fi) =>
    multiplier("stairs", 0.1, (g, d) => {
      const e = d >>> 1;
      if (g.s.edge_steps[e]! > 0) {
        const c = g.climb(e, (d & 1) === 0);
        if (!c || c[0] === c[1]) return 0.2;
        return c[0] > c[1] ? 0.1 : 0.3; // up is the point; down is the price
      }
      return fi.isPavedRoad[e] ? 1.1 : 1.0;
    }),
  collect: {
    candidates: (fi) =>
      fi.staircases.map((s) => ({
        key: `s:${wayKey(fi, s.way)}`,
        path: s.climbPath,
        value: 5 + Math.min(s.climbM, 60) / 2 + Math.min(s.steps, 400) / 40,
      })),
    keysOf: (fi, d) => {
      const sc = fi.staircaseOfWay.get(fi.g.s.edge_way[d >>> 1]!);
      return sc === undefined ? [] : [`s:${wayKey(fi, fi.staircases[sc]!.way)}`];
    },
  },
  score: (s) => s.staircases * 10 + s.stepsUp / 10 + s.stepsUnknown / 20 + s.stepsDown / 40,
};

// --- Parks ---------------------------------------------------------------------------------------

const parks: Mode = {
  id: "parks",
  name: "Parks",
  tagline: "As many parks as the detour allows.",
  cost: (fi) =>
    multiplier("parks", 0.3, (g, d) => {
      const e = d >>> 1;
      if (fi.parkOf[e]) return 0.3;
      if (fi.isTrail[e]) return 0.7;
      return fi.isPavedRoad[e] ? 1.2 : 1.0;
    }),
  collect: {
    candidates: (fi) =>
      fi.parks.map((p) => ({
        key: `p:${p.area}`,
        path: [p.dirEdge],
        value: 10 + Math.min(p.pathLengthM, 2000) / 200,
      })),
    keysOf: (fi, d) => {
      const park = fi.parkOf[d >>> 1]!;
      return park ? [`p:${park}`] : [];
    },
  },
  score: (s) => s.parks * 10 + s.parkM / 100,
};

// --- Snacks ---------------------------------------------------------------------------------------

const SNACK_VALUE = { bakery: 12, pastry: 12, chocolate: 10, ice_cream: 10, cafe: 7 } as const;

const snacks: Mode = {
  id: "snacks",
  name: "Snacks",
  tagline: "Past bakeries, pâtisseries, chocolatiers and cafés.",
  cost: (fi) =>
    multiplier("snacks", 0.5, (g, d) => {
      const e = d >>> 1;
      if (fi.snacksOnEdge.has(e)) return 0.5; // window-shopping is half the fun
      const hw = g.edgeTags(e)["highway"];
      if (hw === "pedestrian" || hw === "living_street") return 0.8;
      return fi.isPavedRoad[e] ? 1.1 : 1.0;
    }),
  collect: {
    candidates: (fi) =>
      fi.snacks.map((s) => ({ key: `k:${s.index}`, path: [s.dirEdge], value: SNACK_VALUE[s.kind] })),
    keysOf: (fi, d) => (fi.snacksOnEdge.get(d >>> 1) ?? []).map((i) => `k:${i}`),
    maxWaypoints: 4, // a walk with snacks, not a crawl
  },
  score: (s) =>
    s.snacks.bakery * 10 + s.snacks.pastry * 10 + s.snacks.chocolate * 8 + s.snacks.ice_cream * 8 + Math.min(s.snacks.cafe, 4) * 4,
};

// --- Left turns only -----------------------------------------------------------------------------

/** Seconds of "pain" per right turn or U-turn: big enough to avoid them almost always. */
export const RIGHT_TURN_PENALTY_S = 1200;

const noRight: Mode = {
  id: "no-right",
  name: "Left turns only",
  tagline: "Left, or straight on. Never right, if it can help it.",
  cost: (fi) => ({
    id: "no-right",
    turnAware: true,
    minCostPerSecond: 1,
    edgeCost: (g, d, t, prev) => {
      if (prev < 0 || fi.degree[g.tail(d)]! < 3) return t;
      const angle = turnAngleDeg(g, prev, d);
      return angle > TURN_DEG || Math.abs(angle) > U_TURN_DEG ? t + RIGHT_TURN_PENALTY_S : t;
    },
  }),
  score: (s) => -s.rightTurns * 100 - s.uTurns * 100 + s.leftTurns,
};

// --- Most inconvenient --------------------------------------------------------------------------

/** Cost per busy-road crossing; the planner raises it if the route still crosses more than normal. */
export const CROSSING_PENALTIES_S = [900, 4000, 20000] as const;
const INCONVENIENT_MIN = 0.35;

/** Cheap: turning at junctions, climbing or descending. Dear: going straight, crossing busy roads. */
export function inconvenientModel(fi: FeatureIndex, crossingPenaltyS: number): CostModel {
  return {
    id: `inconvenient-${crossingPenaltyS}`,
    turnAware: true,
    minCostPerSecond: INCONVENIENT_MIN,
    edgeCost: (g, d, t, prev) => {
      const e = d >>> 1;
      let factor = 1;
      let extra = 0;
      const climb = g.climb(e, (d & 1) === 0);
      if (climb && climb[0] + climb[1] >= 2) factor *= 0.45;
      if (prev >= 0) {
        const node = g.tail(d);
        if (fi.degree[node]! >= 3) {
          const angle = Math.abs(turnAngleDeg(g, prev, d));
          if (angle > TURN_DEG && angle <= U_TURN_DEG) factor *= 0.45;
          else if (angle <= STRAIGHT_DEG) extra += 45;
        }
        if (fi.busyNode[node] && !fi.isBusy[prev >>> 1] && !fi.isBusy[e]) extra += crossingPenaltyS;
      }
      return t * Math.max(INCONVENIENT_MIN, factor) + extra;
    },
  };
}

const inconvenient: Mode = {
  id: "inconvenient",
  name: "Most inconvenient",
  tagline: "Zig-zags, needless hills, nothing straight. No extra busy-road crossings.",
  cost: (fi) => inconvenientModel(fi, CROSSING_PENALTIES_S[0]),
  score: (s) => s.leftTurns + s.rightTurns + 2 * s.straightSkips + (s.climbM + s.descentM) / 5 - 50 * s.busyCrossings,
};

// --- Random -------------------------------------------------------------------------------------

const CHAOS_MIN = 0.25;
const CHAOS_MAX = 4;
const COARSE_DEG = 0.006; // ~500-650 m blobs: sweeping detours
const FINE_DEG = 0.0015; // ~120-170 m: local wiggles

function valueNoise(seed: number, x: number, y: number, cell: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number): number => hashUnit(seed, Math.imul(i, 73856093) ^ Math.imul(j, 19349663));
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
  return top + (bottom - top) * sy;
}

const chaosCache = new WeakMap<FeatureIndex, Map<number, Float32Array>>();

/** Per-edge weights for a seed: smooth noise, so a seed makes big, shareable detours. */
export function chaosWeights(fi: FeatureIndex, seed: number): Float32Array {
  let bySeed = chaosCache.get(fi);
  if (!bySeed) chaosCache.set(fi, (bySeed = new Map()));
  let w = bySeed.get(seed);
  if (!w) {
    w = new Float32Array(fi.g.edgeCount);
    const ratio = Math.log(CHAOS_MAX / CHAOS_MIN);
    for (let e = 0; e < fi.g.edgeCount; e++) {
      const x = fi.midLon[e]!;
      const y = fi.midLat[e]!;
      const n = 0.7 * valueNoise(seed, x, y, COARSE_DEG) + 0.3 * valueNoise(seed ^ 0x5bd1e995, x, y, FINE_DEG);
      w[e] = CHAOS_MIN * Math.exp(ratio * n);
    }
    if (bySeed.size > 8) bySeed.clear();
    bySeed.set(seed, w);
  }
  return w;
}

const chaos: Mode = {
  id: "chaos",
  name: "Random",
  tagline: "A different detour for every seed. The scenic route. Very scenic.",
  cost: (fi, seed) => {
    const w = chaosWeights(fi, seed);
    return {
      id: `chaos-${seed}`,
      turnAware: false,
      minCostPerSecond: CHAOS_MIN,
      edgeCost: (_g, d, t) => t * w[d >>> 1]!,
    };
  },
  score: () => 0,
};

export const MODES: Readonly<Record<ModeId, Mode>> = Object.freeze({
  buildings,
  trail,
  stairs,
  parks,
  snacks,
  "no-right": noRight,
  inconvenient,
  chaos,
});

export const MODE_IDS = Object.keys(MODES) as ModeId[];
