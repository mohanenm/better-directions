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

type SectionType = "i32" | "u32" | "u16" | "u8" | "f32" | "f64";

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

export interface DecodedGraph {
  meta: GraphMeta;
  s: GraphSections;
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

export function decodeGraph(buffer: ArrayBuffer): DecodedGraph {
  if (buffer.byteLength < 12) throw new GraphFormatError("file too short");
  const head = new Uint8Array(buffer, 0, 4);
  if (String.fromCharCode(...head) !== MAGIC) throw new GraphFormatError("not a Better Directions graph");
  const view = new DataView(buffer);
  const version = view.getUint32(4, true);
  if (version !== SUPPORTED_VERSION) throw new GraphFormatError(`unsupported version ${version}`);
  const metaLen = view.getUint32(8, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, metaLen))) as GraphMeta;

  if (!littleEndianHost()) throw new GraphFormatError("big-endian hosts are not supported");

  const sections: Record<string, ArrayBufferView> = {};
  let pos = 12 + metaLen;
  for (const sec of meta.sections) {
    pos += (8 - (pos % 8)) % 8;
    const Ctor = ARRAYS[sec.type];
    const bytes = Ctor.BYTES_PER_ELEMENT * sec.count;
    if (pos + bytes > buffer.byteLength) throw new GraphFormatError(`section ${sec.name} overruns the file`);
    sections[sec.name] = new Ctor(buffer, pos, sec.count);
    pos += bytes;
  }
  if (pos !== buffer.byteLength) throw new GraphFormatError(`trailing bytes: read ${pos} of ${buffer.byteLength}`);
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
