/**
 * An oracle for the property tests, written from the promises in the README's Safety section.
 *
 * It imports nothing from src/safety (rules.ts or limits.ts) on purpose. It's a second, separate
 * reading of the promises, so a bug or a quiet change in the router's own rules can't also hide
 * in the check. Every number and tag value here is a literal. If you change a rule or a limit,
 * this file has to change too, in the same commit as the README.
 *
 * Where it can, it's a little stricter than the rules: values are trimmed, lower-cased and split
 * on ";" everywhere, not only for access and foot. It can't check promises the graph has no data
 * for. Restricted ground (military land, prisons, the closed sites a city lists) is applied
 * geometrically by the build, so it's tested in the pipeline, not here.
 */

import type { DecodedGraph } from "../src/graph/format";

export type Tags = Readonly<Record<string, string>>;

/** Every tag key the oracle reads. The build must keep all of them (checked in oracle.test.ts). */
export const ORACLE_WAY_KEYS = [
  "highway", "railway", "construction", "access", "foot", "motorroad", "service",
  "sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right",
  "conveying", "sac_scale", "oneway", "oneway:foot", "foot:forward", "foot:backward",
  "tunnel", "covered", "indoor", "bridge", "level",
] as const;
export const ORACLE_NODE_KEYS = ["access", "foot", "locked", "crossing", "railway", "highway", "barrier", "entrance"] as const;

/** A tag's values, trimmed, lower-cased and split on ";", or [] when the tag is absent. */
function values(tags: Tags, key: string): string[] {
  const raw = tags[key];
  if (raw === undefined) return [];
  const out = raw.split(";").map((v) => v.trim().toLowerCase()).filter((v) => v !== "");
  return out.length ? out : [""];
}
const one = (tags: Tags, key: string): string | undefined => values(tags, key)[0];
const anyOf = (tags: Tags, key: string, list: readonly string[]): boolean => values(tags, key).some((v) => list.includes(v));
const allOf = (tags: Tags, key: string, list: readonly string[]): boolean => {
  const vs = values(tags, key);
  return vs.length > 0 && vs.every((v) => list.includes(v));
};

// README: "a way or gate is walkable only if its access is absent or open to the public (yes,
// permissive, designated, public, destination or customers)".
const OPEN = ["yes", "permissive", "designated", "public", "destination", "customers"];
// README: on a way, "all but private and no give way to explicit foot permission"; on a gate or
// bollard, foot permission wins over any access value (access=no, foot=yes is how OSM says "no
// vehicles, walkers welcome").
const NEVER_ON_WAYS = ["private", "no"];
const FOOT_GRANTED = ["yes", "designated", "permissive"];
// README: "The same goes for foot". foot=official is the legal form of designated in some
// countries (Germany, Austria), so it's open as well.
const FOOT_OPEN = ["yes", "permissive", "designated", "official", "destination", "customers"];

function accessBroken(tags: Tags, gate: boolean): string | null {
  for (const v of values(tags, "foot")) if (!FOOT_OPEN.includes(v)) return `foot=${v}`;
  const granted = allOf(tags, "foot", FOOT_GRANTED);
  for (const v of values(tags, "access")) {
    if (!gate && NEVER_ON_WAYS.includes(v)) return `access=${v}`;
    if (!OPEN.includes(v) && !granted) return `access=${v}`;
  }
  return null;
}

// README: "Walking only." These are every highway kind a walker may use, plus fast roads and
// cycle or bridle ways, which have conditions below.
const WALKING = [
  "footway", "path", "pedestrian", "steps", "corridor", "living_street", "track", "platform",
  "residential", "service", "unclassified",
  "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link",
];
const FAST = ["motorway", "motorway_link", "trunk", "trunk_link"];
const NOT_FOR_WALKERS_UNLESS_SIGNED = ["cycleway", "bridleway"];
const BUSY = ["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"];
const NO_SIDEWALK = ["no", "none"];

function sidewalkEverywhere(tags: Tags, list: readonly string[]): boolean {
  if (anyOf(tags, "sidewalk", list) || anyOf(tags, "sidewalk:both", list)) return true;
  return anyOf(tags, "sidewalk:left", list) && anyOf(tags, "sidewalk:right", list);
}
function sidewalkMapped(tags: Tags): boolean {
  if (anyOf(tags, "sidewalk", ["yes", "both", "left", "right"])) return true;
  return ["sidewalk:both", "sidewalk:left", "sidewalk:right"].some((k) => anyOf(tags, k, ["yes"]));
}

