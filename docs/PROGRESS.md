# Progress

## Phases

- [x] **Phase 0: Decisions.** Approved 2026-11-24.
- [x] **Phase 1: Data pipeline.** Done 2026-11-24, including the approved rule changes Q-004 to Q-006.
- [x] **Phase 2: Router core.** Done 2026-11-24.
- [x] **Phase 3: The modes.** Done 2026-11-24.
- [x] **Phase 4: The web page.** Done 2026-11-24.
- [x] **Phase 5: Delight.** Done 2026-11-24.
- [ ] Phase 6: GPS art (stretch)
- [ ] Phase 7: Hardening and launch prep (no deploy)

## Phase 5: Delight (2026-11-24)

### Built

- **Route names** (D-030), shown above the summary.
- **Share image** (D-031): drawn on the device, then shared or downloaded.
- **Snack tour mode** (D-028, D-029): 1,026 snack stops in Lyon, snapped to their streets.
- **Famous better routes** (D-032): eight cards on the landing panel, each tested against its pitch:

  | Route | Name and result |
  |---|---|
  | The Fourvière Stair Assault | "Stairway to Somewhere": 33 min instead of 23, 10 staircases, 591 steps up |
  | The Traboule Crawl | 25 min instead of 16, 10 buildings walked through |
  | The Pentes Calf Crusher | 29 min instead of 16, 555 steps up |
  | The Grand Park Tour | 58 min instead of 32, 5 parks |
  | The Croissant Crawl | 18 min instead of 14, 4 bakeries, 2 pâtisseries, 1 chocolatier, 2 ice-cream shops, 5 cafés |
  | The Rhône Dirt Dash | 59 min instead of 23, 6 trails |
  | The Sinister Circuit | 33 min instead of 23, 32 left turns, 0 right |
  | Chaos Route #42 | 47 min instead of 35 |

- **Fun fix carried over from Phase 4:** a doubling-back guard (D-027). The worst sample route now retraces 14%, down from 21%.

### Sample routes (snack tour)

From [SAMPLE_ROUTES.md](SAMPLE_ROUTES.md), which now has names for every row.

| Trip | Snack tour result |
|---|---|
| Bellecour → Terreaux | 18 min instead of 14: 4 bakeries, 2 pâtisseries, 1 chocolatier, 2 ice-cream shops, 5 cafés |
| Part-Dieu → Saint-Jean | 40 min instead of 35: 4 bakeries, 2 pâtisseries, 1 chocolatier, 7 cafés |
| Tête d'Or → Bellecour | 34 min instead of 32: 4 bakeries, 5 pâtisseries, 2 chocolatiers, 2 ice-cream shops, 7 cafés |

### Tests

- **TypeScript:** 200 tests in total. New:
  - snack tour: stops at the fixture bakery, names it with its hours, counts it
  - recognisability: ≥ 3 snack stops, more than normal, at least one sweet stop
  - names: deterministic, and chaos names vary by seed
  - all 8 famous routes against their pitches
  - the property test now covers 7 modes (3,300 pairs plus the tampered graph)
- **Python:** 181 tests. New: snack classification and snapping to the right street. The real-data test now requires the committed graph to match a full build (source info and terrain included) byte for byte. The old version skipped terrain, a gap since Phase 2, now closed.
- **Browser smoke test:** five cases, all passing. The new one clicks a famous route, makes the share image, checks it's 1080 × 1350 with a real map snapshot, and saves it.

### Performance

The 42 sample plans take median 31 ms, p90 70 ms, max 98 ms on a laptop.

### Self-review

- **Safety:** the snack tour is a collecting mode like the others, inside the property test and the cap. Shop opening hours appear in the directions. The share image carries the novelty line and attribution, and the page says images show start and end points.
- **Fun:** names land, famous routes are reliably good, and the share image looks like something you'd post. The snack tour may be the most practical mode of all, at +2 to +9 minutes.

### Decisions

D-027 to D-032.

### Skipped, and why

Nothing from the Phase 5 list. The GPS-art stretch goal is Phase 6.

## Phase 4: The web page (2026-11-24)

### Built

- **Basemap:** self-hosted Protomaps tiles for Lyon (340 static tiles, built 2026-11-23, the same day as the OSM extract), plus fonts and sprites (D-022). Setup: `python -m bdgraph.tiles cities/lyon.json --build 20261123`.
- **Places list:** 1,202 public places (D-023). Setup: `python -m bdgraph.places cities/lyon.json`.
- **Page** (`app/index.html`, `app/src/main.ts`, `app/src/ui/`):
  - **Map:** both routes drawn, the normal route dashed grey and the better route bold magenta, with A/B markers.
  - **Start and end:** search over the local places list with an accessible combobox, a tap on the map, "Use map centre" (the keyboard alternative to tapping), "Use my location" (only on tap, kept on the device), and swap.
  - **Mode picker:** six radio cards with taglines, plus the chaos seed with "Roll a new adventure".
  - **Results:** the stats card with the one-line summary, closure notes with hours, the late-night hint (after 21:00 or before 07:00, Q-009), the roads-under-buildings disclosure, and step-by-step directions with personality. Tapping a step shows it on the map.
  - **Sharing:** links with snapped points (D-025), via the system share sheet or the clipboard.
  - **Always visible:** the novelty notice, the OSM/Protomaps/IGN attribution with the data date, and "Nothing leaves your phone".
