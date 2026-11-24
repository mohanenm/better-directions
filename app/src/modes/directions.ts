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
import type { ModePlan } from "./plan-mode";
import { minutes } from "./stats";

export type StepKind =
  | "start" | "walk" | "stairs-up" | "stairs-down" | "stairs" | "passage" | "corridor"
  | "under-building" | "trail" | "arrive";

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

const QUIPS: Record<ModeId | "normal", { start: string[]; arrive: string[] }> = {
  buildings: {
    start: ["Doors are for amateurs. Let's go through things.", "Today, walls are merely suggestions (mapped ones only)."],
    arrive: ["You went through it all. Literally.", "Architecture: experienced from the inside."],
  },
  trail: {
    start: ["Lace up. Pavement is the enemy.", "Somewhere out there is dirt with your name on it."],
    arrive: ["Your shoes have stories now.", "Trail conquered. Asphalt weeps."],
  },
  stairs: {
    start: ["Your calves called. They want a word.", "Up is the only direction that matters."],
    arrive: ["Legs: jelly. Spirit: soaring.", "Every step counted. Literally, we counted them."],
  },
  parks: {
    start: ["Gotta visit 'em all.", "Grass ahead. Lots of it."],
    arrive: ["Park passport: stamped.", "You are now 40% tree."],
  },
  "no-right": {
    start: ["Right turns are cancelled. Lefts only from here.", "We've lost our right-turn privileges. Onward, leftward."],
    arrive: ["Not a single regret. Or right turn.", "Three lefts make a right, and you made them all."],
  },
  chaos: {
    start: ["The dice have spoken.", "No plan survives this seed. That's the plan."],
    arrive: ["Chaos delivered you safely. Somehow.", "Same destination, entirely different adventure."],
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
    const park = g.s.edge_park[e]!;
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

function turnPhrase(angle: number): string {
  const side = angle > 0 ? "right" : "left";
  const a = Math.abs(angle);
  if (a < 20) return "Continue";
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
  const g = fi.g;
  const route = plan.better;
  const quips = QUIPS[plan.mode];
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
  let prevPark = 0;
  groups.forEach((grp, i) => {
    const first = grp.dirEdges[0]!;
    const at = g.nodeLonLat(g.tail(first));
    const prevLast = i > 0 ? groups[i - 1]!.dirEdges.at(-1)! : -1;
    const turn = prevLast >= 0 ? turnPhrase(turnAngleDeg(g, prevLast, first)) : "Head off";
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
        const flourish = up && plan.mode === "stairs" && grp.steps >= 20 ? ` ${pick(["Glory awaits.", "Feel the burn.", "Onward and upward."], plan.seed, i)}` : "";
        text = up
          ? `Climb ${grp.steps} steps${where}, ${Math.round(grp.climbM)} m up.${flourish}`
          : down
            ? `Head down ${grp.steps} steps${where}.`
            : `Take the ${grp.steps} steps${where}.`;
        break;
      }
      case "passage": {
        kind = "passage";
        const bname = g.area(grp.building)?.name;
        text = `Slip through the passage${bname ? ` in ${bname}` : " through the building"} (${Math.round(grp.lengthM)} m).`;
        break;
      }
      case "corridor": {
        kind = "corridor";
        const venue = g.area(grp.venue)?.name ?? g.area(grp.building)?.name;
        text = `Wander the corridors${venue ? ` of ${venue}` : ""} for ${Math.round(grp.lengthM)} m.`;
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
        text = `${onto} and hit the dirt for ${Math.round(grp.lengthM)} m.`;
        break;
      default:
        text = `${onto} for ${Math.round(grp.lengthM)} m.`;
    }

    if (grp.park && grp.park !== prevPark) {
      const park = g.area(grp.park);
      text += ` You're in ${park?.name ?? "a park"}.`;
    }
    prevPark = grp.park;
    const closure = closureNote(fi, grp);
    if (closure) notes.push(closure);
    steps.push({ kind, text, distanceM: grp.lengthM, at, notes });
  });

  const endAt = g.nodeLonLat(route.nodes.at(-1)!);
  const time = `${minutes(plan.better.timeS)} min instead of ${minutes(plan.normal.timeS)}`;
  steps.push({
    kind: "arrive",
    text: `Arrive at ${toName}: ${time}. ${pick(quips.arrive, plan.seed, 2)}`,
    distanceM: 0,
    at: endAt,
    notes: [],
  });
  return steps;
}