/** Which README promise walking this way would break, or null if none. */
export function wayPromiseBroken(tags: Tags): string | null {
  const hw = one(tags, "highway");
  if (hw === undefined) return "not a path or street";
  if ("railway" in tags) return "railway";
  if (hw === "construction" || hw === "proposed" || "construction" in tags) return "construction";
  const access = accessBroken(tags, false);
  if (access) return access;
  const footGranted = allOf(tags, "foot", FOOT_GRANTED);
  if (anyOf(tags, "motorroad", ["yes"]) && !footGranted) return "motorroad=yes";
  if (hw === "service" && anyOf(tags, "service", ["driveway"]) && !footGranted && !allOf(tags, "access", ["yes", "permissive"])) {
    return "driveway";
  }
  if (FAST.includes(hw)) {
    // README: "Never on motorways or trunk roads unless they have foot=yes or a mapped sidewalk."
    if (!(one(tags, "foot") === "yes" || sidewalkMapped(tags))) return `${hw} without foot=yes or a sidewalk`;
  } else if (NOT_FOR_WALKERS_UNLESS_SIGNED.includes(hw)) {
    if (!footGranted) return `${hw} without foot permission`;
  } else if (!WALKING.includes(hw)) {
    return `highway=${hw}`;
  }
  if (BUSY.includes(hw) && !footGranted) {
    // README: "On a busy road with no sidewalk on either side, nothing. Where the sidewalk is
    // mapped as a separate way on both sides, the router uses those."
    if (sidewalkEverywhere(tags, NO_SIDEWALK)) return "busy road with no sidewalk";
    if (sidewalkEverywhere(tags, ["separate"])) return "busy road with separate sidewalks";
  }
  // README: "It excludes escalators with unknown direction, mountain paths..."
  const conveying = one(tags, "conveying");
  if (conveying !== undefined && !["forward", "backward", "no"].includes(conveying)) return "escalator of unknown direction";
  const sac = one(tags, "sac_scale");
  if (sac !== undefined && !["hiking", "mountain_hiking"].includes(sac)) return `mountain path (sac_scale=${sac})`;
  return null;
}

/** Which directions along the way someone on foot may walk, read from the OSM tags. */
export function walkingDirections(tags: Tags): [forward: boolean, backward: boolean] {
  const conveying = one(tags, "conveying");
  if (conveying === "forward") return [true, false];
  if (conveying === "backward") return [false, true];
  // A plain oneway binds walkers only on ways built for them; on a road it's for traffic.
  const footOnly = ["footway", "path", "steps", "corridor", "pedestrian", "platform"].includes(one(tags, "highway") ?? "");
  const oneway = "oneway:foot" in tags ? one(tags, "oneway:foot") : footOnly ? one(tags, "oneway") : undefined;
  const refused = ["no", "private", "use_sidepath"];
  return [oneway !== "-1" && !anyOf(tags, "foot:forward", refused), oneway !== "yes" && !anyOf(tags, "foot:backward", refused)];
}

export interface NodeSurroundings {
  onRailway: boolean;
  onFastRoad: boolean;
  onFenceOrWall: boolean;
}

/** Which README promise passing this node would break, or null if none. */
export function nodePromiseBroken(tags: Tags, around: NodeSurroundings): string | null {
  const access = accessBroken(tags, true);
  if (access) return `gate: ${access}`;
  if (one(tags, "locked") === "yes") return "locked";
  if (one(tags, "crossing") === "no") return "crossing=no";
  // README: "Railways are crossed only at mapped crossings with foot access."
  if (around.onRailway && !anyOf(tags, "railway", ["crossing", "level_crossing", "tram_crossing", "tram_level_crossing"])) {
    return "railway without a mapped crossing";
  }
  if (around.onFastRoad && !(anyOf(tags, "highway", ["crossing", "traffic_signals"]) || "crossing" in tags)) {
    return "fast road without a marked crossing";
  }
  // README: "It excludes ... gaps in fences that aren't gates".
  const barrier = one(tags, "barrier");
  const opening = barrier !== undefined && !["wall", "fence", "hedge", "retaining_wall", "city_wall", "guard_rail", "ditch", "yes"].includes(barrier);
  if (around.onFenceOrWall && !opening && !("entrance" in tags)) return "gap in a fence or wall that isn't a gate";
  return null;
}

export interface Building {
  kind?: string | null;
  building?: string | null;
}

/**
 * For a way the build found running through a building: which promise it would break, or null.
 * README: "'Through a building' means a mapped passage (tunnel=building_passage, covered=yes,
 * highway=corridor or indoor=corridor) and only where it's plausibly public: through a shop,
 * mall or station, or with public access tags, a street name, or a confirmation against the
 * city's list." Bridges and tunnels inside a building's outline are on another level.
 */
