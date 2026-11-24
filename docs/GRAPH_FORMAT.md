# Graph format (`graph.bin`, version 1)

One file per city, written by `pipeline/bdgraph/encode.py` and read by the browser (and by `pipeline/bdgraph/decode.py` in tests). Keep this page, the encoder and both decoders in step.

## Layout

All numbers are little-endian.

| Offset | Size | Content |
|---|---|---|
| 0 | 4 | Magic `BDG1` |
| 4 | 4 | `u32` version (1) |
| 8 | 4 | `u32` meta length *L* (includes padding) |
| 12 | *L* | Meta JSON, UTF-8, space-padded so the sections start on an 8-byte boundary |
| … | … | Sections, in the order listed in `meta.sections`. Each section starts on an 8-byte boundary (zero padding). |

Each section is a typed array: `{ "name", "type", "count" }`, where type is one of `i32 u32 u16 u8 f32 f64`. In the browser each one is a zero-copy `TypedArray` view over the downloaded buffer.

## Meta JSON

| Key | Meaning |
|---|---|
| `format`, `version` | `"better-directions-graph"`, `1` |
| `city` | `id`, `name`, `bbox` (`west south east north`) |
| `attribution`, `licence`, `source.data_as_of` | Shown in the app: "© OpenStreetMap contributors", ODbL, the OSM data date |
| `terrain` | `provider`, `licence`, `attribution` of the elevation source (empty if none). The attribution must be shown in the app. |
| `coord_scale` | `1000000`: coordinates are integer microdegrees (~0.1 m) |
| `counts` | `nodes`, `edges`, `ways` |
| `flags.edge`, `flags.node_ctx` | Bit values for `edge_flags` and `node_ctx` (below) |
| `strings` | Names and opening hours; index 0 is `""` |
| `tagsets` | Deduplicated way tag subsets (safety and mode keys); index 0 is `{}` |
| `node_tagsets` | Deduplicated node tag subsets (barrier, access, foot, railway, highway, crossing, locked, entrance); index 0 is `{}` |
| `areas` | Parks, venues and buildings that edges reference: `{kind, name, osm, opening_hours?}`, where `kind` is `park`, `mall`, `station` or `building` and `osm` is like `w123` or `r456`. Index 0 is `null` (none). |

## Sections

| Section | Type | Per | Meaning |
|---|---|---|---|
| `node_lat`, `node_lon` | i32 | node | Microdegrees |
| `node_tagset` | u16 | node | Index into `node_tagsets` |
| `node_ctx` | u8 | node | Bit 0: on a railway track. Bit 1: on an excluded motorway/trunk. Bit 2: on a wall, fence or hedge. The router re-runs the node safety rule with these. |
| `edge_from`, `edge_to` | u32 | edge | Node indices. Geometry runs from → to, in the OSM way's direction. |
| `edge_way` | u32 | edge | Way index |
| `edge_length_m` | f32 | edge | Metres along the geometry |
| `edge_flags` | u8 | edge | Bit 0: walkable forward. Bit 1: walkable backward. Bit 2: step count estimated. Bit 3: may be closed (corridors, passages through buildings, covered ways in malls or stations, anything with `opening_hours`, paths in parks with `opening_hours`). Bit 4: passes through a building via a mapped passage. Bit 5: a road running under a building with no tunnel tag (kept, but the app must disclose it). |
| `edge_steps` | u16 | edge | Steps on this edge (staircases only). From `step_count`, split across edges by length, or estimated at 0.3 m per step. |
| `edge_park`, `edge_venue`, `edge_building` | u16 | edge | Index into `areas` (0 = none). `edge_building` is set for passages through a building (bit 4) and roads under one (bit 5). |
| `edge_climb_dm`, `edge_descent_dm` | u16 | edge | Metres ×10 climbed and descended walking the edge forward (swap them for backward). `65535` (`meta.climb_unknown`) means unknown. Bridges, tunnels and levelled ways use endpoints only. |
| `edge_geom_offset` | u32 | edge + 1 | Byte offsets into `geom` |
| `geom` | u8 | | Intermediate points per edge, endpoints excluded: zigzag-varint deltas (lon, then lat) in microdegrees, starting from the `from` node |
| `way_osm_id` | f64 | way | OSM way id (exact as a double up to 2^53) |
| `way_tagset` | u16 | way | Index into `tagsets` |
| `way_name`, `way_opening_hours` | u32 | way | Indices into `strings` |

## Guarantees

- **Only walkable things are in the file.** Every way's tagset passes `way_exclusion`, and every node passes `node_exclusion` with its context bits. Tests check this on the built file, and the router re-checks it at query time.
- **Every node can reach every other node** (the graph is one strongly connected component, respecting one-way flags).
- **Same extract and same code give the same bytes.**
