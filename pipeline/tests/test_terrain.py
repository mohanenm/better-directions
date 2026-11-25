"""Terrain: cache round trip, fetching only what's missing, and per-edge climb (no network)."""

from __future__ import annotations

from osmfixture import M_PER_DEG_LAT, M_PER_DEG_LON, base_town, town_city

from bdgraph.build import build_graph
from bdgraph.decode import decode_graph
from bdgraph.encode import CLIMB_UNKNOWN, encode_graph
from bdgraph.terrain import fill_cache, load_cache, save_cache, to_point


def test_cache_round_trip(tmp_path):
    cache = {(4_830_000, 45_760_000): 1691, (4_840_000, 45_770_000): None}
    save_cache(tmp_path / "c.bin", cache)
    assert load_cache(tmp_path / "c.bin") == cache


def test_fill_cache_fetches_only_missing_points():
    asked = []

    def provider(points):
        asked.extend(points)
        return [100.25 for _ in points]

    cache = {(1, 1): 50}
    fill_cache({(1, 1), (2, 2)}, cache, provider)
    assert asked == [(2, 2)]
    assert cache == {(1, 1): 50, (2, 2): 1002}  # decimetres


def _with_terrain(builder, tmp_path, height):
    """Build, then attach elevations from height(x_metres, y_metres) for every graph point."""
    graph = build_graph(town_city(), builder.write(tmp_path / "t.osm"))

    # Key by the graph's own coordinates (as the real terrain step does), mapping each point
    # back to the fixture's metre grid to look up its height.
    def decimetres(lon: float, lat: float) -> int | None:
        metres = height(round(lon * M_PER_DEG_LON), round(lat * M_PER_DEG_LAT))
        return None if metres is None else round(metres * 10)

    graph.elevations = {
        to_point(lon, lat): decimetres(lon, lat) for lon, lat in graph.node_coords.values()
    }
    graph.terrain = {"provider": "test", "licence": "test", "attribution": "test"}
    return decode_graph(encode_graph(graph))


def _edge(g, osm_id):
    wi = list(g["way_osm_id"]).index(float(osm_id))
    (e,) = [e for e in range(g.meta["counts"]["edges"]) if g["edge_way"][e] == wi]
    return e


def test_climb_and_descent_follow_the_geometry(tmp_path):
    b = base_town()
    b.node(150, 50, "Top")
    hill = b.way(["C1", "Top", "C2"], highway="path")
    # Flat town at 100 m, with a 12.5 m bump at Top.
    g = _with_terrain(b, tmp_path, lambda x, y: 112.5 if (x, y) == (150, 50) else 100.0)
    e = _edge(g, hill)
    assert g["edge_climb_dm"][e] == 125
    assert g["edge_descent_dm"][e] == 125
    assert g.meta["terrain"]["attribution"] == "test"


def test_bridges_ignore_the_valley_below(tmp_path):
    b = base_town()
    b.node(150, 50, "Mid")
    bridge = b.way(["C1", "Mid", "C2"], highway="footway", bridge="yes", layer="1")
    # The river under the bridge is 10 m lower; the deck shouldn't dip.
    g = _with_terrain(b, tmp_path, lambda x, y: 90.0 if (x, y) == (150, 50) else 100.0)
    e = _edge(g, bridge)
    assert (g["edge_climb_dm"][e], g["edge_descent_dm"][e]) == (0, 0)


def test_missing_elevation_is_unknown_not_guessed(tmp_path):
    b = base_town()
    b.node(150, 50, "Hole")
    way = b.way(["C1", "Hole", "C2"], highway="path")
    g = _with_terrain(b, tmp_path, lambda x, y: None if (x, y) == (150, 50) else 100.0)
    e = _edge(g, way)
    assert g["edge_climb_dm"][e] == CLIMB_UNKNOWN
    assert g["edge_descent_dm"][e] == CLIMB_UNKNOWN


def test_no_terrain_means_everything_unknown(tmp_path):
    graph = build_graph(town_city(), base_town().write(tmp_path / "t.osm"))
    g = decode_graph(encode_graph(graph))
    assert set(g["edge_climb_dm"]) == {CLIMB_UNKNOWN}
    assert g.meta["terrain"] == {}


def test_usgs_provider_reads_samples_by_id_and_skips_no_data(monkeypatch):
    from bdgraph import terrain

    def fake_post(url, body, content_type, retries):
        return {
            "samples": [
                {"locationId": 1, "value": "26.6"},
                {"locationId": 0, "value": "18.4"},
                {"locationId": 2, "value": "NoData"},
            ]
        }

    monkeypatch.setattr(terrain, "_post_json", fake_post)
    values = terrain.usgs_3dep_provider(pause_s=0)([(1, 1), (2, 2), (3, 3)])
    assert values == [18.4, 26.6, None]


def test_usgs_provider_halves_batches_the_service_refuses(monkeypatch):
    from bdgraph import terrain

    sizes = []

    def fake_post(url, body, content_type, retries):
        n = body.count(b"%5D%2C+%5B") + 1  # points in the urlencoded geometry
        sizes.append(n)
        if n > 300:
            return {"error": {"code": 500, "message": "too many points"}}
        return {"samples": [{"locationId": i, "value": "1"} for i in range(n)]}

    monkeypatch.setattr(terrain, "_post_json", fake_post)
    values = terrain.usgs_3dep_provider(batch=1000, pause_s=0)([(i, i) for i in range(700)])
    assert values == [1.0] * 700
    assert sizes == [700, 500, 250, 250, 200]  # refused twice, then 250 at a time


def test_usgs_provider_continues_after_a_cut_short_reply(monkeypatch):
    from bdgraph import terrain

    asked = []

    def fake_post(url, body, content_type, retries):
        n = body.count(b"%5D%2C+%5B") + 1
        asked.append(n)
        return {"samples": [{"locationId": i, "value": "2"} for i in range(min(n, 400))]}

    monkeypatch.setattr(terrain, "_post_json", fake_post)
    values = terrain.usgs_3dep_provider(batch=1000, pause_s=0)([(i, i) for i in range(1000)])
    assert values == [2.0] * 1000
    assert asked == [1000, 600, 200]


def test_refetch_unknown_asks_again_for_no_data_points():
    cache = {(1, 1): None, (2, 2): 50}
    fill_cache({(1, 1), (2, 2)}, cache, lambda pts: [7.0 for _ in pts], refetch_unknown=True)
    assert cache == {(1, 1): 70, (2, 2): 50}
