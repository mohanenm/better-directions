# Adding a city

Better Directions serves one city per build. Lyon is the first. This guide covers adding a second city, or switching to one, from scratch. Budget an afternoon, mostly waiting for downloads, plus time to tune the famous routes.

## 0. Check the city's data first

Good cities have many staircases, building passages (`tunnel=building_passage`), covered ways, corridors, parks and unpaved paths in OpenStreetMap. Before committing to one, compare it with Lyon using the Overpass counts in [PHASE0_PROPOSAL.md](PHASE0_PROPOSAL.md) (method: D-002 in [DECISIONS.md](DECISIONS.md)).

## 1. City config: `cities/<id>.json`

Copy `cities/lyon.json` and edit:

| Key | What it is |
|---|---|
| `id`, `name` | Short id (used in paths) and display name |
| `extract.url` | The smallest Geofabrik (or similar) region containing the city. A `*-latest.osm.pbf` URL works: the setup step records the dated file. |
| `bbox` | West, south, east, north. Keep it to the walkable city, roughly 10–15 km across. The graph and tiles grow with it. |
| `terrain` | An elevation provider with **bare-earth** heights. `ign-rge-alti` covers France only. Elsewhere, add a provider to `PROVIDERS` in `pipeline/bdgraph/terrain.py` for the country's open national terrain model. Don't use surface models (Copernicus GLO-30, SRTM): in cities they put streets on rooftops. Leave `terrain` out and every climb is "unknown" (the app still works). |
| `places.square_name_prefixes` | Street-name prefixes that mean "square" locally ("Place ", "Plaza ", "Piazza ", "Platz"…), so famous squares mapped only as streets are searchable |

## 2. Build the data

```sh
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.fetch   cities/<id>.json                  # extract + crop
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.terrain cities/<id>.json                  # elevations (if configured)
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.build   cities/<id>.json                  # graph.bin + stats
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.tiles   cities/<id>.json --build YYYYMMDD # basemap tiles
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.places  cities/<id>.json                  # search list
```

Use a Protomaps build date on or just after the OSM extract's date, so the map and the graph agree.

## 3. Read the stats before going further

Open `data/<id>/STATS.md` and check:

- **Largest strongly connected component:** aim for over 90% of length. If it's low, look at the exclusion counts and the example OSM links. In Lyon, the cause was tram crossings tagged `railway=tram_crossing` (Q-004).
- **Fun features:** passages, corridors, staircases, park paths, unpaved paths, snack stops.
- **Drops:** spot-check the example ways for each drop reason. If a *safety rule* seems wrong for the city, don't change it yourself: rule changes need the project owner's approval (Big item 2), and every change goes through `safety/cases.json` for both implementations.

## 4. Point the app at the city

- **`app/src/city.ts`:** set `id`, `name` and `labelLang` (the OSM `name:<lang>` for map labels).
- **`app/index.html`:** update the description, the map's `aria-label` and the search placeholders ("Search Lyon places").
- **`app/src/ui/famous.ts`:** replace the curated routes with ones for the new city, at least one per mode, between well-known public places. Then update the pitch thresholds in `app/test/famous.test.ts` if needed.
- **`app/bench/samples.bench.ts`** and the Lyon trips in **`app/test/modes.test.ts`:** replace the sample places.
- **Attribution in the footer** comes from the graph (OSM date) and the city's terrain provider. Check it reads correctly.

To serve several cities from one site, `cityData()` already builds paths from the city id. You'd need a city picker that sets the id and loads the right graph; that isn't built yet.

## 5. Check everything

```sh
.venv/bin/python -m pytest          # pipeline, including real-data checks against the new extract
npm run check                       # typecheck, lint, all tests including the safety property test
npm run samples                     # read docs/SAMPLE_ROUTES.md: is every mode recognisable and fun?
npm run pages:local &               # the real build at http://localhost:4173/better-directions/
npm run smoke                       # browser checks: no CSP violations, no third-party requests
npm run perf                        # low-end phone emulation
```

The pipeline's real-data tests (`pipeline/tests/test_real_data.py`) and the property test read the Lyon paths. Switch them to the new city id.

## 6. Size budget

Lyon's graph is 9.7 MB (3.1 MB gzipped), its tiles 27 MB, and the whole site 45 MB. GitHub Pages allows 1 GB per site and 100 GB per month of soft bandwidth. Each extra city of Lyon's size adds about 40 MB, so a handful of cities fit comfortably.
