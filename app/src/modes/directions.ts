/**
 * Step-by-step directions with personality. Pure: same plan, same words.
 *
 * Steps group the route by street and by feature (stairs, passages, corridors, roads under
 * buildings, trails), with turn phrasing from the real angle at each junction. Disclosures
 * (roads under buildings, places that may close) are attached to the step where they apply.
 */
import type { LonLat } from "../graph/graph";
import { turnAngleDeg } from "../router/geometry";
import { hashUnit } from "../router/rng";
import type { FeatureIndex } from "./features";
import type { ModeId } from "./modes";
import type { Route } from "../router/astar";
import type { ModePlan } from "./plan-mode";
import { minutes, TURN_DEG } from "./stats";

export type StepKind =
  | "start" | "walk" | "stairs-up" | "stairs-down" | "stairs" | "passage" | "corridor"
  | "under-building" | "trail" | "stop" | "arrive";

export interface Step {
  kind: StepKind;
  text: string;
  distanceM: number;
  /** Where the step begins. */
  at: LonLat;
  /** Disclosures and warnings for this step (closures, unmapped tunnels). */
  notes: string[];
}

type Category = "plain" | "stairs" | "passage" | "corridor" | "under" | "trail";

interface Group {
  category: Category;
  name: string;
  dirEdges: number[];
  lengthM: number;
  steps: number;
  climbM: number;
  descentM: number;
  park: number;
  building: number;
  venue: number;
}

const GENERIC_NAMES: Record<string, string> = {
  footway: "the footpath",
  path: "the path",
  pedestrian: "the pedestrian street",
  steps: "the stairs",
  corridor: "the corridor",
  service: "the lane",
  living_street: "the shared street",
  track: "the track",
  cycleway: "the shared path",
  platform: "the platform",
};

const QUIPS: Record<ModeId | "normal" | "art" | "workout" | "crawl", { start: string[]; arrive: string[] }> = {
  workout: {
    start: ["Warm up first. Nobody else will remind you.", "Pace yourself; the stairs aren't going anywhere."],
    arrive: ["Done. Stretch, if you're the stretching type.", "That's the loop. Same time next week?"],
  },
  crawl: {
    start: ["Stops are in route order, nothing more.", "Take your time at each stop."],
    arrive: ["That's the lot.", "End of the crawl."],
  },
  art: {
    start: ["Record the walk, or nobody will believe you.", "The drawing only exists if your GPS is on."],
    arrive: ["Done. The shape is in your GPS track, more or less.", "Finished. Squint at the trace."],
  },
  buildings: {
    start: ["Mapped public passages only. If a door is shut, it's shut.", "Through, not round, where the map allows."],
    arrive: ["You've seen more courtyards than most.", "Arrived, mostly indoors."],
  },
  trail: {
    start: ["Expect mud after rain.", "Pavement avoided where possible."],
    arrive: ["Your shoes may need attention.", "Arrived, slightly dustier."],
  },
  stairs: {
    start: ["Mostly uphill, by design.", "There are stairs ahead. That was the idea."],
    arrive: ["Sit down if you like.", "Every step was counted, if mapped."],
  },
  parks: {
    start: ["The scenic route. Very scenic.", "Greenery ahead, in quantity."],
    arrive: ["Arrived, eventually, via the trees.", "That was most of the parks."],
  },
  snacks: {
    start: ["The shops are on the way. Stopping is up to you.", "Pace yourself."],
    arrive: ["Probably later than planned.", "Arrived. Crumbs are your own business."],
  },
  "no-right": {
    start: ["Left turns only. This was your idea.", "Right turns are off the table."],
    arrive: ["Arrived, mostly by turning left.", "Three lefts made several rights."],
  },
  inconvenient: {
    start: ["Straight lines are for other people.", "This will take a while. That's the point."],
    arrive: ["You made it, eventually.", "Arrived. That was annoying on purpose."],
  },
  chaos: {
    start: ["The seed decided this. Take it up with the seed.", "Not the quickest way. Not even close."],
    arrive: ["Arrived. Another seed, another way.", "You got here. The seed is satisfied."],
  },
  normal: { start: ["Off you go."], arrive: ["You're there."] },
};

function pick(list: string[], seed: number, salt: number): string {
  return list[Math.floor(hashUnit(seed, salt) * list.length)]!;
}

export function genericName(highway: string | undefined): string {
  return GENERIC_NAMES[highway ?? ""] ?? "an unnamed street";
}

