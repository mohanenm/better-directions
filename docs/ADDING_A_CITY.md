# Adding a city

Each build serves one city; Lyon is the first. Adding another takes an afternoon, mostly downloads, plus time to pick good famous routes.

## 1. Check the data

A good city has plenty of staircases, building passages (`tunnel=building_passage`), covered ways, parks and unpaved paths in OpenStreetMap. Before committing to one, count them in a central box of about 4 × 4 km with Overpass (`out count;`) and compare with the same box around Lyon's Presqu'île.

## 2. Write `cities/<id>.json`

Copy `cities/lyon.json` and change:

- `id` and `name`: a short id used in paths, and the display name.
- `extract.url`: the smallest Geofabrik (or similar) region containing the city. A `*-latest.osm.pbf` URL is fine; the fetch step records which dated file it got.
- `bbox`: west, south, east, north. Keep it to the walkable city, roughly 10 to 15 km across; the graph and tiles grow with it.
- `terrain`: an elevation provider with bare-earth heights. `ign-rge-alti` covers France only; elsewhere, add a provider to `PROVIDERS` in `pipeline/bdgraph/terrain.py` for the country's open terrain model. Don't use surface models such as Copernicus GLO-30 or SRTM, which put city streets on rooftops. Without `terrain`, every climb is unknown and the app still works.
- `places.square_name_prefixes`: street-name prefixes that mean "square" locally ("Plaza ", "Piazza ", "Platz"), so squares mapped only as streets show up in search.
- `confirmed_passages`: start empty. See step 4.

## 3. Build the data

```sh
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.fetch   cities/<id>.json                  # extract and crop
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.terrain cities/<id>.json                  # elevations, if configured
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.build   cities/<id>.json                  # graph.bin and stats
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.tiles   cities/<id>.json --build YYYYMMDD # basemap tiles
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.places  cities/<id>.json                  # search list
```

Use a Protomaps build dated on or just after the OSM extract, so the map and the graph agree.

## 4. Read the stats

Open `data/<id>/STATS.md`.

The largest strongly connected component should cover over 90% of the network's length. If it doesn't, look at the exclusion counts and their example OSM links. In Lyon the culprit was tram crossings tagged `railway=tram_crossing`, which the rules now treat as crossings.

Spot-check the example ways for each drop reason. If a safety rule looks wrong for the city, don't loosen it to make the numbers better. A rule change is a deliberate decision, and it goes through `safety/cases.json` for both implementations.

Look closely at `passage_not_public`. Passages and corridors through buildings that aren't shops, malls or stations are dropped unless they have public access tags or a street name. If the city publishes a list of passages open to the public, as Lyon does for its traboules, check the dropped ones against it and add the confirmed ones to `confirmed_passages`:

```json
"confirmed_passages": [
  { "way": 123456789, "note": "Cour des Voraces, on the city's list (May 2025)" }
]
```

## 5. Point the app at the city

- `app/src/city.ts`: `id`, `name` and `labelLang` (the OSM `name:<lang>` used for map labels).
- `app/index.html`: the description, the map's `aria-label` and the search placeholders.
- `app/src/ui/famous.ts`: replace the famous routes with the new city's, at least one per mode, between well-known public places. Adjust the thresholds in `app/test/famous.test.ts` if needed.
- `app/bench/samples.bench.ts` and the trips in `app/test/modes.test.ts`: replace the sample places.
- The footer's attribution comes from the graph (OSM date) and the terrain provider. Check it reads right.

To serve several cities from one site you'd need a city picker; `cityData()` already builds paths from the city id.

## 6. Check everything

```sh
.venv/bin/python -m pytest          # pipeline tests, including real-data checks against the new extract
npm run check                       # typecheck, lint and all tests, including the safety property test
npm run samples                     # read docs/SAMPLE_ROUTES.md: is every mode recognisable?
npm run pages:local &               # the real build at http://localhost:4173/better-directions/
npm run smoke                       # browser checks
npm run perf                        # low-end phone emulation
```

The pipeline's real-data tests (`pipeline/tests/test_real_data.py`) and the property test read Lyon's paths; switch them to the new city.

## Size

Lyon's graph is 9.2 MB (2.7 MB gzipped), its tiles 27 MB and the whole built site 39 MB. GitHub Pages allows 1 GB per site and about 100 GB of traffic a month, so a handful of cities this size fit comfortably.