export function passagePromiseBroken(
  tags: Tags,
  name: string,
  building: Building | null,
  evidence: { inMallOrStation: boolean; confirmed: boolean },
): string | null {
  const corridor = one(tags, "highway") === "corridor" || one(tags, "indoor") === "corridor";
  const passage = one(tags, "tunnel") === "building_passage" || one(tags, "covered") === "yes" || corridor;
  if (!passage) {
    const bridge = one(tags, "bridge");
    const otherLevel = one(tags, "tunnel") === "yes" || (bridge !== undefined && bridge !== "no");
    return otherLevel ? null : "through a building without a mapped passage";
  }
  if (building === null) return null; // not inside a building after all
  if (evidence.confirmed || evidence.inMallOrStation) return null;
  if (anyOf(tags, "access", ["yes", "permissive"]) || anyOf(tags, "foot", ["yes", "permissive", "designated", "customers"])) return null;
  if (building.kind === "mall" || building.kind === "station") return null;
  const shopsAndStations = ["retail", "commercial", "mall", "supermarket", "kiosk", "train_station", "transportation", "public", "civic"];
  if (shopsAndStations.includes((building.building ?? "").toLowerCase())) return null;
  if (name.trim() !== "" && !corridor && !name.toLowerCase().includes("traboule")) return null;
  return "passage through a building with no sign it's public";
}

/** README: "Streets that run under a building without a mapped tunnel are kept". Streets only. */
export function underBuildingPromiseBroken(tags: Tags): string | null {
  const streets = [
    "residential", "service", "unclassified", "living_street",
    "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link",
    "trunk", "trunk_link", "motorway", "motorway_link",
  ];
  if (!streets.includes(one(tags, "highway") ?? "")) return "not a street, under a building";
  if ("level" in tags) return "on a level inside a building";
  const indoor = one(tags, "indoor");
  if (indoor !== undefined && indoor !== "no") return "indoors";
  return null;
}

// --- Time limits, from the README, as literals ------------------------------------------------

const HOUR = 3600;

/**
 * README: "A better route takes at most four times the normal walking time, and never more than
 * an hour unless the normal walk is longer. Tick 'Longer walk' and it may take up to two hours,
 * and may always add up to half an hour to the normal walk."
 */
export function detourLimitSeconds(normalSeconds: number, longer: boolean): number {
  const ceiling = longer ? 2 * HOUR : HOUR;
  const limit = Math.max(normalSeconds, Math.min(4 * normalSeconds, ceiling));
  return longer ? Math.max(limit, Math.min(normalSeconds + HOUR / 2, 4 * normalSeconds)) : limit;
}

/** README: "Crawls and workouts are limited to the length you pick, up to two hours". */
export const loopLimitSeconds = (minutes: number): number => Math.min(minutes * 60, 2 * HOUR);

/** README: "shapes to an hour, or an hour and a half for the 1 h 15 option". */
export const shapeLimitSeconds = (minutes: number): number => (minutes > 60 ? 1.5 * HOUR : HOUR);

/** Words are spelled within an hour. */
export const WORD_LIMIT_SECONDS = HOUR;

// --- A whole graph -------------------------------------------------------------------------------

/** Every broken promise in a decoded graph, as "edge 12 (way 345): reason" lines. */
export function brokenPromises(g: DecodedGraph): string[] {
  const { meta, s } = g;
  const bits = meta.flags.edge;
  const ctx = meta.flags.node_ctx;
  const confirmed = new Set(meta.confirmed_passages ?? []);
  const out: string[] = [];
  const nodeReason = (n: number): string | null =>
    nodePromiseBroken(meta.node_tagsets[s.node_tagset[n]!]!, {
      onRailway: (s.node_ctx[n]! & ctx.on_railway) !== 0,
      onFastRoad: (s.node_ctx[n]! & ctx.on_fast_road) !== 0,
      onFenceOrWall: (s.node_ctx[n]! & ctx.on_linear_barrier) !== 0,
    });
  for (let e = 0; e < meta.counts.edges; e++) {
    const flags = s.edge_flags[e]!;
    const fwd = (flags & bits.forward) !== 0;
    const bwd = (flags & bits.backward) !== 0;
    if (!fwd && !bwd) continue; // in the file but not walkable either way
    const w = s.edge_way[e]!;
    const tags = meta.tagsets[s.way_tagset[w]!]!;
    const where = `edge ${e} (way ${s.way_osm_id[w]}) ${JSON.stringify(tags)}`;
    const reasons = [wayPromiseBroken(tags), nodeReason(s.edge_from[e]!), nodeReason(s.edge_to[e]!)];
    const [okFwd, okBwd] = walkingDirections(tags);
    if ((fwd && !okFwd) || (bwd && !okBwd)) reasons.push("walkable the wrong way");
    if (flags & bits.through_building) {
      const venue = meta.areas[s.edge_venue[e]!] ?? null;
      reasons.push(
        passagePromiseBroken(tags, meta.strings[s.way_name[w]!] ?? "", meta.areas[s.edge_building[e]!] ?? null, {
          inMallOrStation: venue !== null && (venue.kind === "mall" || venue.kind === "station"),
          confirmed: confirmed.has(s.way_osm_id[w]!),
        }),
      );
    }
    if (flags & bits.under_building) reasons.push(underBuildingPromiseBroken(tags));
    for (const r of reasons) if (r) out.push(`${where}: ${r}`);
  }
  return out;
}
