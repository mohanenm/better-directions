"""Checks on the real city build. Skipped when the extract hasn't been downloaded
(run `python -m bdgraph.fetch cities/lyon.json` first)."""

from __future__ import annotations

from pathlib import Path

import pytest
from invariants import assert_output_is_safe

from bdgraph.build import attach_metadata, build_graph
from bdgraph.city import load_city
from bdgraph.decode import decode_graph
from bdgraph.encode import encode_graph

ROOT = Path(__file__).parents[2]
CITY = load_city(ROOT / "cities" / "lyon.json")
OSM = ROOT / "data" / "raw" / "lyon.osm.pbf"
COMMITTED = ROOT / "app" / "public" / "data" / "lyon" / "graph.bin"

# Mapped tram crossings count as crossings, so ~95% of the network is one component.
MIN_COMPONENT_SHARE = 0.93

pytestmark = [
    pytest.mark.real_data,
    pytest.mark.skipif(not OSM.exists(), reason="Lyon extract not downloaded"),
]


def full_build():
    """Exactly what `python -m bdgraph.build` writes: graph plus source info and terrain."""
    graph = build_graph(CITY, OSM)
    attach_metadata(graph, ROOT / "data")
    return graph


@pytest.fixture(scope="module")
def built():
    graph = full_build()
    return graph, encode_graph(graph)


def test_lyon_output_is_safe(built):
    _, blob = built
    assert_output_is_safe(decode_graph(blob))


def test_lyon_is_mostly_connected(built):
    graph, _ = built
    assert graph.component["node_share"] >= MIN_COMPONENT_SHARE


def test_lyon_has_the_fun_stuff(built):
    _, blob = built
    g = decode_graph(blob)
    bits = g.meta["flags"]["edge"]
    n = g.meta["counts"]["edges"]
    assert sum(1 for e in range(n) if g["edge_flags"][e] & bits["through_building"]) > 100
    assert sum(g["edge_steps"][e] for e in range(n)) > 10_000
    assert len({g["edge_park"][e] for e in range(n)} - {0}) > 50


def test_lyon_build_is_deterministic(built):
    _, blob = built
    assert encode_graph(full_build()) == blob


@pytest.mark.skipif(not COMMITTED.exists(), reason="no graph.bin built yet")
def test_committed_graph_is_up_to_date(built):
    _, blob = built
    assert COMMITTED.read_bytes() == blob, "rebuild with: python -m bdgraph.build cities/lyon.json"
