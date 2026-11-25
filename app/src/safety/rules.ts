/**
 * The hard safety rules, TypeScript side. Mirrors pipeline/bdgraph/safety.py exactly; both must
 * pass every case in safety/cases.json. No mode, weight or setting can change these.
 */

import type { Tags } from "../graph/format";

const WALKABLE_HIGHWAYS = new Set([
  "footway", "path", "pedestrian", "steps", "corridor", "living_street", "track", "platform",
  "residential", "service", "unclassified",
  "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link",
]);
const NEEDS_FOOT_PERMISSION = new Set(["cycleway", "bridleway"]);
const FAST_ROADS = new Set(["motorway", "motorway_link", "trunk", "trunk_link"]);
const FORBIDDEN_ACCESS = new Set(["private", "no"]);
const FORBIDDEN_FOOT = new Set(["no", "private", "use_sidepath"]);
const FOOT_PERMITTED = new Set(["yes", "designated", "permissive"]);
const SIDEWALK_PRESENT = new Set(["both", "left", "right", "yes"]);
const OK_SAC_SCALES = new Set(["hiking", "mountain_hiking"]);
const BAD_TRAIL_VISIBILITY = new Set(["bad", "horrible", "no"]);

const UNDER_BUILDING_ROADS = new Set([
  "residential", "service", "unclassified", "living_street",
  "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link",
  "trunk", "trunk_link", "motorway", "motorway_link",
]);

const RAILWAY_CROSSINGS = new Set(["crossing", "level_crossing", "tram_crossing", "tram_level_crossing"]);
const RAILWAY_NON_TRACK = new Set([
  "platform", "platform_edge", "station", "halt", "stop", "buffer_stop", "signal_box",
  "turntable", "traverser", "subway_entrance", "train_station_entrance", "funicular_entrance",
  "tram_stop",
]);
const LINEAR_BARRIERS = new Set(["wall", "fence", "hedge", "retaining_wall", "city_wall", "guard_rail", "ditch"]);
const BARRIER_OPENINGS = new Set([
  "gate", "entrance", "opening", "lift_gate", "swing_gate", "kissing_gate", "stile", "turnstile",
  "bollard", "cycle_barrier", "full-height_turnstile", "hampshire_gate", "sliding_gate",
  "wicket_gate",
]);
const CROSSING_HIGHWAY_NODES = new Set(["crossing", "traffic_signals"]);

const has = (set: Set<string>, v: string | undefined): boolean => v !== undefined && set.has(v);

// Busy roads whose sidewalks are mapped separately, or that have none, aren't walked down the middle.
const BUSY_CARRIAGEWAYS = new Set(["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"]);

export function sidewalksMappedSeparately(tags: Tags): boolean {
  if (tags["sidewalk"] === "separate" || tags["sidewalk:both"] === "separate") return true;
  return tags["sidewalk:left"] === "separate" && tags["sidewalk:right"] === "separate";
}

export function hasMappedSidewalk(tags: Tags): boolean {
  if (has(SIDEWALK_PRESENT, tags["sidewalk"])) return true;
  return ["left", "right", "both"].some((side) => tags[`sidewalk:${side}`] === "yes");
}

/** Why a way must never be walked, or null if it's walkable. */
export function wayExclusion(tags: Tags): string | null {
  const hw = tags["highway"];
  if (hw === undefined) return "not_highway";
  if ("railway" in tags) return "railway";
  if (hw === "construction" || hw === "proposed" || "construction" in tags) return "construction";
  if (has(FORBIDDEN_ACCESS, tags["access"])) return "access";
  if (has(FORBIDDEN_FOOT, tags["foot"])) return "foot";

  if (FAST_ROADS.has(hw)) {
    if (!(tags["foot"] === "yes" || hasMappedSidewalk(tags))) return "fast_road";
  } else if (NEEDS_FOOT_PERMISSION.has(hw)) {
    if (!has(FOOT_PERMITTED, tags["foot"])) return "no_foot_permission";
  } else if (!WALKABLE_HIGHWAYS.has(hw)) {
    return "highway_kind";
  }

  if (BUSY_CARRIAGEWAYS.has(hw) && !has(FOOT_PERMITTED, tags["foot"])) {
    if (sidewalksMappedSeparately(tags)) return "sidewalk_separate";
    if (tags["sidewalk"] === "no" || tags["sidewalk"] === "none") return "no_sidewalk";
  }

  const indoor = tags["indoor"];
  if (hw !== "corridor" && indoor !== undefined && indoor !== "no" && indoor !== "corridor") {
    return "indoor_not_corridor";
  }
  const conveying = tags["conveying"];
  if (conveying !== undefined && conveying !== "forward" && conveying !== "backward" && conveying !== "no") {
    return "escalator_direction_unknown";
  }
  const sac = tags["sac_scale"];
  if (sac !== undefined && !OK_SAC_SCALES.has(sac)) return "sac_scale";
  if (has(BAD_TRAIL_VISIBILITY, tags["trail_visibility"])) return "trail_visibility";
  return null;
}

export const isBuildingPassage = (tags: Tags): boolean => tags["tunnel"] === "building_passage";
export const isCovered = (tags: Tags): boolean => tags["covered"] === "yes";
export const isIndoorCorridor = (tags: Tags): boolean =>
  tags["highway"] === "corridor" || tags["indoor"] === "corridor";

