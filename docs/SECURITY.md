# Security and privacy

Better Directions is a static site served from GitHub Pages: HTML, JavaScript, the walking graph, map tiles, fonts and sprites. There is no server code, no database and no accounts. To report a security problem, open an issue; leave out exploit details and ask for a private contact if it's sensitive.

## Privacy

The page makes no requests to other hosts. Scripts, styles, tiles, fonts, sprites, the graph and the places list all come from the site itself, and the browser smoke test (`npm run smoke`) fails on any request elsewhere.

There are no cookies, no local storage and no analytics. The smoke test checks that `document.cookie`, `localStorage` and `sessionStorage` are still empty after planning a route.

Location is read only when you tap "Start at my location" or "Nearest to me". The fix stays on the device, and it's snapped to the nearest path before it goes into a link. Shared links and images do contain the start and end points, and the page says so next to the share buttons.

## Content-Security-Policy

Pages can't send custom headers, so the policy is a `<meta http-equiv>` tag, added by the production build (`vite.config.ts`) as the first element in `<head>`:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; worker-src 'self'; child-src 'self'; manifest-src 'self';
base-uri 'none'; form-action 'none'; object-src 'none'
```

There's no `unsafe-inline`, `unsafe-eval` or wildcard, and the built HTML has no inline scripts, event handlers or style attributes. `app/test/site.test.ts` checks all of this on every build. `img-src` allows `data:` and `blob:` because MapLibre builds sprite and marker images in memory, and share images are `blob:` URLs. MapLibre's worker loads from a same-origin file. Its one `eval` path is the optional plugin loader, which the page never calls and the policy would block anyway.

A meta policy can't set `frame-ancestors`, `report-to` or `sandbox`. So other sites can frame the page, but the page has no sensitive actions to hijack. Violations aren't reported anywhere, which is consistent with collecting nothing.

## How the safety rules are tested

The walking rules are listed in the [README](../README.md). Some need geometry and are only applied when the graph is built: paths crossing railways or fast roads without a crossing, paths inside buildings that aren't mapped passages, and paths on military land, in prisons, construction sites and power plants, or in grounds whose access isn't public. The rest are enforced when the graph is built, re-checked when the page loads (any edge breaking a rule is disabled), respected by the search, and re-checked on every finished route. The Python build and the TypeScript router both pass the same cases in `safety/cases.json`. In DC and Chicago, which load in tiles, the audit runs each time newly loaded tiles are joined into the graph, and the tiler refuses to cut a graph that fails it.

On top of that, the router is checked against the README's promises by an oracle of its own (`app/test/oracle.ts`). It's written from the README, imports nothing from the rules or the limits, and holds every tag value and time limit as a literal. So a bug in a rule, or a limit quietly raised, fails a test instead of being agreed with. Where it can, it's stricter than the rules: values are trimmed, lower-cased and split on `;` for every tag. Three test files use it:

- `app/test/oracle.test.ts` checks every edge and node of every committed graph, with the direction flags as built, in a couple of seconds. No route can break a promise that no edge breaks. It also checks that the build keeps every tag the oracle reads. Its first run found that the README and the rules disagreed about gates tagged `access=no` with `foot=yes`. The maintainer kept the rule (explicit foot access wins on a gate or bollard), and the README now says so.
- `app/test/safety-property.test.ts` plans random walks with every planner and checks each one: the promises, a connected path, the file's direction flags and the time limit. It covers:
  - four synthetic cost models, including an adversarial one that craves passages, stairs and places that close;
  - every mode with random seeds, with and without Longer walk (and for the most inconvenient mode, no more busy-road crossings than the normal route);
  - routes through random stops, workouts, crawls, GPS art and spelled words.

  On a real graph every edge already passes, so the rules themselves are tested on tampered copies of it. In each copy:
  - one way in twelve gets one of 26 forbidden tags, such as `access=private`, `No`, `yes;private`, `permit` or `military`, `foot=use_sidepath`, a railway, construction, a motorway, `motorroad=yes`, a driveway, a busy road with no sidewalk or separate sidewalks, a cycleway or a mountain path;
  - another way in twelve becomes one-way for walkers;
  - one node in fifty becomes a locked, private or permit-only gate;
  - half the buildings become flats, and half the passages lose their name and access tags;
  - some ordinary edges are marked as running through or under a building.

  Every planner runs on three such copies, and none may use anything tampered with. The audit must also disable every kind of tampering. CI runs 300 walks per case on Lyon, and 60 per case on each tampered copy. `PROPERTY_AREAS`, `PROPERTY_RUNS` and `TAMPER_SEEDS` change that.
- `app/test/defence-layers.test.ts` tests each browser layer on its own, by breaking the layers before it: the adjacency list holds only what the audit allowed, the search re-checks the audit by itself, and `assertRouteSafe` refuses a route over its limit, with a gap, or with a way, gate or direction that became forbidden after the audit ran.

Before this release, 18 deliberate breakages were tried one at a time against these three files. They were:
- the final route check switched off;
- the search's re-check removed;
- the adjacency list ignoring the audit;
- the audit skipping the passage rule, the node rules or one-way tags;
- the driveway, motorroad, no-sidewalk, fast-road and locked-gate rules each removed;
- `access=permit` allowed;
- values compared without lower-casing;
- `oneway:foot` ignored;
- each time limit raised.

17 were caught. The one that survived removes inconvenient mode's busy-crossing guard. In 9,600 planned trips across DC, Chicago, Lyon and Arlington the guard never had to act, because the mode's cost model already avoids extra crossings. The property test still checks the outcome. The independent review found that the previous version of the property test, which used the router's own rules, missed several of these, including the final route check, the passage rule and raised limits.

Before this release the property test ran at the CI count on all eleven areas: about 68,000 routes, loops, crawls, drawings and spelled words, over a third of them on tampered graphs, in 40 minutes, with no failures. An earlier version, which used the router's own rules, ran about 83,000 walks on the six areas there were then. It found one bug, on the tampered graph: a random start and end that were the same locked node got a one-node "route". The router now refuses that.

## Supply chain

The page ships two runtime packages, `maplibre-gl` and `@protomaps/basemaps`, and their 24 dependencies, all under BSD, ISC or MIT licences. Their licence texts are in `licenses.txt`, linked from the footer and generated by `npm run notices`. Development tools are Vite, TypeScript, Vitest, ESLint (with typescript-eslint), fast-check and the Node types. Everything is pinned in `package-lock.json`, and `npm audit` reported no vulnerabilities at the last release.

The Python build tools are pinned in `requirements-dev.txt` and never shipped. The `pmtiles` command-line tool is pinned to a release and checked against its SHA-256 before use, and the basemap fonts and sprites come from a pinned commit of `protomaps/basemaps-assets`.

CI and deploy workflows pin every action to a commit SHA, run with `contents: read` and don't persist checkout credentials. Only the deploy job gets `pages: write` and `id-token: write`.

## Review checklist

Before a release, check that:

- no secrets, keys, `.env` files or personal data are in tracked files or history;
- there's no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function` or `document.write` in our code (dynamic text uses `textContent`);
- `npm audit` is clean;
- URL parameters are still validated (inside the city, known modes and shapes, integer seeds, names stripped of control characters and capped at 80 characters) and only ever rendered as text;
- `npm run smoke` passes: no CSP violations, third-party requests, cookies or storage.

The last full review, for this release, found nothing: no secrets in files or history, no unsafe DOM calls, and `npm audit` clean. Twenty-five early commits on GitHub record the maintainer's personal email address as the author; later ones use a GitHub no-reply address. Two things haven't been done: an `axe` or Lighthouse accessibility audit (the smoke test covers names, landmarks, heading order, target sizes and focus instead), and `pip-audit` for the build-only Python packages.