function categoryOf(fi: FeatureIndex, d: number): Category {
  const g = fi.g;
  const e = d >>> 1;
  const bits = g.meta.flags.edge;
  const flags = g.s.edge_flags[e]!;
  if (g.s.edge_steps[e]! > 0) return "stairs";
  if (flags & bits.under_building) return "under";
  if (flags & bits.through_building) {
    const tags = g.edgeTags(e);
    return tags["highway"] === "corridor" || tags["indoor"] === "corridor" ? "corridor" : "passage";
  }
  if (fi.isTrail[e]) return "trail";
  return "plain";
}

function groupRoute(fi: FeatureIndex, dirEdges: number[]): Group[] {
  const g = fi.g;
  const groups: Group[] = [];
  for (const d of dirEdges) {
    const e = d >>> 1;
    const forward = (d & 1) === 0;
    const category = categoryOf(fi, d);
    const name = g.edgeName(e) || genericName(g.edgeTags(e)["highway"]);
    const last = groups[groups.length - 1];
    const climb = g.climb(e, forward);
    const park = fi.parkOf[e]!;
    if (last && last.category === category && last.name === name && last.park === park) {
      last.dirEdges.push(d);
      last.lengthM += g.s.edge_length_m[e]!;
      last.steps += g.s.edge_steps[e]!;
      if (climb) {
        last.climbM += climb[0];
        last.descentM += climb[1];
      }
      continue;
    }
    groups.push({
      category,
      name,
      dirEdges: [d],
      lengthM: g.s.edge_length_m[e]!,
      steps: g.s.edge_steps[e]!,
      climbM: climb ? climb[0] : 0,
      descentM: climb ? climb[1] : 0,
      park,
      building: g.s.edge_building[e]!,
      venue: g.s.edge_venue[e]!,
    });
  }
  // Fold tiny plain groups (crossings, jogs) into the previous group so steps read naturally.
  const merged: Group[] = [];
  for (const grp of groups) {
    const prev = merged[merged.length - 1];
    if (prev && grp.category === "plain" && prev.category === "plain" && grp.lengthM < 15) {
      prev.dirEdges.push(...grp.dirEdges);
      prev.lengthM += grp.lengthM;
      continue;
    }
    merged.push(grp);
  }
  return merged;
}

const SNACK_RANK = { bakery: 0, pastry: 1, chocolate: 2, ice_cream: 3, cafe: 4 } as const;

/** The best snack stop along a group of edges that hasn't been mentioned yet. */
function bestSnack(fi: FeatureIndex, grp: Group, seen: Set<number>) {
  let best: (typeof fi.snacks)[number] | null = null;
  for (const d of grp.dirEdges) {
    for (const i of fi.snacksOnEdge.get(d >>> 1) ?? []) {
      const s = fi.snacks[i]!;
      if (seen.has(i)) continue;
      if (!best || SNACK_RANK[s.kind] < SNACK_RANK[best.kind]) best = s;
    }
  }
  if (best) for (const d of grp.dirEdges) for (const i of fi.snacksOnEdge.get(d >>> 1) ?? []) seen.add(i);
  return best;
}

/**
 * Same rule as the turn counts in stats.ts: only a junction (three or more ways) is a turn, and
 * under TURN_DEG is carrying on. Bends where a path changes name are just "continue".
 */
function turnPhrase(angle: number, atJunction: boolean): string {
  const side = angle > 0 ? "right" : "left";
  const a = Math.abs(angle);
  if (!atJunction || a <= TURN_DEG) return "Continue";
  if (a < 60) return `Bear ${side}`;
  if (a < 150) return `Turn ${side}`;
  return "Turn around";
}

function closureNote(fi: FeatureIndex, grp: Group): string | null {
  const g = fi.g;
  const bits = g.meta.flags.edge;
  const e = grp.dirEdges.find((d) => g.s.edge_flags[d >>> 1]! & bits.may_close);
  if (e === undefined) return null;
  const edge = e >>> 1;
  const parkRef = grp.park ? g.area(grp.park) : null;
  const hours = g.edgeOpeningHours(edge) || parkRef?.opening_hours || "";
  return hours ? `May be closed outside opening hours (${hours}).` : "May be closed outside opening hours.";
}

export function directions(fi: FeatureIndex, plan: ModePlan, fromName: string, toName: string): Step[] {
  const time = `${minutes(plan.better.timeS)} min instead of ${minutes(plan.normal.timeS)}`;
  return describeRoute(fi, plan.better, {
    quips: plan.mode,
    seed: plan.seed,
    fromName,
    arriveText: `Arrive at ${toName}: ${time}.`,
  });
}

export interface DescribeOptions {
  quips: ModeId | "art" | "workout" | "crawl";
  seed: number;
  fromName: string;
  /** First sentence of the arrival step (a quip follows). */
  arriveText: string;
  /** Stops to call out, in route order, when the route reaches their node. */
  stops?: { node: number; label: string }[];
}