export function mayPassThroughBuilding(tags: Tags): boolean {
  if (isBuildingPassage(tags) || isCovered(tags) || isIndoorCorridor(tags)) return true;
  const bridge = tags["bridge"];
  return tags["tunnel"] === "yes" || (bridge !== undefined && bridge !== "no");
}

// Through a building that isn't public-facing, a passage or corridor needs explicit public
// access, a street name, or a confirmation: many run through homes, offices and campuses.
const PUBLIC_BUILDINGS = new Set([
  "retail", "commercial", "mall", "supermarket", "kiosk", "train_station", "transportation", "public", "civic",
]);
export const PUBLIC_AREA_KINDS = new Set(["mall", "station"]);
const PASSAGE_ACCESS_OK = new Set(["yes", "permissive"]);
const PASSAGE_FOOT_OK = new Set(["yes", "permissive", "designated", "customers"]);

export interface PassageBuilding {
  kind?: string | null;
  building?: string | null;
}

/** Why a passage or corridor through `building` must not be used, or null. */
export function passageExclusion(
  tags: Tags,
  name: string,
  building: PassageBuilding | null,
  opts: { inPublicVenue?: boolean; confirmed?: boolean } = {},
): string | null {
  if (building === null || !(isBuildingPassage(tags) || isIndoorCorridor(tags))) return null;
  if (opts.confirmed || opts.inPublicVenue) return null;
  if (has(PASSAGE_ACCESS_OK, tags["access"]) || has(PASSAGE_FOOT_OK, tags["foot"])) return null;
  if (has(PUBLIC_AREA_KINDS, building.kind ?? undefined) || has(PUBLIC_BUILDINGS, building.building ?? undefined)) return null;
  if (name !== "" && !isIndoorCorridor(tags) && !name.toLowerCase().includes("traboule")) return null;
  return "passage_not_public";
}

// Ground the public can't enter: military land never; other private or no-access areas only on
// explicitly public ways. The build applies this geometrically; the shared cases keep it in step.
const WAY_PUBLIC_ACCESS = new Set(["yes", "permissive"]);
const WAY_PUBLIC_FOOT = new Set(["yes", "designated", "permissive"]);

export const isMilitaryArea = (tags: Tags): boolean =>
  tags["landuse"] === "military" || (tags["military"] !== undefined && tags["military"] !== "no");

export function restrictedAreaExclusion(wayTags: Tags, areaTags: Tags): string | null {
  if (isMilitaryArea(areaTags)) return "military_area";
  if (has(FORBIDDEN_ACCESS, areaTags["access"])) {
    if (has(WAY_PUBLIC_ACCESS, wayTags["access"]) || has(WAY_PUBLIC_FOOT, wayTags["foot"])) return null;
    return "restricted_area";
  }
  return null;
}

export function mayPassUnderBuildingUnmapped(tags: Tags): boolean {
  const indoor = tags["indoor"];
  return has(UNDER_BUILDING_ROADS, tags["highway"]) && !("level" in tags) && (indoor === undefined || indoor === "no");
}

/** Which directions (forward, backward along the way) a pedestrian may walk. */
export function footDirections(tags: Tags): [boolean, boolean] {
  const conveying = tags["conveying"];
  if (conveying === "forward") return [true, false];
  if (conveying === "backward") return [false, true];

  let oneway = tags["oneway:foot"];
  if (oneway === undefined && has(PEDESTRIAN_ONEWAY_KINDS, tags["highway"])) oneway = tags["oneway"];
  let fwd = true;
  let bwd = true;
  if (oneway === "yes") bwd = false;
  else if (oneway === "-1") fwd = false;
  if (has(FORBIDDEN_FOOT, tags["foot:forward"])) fwd = false;
  if (has(FORBIDDEN_FOOT, tags["foot:backward"])) bwd = false;
  return [fwd, bwd];
}
const PEDESTRIAN_ONEWAY_KINDS = new Set(["footway", "path", "steps", "corridor", "pedestrian", "platform"]);

export function isTrackRailwayWay(tags: Tags): boolean {
  const rw = tags["railway"];
  return rw !== undefined && !RAILWAY_NON_TRACK.has(rw);
}

export interface NodeContext {
  on_railway?: boolean;
  on_fast_road?: boolean;
  on_linear_barrier?: boolean;
}

/** Why a route must never pass through this node, or null. */
export function nodeExclusion(tags: Tags, ctx: NodeContext = {}): string | null {
  const foot = tags["foot"];
  if (has(FORBIDDEN_FOOT, foot)) return "node_foot";
  if (has(FORBIDDEN_ACCESS, tags["access"]) && !has(FOOT_PERMITTED, foot)) return "node_access";
  if (tags["locked"] === "yes") return "node_locked";
  if (tags["crossing"] === "no") return "node_crossing_no";
  if (ctx.on_railway && !has(RAILWAY_CROSSINGS, tags["railway"])) return "railway_unmapped_crossing";
  if (ctx.on_fast_road && !(has(CROSSING_HIGHWAY_NODES, tags["highway"]) || "crossing" in tags)) {
    return "fast_road_unmarked_crossing";
  }
  if (ctx.on_linear_barrier && !(has(BARRIER_OPENINGS, tags["barrier"]) || "entrance" in tags)) {
    return "barrier_no_opening";
  }
  return null;
}

export const isLinearBarrierWay = (tags: Tags): boolean => has(LINEAR_BARRIERS, tags["barrier"]);
