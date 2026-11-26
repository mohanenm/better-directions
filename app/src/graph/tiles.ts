/**
 * Tiled graphs: the build cuts a big area's graph into tiles about a kilometre square, and the page
 * loads only the tiles a request can reach (see router/region.ts), joined into one graph. Only
 * areas marked `tiled` in city.ts are cut up; the page loads the others' whole graph (whole.bin).
 *
 * A tile holds the nodes inside it, every edge whose bounding box touches it, and those edges'
 * ways and far-end nodes, all with their whole-graph numbers. So a node inside a loaded tile always
 * has all its edges, and a long edge is never cut off. Joined tiles are numbered in whole-graph
 * order, which keeps the router's tie-breaking, and so its routes, the same as on the whole graph.
 *
 * Everything that isn't per node, edge or way (names, tag sets, areas, the feature lists) is in
 * one base file per area.
 */
import type { ExportedFeatures } from "../modes/features";
import { readContainer, writeContainer, type DecodedGraph, type GraphMeta, type GraphSections, type SectionInfo, type TiledInfo } from "./format";
import type { Graph } from "./graph";

export const TILE_FORMAT = "better-directions-tiles";
export const TILE_VERSION = 1;
const TILE_MAGIC = "BDT1";
/** Tile height in degrees of latitude (about 1 km); width is scaled to match at the area's latitude. */
export const TILE_DEG_LAT = 0.009;
/**
 * Areas whose whole graph is at least this big are marked `tiled` in city.ts (a test checks):
 * smaller ones load faster whole than in parts (measured on an emulated low-end phone).
 */
export const TILED_FROM_BYTES = 10_000_000;
/** An untiled area's whole graph: graph.bin as built, under this name. */
export const WHOLE_FILE = "whole";

export interface TileGrid {
  west: number;
  south: number;
  dLon: number;
  dLat: number;
}

/** A tiled area's base file. */
export interface TiledBase {
  format: typeof TILE_FORMAT;
  version: number;
  /** The whole graph's meta, without its sections and points of interest; counts are whole-graph. */
  meta: Omit<GraphMeta, "sections" | "pois">;
  grid: TileGrid;
  /** Tiles that exist; the rest of the grid is empty. */
  tiles: string[];
  /** The whole area's feature lists, in whole-graph numbering. */
  features: ExportedFeatures;
}

export const tileId = (col: number, row: number): string => `${col}_${row}`;

export function tileOf(grid: TileGrid, lon: number, lat: number): [number, number] {
  return [Math.floor((lon - grid.west) / grid.dLon), Math.floor((lat - grid.south) / grid.dLat)];
}

/** The tile's centre, in degrees. */
export function tileCentre(grid: TileGrid, col: number, row: number): [number, number] {
  return [grid.west + (col + 0.5) * grid.dLon, grid.south + (row + 0.5) * grid.dLat];
}

/** One tile's records, with whole-graph numbers. */
export interface Tile {
  nodeGlobal: Uint32Array;
  nodeLat: Int32Array;
  nodeLon: Int32Array;
  nodeTagset: Uint16Array;
  nodeCtx: Uint8Array;
  /** 1 for nodes inside this tile, 0 for far ends of edges leaving it. */
  nodeOwned: Uint8Array;
  edgeGlobal: Uint32Array;
  edgeFrom: Uint32Array;
  edgeTo: Uint32Array;
  edgeWay: Uint32Array;
  edgeLengthDm: Uint16Array;
  edgeFlags: Uint8Array;
  edgeSteps: Uint16Array;
  edgePark: Uint16Array;
  edgeVenue: Uint16Array;
  edgeBuilding: Uint16Array;
  edgeClimbDm: Uint16Array;
  edgeDescentDm: Uint16Array;
  /** Bytes of geometry for each edge, in order. */
  edgeGeomLen: Uint32Array;
  geom: Uint8Array;
  wayGlobal: Uint32Array;
  wayOsmId: Float64Array;
  wayTagset: Uint16Array;
  wayName: Uint32Array;
  wayOpeningHours: Uint32Array;
}

