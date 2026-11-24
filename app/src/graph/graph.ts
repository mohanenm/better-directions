/**
 * In-memory walking graph: decoded sections, adjacency, geometry, and a load-time safety audit.
 *
 * The audit re-runs the hard safety rules on every edge and node (defence in depth: the build
 * already applied them). Anything that fails is disabled and reported; the router never uses a
 * disabled edge or direction.
 */

import { decodeGraph, type AreaRef, type DecodedGraph, type GraphMeta, type GraphSections, type Tags } from "./format";
import { bearingDeg } from "../router/geometry";
import {
  footDirections,
  mayPassThroughBuilding,
  mayPassUnderBuildingUnmapped,
  nodeExclusion,
  wayExclusion,
} from "../safety/rules";

export type LonLat = [lon: number, lat: number];

export interface AuditViolation {
  kind: "way" | "node" | "direction" | "through_building" | "under_building";
  edge: number;
  reason: string;
}

export class Graph {
  readonly meta: GraphMeta;
  readonly s: GraphSections;
  readonly nodeCount: number;
  readonly edgeCount: number;
  /** Bit 0: forward allowed, bit 1: backward allowed, after the audit. */
  readonly allowedDirs: Uint8Array;
  readonly violations: readonly AuditViolation[];
  /** CSR adjacency: for node n, directed edges outEdge[outStart[n]..outStart[n+1]). */
  readonly outStart: Uint32Array;
  /** Directed edge ids: edge * 2 + (forward ? 0 : 1). */
  readonly outDirEdge: Uint32Array;
  private readonly scale: number;
  private bearingCache: { start: Float32Array; end: Float32Array } | null = null;

  constructor(decoded: DecodedGraph) {
    this.meta = decoded.meta;
    this.s = decoded.s;
    this.nodeCount = this.meta.counts.nodes;
    this.edgeCount = this.meta.counts.edges;
    this.scale = this.meta.coord_scale;
    const audit = auditGraph(decoded);
    this.allowedDirs = audit.allowedDirs;
    this.violations = audit.violations;
    [this.outStart, this.outDirEdge] = buildAdjacency(decoded, this.allowedDirs);
  }

  static fromBuffer(buffer: ArrayBuffer): Graph {
    return new Graph(decodeGraph(buffer));
  }

  wayTags(way: number): Tags {
    return this.meta.tagsets[this.s.way_tagset[way]!]!;
  }

  edgeTags(edge: number): Tags {
    return this.wayTags(this.s.edge_way[edge]!);
  }

  edgeName(edge: number): string {
    return this.meta.strings[this.s.way_name[this.s.edge_way[edge]!]!] ?? "";
  }

  edgeOpeningHours(edge: number): string {
    return this.meta.strings[this.s.way_opening_hours[this.s.edge_way[edge]!]!] ?? "";
  }

  area(index: number): AreaRef | null {
    return index === 0 ? null : (this.meta.areas[index] ?? null);
  }

  hasFlag(edge: number, bit: number): boolean {
    return (this.s.edge_flags[edge]! & bit) !== 0;
  }

  nodeLonLat(node: number): LonLat {
    return [this.s.node_lon[node]! / this.scale, this.s.node_lat[node]! / this.scale];
  }

  /** Tail and head nodes of a directed edge. */
  tail(dirEdge: number): number {
    const e = dirEdge >>> 1;
    return dirEdge & 1 ? this.s.edge_to[e]! : this.s.edge_from[e]!;
  }

  head(dirEdge: number): number {
    const e = dirEdge >>> 1;
    return dirEdge & 1 ? this.s.edge_from[e]! : this.s.edge_to[e]!;
  }

  /** Points of an edge in walking order, endpoints included. */
  edgePoints(edge: number, forward = true): LonLat[] {
    const s = this.s;
    const u = s.edge_from[edge]!;
    let x = s.node_lon[u]!;
    let y = s.node_lat[u]!;
    const pts: LonLat[] = [[x / this.scale, y / this.scale]];
    let pos = s.edge_geom_offset[edge]!;
    const end = s.edge_geom_offset[edge + 1]!;
    let pending: number | null = null;
    while (pos < end) {
      let n = 0;
      let shift = 0;
      let b: number;
      do {
        b = s.geom[pos++]!;
        n += (b & 0x7f) * 2 ** shift;
        shift += 7;
      } while (b >= 0x80);
      const v = n % 2 === 0 ? n / 2 : -(n + 1) / 2;
      if (pending === null) {
        pending = v;
      } else {
        x += pending;
        y += v;
        pts.push([x / this.scale, y / this.scale]);
        pending = null;
      }
    }
    const v = s.edge_to[edge]!;
    pts.push([s.node_lon[v]! / this.scale, s.node_lat[v]! / this.scale]);
    return forward ? pts : pts.reverse();
  }

