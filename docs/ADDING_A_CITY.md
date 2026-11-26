# Adding a city

The site serves several areas, each with its own graph, places list and tiles, loaded only when someone picks it. Adding one takes an afternoon, mostly downloads, plus time to pick good famous routes. The US areas (Washington DC, Arlington and Alexandria, Silver Spring and Bethesda, Richmond, Baltimore, Chicago, Newberg, Dundee), Copenhagen and Malmö were added this way; the notes below include what they taught.

## 1. Check the data

A good city has plenty of staircases, building passages (`tunnel=building_passage`), covered ways, parks and unpaved paths in OpenStreetMap. Before committing to one, count them in a central box of about 4 × 4 km with Overpass (`out count;`) and compare with the same box around Lyon's Presqu'île.

## 2. Write `cities/<id>.json`

Copy `cities/lyon.json` and change:

- `id` and `name`: a short id used in paths, and the display name.
- `extract.url`: the smallest Geofabrik (or similar) region containing the city. A `*-latest.osm.pbf` URL is fine; the fetch step records which dated file it got.
- `extract.also`: more regions to merge in, when the box crosses a region boundary. Geofabrik's state and country extracts stop at the border, so without this the far side has map tiles (which come from a worldwide build) but no paths to route on. DC, Arlington and Silver Spring each merge the DC, Virginia and Maryland extracts, which is what makes walks over the Potomac bridges work. The fetch step crops each region to the box and merges them, keeping objects found in more than one once.
- `bbox`: west, south, east, north. Keep it to the walkable city, roughly 10 to 15 km across; the graph and tiles grow with it.
- `terrain`: an elevation provider with bare-earth heights. `ign-rge-alti` covers France and `usgs-3dep` the United States (1 m lidar in most cities, public domain); elsewhere, add a provider to `PROVIDERS` in `pipeline/bdgraph/terrain.py` for the country's open terrain model. Don't use surface models such as Copernicus GLO-30 or SRTM, which put city streets on rooftops. Without `terrain`, every climb is unknown and the app still works: it says there's no elevation data under the area picker, on every result and in the footer, and turns off hill and mixed workouts. The 3DEP service returns at most 1,000 samples a request and takes about 18 seconds each, so DC's 285,000 points take about 90 minutes. If a fetch is interrupted, rerun it; `--refetch-unknown` asks again for points cached as having no data. Denmark's terrain model (DHM/Terræn, through Dataforsyningen's WCS) and Sweden's (Markhöjdmodell grid 1+, from Lantmäteriet) are both true ground models under CC BY 4.0, but each needs a free personal login (a Dataforsyningen token; a Geotorget account and order), so Copenhagen and Malmö don't have one yet.
- `places.square_name_prefixes` and `places.square_name_suffixes`: street names that mean "square" locally, so squares mapped only as streets show up in search. French and Italian names put it first ("Place ", "Piazza "); American ones put it last (" Circle", " Square", " Plaza"), and DC's NW/NE/SW/SE quadrant suffix is ignored. Danish and Swedish write it as part of one word ("Amagertorv", "Rådhuspladsen", "Stortorget"), so their suffixes have no leading space ("torv", "pladsen", "torget"). Matching is case-sensitive.
- `confirmed_passages`: start empty. See step 4.

## 3. Build the data

```sh
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.fetch   cities/<id>.json                  # extract and crop
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.terrain cities/<id>.json                  # elevations, if configured
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.build   cities/<id>.json                  # data/<id>/graph.bin and stats
npm run tiles -- <id>                                                                      # what the page loads (build and dev also run this)
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.tiles   cities/<id>.json --build YYYYMMDD # basemap tiles
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.places  cities/<id>.json                  # search list
```

Use a Protomaps build dated on or just after the OSM extract, so the map and the graph agree.

## 4. Read the stats

Open `data/<id>/STATS.md`.

The largest strongly connected component should cover over 90% of the network's length. If it doesn't, look at the exclusion counts and their example OSM links. In Lyon the culprit was tram crossings tagged `railway=tram_crossing`, which the rules now treat as crossings. In small towns the cause is often a highway with no sidewalk: Newberg and Dundee in Oregon are joined only by Highway 99W, so the build kept Newberg and dropped Dundee entirely. They're now two areas. Expect small towns to land just under 90%, because rural lanes off fast roads are cut off too.