/** Tiles are the same container as graph.bin (format.ts), with one named section per field. */
export function encodeTile(t: Tile): Uint8Array {
  return writeContainer(TILE_MAGIC, TILE_VERSION, {}, Object.entries(t));
}

export function decodeTile(buffer: ArrayBuffer): Tile {
  const { sections } = readContainer<{ sections: SectionInfo[] }>(buffer, TILE_MAGIC, TILE_VERSION, "tile");
  return sections as unknown as Tile;
}

// --- Cutting a graph into tiles (build time) ------------------------------------------------------

/** Cut a whole graph into tiles, plus the base file with its meta, grid and feature lists. */
export function tileGraph(g: Graph, features: ExportedFeatures): { base: TiledBase; tiles: Map<string, Uint8Array> } {
  const { meta, s } = g;
  const b = meta.city.bbox;
  const grid: TileGrid = { west: b.west, south: b.south, dLat: TILE_DEG_LAT, dLon: TILE_DEG_LAT / Math.cos((((b.south + b.north) / 2) * Math.PI) / 180) };

  // Each node in its tile; each edge in every tile under the box around its line.
  const members = new Map<string, { nodes: Set<number>; edges: number[] }>();
  const member = (col: number, row: number) => {
    const id = tileId(col, row);
    let m = members.get(id);
    if (!m) members.set(id, (m = { nodes: new Set(), edges: [] }));
    return m;
  };
  for (let n = 0; n < g.nodeCount; n++) member(...tileOf(grid, ...g.nodeLonLat(n))).nodes.add(n);
  for (let e = 0; e < g.edgeCount; e++) {
    const cells = g.edgePoints(e).map(([lon, lat]) => tileOf(grid, lon, lat));
    const [c0, c1] = [Math.min(...cells.map((c) => c[0])), Math.max(...cells.map((c) => c[0]))];
    const [r0, r1] = [Math.min(...cells.map((c) => c[1])), Math.max(...cells.map((c) => c[1]))];
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) member(c, r).edges.push(e);
  }

  const tiles = new Map<string, Uint8Array>();
  for (const [id, m] of members) {
    const edges = m.edges; // already ascending
    const nodes = new Set(m.nodes);
    const ways = new Set<number>();
    for (const e of edges) {
      nodes.add(s.edge_from[e]!);
      nodes.add(s.edge_to[e]!);
      ways.add(s.edge_way[e]!);
    }
    const nodeList = [...nodes].sort((a, b) => a - b);
    const wayList = [...ways].sort((a, b) => a - b);
    const geomParts = edges.map((e) => s.geom.subarray(s.edge_geom_offset[e]!, s.edge_geom_offset[e + 1]!));
    const geom = new Uint8Array(geomParts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of geomParts) {
      geom.set(p, at);
      at += p.length;
    }
    const pick = <A extends Uint8Array | Uint16Array | Uint32Array | Int32Array | Float64Array>(src: A, list: number[], C: { new (n: number): A }): A => {
      const out = new C(list.length);
      list.forEach((v, i) => (out[i] = src[v]!));
      return out;
    };
    tiles.set(id, encodeTile({
      nodeGlobal: Uint32Array.from(nodeList),
      nodeLat: pick(s.node_lat, nodeList, Int32Array),
      nodeLon: pick(s.node_lon, nodeList, Int32Array),
      nodeTagset: pick(s.node_tagset, nodeList, Uint16Array),
      nodeCtx: pick(s.node_ctx, nodeList, Uint8Array),
      nodeOwned: Uint8Array.from(nodeList, (n) => (m.nodes.has(n) ? 1 : 0)),
      edgeGlobal: Uint32Array.from(edges),
      edgeFrom: pick(s.edge_from, edges, Uint32Array),
      edgeTo: pick(s.edge_to, edges, Uint32Array),
      edgeWay: pick(s.edge_way, edges, Uint32Array),
      edgeLengthDm: pick(s.edge_length_dm, edges, Uint16Array),
      edgeFlags: pick(s.edge_flags, edges, Uint8Array),
      edgeSteps: pick(s.edge_steps, edges, Uint16Array),
      edgePark: pick(s.edge_park, edges, Uint16Array),
      edgeVenue: pick(s.edge_venue, edges, Uint16Array),
      edgeBuilding: pick(s.edge_building, edges, Uint16Array),
      edgeClimbDm: pick(s.edge_climb_dm, edges, Uint16Array),
      edgeDescentDm: pick(s.edge_descent_dm, edges, Uint16Array),
      edgeGeomLen: Uint32Array.from(geomParts, (p) => p.length),
      geom,
      wayGlobal: Uint32Array.from(wayList),
      wayOsmId: pick(s.way_osm_id, wayList, Float64Array),
      wayTagset: pick(s.way_tagset, wayList, Uint16Array),
      wayName: pick(s.way_name, wayList, Uint32Array),
      wayOpeningHours: pick(s.way_opening_hours, wayList, Uint32Array),
    }));
  }
  const { sections: _sections, pois: _pois, ...pageMeta } = meta; // what's per edge stays in the tiles
  void _sections;
  void _pois;
  const base: TiledBase = { format: TILE_FORMAT, version: TILE_VERSION, meta: pageMeta, grid, tiles: [...tiles.keys()].sort(), features };
  return { base, tiles };
}

