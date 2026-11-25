# Changelog

## 2.0.0 (unreleased)

### Changed

- The side panel is now a set of collapsible sections (Plan a route, Draw a shape, Famous routes, About and privacy), each with a one-line summary. Open sections are kept in shared links.
- Modes are listed with a description each, and have shorter names: Through buildings, Trails, Stairs, Parks, Snacks, Left turns only and Random. Links using the old mode ids still work.
- Copy, route names and directions are drier and plainer. The safety notice is unchanged.
- Passages and corridors through buildings that aren't public-facing (flats, offices, university buildings, hospitals) are no longer routed through unless they're tagged public, have a street name, or are confirmed against the city's list. In Lyon this removes the Université Lyon 1 campus corridors and about 150 private-looking passages.
- Documentation rewritten as project documentation; working notes no longer live in the repository.

### Fixed

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
