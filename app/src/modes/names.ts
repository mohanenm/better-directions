/**
 * Route names: "Stairway to Somewhere", "Through the Shops", "The Croissant Route".
 * Deterministic: the same route, mode and seed always get the same name. Names come from the
 * route's own stats and, where it reads well, a real place on it (a staircase, a park).
 */
import type { Route } from "../router/astar";
import { hashUnit } from "../router/rng";
import type { FeatureIndex } from "./features";
import type { ModeId } from "./modes";
import type { CostOfFun } from "./stats";
import { DETOUR } from "../safety/limits";

function choose(options: string[], seed: number, route: Route): string {
  const key = route.dirEdges.reduce((h, d) => (Math.imul(h, 31) + d) >>> 0, route.dirEdges.length);
  return options[Math.floor(hashUnit(seed, key) * options.length)]!;
}

/** The longest named staircase climbed on the route, if any. */
function signatureStaircase(fi: FeatureIndex, route: Route): string | null {
  let best: { name: string; steps: number } | null = null;
  for (const d of route.dirEdges) {
    const sc = fi.staircaseOfWay.get(fi.g.s.edge_way[d >>> 1]!);
    if (sc === undefined) continue;
    const s = fi.staircases[sc]!;
    if (s.name && s.name !== "" && (!best || s.steps > best.steps)) best = { name: s.name, steps: s.steps };
  }
  return best?.name ?? null;
}

/** The park the route spends longest in, if it has a name. */
function signaturePark(fi: FeatureIndex, route: Route): string | null {
  const metres = new Map<number, number>();
  for (const d of route.dirEdges) {
    const park = fi.parkOf[d >>> 1]!;
    if (park) metres.set(park, (metres.get(park) ?? 0) + fi.g.s.edge_length_m[d >>> 1]!);
  }
  let best: [number, number] | null = null;
  for (const entry of metres) if (!best || entry[1] > best[1]) best = entry;
  return best ? (fi.g.area(best[0])?.name ?? null) : null;
}

/** What each collecting mode looks for, for "none found" notes. */
export const MODE_FEATURE: Partial<Record<ModeId, string>> = {
  buildings: "public passages or arcades",
  trail: "dirt or gravel paths",
  stairs: "staircases",
  parks: "parks",
  snacks: "bakeries, cafés or sweet shops",
};

/** Whether the route has any of what its mode looks for. Modes that collect nothing always do. */
export function deliversMode(mode: ModeId, stats: CostOfFun): boolean {
  switch (mode) {
    case "buildings": return stats.buildings > 0 || stats.malls > 0;
    case "trail": return stats.trailShare > 0.02;
    case "stairs": return stats.staircases > 0;
    case "parks": return stats.parks > 0;
    case "snacks": return Object.values(stats.snacks).some((n) => n > 0);
    default: return true;
  }
}

export type SameAsNormal = "too-long" | "already" | "nothing-here" | "no-detour";

/**
 * Whether the better route is really the normal one (or under a minute longer), and why: the
 * normal walk already fills the time limit; it already does what the mode asks; there's none of
 * the mode's feature within reach; or no detour fits. Null when there's a real detour.
 */
export function sameAsNormalReason(p: { mode: ModeId; normal: Route; better: Route; normalStats: CostOfFun; betterStats: CostOfFun }): SameAsNormal | null {
  if (p.better.timeS - p.normal.timeS >= 60) return null;
  if (p.normal.timeS >= DETOUR.maxSeconds - 60) return "too-long";
  if (p.mode === "no-right" && p.normalStats.rightTurns === 0) return "already";
  if (MODE_FEATURE[p.mode] && !deliversMode(p.mode, p.betterStats)) return "nothing-here";
  return "no-detour";
}

export function routeName(fi: FeatureIndex, mode: ModeId, stats: CostOfFun, route: Route, seed: number, normal?: CostOfFun): string {
  const pick = (options: string[]) => choose(options, seed, route);
  // Don't name a route for something it doesn't have.
  if (!deliversMode(mode, stats)) return pick(["A Different Way Round", "The Long Way, Plainly"]);
  switch (mode) {
    case "stairs": {
      const stair = signatureStaircase(fi, route);
      if (stats.stepsUp >= 300) return pick([`${stats.stepsUp} Steps Up`, "Stairway to Somewhere", "The Long Way Up"]);
      if (stair) return pick([`Via ${stair}`, `${stair}, and Then Some`]);
      return pick(["The Stair Route", "Up and Over", "The Step Collector"]);
    }
    case "buildings":
      if (stats.malls) return pick(["Through the Shops", "Indoors, Mostly"]);
      if (stats.buildings >= 5) return pick(["Through the Walls", "The Passage Route", "The Traboule Route"]);
      return pick(["The Inside Route", "A Short Cut Through"]);
    case "trail":
      if (stats.trailShare >= 0.5) return pick(["Mostly Unpaved", "The Gravel Route", "Mud Optional"]);
      return pick(["Paths Less Paved", "Some Dirt Involved", "Off the Pavement"]);
    case "parks": {
      const park = signaturePark(fi, route);
      if (stats.parks >= 5) return pick([`${stats.parks} Parks`, "Park to Park", "The Green Route"]);
      if (park) return pick([`Via ${park}`, `A Stroll Through ${park}`]);
      return pick(["The Leafy Route", "Some Grass Involved"]);
    }
    case "snacks": {
      const sweet = stats.snacks.bakery + stats.snacks.pastry + stats.snacks.chocolate;
      if (stats.snacks.bakery >= 3) return pick(["The Croissant Route", "Bakery to Bakery", "Carbohydrate Corridor"]);
      if (sweet >= 2) return pick(["The Pastry Route", "Sugar, Then Walking"]);
      return pick(["The Coffee Route", "Snacks Available"]);
    }
    case "no-right":
      if (stats.rightTurns === 0 && normal?.rightTurns === 0) return pick(["No Rights Needed", "Left Was Always Enough"]);
      return stats.rightTurns === 0
        ? pick(["Left, Left, Left", "The Sinister Route", "No Rights Reserved"])
        : pick(["Mostly Left", "Nearly Sinister"]);
    case "inconvenient": {
      const turns = stats.leftTurns + stats.rightTurns + stats.uTurns;
      return pick([`${turns} Turns Later`, "Every Which Way", "Zig, Then Zag", "The Long Way Round"]);
    }
    case "chaos":
      return pick([`Seed ${seed}`, `Detour #${seed}`, "The Scenic Route. Very Scenic.", "The Long Way, Randomly"]);
  }
}
