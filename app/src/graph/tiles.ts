/**
 * Tiled graphs: the build cuts an area's graph into tiles about a kilometre square, and the page
 * loads only the tiles a request can reach (see router/region.ts), joined into one graph.
 *
 * A tile holds the nodes inside it, every edge whose line touches it, and those edges' ways and
 * far-end nodes, all with their whole-graph numbers. So a node inside a loaded tile always has
 * all its edges, and a long edge is never cut off. Joined tiles are numbered in whole-graph order,
 * which keeps the router's tie-breaking, and so its routes, the same as on the whole graph.
 *
 * Everything that isn't per node, edge or way (names, tag sets, areas, the feature lists) is in
 * one base file per area.
 */
import type { ExportedFeatures } from "../modes/features";
import type { DecodedGraph, GraphMeta, GraphSections, TiledInfo } from "./format";

export const TILE_FORMAT = "better-directions-tiles";
export const TILE_VERSION = 1;
const TILE_MAGIC = "BDT1";
/** Tile height in degrees of latitude (about 1 km); width is scaled to match at the area's latitude. */
export const TILE_DEG_LAT = 0.009;
/**
 * Areas whose whole graph is smaller than this aren't cut up: the page loads the whole graph,
 * which costs less than the round trips of loading parts (measured on an emulated low-end
 * phone). Only the big areas (DC, Chicago) are tiled.
 */
export const TILED_FROM_BYTES = 10_000_000;
/** An untiled area's whole graph, next to its base file. */
export const WHOLE_FILE = "whole";

export interface TileGrid {
  west: number;
  south: number;
  dLon: number;
  dLat: number;
}

export interface BaseFile {
  format: typeof TILE_FORMAT;
  version: number;
  /** The whole graph's meta, without its sections and points of interest; counts are whole-graph. */
  meta: Omit<GraphMeta, "sections" | "pois">;
  grid: TileGrid;
  /** Tiles that exist (others are empty), with their sizes. */
  tiles: Record<string, { nodes: number; edges: number; bytes: number }>;
  /**
   * True for an area that isn't cut up: the page loads WHOLE_FILE (the graph.bin as built) and
   * works out the features itself, so there are no tiles and no feature lists here.
   */
  whole: boolean;
  /** The whole area's feature lists, for tiled areas. */
  features: ExportedFeatures | null;
}

export const tileId = (col: number, row: number): string => `${col}_${row}`;

export function gridFor(meta: GraphMeta): TileGrid {
  const b = meta.city.bbox;
  const midLat = (b.south + b.north) / 2;
  return { west: b.west, south: b.south, dLat: TILE_DEG_LAT, dLon: TILE_DEG_LAT / Math.cos((midLat * Math.PI) / 180) };
}

export function tileOf(grid: TileGrid, lon: number, lat: number): [number, number] {
  return [Math.floor((lon - grid.west) / grid.dLon), Math.floor((lat - grid.south) / grid.dLat)];
}

/** The tile's centre and half its diagonal, in degrees, for coverage tests. */
export function tileCentre(grid: TileGrid, col: number, row: number): [number, number] {
  return [grid.west + (col + 0.5) * grid.dLon, grid.south + (row + 0.5) * grid.dLat];
}

// --- Tile file -----------------------------------------------------------------------------------

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

type Ctor = Uint8ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor | Int32ArrayConstructor | Float64ArrayConstructor;
/** Field, array type, and which count sizes it. Order is the file's. */
const FIELDS: [keyof Tile, Ctor, "nodes" | "edges" | "ways" | "geom"][] = [
  ["nodeGlobal", Uint32Array, "nodes"], ["nodeLat", Int32Array, "nodes"], ["nodeLon", Int32Array, "nodes"],
  ["nodeTagset", Uint16Array, "nodes"], ["nodeCtx", Uint8Array, "nodes"], ["nodeOwned", Uint8Array, "nodes"],
  ["edgeGlobal", Uint32Array, "edges"], ["edgeFrom", Uint32Array, "edges"], ["edgeTo", Uint32Array, "edges"],
  ["edgeWay", Uint32Array, "edges"], ["edgeLengthDm", Uint16Array, "edges"], ["edgeFlags", Uint8Array, "edges"],
  ["edgeSteps", Uint16Array, "edges"], ["edgePark", Uint16Array, "edges"], ["edgeVenue", Uint16Array, "edges"],
  ["edgeBuilding", Uint16Array, "edges"], ["edgeClimbDm", Uint16Array, "edges"], ["edgeDescentDm", Uint16Array, "edges"],
  ["edgeGeomLen", Uint32Array, "edges"], ["geom", Uint8Array, "geom"],
  ["wayGlobal", Uint32Array, "ways"], ["wayOsmId", Float64Array, "ways"], ["wayTagset", Uint16Array, "ways"],
  ["wayName", Uint32Array, "ways"], ["wayOpeningHours", Uint32Array, "ways"],
];