/** Step-by-step directions for any route. */
export function describeRoute(fi: FeatureIndex, route: Route, opts: DescribeOptions): Step[] {
  const g = fi.g;
  const plan = { mode: opts.quips, seed: opts.seed };
  const fromName = opts.fromName;
  const quips = QUIPS[opts.quips];
  const steps: Step[] = [];
  const startAt = g.nodeLonLat(route.nodes[0]!);
  steps.push({
    kind: "start",
    text: `Start at ${fromName}. ${pick(quips.start, plan.seed, 1)}`,
    distanceM: 0,
    at: startAt,
    notes: [],
  });

  const groups = groupRoute(fi, route.dirEdges);
  const pendingStops = [...(opts.stops ?? [])];
  // A stop right at the start is reached before the first step.
  while (pendingStops[0] && pendingStops[0].node === route.nodes[0]) {
    const first = pendingStops.shift()!;
    steps.push({ kind: "stop", text: `${first.label}.`, distanceM: 0, at: g.nodeLonLat(first.node), notes: [] });
  }
  let prevPark = 0;
  const seenSnacks = new Set<number>();
  groups.forEach((grp, i) => {
    const first = grp.dirEdges[0]!;
    const at = g.nodeLonLat(g.tail(first));
    const prevLast = i > 0 ? groups[i - 1]!.dirEdges.at(-1)! : -1;
    const turn = prevLast >= 0 ? turnPhrase(turnAngleDeg(g, prevLast, first), fi.degree[g.tail(first)]! >= 3) : "Head off";
    const onto = turn === "Continue" ? `Continue on ${grp.name}` : `${turn} onto ${grp.name}`;
    const notes: string[] = [];
    let kind: StepKind = "walk";
    let text: string;

    switch (grp.category) {
      case "stairs": {
        const up = grp.climbM > grp.descentM + 0.5;
        const down = grp.descentM > grp.climbM + 0.5;
        kind = up ? "stairs-up" : down ? "stairs-down" : "stairs";
        const where = grp.name === GENERIC_NAMES["steps"] ? "" : ` (${grp.name})`;
        text = up
          ? `Climb ${grp.steps} steps${where}, ${Math.round(grp.climbM)} m up.`
          : down
            ? `Head down ${grp.steps} steps${where}.`
            : `Take the ${grp.steps} steps${where}.`;
        break;
      }
      case "passage": {
        kind = "passage";
        const bname = g.area(grp.building)?.name;
        text = `Go through the passage${bname ? ` in ${bname}` : " under the building"} (${Math.round(grp.lengthM)} m).`;
        break;
      }
      case "corridor": {
        kind = "corridor";
        const venue = g.area(grp.venue)?.name ?? g.area(grp.building)?.name;
        text = `Follow the corridors${venue ? ` of ${venue}` : ""} for ${Math.round(grp.lengthM)} m.`;
        break;
      }
      case "under": {
        kind = "under-building";
        text = `${onto}, passing under a building.`;
        notes.push("No tunnel is mapped here. Check the way under the building is open to walkers.");
        break;
      }
      case "trail":
        kind = "trail";
        text = `${onto}, unpaved, for ${Math.round(grp.lengthM)} m.`;
        break;
      default:
        text = `${onto} for ${Math.round(grp.lengthM)} m.`;
    }

    if (plan.mode === "snacks") {
      const stop = bestSnack(fi, grp, seenSnacks);
      if (stop) {
        text += ` You pass ${stop.name}${stop.openingHours ? ` (open ${stop.openingHours})` : ""}.`;
      }
    }
    if (grp.park && grp.park !== prevPark) {
      const park = g.area(grp.park);
      text += ` You're in ${park?.name ?? "a park"}.`;
    }
    prevPark = grp.park;
    const closure = closureNote(fi, grp);
    if (closure) notes.push(closure);
    steps.push({ kind, text, distanceM: grp.lengthM, at, notes });
    for (const d of grp.dirEdges) {
      const next = pendingStops[0];
      if (next && g.head(d) === next.node) {
        steps.push({ kind: "stop", text: `${next.label}.`, distanceM: 0, at: g.nodeLonLat(next.node), notes: [] });
        pendingStops.shift();
      }
    }
  });

  const endAt = g.nodeLonLat(route.nodes.at(-1)!);
  steps.push({
    kind: "arrive",
    text: `${opts.arriveText} ${pick(quips.arrive, plan.seed, 2)}`,
    distanceM: 0,
    at: endAt,
    notes: [],
  });
  return steps;
}
