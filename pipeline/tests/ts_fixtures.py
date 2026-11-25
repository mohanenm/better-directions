"""Graph fixtures for the TypeScript router tests, built by the real Python pipeline.

Regenerate with:  UPDATE_TS_FIXTURES=1 .venv/bin/python -m pytest pipeline/tests/test_ts_fixtures.py
"""

from __future__ import annotations

from pathlib import Path

from osmfixture import M_PER_DEG_LON, OsmBuilder, town_city

from bdgraph.build import build_graph
from bdgraph.encode import encode_graph
from bdgraph.terrain import to_point

FIXTURE_DIR = Path(__file__).parents[2] / "app" / "test" / "fixtures"


def minitown() -> OsmBuilder:
    """Base town plus features with known routing consequences (see app/test/router.test.ts).

    - Diagonal footway A0-B1: the normal route A0 -> B3 is Diagonal + Second Street (341 m).
    - Private footway A1-B3 would be shorter still, but must never be used.
    - One-way footway C1 -> C2.
    - Stairs C2 - S - C3 (30 steps) inside Little Park.
    - Traboule: a building passage W - E through Traboule House.
    - Snack stops: a bakery by C3 and a café by B2; a far-off bakery that's too far to snap.
    """
    b = OsmBuilder()
    for i in range(4):
        b.node(i * 100, 0, f"A{i}")
        b.node(i * 100, 50, f"C{i}")
        b.node(i * 100, 100, f"B{i}")
    b.node(250, 50, "S")
    b.node(0, 85, "W")
    b.node(100, 85, "E")
    b.way(["A0", "A1", "A2", "A3"], highway="residential", name="Main Street")
    b.way(["B0", "B1", "B2", "B3"], highway="residential", name="Second Street")
    b.way(["A0", "C0", "W", "B0"], highway="residential", name="Cross Street 0")
    b.way(["A1", "C1", "E", "B1"], highway="residential", name="Cross Street 1")
    for i in (2, 3):
        b.way([f"A{i}", f"C{i}", f"B{i}"], highway="residential", name=f"Cross Street {i}")
    b.way(["A0", "B1"], highway="footway", name="Diagonal")
    b.way(["A1", "B3"], highway="footway", access="private", name="Private")
    b.way(["C1", "C2"], highway="footway", oneway="yes", name="One Way")
    b.way(["C2", "S", "C3"], highway="steps", step_count="30", name="Stairs")
    b.way(
        ["W", "E"], highway="footway", tunnel="building_passage", foot="permissive", name="Traboule"
    )
    b.ring([(210, 40), (290, 40), (290, 60), (210, 60)], leisure="park", name="Little Park")
    b.ring([(20, 70), (45, 70), (45, 95), (20, 95)], building="yes", name="Traboule House")
    for x, y, tags in (
        (305, 55, {"shop": "bakery", "name": "Boulangerie Test", "opening_hours": "07:00-19:30"}),
        (205, 105, {"amenity": "cafe", "name": "Café Test"}),
        (150, 300, {"shop": "bakery", "name": "Too Far Bakery"}),
    ):
        b.nodes[b.node(x, y)][2].update(tags)
    return b


GRID_N = 6
GRID_STEP_M = 80
GRID_SLOPE = 0.06  # rises 6 m per 100 m going east


def grid() -> OsmBuilder:
    b = OsmBuilder()
    for i in range(GRID_N):
        for j in range(GRID_N):
            b.node(i * GRID_STEP_M, j * GRID_STEP_M, f"N{i}_{j}")
    for j in range(GRID_N):
        b.way([f"N{i}_{j}" for i in range(GRID_N)], highway="residential", name=f"Rue {j}")
    for i in range(GRID_N):
        b.way([f"N{i}_{j}" for j in range(GRID_N)], highway="residential", name=f"Avenue {i}")
    return b


def build_fixture(builder: OsmBuilder, tmp: Path, slope: float | None = None) -> bytes:
    graph = build_graph(town_city(), builder.write(tmp))
    if slope is not None:
        graph.elevations = {
            to_point(lon, lat): round((100 + slope * lon * M_PER_DEG_LON) * 10)
            for lon, lat in graph.node_coords.values()
        }
        graph.terrain = {"provider": "test", "licence": "test", "attribution": "Test terrain"}
    return encode_graph(graph)


FIXTURES = {
    "minitown.bin": lambda tmp: build_fixture(minitown(), tmp / "minitown.osm"),
    "grid.bin": lambda tmp: build_fixture(grid(), tmp / "grid.osm", slope=GRID_SLOPE),
}
