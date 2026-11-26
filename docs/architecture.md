# Architecture

Better Directions is a static site. A Python pipeline turns an OpenStreetMap extract into a compact walking graph and a set of map tiles for each area; the browser downloads the chosen area's graph (for the biggest areas, only the parts a request can reach) and plans every route locally, in a Web Worker. There is no server and no API. Areas are listed in `app/src/city.ts` and picked with `?area=`; switching area reloads the page, and the worker is named after the area so it loads the right graph.

```
OSM extract ──► pipeline (Python) ──► graph.bin ──► npm run tiles ──► graph tiles ─┐
                                   └─► map tiles + places.json ─────────────────────┴─► static site
                    │                                                      │
             safety rules (py)  ◄── safety/cases.json ──►  safety rules (ts) + router
```

## Data pipeline

`pipeline/bdgraph` has one module per step: `fetch` downloads a dated regional extract and crops it to the city's bounding box, `terrain` fetches elevations, `build` makes the graph, `tiles` cuts the basemap and `places` makes the search list. Each step caches its output under `data/raw/`, so the build itself takes about 30 seconds.

The crop keeps every way that touches the box whole, with all its nodes, so parks and buildings at the edge stay complete and containment checks stay correct.

The build keeps only the largest strongly connected component (respecting one-way paths and escalators). Every start and end in the graph can therefore reach each other, which keeps the app predictable and the property test meaningful. In Lyon that's 95% of junctions.

### Terrain

Climb comes from a bare-earth terrain model, not a surface model: Copernicus and SRTM put city streets on rooftops. For Lyon that's IGN's RGE ALTI, queried through the Géoplateforme service for only the points the graph uses (about 50 requests); for the US areas, the USGS 3D Elevation Program's image service, 2,000 points a request. Bridges, tunnels and levelled ways take their endpoints' heights. Missing values stay unknown rather than guessed. The provider is set per city, and without one every climb is unknown and the app still works.

### Basemap

GitHub Pages compresses responses on the fly and applies byte ranges to the compressed stream, so a single PMTiles file can't be read from it. The pipeline unpacks a Protomaps build into plain `z/x/y.mvt` files instead (340 files, 27 MB for Lyon, zoom 0 to 15), using a build from the same day as the OSM extract so the map and the graph agree. Fonts and sprites are self-hosted too.

## The graph file

`graph.bin` is a JSON header followed by 8-byte-aligned typed arrays, so the browser reads it with zero-copy `TypedArray` views. Coordinates are microdegrees, edge shapes are delta-encoded varints, edge lengths are 16-bit decimetres, and tags are deduplicated into shared tag sets. Lyon's graph is 9.0 MB, 2.6 MB gzipped. Only junctions and rule-relevant points are nodes. The format is described in [GRAPH_FORMAT.md](GRAPH_FORMAT.md).

The file keeps the raw tags the safety rules need, so the browser can re-run the same rules rather than trust the build.

## Loading the graph

Most areas load their whole graph, as built (`whole.bin`). The big ones, DC and Chicago, are marked `tiled` in `app/src/city.ts` (a test requires it of any graph of 10 MB or more). `npm run tiles`, which the build runs first, cuts their graphs into tiles about a kilometre square, and the worker loads only the tiles a request can reach. Because the page knows from `city.ts` which kind of area it's in, it fetches the right files straight away, with no index to read first. Smaller graphs stay whole because one download beats the extra round trips of loading parts; tiling every area made the medium ones slower on the emulated phone.

That's exact rather than a guess, because every route is capped in time and nobody walks faster than 6 km/h (`MAX_SPEED_MS`; edge times are never shorter than length over it). A route between two points can only pass points inside an ellipse with those points as foci, where the straight-line distances add up to at most cap × speed; a trip through stops, the union over its legs; a loop, a circle around its start (`router/region.ts`). The worker loads every tile that touches that region plus a margin for snapping and look-ups near the route; planners skip candidates outside it, and each leg of a multi-leg route is capped to leave room for the rest. A trip whose normal route runs past the cap is loaded out to the normal route's reach and checked again until it fits.

Joined tiles are numbered in whole-graph order, so the router breaks ties the same way, and the feature lists (staircases, parks and so on) are worked out over the whole area at build time and mapped onto what's loaded. Anything seeded or hashed (route names, Random's waypoints) uses whole-graph numbers. `app/test/tiled.test.ts` plans random trips in every mode (with stops and longer walks), crawls, workouts, shapes and words on the whole graph and on tiles, and requires identical routes, names and summaries. Each request is checked twice: on a fresh loader, and on one already holding another request's tiles, so an answer can't depend on what happens to be loaded.

In the worker, each request goes through two steps in `app/src/requests.ts`: `prepareRequest` loads the tiles its kind of walk can reach (a trip, a crawl, a loop, a drawing), and `handle` plans it on the result, with nothing awaited in between. For a whole area the first step is a no-op. The test calls the same two functions.

