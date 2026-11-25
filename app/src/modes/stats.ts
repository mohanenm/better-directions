/**
 * The cost of fun: what a route gives you, and what it costs in time.
 * "Normal: 6 min. Better: 23 min, 4 staircases, 2 malls, 1 trail."
 */
import type { Route } from "../router/astar";
import { turnAngleDeg } from "../router/geometry";
import type { FeatureIndex } from "./features";
import { MIN_STAIRCASE_STEPS } from "./features";

/** A turn is a change of heading of more than this at a junction with a real choice. */
export const TURN_DEG = 30;
export const U_TURN_DEG = 150;
const TRAIL_STRETCH_M = 150;

export interface ClosureNote {
  name: string;
  openingHours: string;
}

export interface CostOfFun {
  timeS: number;
  lengthM: number;
  staircases: number;
  stepsUp: number;
  stepsDown: number;
  /** Steps on staircases whose direction the terrain data couldn't tell. */
  stepsUnknown: number;
  climbM: number;
  descentM: number;
  buildings: number;
  buildingNames: string[];
  passageM: number;
  /** Roads under buildings with no tunnel mapped: always disclosed. */
  underBuildings: number;
  malls: number;
  stations: number;
  trailM: number;
  trailShare: number;
  trails: number;
  parks: number;
  parkNames: string[];
  parkM: number;
  leftTurns: number;
  rightTurns: number;
  uTurns: number;
  /** Metres of the route on edges it walks more than once (doubling back). */
  retracedM: number;
  /** Snack stops the route walks past, by kind, and their names in route order. */
  snacks: Record<"bakery" | "pastry" | "chocolate" | "ice_cream" | "cafe", number>;
  snackNames: string[];
  mayClose: ClosureNote[];
  /** Turns taken at junctions where carrying straight on was possible. */
  straightSkips: number;
  /** Times the route crosses a primary, secondary, tertiary or trunk road. */
  busyCrossings: number;
  /** Metres on ways tagged lit=no. */
  unlitM: number;
}

/** Within this many degrees of straight ahead counts as "you could have gone straight". */
export const STRAIGHT_DEG = 20;

export function costOfFun(fi: FeatureIndex, route: Route): CostOfFun {
  const g = fi.g;
  const bits = g.meta.flags.edge;
  const stats: CostOfFun = {
    timeS: route.timeS, lengthM: route.lengthM, staircases: 0, stepsUp: 0, stepsDown: 0,
    stepsUnknown: 0, climbM: 0, descentM: 0, buildings: 0, buildingNames: [], passageM: 0,
    underBuildings: 0, malls: 0, stations: 0, trailM: 0, trailShare: 0, trails: 0, parks: 0,
    parkNames: [], parkM: 0, leftTurns: 0, rightTurns: 0, uTurns: 0, retracedM: 0, mayClose: [],
    snacks: { bakery: 0, pastry: 0, chocolate: 0, ice_cream: 0, cafe: 0 }, snackNames: [],
    straightSkips: 0, busyCrossings: 0, unlitM: 0,
  };
  const staircases = new Set<number>();
  const buildings = new Map<number, string>();
  const parks = new Map<number, string>();
  const venues = new Set<number>();
  const closures = new Map<string, ClosureNote>();
  let trailRun = 0;
  const walked = new Set<number>();

  route.dirEdges.forEach((d, i) => {
    const e = d >>> 1;
    const forward = (d & 1) === 0;
    const len = g.s.edge_length_m[e]!;
    const flags = g.s.edge_flags[e]!;
    if (walked.has(e)) stats.retracedM += len;
    else {
      for (const si of fi.snacksOnEdge.get(e) ?? []) {
        const snack = fi.snacks[si]!;
        stats.snacks[snack.kind]++;
        stats.snackNames.push(snack.name);
      }
    }
    walked.add(e);
    const climb = g.climb(e, forward);
    if (climb) {
      stats.climbM += climb[0];
      stats.descentM += climb[1];
    }

    const steps = g.s.edge_steps[e]!;
    if (steps > 0) {
      const sc = fi.staircaseOfWay.get(g.s.edge_way[e]!);
      if (sc !== undefined) staircases.add(sc);
      if (!climb || climb[0] === climb[1]) stats.stepsUnknown += steps;
      else if (climb[0] > climb[1]) stats.stepsUp += steps;
      else stats.stepsDown += steps;
    }

    if (flags & bits.through_building) {
      const b = g.s.edge_building[e]!;
      buildings.set(b, g.area(b)?.name ?? "");
      stats.passageM += len;
    }
    if (flags & bits.under_building) stats.underBuildings++;

    const venue = g.s.edge_venue[e]!;
    if (venue) venues.add(venue);

    const park = g.s.edge_park[e]!;
    if (park) {
      parks.set(park, g.area(park)?.name ?? "");
      stats.parkM += len;
    }

    if (fi.isTrail[e]) {
      stats.trailM += len;
      trailRun += len;
    }
    if (!fi.isTrail[e] || i === route.dirEdges.length - 1) {
      if (trailRun >= TRAIL_STRETCH_M) stats.trails++;
      trailRun = 0;
    }

    if (flags & bits.may_close) {
      const parkRef = park ? g.area(park) : null;
      const hours = g.edgeOpeningHours(e) || parkRef?.opening_hours || "";
      const name = parkRef?.opening_hours ? (parkRef.name ?? "a park") : g.edgeName(e) || g.area(g.s.edge_building[e]!)?.name || "a passage";
      const key = `${name}|${hours}`;
      if (!closures.has(key)) closures.set(key, { name, openingHours: hours });
    }

    if (fi.lit[e] === 2) stats.unlitM += len;
    if (i > 0) {
      const node = g.tail(d);
      const prev = route.dirEdges[i - 1]!;
      if (fi.degree[node]! >= 3) {
        const angle = turnAngleDeg(g, prev, d);
        if (Math.abs(angle) > U_TURN_DEG) stats.uTurns++;
        else if (angle > TURN_DEG) stats.rightTurns++;
        else if (angle < -TURN_DEG) stats.leftTurns++;
        if (Math.abs(angle) > TURN_DEG && canGoStraight(g, prev, node)) stats.straightSkips++;
      }
      if (fi.busyNode[node] && !fi.isBusy[prev >>> 1] && !fi.isBusy[e]) stats.busyCrossings++;
    }
  });

  for (const sc of staircases) if (fi.staircases[sc]!.steps >= MIN_STAIRCASE_STEPS) stats.staircases++;
  stats.buildings = buildings.size;
  stats.buildingNames = [...buildings.values()].filter(Boolean);
  stats.parks = parks.size;
  stats.parkNames = [...parks.values()].filter(Boolean);
  for (const v of venues) {
    const kind = g.area(v)?.kind;
    if (kind === "mall") stats.malls++;
    if (kind === "station") stats.stations++;
  }
  stats.trailShare = route.lengthM > 0 ? stats.trailM / route.lengthM : 0;
  stats.mayClose = [...closures.values()];
  return stats;
}