export function encodeTile(t: Tile): Uint8Array {
  const counts = { nodes: t.nodeGlobal.length, edges: t.edgeGlobal.length, ways: t.wayGlobal.length, geom: t.geom.length };
  const metaBytes = new TextEncoder().encode(JSON.stringify(counts));
  const align = (n: number) => n + ((8 - (n % 8)) % 8);
  let size = align(12 + metaBytes.length);
  for (const [name] of FIELDS) size = align(size + t[name].byteLength);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(TILE_MAGIC), 0);
  view.setUint32(4, TILE_VERSION, true);
  view.setUint32(8, metaBytes.length, true);
  out.set(metaBytes, 12);
  let pos = align(12 + metaBytes.length);
  for (const [name] of FIELDS) {
    const a = t[name];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), pos);
    pos = align(pos + a.byteLength);
  }
  return out;
}

export function decodeTile(buffer: ArrayBuffer): Tile {
  const head = new Uint8Array(buffer, 0, 4);
  if (String.fromCharCode(...head) !== TILE_MAGIC) throw new Error("not a Better Directions tile");
  const view = new DataView(buffer);
  if (view.getUint32(4, true) !== TILE_VERSION) throw new Error("unsupported tile version");
  const metaLen = view.getUint32(8, true);
  const counts = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metaLen))) as Record<string, number>;
  const align = (n: number) => n + ((8 - (n % 8)) % 8);
  let pos = align(12 + metaLen);
  const t: Partial<Record<keyof Tile, ArrayBufferView>> = {};
  for (const [name, C, by] of FIELDS) {
    const n = counts[by]!;
    if (pos + n * C.BYTES_PER_ELEMENT > buffer.byteLength) throw new Error(`tile section ${name} overruns the file`);
    t[name] = new C(buffer, pos, n);
    pos = align(pos + n * C.BYTES_PER_ELEMENT);
  }
  return t as Tile;
}

// --- Cutting a graph into tiles (build time) ------------------------------------------------------

/** The base file for an area that isn't cut up: its meta, nothing else (see BaseFile.whole). */
export function wholeBase(meta: GraphMeta): BaseFile {
  const { sections: _sections, pois: _pois, ...rest } = meta;
  void _sections;
  void _pois;
  return { format: TILE_FORMAT, version: TILE_VERSION, meta: rest, grid: gridFor(meta), tiles: {}, whole: true, features: null };
}

/** Cut a whole graph into tiles, plus the base file with its meta, grid and feature lists. */
export function tileGraph(d: DecodedGraph, features: ExportedFeatures): { base: BaseFile; tiles: Map<string, Uint8Array> } {
  const { meta, s } = d;
  const grid = gridFor(meta);
  const scale = meta.coord_scale;
  const nodeTile = (n: number) => tileOf(grid, s.node_lon[n]! / scale, s.node_lat[n]! / scale);

  // Which tiles each edge touches: every tile under the box around its line.
  const members = new Map<string, { nodes: Set<number>; edges: number[] }>();
  const member = (col: number, row: number) => {
    const id = tileId(col, row);
    let m = members.get(id);
    if (!m) members.set(id, (m = { nodes: new Set(), edges: [] }));
    return m;
  };
  for (let n = 0; n < meta.counts.nodes; n++) member(...nodeTile(n)).nodes.add(n);
  for (let e = 0; e < meta.counts.edges; e++) {
    const pts = edgeCoords(d, e);
    let [c0, r0] = tileOf(grid, pts[0]![0], pts[0]![1]);
    let [c1, r1] = [c0, r0];
    for (const [lon, lat] of pts) {
      const [c, r] = tileOf(grid, lon, lat);
      c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) member(c, r).edges.push(e);
  }

  const tiles = new Map<string, Uint8Array>();
  const index: BaseFile["tiles"] = {};
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
    const tile: Tile = {
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
    };
    const bytes = encodeTile(tile);
    tiles.set(id, bytes);
    index[id] = { nodes: m.nodes.size, edges: edges.length, bytes: bytes.length };
  }

  const { sections: _sections, pois: _pois, ...rest } = meta;
  void _sections;
  void _pois;
  return { base: { format: TILE_FORMAT, version: TILE_VERSION, meta: rest, grid, tiles: index, whole: false, features }, tiles };
}

