# Progress

## Phases

- [x] **Phase 0: Decisions.** Approved 2026-11-24.
- [x] **Phase 1: Data pipeline.** Done 2026-11-24, including the approved rule changes Q-004 to Q-006.
- [x] **Phase 2: Router core.** Done 2026-11-24.
- [ ] Phase 3: The modes
- [ ] Phase 4: The web page
- [ ] Phase 5: Delight
- [ ] Phase 6: GPS art (stretch)
- [ ] Phase 7: Hardening and launch prep (no deploy)

## Phase 2: Router core (2026-11-24)

### Built (TypeScript, `app/src/`)

- **Graph decoder** (`graph/format.ts`) and **graph class** (`graph/graph.ts`): zero-copy views, CSR adjacency, edge geometry, climb, and bearings (precomputed, for turn-aware modes).
- **Load-time safety audit:** every way tagset, node (with context bits), direction flag and building flag is re-checked against the TypeScript rules (`safety/rules.ts`). Those rules pass the same 121 shared cases as the Python build.
- **A\* over directed edges** (`router/astar.ts`): pluggable cost models, turn-aware by construction, an enforced admissibility contract, reused buffers and deterministic tie-breaks.
- **Walking time** (`router/time.ts`): Tobler's function on terrain grade, per-step stair times.
- **Planner** (`router/planner.ts`): normal plus better route, with the detour cap (`safety/limits.ts`: 4×, at most 60 min) enforced by pruning, then blending, then falling back to the normal route.
- **Final route check** (`router/verify.ts`), seeded hash RNG (`router/rng.ts`), and nearest-node lookup (`router/snap.ts`).
- **CI workflow:** `.github/workflows/ci.yml`. Not pushed, so it has never run.

### Also this round (follow-ups to Phase 1, approved by you)

- **Roads under buildings** (Q-007) are kept with flag bit 5, so the app can disclose them. That's 162 Lyon edges, 5.3 km.
- **Terrain** (Q-008): IGN RGE ALTI via `data.geopf.fr`, covering 100% of Lyon's edges with climb data. Plausibility check: the biggest staircase is the Montée Nicolas de Lange up to Fourvière, 562 steps and 68 m up.
- The Lyon graph is now 9.62 MB raw, 3.09 MB gzipped.

### Tests

- **TypeScript (148 unit tests, 0.3 s):**
  - shared safety cases
  - the decoder, including rejecting bad files
  - the audit on tampered graphs (a private way, a locked node, lying direction flags)
  - known routes on the mini-town (the diagonal, no private shortcut, the one-way)
  - stairs timing, the cost-model contract, and turn-aware routing
  - Tobler on the sloped grid: east (uphill) is more than 20% slower than west
  - detour cap maths and an adversary that forces the cap to act
  - seeded determinism
- **Safety property test (~2.3 min):**
  - 2,000 random Lyon pairs across four models, plus 250 on a tampered graph, checked by an independent oracle
  - no unsafe route and no cap breach
  - the real graph passes the audit with 0 violations
- **Python:** 171 fixture tests (0.4 s), plus 5 real-data tests (63 s). The fixture tests include a check that the TypeScript fixture graphs are current.

### Performance (`npm run bench`, Apple laptop)

| | |
|---|---|
| Load + audit | 112 ms |
| Router setup | 25 ms |
| Normal route, 0.5–3 km | median 3.9 ms, p90 10 ms, max 31 ms |
| Full plan (normal + random-weights better), 0.5–3 km | median 14 ms, p90 30 ms, max 55 ms |

A mid-range phone should be roughly 5× slower, which is still well under 1 s. Phase 7 measures on a real low-end phone.

### Self-review

- **Safety:**
  - Three layers in the app: audit, search filter, final check (D-016).
  - The tampered-graph property test shows a bad file can't route through disabled ways or nodes.
  - The detour cap is frozen constants, not a parameter.
  - Snapping only picks nodes with walkable edges.
- **Found:** a "forbid right turns" model is the slowest (~80 ms per plan). When a capped search can't finish, the planner tries blends before falling back. Phase 3's real mode will penalise right turns instead of forbidding them, which also keeps routes possible.
- **Found:** a 70% "steepest edge" in the terrain stats, probably a path below a retaining wall where the bare-earth model jumps. The router naturally avoids it (Tobler makes it very slow). Phase 3 will check whether it distorts Stairmaster.
- **Fun:** not testable until Phase 3's modes exist. The core already supports everything they need: turn angles, seeds, climb, steps, parks, buildings, venues.

### Decisions

D-012 to D-017.

### Skipped, and why

- Sample routes per mode: Phase 3.
- Real-phone timing: Phase 7.
- Running CI: needs a push, which is a big item.

## Phase 1: Data pipeline (2026-11-24)

### Built

