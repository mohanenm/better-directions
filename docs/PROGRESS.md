# Progress

## Phases

- [x] **Phase 0: Decisions.** Approved 2026-11-24.
- [x] **Phase 1: Data pipeline.** Done 2026-11-24; three safety-rule questions waiting (Q-004 to Q-006).
- [ ] Phase 2: Router core
- [ ] Phase 3: The modes
- [ ] Phase 4: The web page
- [ ] Phase 5: Delight
- [ ] Phase 6: GPS art (stretch)
- [ ] Phase 7: Hardening and launch prep (no deploy)

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
| Graph | 99,985 nodes, 131,035 edges, 3,242 km walkable |
| graph.bin | **6.64 MB raw, 2.19 MB gzipped** (budget: a few MB) |
| Build | 30 s, 0.9 GB peak memory |
| Largest component | **72.9%** of junctions (strict railway rule; 95.5% if Q-004 is approved) |
| Passages through buildings | 298 edges through 180 buildings (401 `building_passage` edges): the traboules |
| Staircases | 2,146 edges, ~61,400 steps (725 edges estimated) |
| Park paths | 5,780 edges, 166 km, 258 parks |
| Unpaved | 194 km |
| Corridors | 9 edges (2,980 more are waiting on Q-005) |
| May close | 2,714 edges, 73 km: passages, corridors, and parks with opening hours such as Tête d'Or (06:30–22:30 in summer) |

### Tests

- 135 fixture and unit tests run in 0.3 s. They use made-up towns written as OSM XML, with one focused test per rule: private, foot=no, trunk, construction, indoor, railway (shared node, level crossing, geometric crossing, tunnel), buildings (unmapped, passage, courtyard hole, facade sidewalk, corridor), gates, parks, steps, one-ways, islands, one-way traps, geometry round trip, node storage and determinism.
- 5 real-data tests run in 63 s and are skipped without the extract: output safety invariant, connectivity, fun-feature counts, byte-identical rebuild, and that the built graph is current.
- The output safety invariant re-runs every rule on what's actually in the file: way tagsets, node tags with context bits, direction flags and through-building flags.

### Self-review (safety and fun)

- **Fixed:** paths in parks with opening hours now get the "may close" flag (24/7 parks excluded).
- **Fixed:** nodes the safety rules look at are always stored, so the router's re-check is complete.
- **Fixed:** shape points were stored twice; removing them made the file ~1 MB smaller.
- **Found:** strict railway reading cuts Lyon along its tram lines (Q-004).
- **Found:** my indoor rule is stricter than the brief and drops the Part-Dieu corridors (Q-005).
- **Found:** a classifier over-blocks railway entrance and stop features (Q-006).
- **Stopped:** I tried to fix Q-006 directly and was stopped, correctly, because it loosens a rule. It's now a question for you.
- **Possible over-exclusion, safe direction:** paths that share nodes with a fence running alongside them get cut at those nodes (1,355 segments dropped for `barrier_no_opening`). Phase 3 tuning will look at whether that costs fun routes.
- **Fun:** the traboules, stairs and parks are all there in quantity. Through-buildings mode will be thin on malls until Q-005 is answered.

### Decisions

D-004 to D-011 in [DECISIONS.md](DECISIONS.md).

### Open questions

- Q-004 to Q-006: safety rules, need your approval.
- Q-007: roads under buildings.
- Q-008: elevation data.

### Skipped, and why

- `graph.bin` isn't committed yet (D-011): it changes as soon as Q-004 to Q-006 are answered.
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
