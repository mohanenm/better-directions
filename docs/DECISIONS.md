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
