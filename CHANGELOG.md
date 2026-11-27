# Changelog

## 2.0.0 (unreleased)

### Added

- New areas: Washington DC, Arlington and Alexandria, Silver Spring and Bethesda, Richmond, Baltimore, Chicago (from Chinatown and Pilsen up to Rogers Park), Newberg and Dundee in Oregon, Copenhagen (with Amager) and Malmö (with Limhamn), each loaded only when picked, with an area picker and "nearest to me". Famous routes for each.
- Elevation for the US areas from the USGS 3D Elevation Program, so climbs and steps up are known there too.
- Most inconvenient mode: many turns, needless ups and downs, no straight lines, and never more busy-road crossings than the normal route.
- Crawls: art, pub and wine crawls through a chosen number of stops, looping back or ending at your To point. Stops are numbered pins you can swap or skip.
- Workouts: loops of 20 minutes to an hour collecting staircases, hills or both, preferring lit streets for longer loops.
- Park pins: parks along or near a route, with their hours. Tap one to add it as a stop; up to three stops, in order.
- Spell a word: a walk whose trace spells 2 to 6 letters or digits, scored for readability per letter. The word stays on the device unless you choose to include it in a link.
- Famous routes for the new mode, a crawl and a workout.
- Longer walks: tick "Longer walk" to let a detour run to two hours, and always add up to half an hour to the normal walk, so walks that are already long still get a detour. A route that's just the normal one because the hour left no room offers "Allow a longer walk" right there. Crawls and workouts go up to two hours; shapes have a 1 h 15 option. The default stays an hour, and walks over an hour say roughly when you'd finish.
- Big areas load faster: DC's and Chicago's walking graphs are cut into tiles, and the page loads only the part a request can reach. On an emulated slow phone, DC's first route takes about 9 seconds instead of 16, and Chicago's about 8 instead of 11; and the routes are exactly those the whole graph would give. Planning also skips candidates that could never fit the time cap, which changes a few routes slightly.
- Dark mode, with a dark basemap. It follows the system setting, and a switch in the header changes it for the visit (nothing is stored).

### Changed

- Stricter safety: no paths on military land; inside private or no-access grounds only explicitly public paths; no walking down busy roads whose sidewalks are mapped separately or that have none. Cemeteries are flagged as places that may close.
- Stricter still, after an independent review: `access` and `foot` are allow-lists, so `permit`, `military`, `emergency`, `delivery` and unknown values are left out (`permit` had opened the NIH campus in Bethesda and airport terminal roads). Prisons, construction sites, power plants and substations, and permit-only areas are closed ground, like private grounds. Driveways and `motorroad=yes` roads are out, and so are busy roads with no sidewalk on either side however it's tagged. Covered walkways through buildings need the same evidence of being public as passages, and a way's `layer` tag no longer hides the building it runs through. Tag values are compared trimmed and lower-cased, with lists split and the strictest value winning. Sites that are closed but not tagged so can be listed per city (`closed_areas`); the NIH campus is the first.
- Directions only call it a turn at a real junction, matching the turn counts.
- A simpler panel. Pick the kind of walk (A to B, Crawl, Workout or Draw) and only its options show. Once a walk is ready, the result replaces the planner: the trip, the route's name and stats, any warnings in one box, then the directions, with Edit to go back and mode chips to compare modes without leaving the result. About and privacy, and sharing, open as dialogs. Links keep the kind of walk (`kind=`); older links with `open=` still work.
- A new look: the map fills the screen, with the planner floating over it on wide screens and as a bottom sheet on phones that expands to full height. Start and end sit in one field with a swap button; modes are cards; short choices are segmented controls. Routes are fitted into the part of the map the planner leaves visible, and so is the share image.
- Modes are listed with a description each, and have shorter names: Through buildings, Trails, Stairs, Parks, Snacks, Left turns only and Random. Links using the old mode ids still work.
- Copy, route names and directions are drier and plainer. The safety notice is unchanged.
- Passages and corridors through buildings that aren't public-facing (flats, offices, university buildings, hospitals) are no longer routed through unless they're tagged public, have a street name, or are confirmed against the city's list. In Lyon this removes the Université Lyon 1 campus corridors and about 150 private-looking passages.
- Documentation rewritten as project documentation; working notes no longer live in the repository.

### Fixed

- DC, Arlington and Silver Spring now include the paths on the other side of the state lines inside their boxes. Each was built from one state's extract, so most of DC was unroutable from the Arlington area ("too far from any walkable path") despite showing on the map. When a point can't be placed, the message now says whether it's outside the area and names an area that covers it.
- The map sometimes kept showing the previous route after a new one was planned.
- Errors appeared below all the panel's sections, out of sight; they now show near the top, and the old route is cleared.
- A step's note (such as a park's opening hours) was squeezed into the step-number column, one word per line, making some routes' directions dozens of screens long; it now sits under the step, once per place.
- The map opened on the whole area's box, which on a phone showed the suburbs; it now opens on the centre of town.
- Landscape phones get the side-panel layout, and the header and footer no longer cover the map at large text sizes.
- "Start at my location" put the raw GPS fix, and the name "My location", in the address bar before the walk was planned. Links now carry a location only once it's snapped to the nearest path, and never that name. A crawl's end point is snapped too.
- The share image of a word kept out of links showed the word, in the dashed ideal lettering. That's now left off the image.
- `licenses.txt` was missing the licence texts of two shipped packages (`@protomaps/basemaps`, `murmurhash-js`); they're included, and generating the file fails if any package's text is missing.
- On touch screens a mode tapped earlier kept its hover style and looked as selected as the one tapped since; hover styles now apply only with a real pointer.
- Sharing feedback ("Link copied") showed behind the share dialog; it's now in the dialog, with the link to copy by hand if sharing and copying both fail.
- A walk already over an hour, or with nothing for the chosen mode within reach, now says why the better route is the normal one, and routes are no longer named for features they don't have.
- Shared links could reopen a slightly different route; park stops from an earlier route carried over into later ones; the dark share image's title was unreadable; the share image could crop a sliver of map.
- A stairs workout could drop the staircases it found; crawls short of stops now say so; Spell a word no longer offers 10 letters when about 5 fit, or suggests chopped words.
- Smaller fixes from an audit of the planner and the page: search feedback and duplicates, wording in directions, tap targets on small phones, snapping range in the Nordic areas.
- Scrolling the side panel no longer scrolls the whole page, moves the map, or leaves a blank gap under the footer, on desktop or mobile.
- Small tap targets (step-by-step buttons, walk-length options, the Download link) are now at least 24 px.

## 1.0.0 (2026-11-24)

First release, for Lyon.

- Seven modes: Through buildings, Trail runner, Stairmaster, Park hopper, Snack tour, Never turn right and Scenic chaos. The normal route is always shown alongside, with the cost of the detour.
- Hard-coded walking safety rules, enforced when the graph is built, when it loads, during the search and on every route, and tested with shared cases and a property test.
- Climb from IGN's RGE ALTI terrain model, with step counts on staircases.
- Generated route names, step-by-step directions, shareable links and share images.
- Eight famous Lyon routes.
- Experimental GPS art: shapes and one-stroke letters drawn with real streets.
- A static site with self-hosted tiles and fonts, a strict Content-Security-Policy, and no cookies, storage or analytics.
