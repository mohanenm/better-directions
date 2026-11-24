/**
 * Route names: "The Stairmaster Special", "Mall Rat Express", "The Croissant Crawl".
 * Deterministic: the same route, mode and seed always get the same name. Names come from the
 * route's own stats and, where it reads well, a real place on it (a staircase, a park).
 */
import type { Route } from "../router/astar";
import { hashUnit } from "../router/rng";
import type { FeatureIndex } from "./features";
import type { ModeId } from "./modes";
import type { CostOfFun } from "./stats";

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
    const park = fi.g.s.edge_park[d >>> 1]!;
    if (park) metres.set(park, (metres.get(park) ?? 0) + fi.g.s.edge_length_m[d >>> 1]!);
  }
  let best: [number, number] | null = null;
  for (const entry of metres) if (!best || entry[1] > best[1]) best = entry;
  return best ? (fi.g.area(best[0])?.name ?? null) : null;
}

export function routeName(fi: FeatureIndex, mode: ModeId, stats: CostOfFun, route: Route, seed: number): string {
  const pick = (options: string[]) => choose(options, seed, route);
  switch (mode) {
    case "stairs": {
      const stair = signatureStaircase(fi, route);
      if (stats.stepsUp >= 300) return pick([`The ${stats.stepsUp}-Step Stairmaster Special`, "The Calf Destroyer Deluxe", "Stairway to Somewhere"]);
      if (stair) return pick([`The ${stair} Calf Crusher`, `${stair} or Bust`]);
      return pick(["The Stairmaster Special", "Up, Up and Away", "The Step Collector"]);
    }
    case "buildings":
      if (stats.malls) return pick(["Mall Rat Express", "The Window Shopper's Shortcut"]);
      if (stats.buildings >= 5) return pick(["The Secret Passage Shuffle", "Through the Walls Tour", "The Traboule Tango"]);
      return pick(["The Inside Track", "The Short Cut Through"]);
    case "trail":
      if (stats.trailShare >= 0.5) return pick(["The Mud Lover's Mile", "Dirt Road Diva", "Gravel Rush"]);
      return pick(["The Off-Pavement Express", "Trail Mix", "Paths Less Paved"]);
    case "parks": {
      const park = signaturePark(fi, route);
      if (stats.parks >= 5) return pick([`The ${stats.parks}-Park Picnic Parade`, "The Completionist's Park Tour", "The Green Grand Tour"]);
      if (park) return pick([`The ${park} Ramble`, `A Stroll Through ${park}`]);
      return pick(["The Leafy Loop", "Park Life"]);
    }
    case "snacks": {
      const sweet = stats.snacks.bakery + stats.snacks.pastry + stats.snacks.chocolate;
      if (stats.snacks.bakery >= 3) return pick(["The Croissant Crawl", "The Bakery Blitz", "Carb Loading Loop"]);
      if (sweet >= 2) return pick(["The Pastry Pilgrimage", "Sugar Rush Route"]);
      return pick(["The Coffee Run", "Snack Attack"]);
    }
    case "no-right":
      return stats.rightTurns === 0
        ? pick(["The Sinister Circuit", "Port Side Promenade", "Left Lane Legend"])
        : pick(["Mostly Left", "The Nearly Sinister Circuit"]);
    case "chaos":
      return pick([`Chaos Route #${seed}`, "The Butterfly Effect", "The Scenic Tangent", `Adventure #${seed}`]);
  }
}
