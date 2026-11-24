# Decisions

Small and medium choices made while working. Big items (see the project brief) are proposed and approved separately; Phase 0's live in [PHASE0_PROPOSAL.md](PHASE0_PROPOSAL.md).

Each entry: the choice, the alternatives, why, and how reversible it is.

---

## D-001 Default branch is `main`

- **Choice:** the repo's first branch is `main` (the unborn `master` was renamed before any commit).
- **Alternatives:** keep `master`.
- **Why:** it matches GitHub's default and the Pages workflow we'll write later.
- **Reversible:** trivially.

## D-002 Phase 0 data check: Overpass counts in comparable central boxes

- **Choice:** compare candidate cities by Overpass `out count` queries over a ~4 × 4 km box around each centre, counting steps, building passages, covered ways, corridors, indoor ways, parks, unpaved paths, surface tagging, cafés and bakeries.
- **Alternatives:** whole administrative areas (sizes differ wildly, so not comparable); downloading full extracts (heavier, and needs tooling not yet approved).
- **Why:** the boxes give a cheap like-for-like comparison of the city centre, where most routes will be. Queries were sent one at a time with backoff, after the main server said it was at capacity.
- **Reversible:** it's research only; Phase 1 recomputes real stats from the downloaded extract.

## D-003 Treat GitHub Pages as a whole-file host (no byte ranges)

- **Choice:** never depend on HTTP range requests against GitHub Pages.
- **Alternatives:** serve one `.pmtiles` file and read it with range requests.
- **Why:** tested on 2026-11-24 against a real PMTiles file on Pages (`pmtiles.io/protomaps(vector)ODbL_firenze.pmtiles`). When the request carries `Accept-Encoding: gzip`, which browsers always send and scripts cannot remove, Pages gzips the whole file and applies the range to the compressed stream. The total length changes from 6,601,156 to 6,602,554 bytes and the body starts with gzip magic `1f8b` instead of `PMTiles`. Mid-file ranges therefore decode to garbage.
- **Reversible:** yes, if GitHub changes this behaviour; re-run the curl check in the proposal.

## D-004 Build tooling: Python 3.12 in a project venv, pinned dev requirements

- **Choice:** `.venv` with Homebrew's Python 3.12. `requirements-dev.txt` pins `osmium`, `pytest` and `ruff`; ruff and pytest are configured in `pyproject.toml`.
- **Alternatives:** system Python 3.9 (end of life); uv or Poetry (extra tools nobody asked for).
- **Why:** it's the smallest setup that is reproducible in CI with `actions/setup-python`.
- **Reversible:** easy.

## D-005 Greater Lyon crop, whole ways kept

- **Choice:** bbox 4.77–4.93 E, 45.70–45.81 N (~12 × 12 km: Lyon, Villeurbanne, and the edges of neighbouring towns). The crop keeps every way touching the bbox whole, plus the nodes it references. The graph itself only uses segments inside the bbox.
- **Alternatives:** the administrative boundary polygon (oddly shaped, and it splits Villeurbanne off); a smaller centre-only box (loses Parc de la Tête d'Or and the hills' edges).
- **Why:** areas such as parks and buildings stay complete, so containment tests are right at the edges. The crop is 21 MB and takes ~3 minutes; the build takes 30 s.
- **Reversible:** edit `cities/lyon.json` and re-run the setup step.

## D-006 Extra exclusions stricter than the brief

These don't loosen any rule, so they didn't need approval. Each is in `safety/cases.json`.

- `foot=use_sidepath` excluded, like `foot=no`.
- `highway=proposed` treated like construction.
- Cycleways and bridleways need explicit `foot=yes|designated|permissive`. France's default is no pedestrians on cycleways.
- Escalators with unknown direction (`conveying=yes|reversible`) excluded; directional ones are one-way.
- `sac_scale` beyond `mountain_hiking`, and `trail_visibility=bad|horrible|no`, excluded.
- Nodes: `access=private|no` (unless `foot` explicitly permits), `foot=no|private`, `locked=yes` and `crossing=no` block passage.
- Nodes shared with a wall, fence or hedge block passage unless tagged as a gate or other opening.
- Nodes shared with an excluded motorway or trunk block passage unless tagged as a crossing or traffic signals.
- **Geometric checks:** a walkable segment that crosses a railway track or excluded fast road at grade with no shared node is dropped. So is one that lies inside a building footprint without being a mapped passage (sampled every 4 m, ignoring points within 0.75 m of a wall, so sidewalks drawn on facades survive).
- Under the strict reading, `access=no` + `foot=yes` stays excluded, and only `covered=yes` (not `covered=arcade`) counts as a covered passage.
- **Reversible:** each is one rule plus one case.

