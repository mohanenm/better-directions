# Changelog

## 2.0.0 (unreleased)

### Added

- New areas: Washington DC, Arlington and Alexandria, Silver Spring and Bethesda, Richmond, Baltimore, Chicago (from Chinatown and Pilsen up to Rogers Park), Newberg and Dundee in Oregon, Copenhagen (with Amager) and Malmö (with Limhamn), each loaded only when picked, with an area picker and "nearest to me". Famous routes for each.
- Elevation for the US areas from the USGS 3D Elevation Program, so climbs and steps up are known there too.
- Most inconvenient mode: many turns, needless ups and downs, no straight lines, and never more busy-road crossings than the normal route.
- Crawls: art, pub and wine crawls through a chosen number of stops, looping back or ending at your To point. Stops are numbered pins you can swap or skip.
- Workouts: 20, 30 or 45-minute loops collecting staircases, hills or both, preferring lit streets for longer loops.
- Park pins: parks along or near a route, with their hours. Tap one to add it as a stop; up to three stops, in order.
- Spell a word: a walk whose trace spells 2 to 10 letters or digits, scored for readability per letter. The word stays on the device unless you choose to include it in a link.
- Famous routes for the new mode, a crawl and a workout.
- Dark mode, with a dark basemap. It follows the system setting, and a switch in the header changes it for the visit (nothing is stored).

### Changed

- Stricter safety: no paths on military land; inside private or no-access grounds only explicitly public paths; no walking down busy roads whose sidewalks are mapped separately or that have none. Cemeteries are flagged as places that may close.
- Directions only call it a turn at a real junction, matching the turn counts.
- The side panel is now a set of collapsible sections (Plan a route, Draw a shape, Famous routes, About and privacy), each with a one-line summary. Open sections are kept in shared links.
- A new look: the map fills the screen, with the planner floating over it on wide screens and as a bottom sheet on phones that expands to full height. Start and end sit in one field with a swap button; modes are cards; short choices are segmented controls. Routes are fitted into the part of the map the planner leaves visible, and so is the share image.
- Modes are listed with a description each, and have shorter names: Through buildings, Trails, Stairs, Parks, Snacks, Left turns only and Random. Links using the old mode ids still work.
- Copy, route names and directions are drier and plainer. The safety notice is unchanged.
- Passages and corridors through buildings that aren't public-facing (flats, offices, university buildings, hospitals) are no longer routed through unless they're tagged public, have a street name, or are confirmed against the city's list. In Lyon this removes the Université Lyon 1 campus corridors and about 150 private-looking passages.
- Documentation rewritten as project documentation; working notes no longer live in the repository.

### Fixed

- DC, Arlington and Silver Spring now include the paths on the other side of the state lines inside their boxes. Each was built from one state's extract, so most of DC was unroutable from the Arlington area ("too far from any walkable path") despite showing on the map. When a point can't be placed, the message now says whether it's outside the area and names an area that covers it.
- The map sometimes kept showing the previous route after a new one was planned.
- Errors appeared below all the panel's sections, out of sight; they now show near the top, and the old route is cleared.
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
