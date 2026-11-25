# Crawls

A crawl is a walk through a few stops of one kind, from your From point and back, or on to your To point. Stops are picked to be spread out but within walking distance of each other, ordered to keep the walk short (nearest neighbour, then 2-opt), and joined by ordinary router legs, so every safety rule applies. The planner never ranks venues: the order is the route's.

Art crawls can have up to eight stops; pub and wine crawls up to six. Pub and wine crawls keep the walk between stops under about 600 m in a straight line, prefer lit streets over unlit paths, trails and parks, and flag stops whose mapped hours end before 21:00. They also carry a short note about drinking responsibly and the legal drinking age.

## What counts as a stop

Stops come from OpenStreetMap tags, read when the graph is built (`poi_kind` in `pipeline/bdgraph/build.py`) and snapped to the street they're on, within 40 m.

| Theme | Tags |
|---|---|
| Art | `tourism=artwork` (not `indoor=yes`), `tourism=gallery`, `tourism=museum` with `museum=art` or "art" in its name |
| Pub | `amenity=pub`, `amenity=bar`, `amenity=biergarten`, `craft=brewery`, or a bar or pub with `microbrewery=yes` |
| Wine | `craft=winery`, `shop=wine`, or a bar or pub with `bar=wine`, `drink:wine=yes\|served`, or a wine word in its name |

Unnamed artworks are included and labelled by `artwork_type` ("Mural", "Sculpture", "Pavement mosaic"); unnamed bars and shops are skipped.

## Tagging in Lyon

As of the 2026-11-23 extract: 394 outdoor artworks (sculptures, murals, statues, Ememem's pavement mosaics tagged `artwork_type=flacking`), 51 galleries, 8 art museums, 388 bars, 119 pubs, 18 breweries, 10 wine bars, 36 wine shops and 2 wineries.

Wine bars are rarely tagged as such in Lyon: only three bars have `drink:wine=yes` and none `bar=wine`. Most are found by name ("Cave", "Vins", "Wine"), which also catches some restaurants and misses wine bars with other names. `shop=wine` places are included because many Lyon cavistes pour by the glass, but tastings aren't tagged, so check before you go.