/** Whether some allowed edge leaves `node` within STRAIGHT_DEG of the heading along `prev`. */
function canGoStraight(g: FeatureIndex["g"], prev: number, node: number): boolean {
  for (let i = g.outStart[node]!; i < g.outStart[node + 1]!; i++) {
    const out = g.outDirEdge[i]!;
    if (out >>> 1 === prev >>> 1) continue;
    if (Math.abs(turnAngleDeg(g, prev, out)) <= STRAIGHT_DEG) return true;
  }
  return false;
}

export function minutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "Normal: 6 min. Better: 23 min, 4 staircases, 2 malls, 1 trail." */
export function summarise(normal: CostOfFun, better: CostOfFun, extras: string[] = []): string {
  const bits: string[] = [];
  if (better.staircases) bits.push(plural(better.staircases, "staircase"));
  if (better.stepsUp >= 20) bits.push(`${better.stepsUp} steps up`);
  if (better.buildings) bits.push(plural(better.buildings, "building") + " walked through");
  if (better.malls) bits.push(plural(better.malls, "mall"));
  if (better.stations) bits.push(plural(better.stations, "station"));
  if (better.trails) bits.push(plural(better.trails, "trail"));
  if (better.parks) bits.push(plural(better.parks, "park"));
  bits.push(...extras);
  const tail = bits.length ? `, ${bits.join(", ")}` : "";
  return `Normal: ${minutes(normal.timeS)} min. Better: ${minutes(better.timeS)} min${tail}.`;
}

const SNACK_WORDS: Record<keyof CostOfFun["snacks"], [string, string]> = {
  bakery: ["bakery", "bakeries"],
  pastry: ["pâtisserie", "pâtisseries"],
  chocolate: ["chocolatier", "chocolatiers"],
  ice_cream: ["ice-cream shop", "ice-cream shops"],
  cafe: ["café", "cafés"],
};

/** "3 bakeries, 1 chocolatier, 2 cafés" */
export function snackSummary(stats: CostOfFun): string[] {
  return (Object.keys(SNACK_WORDS) as (keyof CostOfFun["snacks"])[])
    .filter((k) => stats.snacks[k] > 0)
    .map((k) => `${stats.snacks[k]} ${SNACK_WORDS[k][stats.snacks[k] === 1 ? 0 : 1]}`);
}

/** "48 turns, 31 m up and 29 m down, could have gone straight 12 times" */
export function inconvenienceSummary(stats: CostOfFun): string[] {
  const out = [plural(stats.leftTurns + stats.rightTurns + stats.uTurns, "turn")];
  if (stats.climbM >= 5 || stats.descentM >= 5) out.push(`${Math.round(stats.climbM)} m up and ${Math.round(stats.descentM)} m down`);
  if (stats.straightSkips) out.push(`could have gone straight ${plural(stats.straightSkips, "time")}`);
  return out;
}