- **Planning worker** (`app/src/worker.ts`, D-024).
- **Static and private:** Vite build under `/better-directions/`, with the strict meta CSP added at build time ([SECURITY.md](SECURITY.md)). No cookies, storage, analytics or third-party requests.

### Tests

- **TypeScript:** 187 tests in total.
  - Directions on the mini-town: bookends, distances adding up, the traboule step with its closure note, stairs counts, park entry, determinism.
  - Link round-trip and sanitising; accent-insensitive search.
  - **Built-site checks:** CSP meta exact, no inline scripts, handlers or style attributes, everything under the base path, external links to attribution sites only, all assets present, 45 MB against a 100 MB budget.
- **Browser smoke test** (`npm run smoke`, local Brave):
  - phone Stairmaster route, desktop Through-buildings route, empty state, and a keyboard-only flow
  - all pass with no CSP violations, errors, third-party requests, cookies or storage
- **Sub-path:** the page, graph, places, a tile, a font, a sprite and the favicon all return 200 under `/better-directions/` in `vite preview`.

### Performance and size

| | |
|---|---|
| JS | 1.13 MB main (310 kB gzipped, mostly MapLibre and the style), 551 kB MapLibre worker, 33 kB planning worker |
| Graph | 9.6 MB (3.1 MB gzipped), downloaded once per visit |
| Total site | 45 MB, mostly tiles; a visit loads only the tiles it views |

### Self-review

- **Safety:**
  - The novelty notice is always on screen.
  - Closure notes show with their hours, and the late-night hint fires when it applies.
  - Roads under buildings are disclosed in the stats card and in the step itself.
  - Points too far from a path get a clear error, not a guess.
  - Link names are sanitised and only ever rendered as text (no `innerHTML` anywhere).
- **Privacy:**
  - Geolocation only on tap, and snapped before it reaches the URL.
  - The smoke test checks there are no cookies, storage or third-party requests.
- **Accessibility:**
  - Native controls with labels, and the combobox follows the ARIA pattern.
  - Keyboard-only use works end to end (tested).
  - Visible focus outlines, AA contrast, respect for reduced motion.
  - Routes are fully described in text, and results are announced through a live region.
  - Not yet done: an automated axe or Lighthouse audit. That needs a tool we haven't approved; it's planned for Phase 7.
- **Found and fixed by looking at screenshots:** the seed row showed in every mode, the marker letters were hard to read, the status line duplicated the summary, the step numbers were misaligned, and "Onward and upward" appeared on a 3-step staircase.
- **Found by the keyboard smoke test:** famous squares were missing from search.
- **Fun:** routes read well on the map. One visible weakness: the desktop Through-buildings sample goes down a quay to one far passage and back. That's the 19% doubling-back case, to tune in Phase 5.

### Decisions

D-022 to D-026.

### Skipped, and why

- Route names, the share image, snack tour and famous routes: Phase 5.
- Deploy: a big item. The workflow comes in Phase 7.

## Phase 3: The modes (2026-11-24)

### Built (`app/src/modes/`)

- **Feature index** (`features.ts`): trails, staircases (as climbable chains), parks, passages and trail stretches, plus junction degree and edge midpoints. Built once per graph.
- **Cost of fun** (`stats.ts`): extra minutes, staircases, steps up/down, metres climbed, buildings walked through, roads under buildings (disclosed), malls, stations, trail share and stretches, parks, left/right/U-turns, doubling back, and closures with hours. Plus the one-line summary.
- **The six modes** (`modes.ts`): Through buildings, Trail runner, Stairmaster, Park hopper, Never turn right, Scenic chaos (D-018 to D-020).
- **Collecting search** (`collect.ts`) and **mode planner** (`plan-mode.ts`). The cost-profile and collected routes compete on the mode's fun score, and the winner passes the safety check and the detour cap.

### Sample routes

From `npm run samples`; all 36 are in [SAMPLE_ROUTES.md](SAMPLE_ROUTES.md).

**Place des Terreaux → Place de la Croix-Rousse** (normal: 16 min)

