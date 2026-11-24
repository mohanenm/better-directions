# Open questions

Each question has a recommended answer and the assumption I'm working on until you decide.

## Q-001 Phase 0 decisions: answered 2026-11-24

- **Answer:** approved as proposed.

## Q-002 Shared fixture town

- **Question:** does the separate fixture-generator project (a shared made-up town) exist yet?
- **Recommendation:** start with a small hand-made mini-graph in this repo. That's enough for router and safety tests. Add the shared town later as an optional extra test input.
- **Assumption:** it doesn't exist yet, so I'm using local fixtures only.

## Q-003 Python version

- **Question:** which Python should run the build tooling?
- **Recommendation:** Python 3.12. It's already installed through Homebrew; the system's 3.9 is past end of life. CI will pin 3.12 the same way.
- **Assumption:** 3.12, in a project-local `.venv`.

## Q-004 Tram crossings: answered 2026-11-24, allowed

- **Answer:** allow `tram_crossing` and `tram_level_crossing`, with foot access checks. Applied; Lyon connectivity went from 72.9% to 93.9% of junctions (96.1% of length).

<details><summary>Original question</summary>


- **Question:** should `railway=tram_crossing` and `railway=tram_level_crossing` count as mapped railway crossings, alongside `crossing` and `level_crossing`? They would still need foot access, i.e. no `foot=no` and no `access=no|private`.
- **Background:** in OSM, `railway=tram_crossing` is *the* tag for a pedestrian crossing over tram tracks, and `tram_level_crossing` is a road crossing them. The brief's rule lists only `crossing` and `level_crossing`, so the build currently blocks all 1,708 mapped tram crossings in Lyon. Tram lines then cut the city into pieces: **only 72.9% of the network is in the largest connected part.**
- **Measured, 2026-11-24 data:**

  | Variant | Network kept |
  |---|---|
  | Strict (current) | 72.9% |
  | + tram crossings allowed | **95.5%** |
  | + abandoned/razed railways not treated as tracks | 95.7% |
  | No railway node rule at all (upper bound) | 95.7% |

- **Recommendation:** allow the two tram crossing tags, and nothing else. That recovers almost everything while keeping unmapped crossings (341 untagged shared nodes) blocked. It's one line in the rules and two edited cases in `safety/cases.json`.
- **Assumption:** strict rule until you answer. Routes work, but parts of the city are unreachable.

</details>

## Q-005 `highway=corridor` with `indoor=yes`: answered 2026-11-24, allowed

- **Answer:** `highway=corridor` qualifies whatever its `indoor` value. Missing access counts as public; `private` and `no` still exclude. Applied; corridors went from 9 edges to 3,498.

<details><summary>Original question</summary>


- **Question:** should `highway=corridor` qualify as a passage whatever its `indoor` value?
- **Background:** the brief says `indoor=corridor` *or* `highway=corridor` (public or permissive) qualifies. My implementation is stricter than that: it excludes any way whose `indoor` value isn't `corridor` or `no`. That removes **2,980 `highway=corridor` + `indoor=yes` ways**, mostly the Part-Dieu mall and station complex. They're exactly what "Through buildings" wants. Matching the brief would still un-exclude ways, so I'm asking rather than changing it.
- **Related reading to confirm:** a corridor with no `access` tag is treated as public (OSM's default), and so are `customers` and `destination`. Only `private` and `no` exclude.
- **Recommendation:** allow `highway=corridor` regardless of `indoor`. Keep excluding non-corridor ways with `indoor=yes`, e.g. 131 footways and 52 staircases inside buildings. Corridors are flagged "may be closed".
- **Assumption:** strict until you answer.

</details>

## Q-006 Railway features that aren't tracks: answered 2026-11-24, allowed

- **Answer:** entrance and `tram_stop` ways aren't tracks for the crossing rule. Applied.

<details><summary>Original question</summary>


- **Question:** for the crossing rule, should ways tagged `railway=subway_entrance`, `train_station_entrance`, `funicular_entrance` or `tram_stop` count as non-track features, like platforms?
- **Background:** they aren't rails, but my classifier treats any unknown `railway=*` way as a track (strict default), so nodes shared with them are blocked. This has no measurable effect on Lyon's connectivity. I tried to change it as a bug fix and was rightly stopped: it loosens a rule.
- **Recommendation:** yes, treat them as non-track features. Walking *along* any `railway=*` way stays excluded.
- **Assumption:** strict.

</details>

## Q-007 Public roads passing under buildings: answered 2026-11-24, keep with a flag

- **Answer:** keep them, with a special flag and a disclosure. Roads only (residential up to primary, service, living street, and walkable trunks), with no `level` or `indoor` tag. They carry `edge_flags` bit 5, and the app will say something like "passes under a building (no tunnel mapped)". Footways and stairs inside footprints are still dropped. Lyon: 162 edges, 5.3 km kept.

<details><summary>Original question</summary>


- **Question:** what should happen to street segments whose path lies inside a building footprint with no `tunnel` or `covered` tag? Examples: primary Avenue du Châter (way 4424264), tertiary Avenue de Taffignon (way 4424268), and some service roads.
- **Background:** the build drops them, because the brief says never through a building except via mapped passages. They're usually streets running under a building, or sloppy outlines.
- **Recommendation:** keep dropping them. It's the safe direction, and the stats list examples with OSM links for anyone who wants to fix the map.
- **Assumption:** keep dropping them.

</details>

## Q-008 Elevation data: answered 2026-11-24, added

- **Answer:** add a terrain source. Implemented with IGN RGE ALTI (see D-013): new host `data.geopf.fr`, build time only. 100% of Lyon's edges now have climb data.

<details><summary>Original question</summary>


- **Question:** add a terrain model so "steps climbed" and hill effort are real, rather than estimated from tags?
- **Recommendation:** not now. `incline` tags and staircases are enough for Stairmaster. If wanted later: IGN RGE ALTI 5 m (Etalab open licence) or Copernicus GLO-30. Either means a new build-time download host.
- **Assumption:** no elevation data.

</details>