- **Setup step** (`python -m bdgraph.fetch cities/lyon.json`). It downloads Geofabrik's dated Rhône-Alpes extract (534 MB, MD5-verified) and crops it to Greater Lyon (21 MB, ~3 min). Whole ways are kept, plus the nodes they reference. Source, data date (2026-11-23T21:21Z), checksums and the ODbL licence are recorded in [data/lyon/SOURCE.md](../data/lyon/SOURCE.md) and `source.json`. Re-cropping gives the identical SHA-256.
- **Safety rules** in [pipeline/bdgraph/safety.py](../pipeline/bdgraph/safety.py), with 96 shared cases in [safety/cases.json](../safety/cases.json). The TypeScript router must pass the same file in Phase 2.
- **Graph build** (`python -m bdgraph.build cities/lyon.json`). It applies the way and node rules, then runs geometric checks: at-grade crossings of railways or fast roads with no shared node, and segments inside buildings without a mapped passage. It simplifies the result to junction-to-junction edges, keeps the largest strongly connected component, and computes per-edge parks, venues, buildings passed through, steps and "may close".
- **Binary format:** see [GRAPH_FORMAT.md](GRAPH_FORMAT.md). JSON meta plus typed arrays. Raw safety tags are kept as deduplicated tagsets, so the router can re-run the identical rules.
- **Stats report:** [data/lyon/STATS.md](../data/lyon/STATS.md) and `stats.json`, including example OSM ids for each drop reason.

### Numbers (Lyon)

| | |
|---|---|
| Graph | 136,049 nodes, 177,798 edges, 4,361 km walkable |
| graph.bin | **8.90 MB raw, 2.93 MB gzipped** (budget: a few MB) |
| Build | 30 s, 0.9 GB peak memory |
| Largest component | **93.9%** of junctions, 96.1% of length (it was 72.9% under the strict tram reading, before Q-004) |
| Passages through buildings | 3,253 edges through 255 buildings: 491 `building_passage` edges (the traboules), plus corridors |
| Corridors | 3,498 edges, 10.9 km (Part-Dieu mall and station, after Q-005) |
| Staircases | 2,351 edges, ~67,800 steps (809 edges estimated) |
| Park paths | 7,704 edges, 239 km, 312 parks |
| Unpaved | 248 km |
| Venues | 7 malls, 13 stations |
| May close | 6,370 edges, 89 km: passages, corridors, and parks with opening hours such as Tête d'Or (06:30–22:30 in summer) |

### Tests

- 153 fixture and unit tests run in 0.4 s. They use made-up towns written as OSM XML, with one focused test per rule: private, foot=no, trunk, construction, indoor, railway (shared node, level crossing, geometric crossing, tunnel), buildings (unmapped, passage, courtyard hole, facade sidewalk, corridor), gates, parks, steps, one-ways, islands, one-way traps, geometry round trip, node storage and determinism.
- 5 real-data tests run in 63 s and are skipped without the extract: output safety invariant, connectivity, fun-feature counts, byte-identical rebuild, and that the built graph is current.
- The output safety invariant re-runs every rule on what's actually in the file: way tagsets, node tags with context bits, direction flags and through-building flags.

### Self-review (safety and fun)

- **Fixed:** paths in parks with opening hours now get the "may close" flag (24/7 parks excluded).
- **Fixed:** nodes the safety rules look at are always stored, so the router's re-check is complete.
- **Fixed:** shape points were stored twice; removing them made the file ~1 MB smaller.
- **Found:** strict railway reading cuts Lyon along its tram lines (Q-004).
- **Found:** my indoor rule is stricter than the brief and drops the Part-Dieu corridors (Q-005).
- **Found:** a classifier over-blocks railway entrance and stop features (Q-006).
- **Stopped:** I tried to fix Q-006 directly and was stopped, correctly, because it loosens a rule. It went to you as a question.
- **Applied after your approval:** Q-004 to Q-006, with the shared cases extended to match.
- **Possible over-exclusion, safe direction:** paths that share nodes with a fence running alongside them get cut at those nodes (1,355 segments dropped for `barrier_no_opening`). Phase 3 tuning will look at whether that costs fun routes.
- **Fun:** the traboules, stairs, parks, and now the Part-Dieu corridors are all there in quantity.

### Decisions

D-004 to D-011 in [DECISIONS.md](DECISIONS.md).

### Open questions

- Q-004 to Q-006: answered and applied.
- Q-007: roads under buildings.
- Q-008: elevation data.

### Skipped, and why

- Map tiles are Phase 4 work.
- CI isn't set up yet: the workflow comes with Phase 2, when there's TypeScript to test too. Pushing is a big item either way.
- Sample routes per mode start in Phase 3.

## Phase 0: Decisions (2026-11-24)

**Built:** [PHASE0_PROPOSAL.md](PHASE0_PROPOSAL.md), the decisions log ([DECISIONS.md](DECISIONS.md)) and open questions ([OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)). No code yet.

**Research done:**

- OSM feature counts for Minneapolis, Montreal, Lyon, Bologna and Edinburgh, using Overpass queries over comparable ~16 km² central boxes. The results are tabulated in the proposal.
- A range-request check on GitHub Pages using a real `.pmtiles` file. Pages applies byte ranges to the gzipped body, so single-file PMTiles is unsafe there (D-003).
- GitHub Pages limits, from GitHub's docs: 1 GB site, 100 GB/month soft bandwidth, 10-minute deploys.

**Recommendations:** see the proposal for the details.

- **Stack:** Python build, TypeScript static app.
- **City:** Lyon.
- **Tiles:** self-hosted Protomaps tiles as a static `z/x/y` folder.
- **Pages layout:** project site at `/better-directions/`.
- **Expected site size:** 15–35 MB.

**Tests and performance:** none yet; no code.

**Skipped:**

- I didn't measure the real tile and graph sizes for Lyon. That needs the approved tooling and download hosts, so it moves to Phase 1.
- I didn't deploy a test file to Pages. That would mean pushing, which is a big item. Testing the existing public PMTiles file on Pages answered the question instead.
