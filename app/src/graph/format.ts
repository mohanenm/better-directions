/**
 * Decoder for graph.bin (docs/GRAPH_FORMAT.md). Keep in step with pipeline/bdgraph/encode.py.
 * Sections become zero-copy typed-array views over the downloaded buffer.
 */

export type Tags = Readonly<Record<string, string>>;

export interface AreaRef {
  /** grounds: cemeteries, gardens and zoos that close; only their hours matter. */
  kind: "park" | "grounds" | "mall" | "station" | "building";
  name: string | null;
  osm: string;
  opening_hours?: string;
  /** The building tag, for building areas. */
  building?: string;
}

export type SnackKind = "bakery" | "pastry" | "chocolate" | "ice_cream" | "cafe";
export type CrawlKind = "artwork" | "gallery" | "museum" | "pub" | "bar" | "brewery" | "wine_bar" | "winery" | "wine_shop";

export interface Poi {
  kind: SnackKind | CrawlKind;
  name: string;
  /** The edge (street) the shop is on. */
  edge: number;
  opening_hours?: string;
}

export interface GraphMeta {
  format: string;
  version: number;
  city: { id: string; name: string; bbox: { west: number; south: number; east: number; north: number } };
  attribution: string;
  licence: string;
  source: { data_as_of?: string; dated_url?: string };
  terrain: { provider?: string; licence?: string; attribution?: string };
  climb_unknown: number;
  coord_scale: number;
  counts: { nodes: number; edges: number; ways: number };
  flags: {
    edge: {
      forward: number;
      backward: number;
      steps_estimated: number;
      may_close: number;
      through_building: number;
      under_building: number;
    };
    node_ctx: { on_railway: number; on_fast_road: number; on_linear_barrier: number };
  };
  strings: string[];
  tagsets: Tags[];
  node_tagsets: Tags[];
  areas: (AreaRef | null)[];
  /** OSM way ids of passages confirmed open to the public. */
  confirmed_passages?: number[];
  /** Snack stops for the snack tour (absent in older graphs). */
  pois?: Poi[];
  sections: { name: string; type: SectionType; count: number }[];
}

export type SectionType = "i32" | "u32" | "u16" | "u8" | "f32" | "f64";

export interface GraphSections {
  node_lat: Int32Array;
  node_lon: Int32Array;
  node_tagset: Uint16Array;
  node_ctx: Uint8Array;
  edge_from: Uint32Array;
  edge_to: Uint32Array;
  edge_way: Uint32Array;
  /** Stored as u16 decimetres (`edge_length_dm`); expanded to metres at load. */
  edge_length_m: Float32Array;
  edge_length_dm: Uint16Array;
  edge_flags: Uint8Array;
  edge_steps: Uint16Array;
  edge_park: Uint16Array;
  edge_venue: Uint16Array;
  edge_building: Uint16Array;
  edge_climb_dm: Uint16Array;
  edge_descent_dm: Uint16Array;
  edge_geom_offset: Uint32Array;
  geom: Uint8Array;
  way_osm_id: Float64Array;
  way_tagset: Uint16Array;
  way_name: Uint32Array;
  way_opening_hours: Uint32Array;
}

/**
 * For a graph joined from tiles (part of an area): how its numbering maps to the whole graph's,
 * and which nodes lie in a loaded tile (the others are just far ends of edges leaving it).
 */
export interface TiledInfo {
  nodeGlobal: Uint32Array;
  edgeGlobal: Uint32Array;
  wayGlobal: Uint32Array;
  /** Whole-graph edge or way -> local index, or -1 when not loaded. */
  edgeLocal: Int32Array;
  wayLocal: Int32Array;
  /** 1 where the node lies in a loaded tile, so all its edges are loaded. */
  nodeOwned: Uint8Array;
}

export interface DecodedGraph {
  meta: GraphMeta;
  s: GraphSections;
  tiled?: TiledInfo;
}

const MAGIC = "BDG1";
const SUPPORTED_VERSION = 2;

const ARRAYS = {
  i32: Int32Array,
  u32: Uint32Array,
  u16: Uint16Array,
  u8: Uint8Array,
  f32: Float32Array,
  f64: Float64Array,
} as const;

export class GraphFormatError extends Error {}