Spot-check the example ways for each drop reason. If a safety rule looks wrong for the city, don't loosen it to make the numbers better. A rule change is a deliberate decision, and it goes through `safety/cases.json` for both implementations.

Check `military_area` and `restricted_area` too. Nothing inside military land is walkable, and inside other areas tagged `access=private` or `no` only explicitly public ways are. In DC that removes the bases, the White House grounds and Lafayette Square (tagged `access=no`), but also a great many private parking lots; a sidewalk drawn across a private lot is dropped unless it's tagged `foot=yes`. Spot-check that famous public places survived: in DC, the National Mall did and the Pentagon didn't.

In the US, busy roads usually carry `sidewalk=separate` because the sidewalks are mapped as their own ways. The router won't walk down the middle of a primary, secondary or tertiary road tagged that way, or tagged `sidewalk=no`, so check `sidewalk_separate` and `no_sidewalk` haven't cut the network (in DC connectivity stayed at 98.5%).

Cemeteries are always marked as places that may close, with their hours if mapped; Arlington National Cemetery has none in OSM. Gardens and zoos count only when they have hours.

Look closely at `passage_not_public`. Passages and corridors through buildings that aren't shops, malls or stations are dropped unless they have public access tags or a street name. If the city publishes a list of passages open to the public, as Lyon does for its traboules, check the dropped ones against it and add the confirmed ones to `confirmed_passages`:

```json
"confirmed_passages": [
  { "way": 123456789, "note": "Cour des Voraces, on the city's list (May 2025)" }
]
```

## 5. Add it to the app

- `app/src/city.ts`: add an entry to `AREAS` with the same `id`, `name` and `bbox` as the config (`app/test/areas.test.ts` checks they match), a centre for "nearest to me", `labelLang` (the OSM `name:<lang>` for map labels) and `maxTileZoom`. Add `tiled: true` if `graph.bin` is 10 MB or more, so the page loads it in tiles; the same test fails if it's missing, or set on a smaller area.
- `app/src/ui/famous.ts`: add a few famous routes under the area's id, between well-known public places. `app/test/famous.test.ts` checks each one still lives up to its pitch. Without terrain, staircases are counted but steps have no direction, so pitch stairs routes by staircases rather than steps up.
- The footer's attribution comes from the graph (OSM date) and the terrain provider, if any.

The area list, the picker and the links (`?area=<id>`) pick the area up automatically. The heavier tests (`app/test/modes.test.ts`, the property test by default) run on Lyon.

## 6. Check everything

```sh
.venv/bin/python -m pytest          # pipeline tests, including real-data checks against the new extract
npm run check                       # typecheck, lint and all tests, including the safety property test
npm run samples                     # read docs/SAMPLE_ROUTES.md: is every mode recognisable?
npm run pages:gz &                  # the real build at http://localhost:4174/better-directions/, served like Pages
npm run smoke                       # browser checks, including no missing files
npm run perf                        # low-end phone emulation
```

The pipeline's real-data tests (`pipeline/tests/test_real_data.py`) and the property test read Lyon's paths; switch them to the new city.

## Size

With eleven areas the built site is about 285 MB. DC has the most map tiles, 50 MB at zoom 0 to 15 for its 18 × 23 km, and the largest graph, 18 MB (5.5 MB gzipped), since it merges the Virginia and Maryland parts of its box. Loaded whole, its first route took about 16 seconds on the emulated phone; in tiles it takes about 9. Tiles repeat the edges that cross their borders, so a tiled graph takes about a third more space on the site (DC's tiles are 24 MB), though a visit downloads only a small part of it. Chicago's is 12.8 MB (3.4 MB gzipped) for 11 × 20 km of dense grid, alleys and mapped sidewalks. Tiles grow with the area's size, roughly 1.2 to 1.7 MB per 10 km²; dropping zoom 15 cuts them by about 60% at the cost of street-level detail. The graph grows with how much is mapped: about 0.6 MB per 10 km² in Chicago, against 0.25 in DC with its parkland and river. GitHub Pages allows 1 GB per site and about 100 GB of traffic a month, and no file may exceed 100 MB (the site test keeps every file under 25 MB and the whole site under 300 MB).
