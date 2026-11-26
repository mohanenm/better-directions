"""Merging extracts for an area that crosses a region boundary (DC's box reaches into Virginia
and Maryland, and Geofabrik's state extracts stop at the state line)."""

from __future__ import annotations

import json
from pathlib import Path

import osmium
from osmfixture import OsmBuilder

from bdgraph.city import extract_urls, load_city
from bdgraph.fetch import merge


def _state(include_east: bool) -> OsmBuilder:
    """Two neighbouring "states" sharing the street that crosses the line between them. Ids are
    the same in both, as in real extracts of one OSM database."""
    b = OsmBuilder()
    for i in range(4):
        b.node(i * 100, 0, f"A{i}")
    b.way(["A0", "A1", "A2", "A3"], highway="residential", name="Line Street")  # in both
    if include_east:
        b.node(300, 100, "E")
        b.way(["A3", "E"], highway="footway", name="East Path")  # only in the east state
    return b


def _read(path: Path) -> tuple[list[int], dict[int, str]]:
    nodes, ways = [], {}
    for obj in osmium.FileProcessor(str(path)):
        if obj.is_node():
            nodes.append(obj.id)
        elif obj.is_way():
            ways[obj.id] = obj.tags.get("name", "")
    return nodes, ways


def test_merge_keeps_shared_objects_once_and_both_sides(tmp_path: Path) -> None:
    west = _state(include_east=False).write(tmp_path / "west.osm")
    east = _state(include_east=True).write(tmp_path / "east.osm")
    out = tmp_path / "merged.osm.pbf"
    merge([west, east], out)
    nodes, ways = _read(out)
    assert len(nodes) == len(set(nodes)) == 5  # A0-A3 once each, plus E
    assert sorted(ways.values()) == ["East Path", "Line Street"]


def test_city_lists_its_extra_extracts(tmp_path: Path) -> None:
    config = {
        "id": "x",
        "name": "X",
        "extract": {
            "provider": "Geofabrik",
            "url": "https://example.test/a-latest.osm.pbf",
            "also": ["https://example.test/b-latest.osm.pbf"],
            "licence": "ODbL 1.0",
            "attribution": "© OpenStreetMap contributors",
        },
        "bbox": {"west": 0, "south": 0, "east": 1, "north": 1},
    }
    path = tmp_path / "x.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    assert extract_urls(load_city(path)) == (
        "https://example.test/a-latest.osm.pbf",
        "https://example.test/b-latest.osm.pbf",
    )


def test_dc_area_configs_merge_the_neighbouring_states() -> None:
    root = Path(__file__).resolve().parents[2]
    for area in ("dc", "arlington", "silver-spring"):
        urls = extract_urls(load_city(root / "cities" / f"{area}.json"))
        names = {u.rsplit("/", 1)[1] for u in urls}
        assert names == {
            "district-of-columbia-latest.osm.pbf",
            "virginia-latest.osm.pbf",
            "maryland-latest.osm.pbf",
        }, area