// --- Joining loaded tiles (page) ------------------------------------------------------------------

/**
 * Join loaded tiles into one graph, numbered in whole-graph order. Nodes inside any loaded tile are
 * "owned" (all their edges are present); the rest are far ends of edges leaving the loaded part.
 */
export function assemble(base: TiledBase, tiles: Tile[]): DecodedGraph {
  const counts = base.meta.counts;
  // Whole-graph number -> which tile has it (-1: none) and where; the first copy wins (copies
  // are identical). Typed arrays rather than maps: this runs on every load, on slow phones too.
  const nodeTile = new Int32Array(counts.nodes).fill(-1);
  const nodeAt = new Int32Array(counts.nodes);
  const owned = new Uint8Array(counts.nodes);
  const edgeTile = new Int32Array(counts.edges).fill(-1);
  const edgeAt = new Int32Array(counts.edges);
  const edgeGeomAt = new Uint32Array(counts.edges);
  const wayTile = new Int32Array(counts.ways).fill(-1);
  const wayAt = new Int32Array(counts.ways);
  tiles.forEach((t, ti) => {
    for (let i = 0; i < t.nodeGlobal.length; i++) {
      const n = t.nodeGlobal[i]!;
      if (nodeTile[n] === -1) {
        nodeTile[n] = ti;
        nodeAt[n] = i;
      }
      if (t.nodeOwned[i]) owned[n] = 1;
    }
    let geomAt = 0;
    for (let i = 0; i < t.edgeGlobal.length; i++) {
      const e = t.edgeGlobal[i]!;
      if (edgeTile[e] === -1) {
        edgeTile[e] = ti;
        edgeAt[e] = i;
        edgeGeomAt[e] = geomAt;
      }
      geomAt += t.edgeGeomLen[i]!;
    }
    for (let i = 0; i < t.wayGlobal.length; i++) {
      const w = t.wayGlobal[i]!;
      if (wayTile[w] === -1) {
        wayTile[w] = ti;
        wayAt[w] = i;
      }
    }
  });
  // Local numbering follows whole-graph order (ascending), which keeps tie-breaking the same.
  const present = (src: Int32Array) => {
    const out: number[] = [];
    for (let i = 0; i < src.length; i++) if (src[i] !== -1) out.push(i);
    return Uint32Array.from(out);
  };
  const nodeGlobal = present(nodeTile);
  const edgeGlobal = present(edgeTile);
  const wayGlobal = present(wayTile);
  const nodeLocal = new Int32Array(counts.nodes).fill(-1);
  nodeGlobal.forEach((n, i) => (nodeLocal[n] = i));
  const edgeLocal = new Int32Array(counts.edges).fill(-1);
  edgeGlobal.forEach((e, i) => (edgeLocal[e] = i));
  const wayLocal = new Int32Array(counts.ways).fill(-1);
  wayGlobal.forEach((w, i) => (wayLocal[w] = i));

  const N = nodeGlobal.length;
  const E = edgeGlobal.length;
  const W = wayGlobal.length;
  let geomBytes = 0;
  edgeGlobal.forEach((e) => (geomBytes += tiles[edgeTile[e]!]!.edgeGeomLen[edgeAt[e]!]!));
  const s: GraphSections = {
    node_lat: new Int32Array(N), node_lon: new Int32Array(N), node_tagset: new Uint16Array(N), node_ctx: new Uint8Array(N),
    edge_from: new Uint32Array(E), edge_to: new Uint32Array(E), edge_way: new Uint32Array(E),
    edge_length_dm: new Uint16Array(E), edge_length_m: new Float32Array(E), edge_flags: new Uint8Array(E),
    edge_steps: new Uint16Array(E), edge_park: new Uint16Array(E), edge_venue: new Uint16Array(E),
    edge_building: new Uint16Array(E), edge_climb_dm: new Uint16Array(E), edge_descent_dm: new Uint16Array(E),
    edge_geom_offset: new Uint32Array(E + 1), geom: new Uint8Array(geomBytes),
    way_osm_id: new Float64Array(W), way_tagset: new Uint16Array(W), way_name: new Uint32Array(W), way_opening_hours: new Uint32Array(W),
  };
  const nodeOwned = new Uint8Array(N);
  nodeGlobal.forEach((n, i) => {
    const [t, j] = [tiles[nodeTile[n]!]!, nodeAt[n]!];
    s.node_lat[i] = t.nodeLat[j]!;
    s.node_lon[i] = t.nodeLon[j]!;
    s.node_tagset[i] = t.nodeTagset[j]!;
    s.node_ctx[i] = t.nodeCtx[j]!;
    nodeOwned[i] = owned[n]!;
  });
  let at = 0;
  edgeGlobal.forEach((e, i) => {
    const [t, j, g0] = [tiles[edgeTile[e]!]!, edgeAt[e]!, edgeGeomAt[e]!];
    s.edge_from[i] = nodeLocal[t.edgeFrom[j]!]!;
    s.edge_to[i] = nodeLocal[t.edgeTo[j]!]!;
    s.edge_way[i] = wayLocal[t.edgeWay[j]!]!;
    s.edge_length_dm[i] = t.edgeLengthDm[j]!;
    s.edge_length_m[i] = t.edgeLengthDm[j]! / 10;
    s.edge_flags[i] = t.edgeFlags[j]!;
    s.edge_steps[i] = t.edgeSteps[j]!;
    s.edge_park[i] = t.edgePark[j]!;
    s.edge_venue[i] = t.edgeVenue[j]!;
    s.edge_building[i] = t.edgeBuilding[j]!;
    s.edge_climb_dm[i] = t.edgeClimbDm[j]!;
    s.edge_descent_dm[i] = t.edgeDescentDm[j]!;
    s.edge_geom_offset[i] = at;
    const len = t.edgeGeomLen[j]!;
    s.geom.set(t.geom.subarray(g0, g0 + len), at);
    at += len;
  });
  s.edge_geom_offset[E] = at;
  wayGlobal.forEach((w, i) => {
    const [t, j] = [tiles[wayTile[w]!]!, wayAt[w]!];
    s.way_osm_id[i] = t.wayOsmId[j]!;
    s.way_tagset[i] = t.wayTagset[j]!;
    s.way_name[i] = t.wayName[j]!;
    s.way_opening_hours[i] = t.wayOpeningHours[j]!;
  });
  const meta: GraphMeta = { ...base.meta, counts: { nodes: N, edges: E, ways: W }, sections: [] };
  const tiled: TiledInfo = { nodeGlobal, edgeGlobal, wayGlobal, edgeLocal, wayLocal, nodeOwned };
  return { meta, s, tiled };
}
