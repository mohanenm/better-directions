# Better Directions

A deliberately silly walking-directions app. Pick a start and an end, choose a mode, and it finds the *better* route: through building passages, up every staircase, along every trail, through every park. It always shows the normal route next to it, with the cost of the fun.

> **For fun.** Use common sense, follow signs and local rules, and don't follow it anywhere that looks unsafe or closed.

Status: work in progress. The data pipeline, router and modes are done; the web page is next. See [docs/PROGRESS.md](docs/PROGRESS.md).

## The modes

- **Through buildings:** traboules, arcades and mall corridors. Why go round when you can go through?
- **Trail runner:** dirt and gravel over pavement.
- **Stairmaster:** every staircase is a shortcut to glory. Climbed upwards, naturally.
- **Park hopper:** collect them all. The parks, that is.
- **Never turn right:** three lefts make a right.
- **Scenic chaos:** same start, same end, a different adventure every seed.

Every "better" route is capped at 4× the normal walking time, and never more than an hour, unless the normal walk is itself longer. See [docs/SAMPLE_ROUTES.md](docs/SAMPLE_ROUTES.md).

## Building the graph

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.fetch cities/lyon.json     # downloads ~534 MB once
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.terrain cities/lyon.json   # elevations from IGN, cached
PYTHONPATH=pipeline .venv/bin/python -m bdgraph.build cities/lyon.json
.venv/bin/python -m pytest
```

## Router (TypeScript)

```sh
npm ci
npm run check   # typecheck, lint, tests (including the safety property test)
npm run bench   # routing benchmark on the Lyon graph
npm run samples # sample routes per mode -> docs/SAMPLE_ROUTES.md
```

## Licences

- Code: [MIT](LICENSE).
- Map data: © OpenStreetMap contributors, available under the [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- Elevation (Lyon): IGN RGE ALTI®, [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/).
