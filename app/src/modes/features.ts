/**
 * Per-graph feature index, built once: what's a trail, where the staircases, parks and passages
 * are, and a good waypoint for visiting each. Modes and the cost-of-fun stats both read it.
 */
import type { CrawlKind, SnackKind } from "../graph/format";
import type { Graph } from "../graph/graph";

const UNPAVED = new Set([
  "unpaved", "dirt", "earth", "ground", "gravel", "fine_gravel", "compacted", "grass", "mud",
  "sand", "woodchips", "pebblestone", "rock",
]);
const PAVED = new Set([
  "paved", "asphalt", "concrete", "paving_stones", "sett", "cobblestone", "unhewn_cobblestone",
  "concrete:plates", "concrete:lanes", "metal", "wood", "bricks",
]);

/** Dirt, gravel and friends; or a path or track with no paved surface mapped. */
export function isTrailTags(tags: Readonly<Record<string, string>>): boolean {
  const surface = tags["surface"];
  if (surface !== undefined) return UNPAVED.has(surface);
  const hw = tags["highway"];
  return hw === "path" || hw === "track";
}

export function isPavedRoadTags(tags: Readonly<Record<string, string>>): boolean {
  const hw = tags["highway"] ?? "";
  if (["footway", "path", "pedestrian", "steps", "corridor", "track", "platform"].includes(hw)) return false;
  const surface = tags["surface"];
  return surface === undefined || PAVED.has(surface);
}

/** Staircases shorter than this don't count as "a staircase" in the stats (kerbs, single steps). */
export const MIN_STAIRCASE_STEPS = 5;

export interface Staircase {
  way: number;
  edges: number[];
  steps: number;
  /** Directed edges climbing the whole staircase (its longest connected run), bottom to top. */
  climbPath: number[];
  climbM: number;
  name: string;
}

export interface ParkInfo {
  area: number;
  name: string;
  /** A park path edge near the middle of the park's paths, as a directed edge: the waypoint. */
  dirEdge: number;
  pathLengthM: number;
}

export interface PassageInfo {
  /** Index into meta.areas of the building passed through. */
  area: number;
  name: string;
  /** Longest passage edge through this building, as a directed edge. */
  dirEdge: number;
  lengthM: number;
  kind: "passage" | "corridor" | "covered";
}

export interface TrailStretch {
  way: number;
  edges: number[];
  lengthM: number;
  /** Directed edges walking the stretch end to end (its longest connected run). */
  path: number[];
}

export const SNACK_KINDS: ReadonlySet<string> = new Set(["bakery", "pastry", "chocolate", "ice_cream", "cafe"]);

export type CrawlTheme = "art" | "pub" | "wine";
export const CRAWL_THEME_OF: Readonly<Record<CrawlKind, CrawlTheme>> = {
  artwork: "art", gallery: "art", museum: "art",
  pub: "pub", bar: "pub", brewery: "pub",
  wine_bar: "wine", winery: "wine", wine_shop: "wine",
};