## D-007 Keep only the largest strongly connected component

- **Choice:** drop everything outside the largest strongly connected component, respecting pedestrian one-ways.
- **Alternatives:** the weakly connected component (the router could then get stuck, e.g. at the bottom of a one-way escalator); keep everything and handle failures at query time.
- **Why:** every start/end pair is routable, which makes the property test meaningful and the app predictable.
- **Reversible:** easy.

## D-008 Graph file design

- **Choice:** a single binary file: JSON meta followed by 8-byte-aligned typed-array sections. Coordinates are microdegrees, and geometry is varint-delta. Way and node tags are deduplicated into tagsets (see [GRAPH_FORMAT.md](GRAPH_FORMAT.md)).
- **Alternatives:** GeoJSON (~10× bigger, slow to parse); protobuf or flatbuffers (a new dependency); separate files per array (more requests).
- **Why:** zero-copy `TypedArray` views in the browser. The file keeps the raw safety-relevant tags, so the router re-runs exactly the same rules from `safety/cases.json`. Lyon is 8.9 MB raw, 2.9 MB gzipped. Only junctions and rule-relevant points are nodes; shape points live in the geometry stream.
- **Reversible:** the format is versioned (`BDG1`, version 1).

## D-009 No elevation data yet

- **Choice:** slope comes only from `incline` tags and staircases. Step counts come from `step_count`, or are estimated at 0.3 m of run per step (marked as estimated).
- **Alternatives:** a terrain model (IGN RGE ALTI, Copernicus GLO-30). That would be a new data source and download host, so it needs approval (see open questions).
- **Reversible:** add an elevation pass later; the format has room via a new section.

## D-010 Parks, venues and "may close"

- **Choice:**
  - **Parks:** `leisure=park`.
  - **Venues:** `shop=mall` areas and `building=train_station` (or areas tagged both `railway=station` and `public_transport=station`).
  - **"May be closed" flag:** corridors, any passage through a building, covered ways inside a mall or station, anything with `opening_hours`, and paths inside parks that have `opening_hours` (Lyon's big parks lock their gates at night).
- **Alternatives:** include `leisure=garden` (many are private); a narrower "may close" (would miss traboule doors that lock at night).
- **Why:** it errs towards warning people.
- **Reversible:** easy.

## D-011 Commit graph.bin once the safety rules settled

- **Choice:** the built graph (`app/public/data/lyon/graph.bin`, 8.9 MB) was held back until Q-004 to Q-006 were answered. It was committed afterwards, on 2026-11-24.
- **Alternatives:** rebuild in CI (a 534 MB download on every run); Git LFS (Pages doesn't serve LFS files).
- **Why:** CI and Pages use the committed graph, and the real-data test checks it matches a fresh build. Rebuild only when the data or rules change, to keep history small.
- **Reversible:** yes.

## D-012 Which "unmapped tunnels" are kept (Q-007 follow-through)

- **Choice:** kept and flagged: walkable roads (residential, service, unclassified, living street, tertiary up to primary and their links, walkable trunks) whose path lies inside a building footprint without a passage tag, and that have no `level` or `indoor` tag. Pedestrian streets, footways, paths and steps stay dropped.
- **Alternatives:** keep every walkable way type. That would let indoor footways and stairs back in, which the brief forbids.
- **Why:** a road inside a footprint is almost always a street running under the building. A footway inside one is usually an indoor route. The flag (`edge_flags` bit 5) lets the app disclose it, and modes decide whether it counts as fun.
- **Reversible:** one set in `safety.py` plus cases.