  /**
   * Bearings (degrees from north) of each directed edge's first and last segment, computed once
   * on first use. Turn-aware modes read these on every relaxation.
   */
  bearings(): { start: Float32Array; end: Float32Array } {
    if (!this.bearingCache) {
      const start = new Float32Array(this.edgeCount * 2);
      const end = new Float32Array(this.edgeCount * 2);
      for (let e = 0; e < this.edgeCount; e++) {
        const pts = this.edgePoints(e);
        const n = pts.length;
        const first = bearingDeg(pts[0]!, pts[1]!);
        const last = bearingDeg(pts[n - 2]!, pts[n - 1]!);
        start[e * 2] = first;
        end[e * 2] = last;
        // Walking backward: start along the reversed last segment, end along the reversed first.
        start[e * 2 + 1] = (last + 180) % 360;
        end[e * 2 + 1] = (first + 180) % 360;
      }
      this.bearingCache = { start, end };
    }
    return this.bearingCache;
  }

  /** (climb, descent) in metres walking the edge in the given direction, or null if unknown. */
  climb(edge: number, forward: boolean): [number, number] | null {
    const up = this.s.edge_climb_dm[edge]!;
    const down = this.s.edge_descent_dm[edge]!;
    if (up === this.meta.climb_unknown) return null;
    return forward ? [up / 10, down / 10] : [down / 10, up / 10];
  }
}

export function auditGraph(g: DecodedGraph): { allowedDirs: Uint8Array; violations: AuditViolation[] } {
  const { meta, s } = g;
  const bits = meta.flags.edge;
  const ctxBits = meta.flags.node_ctx;
  const violations: AuditViolation[] = [];

  const wayOk = new Uint8Array(meta.counts.ways);
  const wayReason: (string | null)[] = [];
  for (let w = 0; w < meta.counts.ways; w++) {
    const reason = wayExclusion(meta.tagsets[s.way_tagset[w]!]!);
    wayReason.push(reason);
    wayOk[w] = reason === null ? 1 : 0;
  }
  const nodeOk = new Uint8Array(meta.counts.nodes);
  const nodeReason: (string | null)[] = [];
  for (let n = 0; n < meta.counts.nodes; n++) {
    const ctx = s.node_ctx[n]!;
    const reason = nodeExclusion(meta.node_tagsets[s.node_tagset[n]!]!, {
      on_railway: (ctx & ctxBits.on_railway) !== 0,
      on_fast_road: (ctx & ctxBits.on_fast_road) !== 0,
      on_linear_barrier: (ctx & ctxBits.on_linear_barrier) !== 0,
    });
    nodeReason.push(reason);
    nodeOk[n] = reason === null ? 1 : 0;
  }

  const allowedDirs = new Uint8Array(meta.counts.edges);
  for (let e = 0; e < meta.counts.edges; e++) {
    const w = s.edge_way[e]!;
    const tags = meta.tagsets[s.way_tagset[w]!]!;
    const flags = s.edge_flags[e]!;
    if (!wayOk[w]) {
      violations.push({ kind: "way", edge: e, reason: wayReason[w]! });
      continue;
    }
    const u = s.edge_from[e]!;
    const v = s.edge_to[e]!;
    if (!nodeOk[u] || !nodeOk[v]) {
      violations.push({ kind: "node", edge: e, reason: (nodeOk[u] ? nodeReason[v] : nodeReason[u])! });
      continue;
    }
    if (flags & bits.through_building && !mayPassThroughBuilding(tags)) {
      violations.push({ kind: "through_building", edge: e, reason: "not a mapped passage" });
      continue;
    }
    if (flags & bits.under_building && !mayPassUnderBuildingUnmapped(tags)) {
      violations.push({ kind: "under_building", edge: e, reason: "not a road" });
      continue;
    }
    const [fwdRule, bwdRule] = footDirections(tags);
    const fwdFlag = (flags & bits.forward) !== 0;
    const bwdFlag = (flags & bits.backward) !== 0;
    if (fwdFlag !== fwdRule || bwdFlag !== bwdRule) {
      violations.push({ kind: "direction", edge: e, reason: "direction flags disagree with the rules" });
    }
    // Only directions both the file and the rules allow.
    allowedDirs[e] = (fwdFlag && fwdRule ? 1 : 0) | (bwdFlag && bwdRule ? 2 : 0);
  }
  return { allowedDirs, violations };
}

function buildAdjacency(g: DecodedGraph, allowedDirs: Uint8Array): [Uint32Array, Uint32Array] {
  const { s, meta } = g;
  const n = meta.counts.nodes;
  const counts = new Uint32Array(n + 1);
  for (let e = 0; e < meta.counts.edges; e++) {
    if (allowedDirs[e]! & 1) counts[s.edge_from[e]! + 1]!++;
    if (allowedDirs[e]! & 2) counts[s.edge_to[e]! + 1]!++;
  }
  for (let i = 0; i < n; i++) counts[i + 1]! += counts[i]!;
  const out = new Uint32Array(counts[n]!);
  const fill = counts.slice(0, n);
  for (let e = 0; e < meta.counts.edges; e++) {
    if (allowedDirs[e]! & 1) out[fill[s.edge_from[e]!]!++] = e * 2;
    if (allowedDirs[e]! & 2) out[fill[s.edge_to[e]!]!++] = e * 2 + 1;
  }
  return [counts, out];
}