/** Roads where crossing means stepping into real traffic. */
const BUSY_ROADS = new Set(["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "trunk", "trunk_link"]);

export interface CrawlStop {
  index: number;
  kind: CrawlKind;
  theme: CrawlTheme;
  name: string;
  edge: number;
  dirEdge: number;
  openingHours: string;
}

export interface SnackStop {
  index: number;
  kind: SnackKind;
  name: string;
  edge: number;
  /** An allowed direction of the shop's street, as a directed edge: the waypoint. */
  dirEdge: number;
  openingHours: string;
}

export class FeatureIndex {
  readonly isTrail: Uint8Array;
  readonly isPavedRoad: Uint8Array;
  /** Incident edge count per node (both directions counted once). */
  readonly degree: Uint8Array;
  readonly midLon: Float32Array;
  readonly midLat: Float32Array;
  readonly staircases: Staircase[] = [];
  /** Way index -> staircase index, for step edges. */
  readonly staircaseOfWay = new Map<number, number>();
  readonly parks: ParkInfo[] = [];
  readonly passages: PassageInfo[] = [];
  readonly trails: TrailStretch[] = [];
  readonly snacks: SnackStop[] = [];
  readonly crawlStops: CrawlStop[] = [];
  /** 1 on primary, secondary, tertiary and trunk roads (and links). */
  readonly isBusy: Uint8Array;
  /** 1 where a node touches a busy road. */
  readonly busyNode: Uint8Array;
  /** Street lighting from the lit tag: 1 lit, 2 explicitly unlit, 0 unknown. */
  readonly lit: Uint8Array;
  /** Edge -> snack stops on it. */
  readonly snacksOnEdge = new Map<number, number[]>();

  constructor(readonly g: Graph) {
    const E = g.edgeCount;
    this.isTrail = new Uint8Array(E);
    this.isPavedRoad = new Uint8Array(E);
    this.degree = new Uint8Array(g.nodeCount);
    this.midLon = new Float32Array(E);
    this.midLat = new Float32Array(E);
    this.isBusy = new Uint8Array(E);
    this.busyNode = new Uint8Array(g.nodeCount);
    this.lit = new Uint8Array(E);
    const bits = g.meta.flags.edge;

    const stairEdges = new Map<number, number[]>();
    const trailEdges = new Map<number, number[]>();
    const parkEdges = new Map<number, number[]>();
    const passageBest = new Map<number, { edge: number; len: number; kind: PassageInfo["kind"] }>();

    for (let e = 0; e < E; e++) {
      if (!g.allowedDirs[e]) continue;
      const tags = g.edgeTags(e);
      const u = g.s.edge_from[e]!;
      const v = g.s.edge_to[e]!;
      this.degree[u] = Math.min(255, this.degree[u]! + 1);
      this.degree[v] = Math.min(255, this.degree[v]! + 1);
      const [lu, au] = g.nodeLonLat(u);
      const [lv, av] = g.nodeLonLat(v);
      this.midLon[e] = (lu + lv) / 2;
      this.midLat[e] = (au + av) / 2;
      const way = g.s.edge_way[e]!;
      const len = g.s.edge_length_m[e]!;

      if (isTrailTags(tags)) {
        this.isTrail[e] = 1;
        push(trailEdges, way, e);
      }
      if (isPavedRoadTags(tags)) this.isPavedRoad[e] = 1;
      if (BUSY_ROADS.has(tags["highway"] ?? "")) {
        this.isBusy[e] = 1;
        this.busyNode[u] = 1;
        this.busyNode[v] = 1;
      }
      const litTag = tags["lit"];
      if (litTag === "no" || litTag === "disused") this.lit[e] = 2;
      else if (litTag !== undefined) this.lit[e] = 1;
      if (g.s.edge_steps[e]! > 0) push(stairEdges, way, e);
      const park = g.s.edge_park[e]!;
      if (park) push(parkEdges, park, e);
      if (g.s.edge_flags[e]! & bits.through_building) {
        const b = g.s.edge_building[e]!;
        const kind: PassageInfo["kind"] =
          tags["tunnel"] === "building_passage" ? "passage" : tags["covered"] === "yes" ? "covered" : "corridor";
        const best = passageBest.get(b);
        if (!best || len > best.len) passageBest.set(b, { edge: e, len, kind });
      }
    }

    for (const [way, edges] of stairEdges) {
      const steps = edges.reduce((s, e) => s + g.s.edge_steps[e]!, 0);
      if (steps < MIN_STAIRCASE_STEPS) continue;
      const netForward = edges.reduce((s, e) => {
        const c = g.climb(e, true);
        return s + (c ? c[0] - c[1] : 0);
      }, 0);
      const climbPath = this.chain(edges, netForward >= 0);
      if (!climbPath) continue;
      this.staircaseOfWay.set(way, this.staircases.length);
      this.staircases.push({ way, edges, steps, climbPath, climbM: Math.abs(netForward), name: g.edgeName(edges[0]!) });
    }

    for (const [area, edges] of parkEdges) {
      let sx = 0;
      let sy = 0;
      let total = 0;
      for (const e of edges) {
        const len = g.s.edge_length_m[e]!;
        sx += this.midLon[e]! * len;
        sy += this.midLat[e]! * len;
        total += len;
      }
      if (total < 30) continue; // a sliver of a park, not worth a visit
      const cx = sx / total;
      const cy = sy / total;
      let bestEdge = -1;
      let bestD = Infinity;
      for (const e of edges) {
        const d = (this.midLon[e]! - cx) ** 2 + (this.midLat[e]! - cy) ** 2;
        if (d < bestD || (d === bestD && e < bestEdge)) {
          bestD = d;
          bestEdge = e;
        }
      }
      const dirEdge = g.allowedDirs[bestEdge]! & 1 ? bestEdge * 2 : bestEdge * 2 + 1;
      const ref = g.area(area);
      this.parks.push({ area, name: ref?.name ?? "an unnamed park", dirEdge, pathLengthM: total });
    }

    for (const [area, best] of passageBest) {
      const dirEdge = g.allowedDirs[best.edge]! & 1 ? best.edge * 2 : best.edge * 2 + 1;
      this.passages.push({ area, name: g.area(area)?.name ?? "", dirEdge, lengthM: best.len, kind: best.kind });
    }

    for (const poi of g.meta.pois ?? []) {
      const allowed = g.allowedDirs[poi.edge];
      if (!allowed) continue; // the audit disabled its street
      const dirEdge = allowed & 1 ? poi.edge * 2 : poi.edge * 2 + 1;
      const openingHours = poi.opening_hours ?? "";
      if (SNACK_KINDS.has(poi.kind)) {
        const index = this.snacks.length;
        this.snacks.push({ index, kind: poi.kind as SnackKind, name: poi.name, edge: poi.edge, dirEdge, openingHours });
        push(this.snacksOnEdge, poi.edge, index);
      } else if (poi.kind in CRAWL_THEME_OF) {
        const kind = poi.kind as CrawlKind;
        this.crawlStops.push({ index: this.crawlStops.length, kind, theme: CRAWL_THEME_OF[kind], name: poi.name, edge: poi.edge, dirEdge, openingHours });
      }
    }

    for (const [way, edges] of trailEdges) {
      const path = this.chain(edges, true);
      if (!path) continue;
      const lengthM = path.reduce((s, d) => s + g.s.edge_length_m[d >>> 1]!, 0);
      if (lengthM < 100) continue;
      this.trails.push({ way, edges, lengthM, path });
    }
  }

  /**
   * The longest connected run of a way's edges, as directed edges in walking order. Walks it
   * forward along the way if `preferForward` and allowed, else backward; null if neither works.
   */
  chain(edges: number[], preferForward: boolean): number[] | null {
    const g = this.g;
    const sorted = [...edges].sort((a, b) => a - b); // the build emits a way's edges in order
    let best: number[] = [];
    let run: number[] = [];
    for (const e of sorted) {
      const prev = run[run.length - 1];
      if (prev !== undefined && g.s.edge_to[prev] === g.s.edge_from[e]) run.push(e);
      else run = [e];
      if (run.length > best.length) best = [...run];
    }
    const allow = (bit: number) => best.every((e) => g.allowedDirs[e]! & bit);
    for (const forward of preferForward ? [true, false] : [false, true]) {
      if (!allow(forward ? 1 : 2)) continue;
      return forward ? best.map((e) => e * 2) : best.reverse().map((e) => e * 2 + 1);
    }
    return null;
  }
}

function push(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