/** An edge's points, endpoints included, in degrees. */
function edgeCoords(d: DecodedGraph, e: number): [number, number][] {
  const { s, meta } = d;
  const scale = meta.coord_scale;
  let x = s.node_lon[s.edge_from[e]!]!;
  let y = s.node_lat[s.edge_from[e]!]!;
  const pts: [number, number][] = [[x / scale, y / scale]];
  let pos = s.edge_geom_offset[e]!;
  const end = s.edge_geom_offset[e + 1]!;
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
    if (pending === null) pending = v;
    else {
      x += pending;
      y += v;
      pts.push([x / scale, y / scale]);
      pending = null;
    }
  }
  const to = s.edge_to[e]!;
  pts.push([s.node_lon[to]! / scale, s.node_lat[to]! / scale]);
  return pts;
}

// --- Joining loaded tiles (page) ------------------------------------------------------------------

/**
 * Join loaded tiles into one graph, numbered in whole-graph order. Nodes inside any loaded tile are
 * "owned" (all their edges are present); the rest are far ends of edges leaving the loaded part.
 */
export function assemble(base: BaseFile, tiles: Tile[]): DecodedGraph {
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
  const s = {
    node_lat: new Int32Array(N), node_lon: new Int32Array(N), node_tagset: new Uint16Array(N), node_ctx: new Uint8Array(N),
    edge_from: new Uint32Array(E), edge_to: new Uint32Array(E), edge_way: new Uint32Array(E),
    edge_length_dm: new Uint16Array(E), edge_length_m: new Float32Array(E), edge_flags: new Uint8Array(E),
    edge_steps: new Uint16Array(E), edge_park: new Uint16Array(E), edge_venue: new Uint16Array(E),
    edge_building: new Uint16Array(E), edge_climb_dm: new Uint16Array(E), edge_descent_dm: new Uint16Array(E),
    edge_geom_offset: new Uint32Array(E + 1), geom: new Uint8Array(0),
    way_osm_id: new Float64Array(W), way_tagset: new Uint16Array(W), way_name: new Uint32Array(W), way_opening_hours: new Uint32Array(W),
  } satisfies GraphSections;
  const nodeOwned = new Uint8Array(N);
  nodeGlobal.forEach((n, i) => {
    const [t, j] = [tiles[nodeTile[n]!]!, nodeAt[n]!];
    s.node_lat[i] = t.nodeLat[j]!;
    s.node_lon[i] = t.nodeLon[j]!;
    s.node_tagset[i] = t.nodeTagset[j]!;
    s.node_ctx[i] = t.nodeCtx[j]!;
    nodeOwned[i] = owned[n]!;
  });
  let geomBytes = 0;
  edgeGlobal.forEach((e) => (geomBytes += tiles[edgeTile[e]!]!.edgeGeomLen[edgeAt[e]!]!));
  const geom = new Uint8Array(geomBytes);
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
    geom.set(t.geom.subarray(g0, g0 + len), at);
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
  const sections = { ...s, geom };
  const meta: GraphMeta = { ...base.meta, counts: { nodes: N, edges: E, ways: W }, sections: [] };
  const tiled: TiledInfo = { nodeGlobal, edgeGlobal, wayGlobal, edgeLocal, wayLocal, nodeOwned };
  return { meta, s: sections, tiled };
}