export interface SectionInfo {
  name: string;
  type: SectionType;
  count: number;
}

/**
 * The container graph.bin and graph tiles share: a 4-byte magic, a u32 version, a u32 length and
 * a JSON header listing the sections, then each section as a typed array starting on an 8-byte
 * boundary, with nothing after the last. Sections become zero-copy views over the buffer.
 */
export function readContainer<M extends { sections: SectionInfo[] }>(buffer: ArrayBuffer, magic: string, version: number, what: string): { meta: M; sections: Record<string, ArrayBufferView> } {
  if (buffer.byteLength < 12) throw new GraphFormatError(`${what}: file too short`);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== magic) throw new GraphFormatError(`not a Better Directions ${what}`);
  const view = new DataView(buffer);
  const v = view.getUint32(4, true);
  if (v !== version) throw new GraphFormatError(`${what}: unsupported version ${v}`);
  const metaLen = view.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metaLen))) as M;
  if (!littleEndianHost()) throw new GraphFormatError("big-endian hosts are not supported");
  const sections: Record<string, ArrayBufferView> = {};
  let pos = 12 + metaLen;
  for (const sec of meta.sections) {
    pos += (8 - (pos % 8)) % 8;
    const Ctor = ARRAYS[sec.type];
    const bytes = Ctor.BYTES_PER_ELEMENT * sec.count;
    if (pos + bytes > buffer.byteLength) throw new GraphFormatError(`${what}: section ${sec.name} overruns the file`);
    sections[sec.name] = new Ctor(buffer, pos, sec.count);
    pos += bytes;
  }
  if (pos !== buffer.byteLength) throw new GraphFormatError(`${what}: trailing bytes: read ${pos} of ${buffer.byteLength}`);
  return { meta, sections };
}

/** Write the same container (graph tiles; graph.bin itself is written by the Python pipeline). */
export function writeContainer(magic: string, version: number, header: Record<string, unknown>, arrays: [string, ArrayBufferView][]): Uint8Array {
  const typeOf = (a: ArrayBufferView): SectionType => {
    for (const [t, C] of Object.entries(ARRAYS)) if (a instanceof C) return t as SectionType;
    throw new GraphFormatError("unsupported section type");
  };
  const sections: SectionInfo[] = arrays.map(([name, a]) => ({ name, type: typeOf(a), count: a.byteLength / ARRAYS[typeOf(a)].BYTES_PER_ELEMENT }));
  const metaBytes = new TextEncoder().encode(JSON.stringify({ ...header, sections }));
  const align = (n: number) => n + ((8 - (n % 8)) % 8);
  let size = 12 + metaBytes.length;
  for (const [, a] of arrays) size = align(size) + a.byteLength;
  const out = new Uint8Array(size);
  out.set(new TextEncoder().encode(magic), 0);
  new DataView(out.buffer).setUint32(4, version, true);
  new DataView(out.buffer).setUint32(8, metaBytes.length, true);
  out.set(metaBytes, 12);
  let pos = 12 + metaBytes.length;
  for (const [, a] of arrays) {
    pos = align(pos);
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), pos);
    pos += a.byteLength;
  }
  return out;
}

export function decodeGraph(buffer: ArrayBuffer): DecodedGraph {
  const { meta, sections } = readContainer<GraphMeta>(buffer, MAGIC, SUPPORTED_VERSION, "graph");
  for (const name of REQUIRED_SECTIONS) {
    if (!(name in sections)) throw new GraphFormatError(`missing section ${name}`);
  }
  const dm = sections["edge_length_dm"] as Uint16Array;
  const metres = new Float32Array(dm.length);
  for (let i = 0; i < dm.length; i++) metres[i] = dm[i]! / 10;
  sections["edge_length_m"] = metres;
  return { meta, s: sections as unknown as GraphSections };
}

const REQUIRED_SECTIONS: (keyof GraphSections)[] = [
  "node_lat", "node_lon", "node_tagset", "node_ctx", "edge_from", "edge_to", "edge_way",
  "edge_length_dm", "edge_flags", "edge_steps", "edge_park", "edge_venue", "edge_building",
  "edge_climb_dm", "edge_descent_dm", "edge_geom_offset", "geom", "way_osm_id", "way_tagset",
  "way_name", "way_opening_hours",
];

function littleEndianHost(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}