| Mode | Cost of fun |
|---|---|
| Through buildings | 25 min, 8 staircases, 310 steps up, **10 buildings walked through** |
| Trail runner | 57 min, 8 staircases, 435 steps up, 2 trails, 1 park (28% trail) |
| Stairmaster | 29 min, **9 staircases, 555 steps up**, 2 buildings walked through, 1 park |
| Park hopper | 52 min, 9 staircases, 201 steps up, **8 parks** |
| Never turn right | 20 min, 1 staircase, 107 steps up, 1 park, **26 left turns, 0 right** |
| Scenic chaos (seed 7) | 56 min, 1 staircase, 443 steps up, 1 park |

**Cathédrale Saint-Jean → Basilique de Fourvière** (normal: 23 min)

| Mode | Cost of fun |
|---|---|
| Through buildings | 47 min, 8 staircases, 355 steps up, **6 buildings walked through**, 1 station |
| Trail runner | 60 min, 14 staircases, 249 steps up, **4 trails**, 2 parks (32% trail) |
| Stairmaster | 33 min, **10 staircases, 591 steps up**, 1 park |
| Park hopper | 50 min, 11 staircases, 212 steps up, 2 trails, **6 parks** |
| Never turn right | 30 min, 9 staircases, 302 steps up, **33 left turns, 0 right** |
| Scenic chaos (seed 7) | 42 min, 5 staircases, 808 steps up |

**Across all six sample trips:**

| Mode | Range |
|---|---|
| Stairmaster | 8–16 staircases |
| Park hopper | 5–8 parks |
| Through buildings | 6–10 buildings walked through |
| Trail runner | 28–64% trail |
| Never turn right | 0 right turns on 5 of 6 trips (1 on the sixth) |
| Scenic chaos | +16 to +40 min |

### Tuning log (what changed and why)

1. **Scenic chaos barely deviated** (0–3 min extra) with smooth weights alone, so I added seeded waypoints (D-020). Seeds then failed on longer trips, so waypoint distance was resized against the *spare* budget, and up to four seeded rounds were added.
2. **Park hopper found 1 park** from Part-Dieu to Saint-Jean. A park waypoint was a node a route could touch without walking any park path, so the same park was re-inserted over and over. It's now a park path edge, and inserted features are marked visited. Result: 6 parks.
3. **Trail runner reached 17% trail** on Terreaux to Croix-Rousse. Trail waypoints walked only a trail's middle edge while being valued at its full length. Waypoints became whole chains, which also made Stairmaster climb whole staircases. Result: 28%, and Stairmaster up to ~600 steps.
4. **Waypoint legs searched the whole cap.** Budgeting them was the big speed win: median went from 119 ms to 41 ms, worst from 530 ms to 140 ms.
5. **Doubling back:** tuned the reuse penalty (D-018).
6. **Never turn right:** raised the penalty from 300 to 1,200 s.

### Tests

- **TypeScript (160 unit tests):** cost-of-fun stats on the mini-town (staircase and steps, traboule and closure note, the brief's exact summary line), trail classification, and all modes on the mini-town.
- **Recognisability on six Lyon trips:**
  - Stairmaster: ≥ 5 staircases and ≥ 100 steps up
  - Park hopper: ≥ 4 parks
  - Through buildings: ≥ 5 buildings walked through
  - Trail runner: ≥ 25% trail, and more than normal
  - Never turn right: ≤ 1 right turn, and no more than normal
  - Scenic chaos: ≥ 4 distinct routes from 5 seeds, each with more than 5 minutes extra, reproducible per seed
  - Every mode: within the cap, deterministic, and doubling back ≤ 25%
- **Safety property test:** 3,000 random Lyon pairs (300 each for four synthetic models and all six modes with random seeds), plus 150 on a tampered graph. All safe, connected and within the cap; about 5 minutes.

### Performance

The six sample trips × six modes take median 41 ms, p90 99 ms, max 140 ms on a laptop; roughly 0.2–0.7 s on a mid-range phone. Phase 4 runs planning in a Web Worker, so the page never freezes.

### Self-review

- **Safety:** modes only change costs. Waypoint paths use only directions the audit allowed, and every assembled route goes through `assertRouteSafe` and the cap check. The property test covers every mode and random seeds.
- **Safety, open:** collecting modes like places that close (parks with gates, traboules). They're flagged and listed with their hours, but the router doesn't check the clock (Q-009). Climbing is priced by the time cap, not capped separately (Q-010).
- **Fun:** every mode is recognisable in its summary line, and the lines read well. One thing to watch in Phase 4, once routes are on a map: the remaining doubling back (worst 21%) is mostly dead-end staircases and park paths.

### Decisions

D-018 to D-021.

### Open questions

Q-009 (opening hours at route time) and Q-010 (an effort limit).

### Skipped, and why

- Directions with personality, and the stats card UI: Phase 4.
- Snack tour: Phase 5. It needs café and bakery points added to the graph build, and the waypoint search is ready for it.

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
