# Phase 0 proposal: stack, city, tiles, Pages layout

Status: **waiting for approval.** Nothing below is built yet. Evidence and smaller choices: [DECISIONS.md](DECISIONS.md).

## 1. Stack: offline Python graph build + TypeScript router in the browser (static site)

| | **Static: Python build + TS browser router** (recommended) | Python/Ruby router behind a server | GraphHopper / Valhalla, modes as profiles |
|---|---|---|---|
| Effort | Medium: we write A*, but it's ~300 lines | Medium, plus server ops | Low for basic modes; high for weird ones |
| Weird modes (turns, seeded chaos, GPS art) | Easy: we own the search state | Easy | Hard: turn-only and GPS art need custom search anyway |
| Hosting cost | Free on GitHub Pages | Needs an always-on host | JVM/C++ server with GBs of RAM |
| Offline use | Works once loaded | No | No |
| Privacy | Start and end never leave the device | Every query hits our server | Same as server |
| Fun to build | High | Medium | Low (mostly config) |

- **Graph build:** Python 3.12 with **pyosmium**, the maintained binding to the libosmium library. Python beats Ruby here because Ruby has no maintained `.osm.pbf` parser. The build is repo tooling, not a package.
- **App:** TypeScript and **Vite**. Vite handles bundling, the `/better-directions/` base path, and a preview server under that sub-path. **MapLibre GL JS** draws the map: it's BSD-3 licensed, and its CSP build avoids `blob:` workers and `eval`.
- **Safety rules implemented twice, on purpose:** once in Python (the build drops excluded ways) and once in TypeScript (the router re-checks each edge's stored tag class at query time). Both implementations run the same shared table of tagged test cases (`safety/cases.json`). The property test then checks the Python-built graph against the TypeScript rules, so the two implementations police each other.
- **Graph format:** one compact binary file of typed arrays (coordinates, edges, per-edge flag bits, delta-encoded geometry), gzipped by Pages. Budget is ≤ 5 MB on the wire; Phase 1 will measure it.
- **Licence:** code **MIT**; data **ODbL**, with "© OpenStreetMap contributors" shown in the app.
- **Is it a gem?** No: it's a web app in its own repo. Nothing here gets published as a package.

## 2. First city: **Lyon** (runner-up Edinburgh, then Montreal)

Method: Overpass counts on 2026-11-24 over a ~4 × 4 km central box per city (Edinburgh rerun on a matched box). All numbers are way counts. "Public passages" excludes `access=private|no`.

| per ~16 km² centre | Lyon | Edinburgh | Montreal | Bologna¹ | Minneapolis |
|---|---|---|---|---|---|
| Staircases (`highway=steps`) | 1,065 | **1,290** | 943 | 255 | 382 |
| Public building passages | 178 | **285** | 94 | 141 | 35 |
| `covered=yes` ways | 169 | **239** | 37 | **254** | 146 |
| Corridors + indoor ways | **447** | 82 | **543** | 293 | 514 (137 skyway bridges) |
| Parks (ways + relations) | 113 | 31 | **180** | 84 | 55 |
| Unpaved paths | **678** | 441 | 638 | 73 | 46 |
| Cafés / bakeries | 307 / **169** | **476** / 40 | 284 / 41 | 266 / 33 | 70 / 3 |
| Steps with `step_count` | **771** | 582 | 309 | 89 | 98 |

¹ Bologna's box is ~13 km², so its counts are slightly understated. "Corridors + indoor" may count a way twice if it carries both tags.

**Why Lyon:** it's the only city that places first or second in every mode:

- **Through buildings:** traboules, the Renaissance passages through buildings, plus the Part-Dieu mall and station corridors.
- **Stairmaster:** the Fourvière and Croix-Rousse hillsides, each staircase climbing a whole slope.
- **Trail runner:** the Saône and Rhône banks and the hill paths.
- **Park hopper:** many small parks.
- **Snack tour:** 169 bakeries, four times any other candidate.

The data looks carefully mapped: 57% of traboules are tagged `access=private`, which suggests mappers recorded real access rather than leaving it blank. Our exclusions drop those, and the remaining public ones get the "may be closed" note. French street names suit directions with personality ("Haul yourself up the Montée de la Grande Côte").

**Edinburgh** is the strongest alternative if you'd rather have English names and maximum stairs. Its weak spots are parks and indoor corridors. **Minneapolis** is great for one mode (skyways) and thin for the rest.

**Extract:** Geofabrik's `europe/france/rhone-alpes` `.osm.pbf`, downloaded in an explicit setup step and cropped to Greater Lyon (Lyon plus Villeurbanne) during the build. Source, date and licence get recorded in `data/SOURCE.md`, and the raw file is gitignored.

## 3. Map tiles: Protomaps basemap, self-hosted as a static `z/x/y` tile folder

- **Source:** cut a Lyon extract (zoom 0–15) from the Protomaps daily planet build using the `pmtiles` command-line tool. Unpack it into plain `tiles/{z}/{x}/{y}.mvt` files and serve them from Pages; MapLibre over-zooms past 15. Fonts (Noto, OFL licence) and sprites come from `protomaps/basemaps-assets` and are served by us. The style is generated by `@protomaps/basemaps` (BSD-3).
- **Attribution:** "© OpenStreetMap contributors · Protomaps", always visible.
- **Why not one `.pmtiles` file?** I tested range requests on Pages (D-003). Pages answers `206`, but when the browser sends `Accept-Encoding: gzip` (browsers always do), it gzips the file and applies the byte range to the **compressed** stream. Mid-file reads come back as garbage. A folder of whole tile files avoids that entirely.
- **Why not a hosted provider (MapTiler, Stadia)?** It would be a third-party request on every map pan, sending the user's IP and viewport to the provider. It would also need an API key exposed in a public site.

## 4. Pages layout: project site at `mohanenm.github.io/better-directions/`

- I recommend the project site. `mohanenm.github.io/` currently returns 404, so the root stays free for a landing page across your projects. All URLs will be relative or base-path aware. Shareable state goes in the query string, so no 404 fallback is needed.
- **Limits** (GitHub docs, checked today): published site ≤ 1 GB; 100 GB/month soft bandwidth; 10-minute deploy timeout; 100 MB hard cap per file in git.
- **Expected total size:** roughly **15–35 MB**:

  | Part | Estimate |
  |---|---|
  | Tiles | 10–25 MB, ~1–3k files |
  | Graph | ≤ 5 MB |
  | MapLibre | ~0.8 MB |
  | Fonts and sprites | ~1–2 MB |

  That's under 4% of the 1 GB limit, and the largest single file is around 5 MB. Phase 1 and Phase 4 will measure the real figures.

## What approving this also approves (Big items 3 and 4)

- **Network hosts, build time only, never from the page:**
  - `download.geofabrik.de` (OSM extract)
  - `build.protomaps.com` (basemap planet, read with ranges by `pmtiles extract`)
  - `github.com` releases (the `pmtiles` command-line tool, `basemaps-assets`)
  - PyPI and npm (packages)
- **Runtime dependency:** `maplibre-gl`.
- **Build and dev dependencies:**
  - JavaScript: `typescript`, `vite`, `vitest`, `eslint` + `typescript-eslint`, `fast-check` (property tests), `@protomaps/basemaps`
  - Python: `osmium` (pyosmium), `pmtiles`, `pytest`, `ruff`
  - Tool: the `pmtiles` command-line binary
- **Not included:** anything else, such as Playwright for browser tests; I'll ask when it comes up.
