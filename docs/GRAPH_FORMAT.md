# Graph format (`graph.bin`, version 2)

One file per city, written by `pipeline/bdgraph/encode.py` and read by the browser (and by `pipeline/bdgraph/decode.py` in tests). Keep this page, the encoder and both decoders in step.

## Layout

All numbers are little-endian.

| Offset | Size | Content |
|---|---|---|
| 0 | 4 | Magic `BDG1` |
| 4 | 4 | `u32` version (2; version 1 stored edge lengths as `f32` metres) |
| 8 | 4 | `u32` meta length *L* (includes padding) |
| 12 | *L* | Meta JSON, UTF-8, space-padded so the sections start on an 8-byte boundary |
| … | … | Sections, in the order listed in `meta.sections`. Each section starts on an 8-byte boundary (zero padding). |

Each section is a typed array: `{ "name", "type", "count" }`, where type is one of `i32 u32 u16 u8 f32 f64`. In the browser each one is a zero-copy `TypedArray` view over the downloaded buffer.

## Meta JSON

| Key | Meaning |
|---|---|
| `format`, `version` | `"better-directions-graph"`, `2` |
| `city` | `id`, `name`, `bbox` (`west south east north`) |
| `attribution`, `licence`, `source.data_as_of` | Shown in the app: "© OpenStreetMap contributors", ODbL, the OSM data date |
| `terrain` | `provider`, `licence`, `attribution` of the elevation source (empty if none). The attribution must be shown in the app. |
| `coord_scale` | `1000000`: coordinates are integer microdegrees (~0.1 m) |
| `counts` | `nodes`, `edges`, `ways` |
| `flags.edge`, `flags.node_ctx` | Bit values for `edge_flags` and `node_ctx` (below) |
| `strings` | Names and opening hours; index 0 is `""` |
| `tagsets` | Deduplicated way tag subsets (safety and mode keys); index 0 is `{}` |
| `node_tagsets` | Deduplicated node tag subsets (barrier, access, foot, railway, highway, crossing, locked, entrance); index 0 is `{}` |
| `pois` | Snack stops for the snack tour: `{kind, name, edge, opening_hours?}`, where `kind` is `bakery`, `pastry`, `chocolate`, `ice_cream` or `cafe` and `edge` is the street the shop is on (the nearest edge within 40 m). Sorted by edge, then kind, then name. |
| `areas` | Parks, venues and buildings that edges reference: `{kind, name, osm, opening_hours?, building?}`, where `kind` is `park`, `mall`, `station` or `building`, `osm` is like `w123` or `r456`, and `building` is the building tag. Index 0 is `null` (none). |
| `confirmed_passages` | OSM way ids of passages confirmed open to the public in the city config. The load-time audit accepts these through any building. |

## Sections

| Section | Type | Per | Meaning |
|---|---|---|---|
| `node_lat`, `node_lon` | i32 | node | Microdegrees |
| `node_tagset` | u16 | node | Index into `node_tagsets` |
| `node_ctx` | u8 | node | Bit 0: on a railway track. Bit 1: on an excluded motorway/trunk. Bit 2: on a wall, fence or hedge. The router re-runs the node safety rule with these. |
| `edge_from`, `edge_to` | u32 | edge | Node indices. Geometry runs from → to, in the OSM way's direction. |
| `edge_way` | u32 | edge | Way index |
| `edge_length_dm` | u16 | edge | Decimetres along the geometry (max 6,553.5 m). Decoders expose it as `edge_length_m`. |
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

- Only walkable things are in the file. Every way's tagset passes `way_exclusion`, every node passes `node_exclusion` with its context bits, and every edge through a building passes `passage_exclusion` with its building and venue. Tests check this on the built file, and the browser re-checks it when the file loads.
- Every node can reach every other node: the graph is one strongly connected component, respecting one-way flags.
- The same extract and the same code give the same bytes.

## What the page loads

`graph.bin` is a build input (`data/<area>/graph.bin`). `npm run tiles` turns it into what the page loads, in `app/public/data/<area>/graph/`:

- `base.json`: the graph's meta (without `sections` and `pois`), the tile grid, the list of tiles with their sizes, `whole`, and, for tiled areas, the feature lists worked out over the whole area (`features`: staircases, parks, passages, trails, snack and crawl stops, workout hills, in whole-graph numbering).
- Areas under 10 MB (`TILED_FROM_BYTES`): `whole: true` and `whole.bin`, which is `graph.bin` unchanged.
- Bigger areas (DC, Chicago): one `<col>_<row>.bin` per tile of the grid, about 1 km square (`TILE_DEG_LAT` = 0.009°, width scaled to the area's latitude, origin at the area's south-west corner).

A tile holds the nodes inside it, every edge whose bounding box touches it, and those edges' ways and far-end nodes, all with their whole-graph numbers. Its layout is `"BDT1"`, a u32 version (1), a u32 length and a JSON header `{nodes, edges, ways, geom}`, then these arrays, each starting on an 8-byte boundary: node number, lat, lon (u32, i32, i32), node tag set (u16), context (u8), owned (u8: 1 if the node is inside this tile); edge number, from, to, way (u32 each, whole-graph numbers), length (u16 dm), flags (u8), steps, park, venue, building, climb, descent (u16), geometry length (u32), geometry bytes (u8, as in `geom`); way number (u32), OSM id (f64), tag set (u16), name and opening hours (u32). `app/src/graph/tiles.ts` writes and reads them; `assemble` joins loaded tiles into one graph numbered in whole-graph order.