## Safety

The rules are hard-coded in two places, `pipeline/bdgraph/safety.py` and `app/src/safety/rules.ts`, and both must return exactly the results in `safety/cases.json`. No mode or setting can switch them off. Where a tag is ambiguous, the stricter reading wins.

Some checks need geometry rather than tags. The build drops a path that crosses a railway or a fast road at grade without a shared node; any path on military land; any path inside an area tagged `access=private` or `no` unless the path itself is explicitly public; and a path that lies inside a building without being a mapped passage (sampled every 4 m, ignoring points within 0.75 m of a wall so pavements drawn on facades survive). A mapped passage or corridor only counts if the building is public-facing (a shop, mall or station), or the way has public access tags, a street name, or is listed as confirmed in the city config. Many passages run through flats, offices, universities and hospitals. Roads that run under a building with no tunnel tag are kept, flagged and disclosed in the directions. On busy roads whose sidewalks are mapped separately (common in the US), or that have none, the router uses the sidewalk or nothing.

In the browser the rules run three more times: a load-time audit disables any edge, node or direction that breaks a rule; the search only uses what the audit allowed; and every finished route goes through `assertRouteSafe`, which re-checks it from raw tags, along with connectivity and the detour cap. The property test adds its own independent check on top.

The detour cap is `max(normal, min(4 × normal, 60 min))`, or 90 minutes instead of 60 when the walker ticks "Longer walk" (`long=1` in links). Loops, which have no normal route, are capped by the length chosen: up to 60 minutes, or 90 for the 1 h 30 crawls and workouts. Shapes may take up to an hour, or an hour and a half for the 75-minute option. Spelled words stay within an hour. Nothing exceeds 90 minutes unless the normal route itself does.

## Router

The router is A* over directed edges, so turn-aware modes and plain ones share one search. Each cost model declares the cheapest it can ever be per second of walking, and the heuristic uses that, so it stays admissible; the router throws if a model breaks its promise.

Walking time uses Tobler's hiking function on each edge's grade, plus a fixed time per step on stairs. The planner prunes partial routes that can't finish under the detour cap. If the best fun route is still over the cap, it blends walking time back into the cost in steps, and as a last resort returns the normal route.

## Modes

Every mode is a cost profile: a multiplier on walking time per edge. Cheap edges are the ones the mode likes.

A cost profile only picks up features that are roughly on the way, so the collecting modes (stairs, parks, buildings, trails and snacks) also run a greedy waypoint search. It picks the feature with the best value per extra metre, inserts it where it adds least, routes the two new legs for real within the remaining budget, and keeps the insertion only if the whole route still fits the cap. A waypoint is a whole feature, such as a staircase climbed bottom to top or a trail end to end. Edges already on the route cost three times as much in later legs, and an insertion is rejected if more than 15% of the route would retrace itself, so routes loop rather than double back. The planner keeps whichever of the two routes scores higher on the mode's own measure of fun.

"Never turn right" adds a heavy penalty per right turn or U-turn at real junctions instead of banning them, because a ban sometimes leaves no route within the cap. The stats always show the count. "Scenic chaos" combines smooth random weights with one or two random waypoints, all derived from the seed and the trip, so the same link always gives the same route.

## GPS art

Shape templates are scaled to the chosen walk time, anchored at the start, and placed by scoring candidate positions against the street network. The corners are joined with legs routed along a corridor around the ideal outline, and spurs are trimmed. Likeness is the mean distance between the walk and the shape, relative to the shape's size. Because it uses the normal router, all the safety checks apply. Details are in [GPS_ART.md](GPS_ART.md).

## The page

The page is plain TypeScript with MapLibre GL, built by Vite. Planning runs in a Web Worker so the map stays smooth; stale replies are dropped. Place search runs over a local list of about 1,200 squares, stations, parks and landmarks extracted from OSM.

A shared link holds the start and end snapped to the walking graph (not the raw tap or GPS fix), the mode and, for chaos, the seed. Parsing ignores anything outside the city and renders names as text only. Share images are drawn on a canvas on the device.

The production build adds a strict Content-Security-Policy as a meta tag: every request goes to the site itself. There are no cookies, no storage and no analytics.

## Hosting and CI

The site is built for GitHub Pages under `/better-directions/`. CI runs the pipeline tests and the app's typecheck, lint, build and tests on every push. The deploy workflow runs the same checks again, then deploys on every merge to `main`. Actions are pinned to commit SHAs, and only the deploy job can write to Pages.

Each area's built graph (`data/<area>/graph.bin`) is committed, because rebuilding needs a 550 MB download; what the page loads is generated from it at build time. A pipeline test, run locally where the extract is available, checks that the committed Lyon file matches a fresh build byte for byte.
