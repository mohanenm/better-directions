"""Graph build on made-up towns: exclusions, geometry checks, attributes, connectivity, format."""

from __future__ import annotations

import pytest
from invariants import assert_output_is_safe
from osmfixture import base_town, town_city

from bdgraph.build import build_graph
from bdgraph.decode import decode_graph
from bdgraph.encode import (
    FLAG_BACKWARD,
    FLAG_FORWARD,
    FLAG_MAY_CLOSE,
    FLAG_STEPS_ESTIMATED,
    FLAG_THROUGH_BUILDING,
    FLAG_UNDER_BUILDING,
    encode_graph,
)


def build(builder, tmp_path):
    path = builder.write(tmp_path / "town.osm")
    graph = build_graph(town_city(), path)
    return graph, decode_graph(encode_graph(graph))


def way_ids(g) -> set[int]:
    return {int(x) for x in g["way_osm_id"]}


def edges_of_way(g, osm_id: int) -> list[int]:
    wi = list(g["way_osm_id"]).index(float(osm_id))
    return [e for e in range(g.meta["counts"]["edges"]) if g["edge_way"][e] == wi]


def test_base_town_builds_and_is_safe(tmp_path):
    graph, g = build(base_town(), tmp_path)
    assert g.meta["counts"]["edges"] > 0
    assert graph.component["node_share"] == 1.0
    assert_output_is_safe(g)


def test_osmium_filter_keeps_locations_for_untagged_nodes(tmp_path):
    # The base town's way nodes are all untagged; if locations were lost, no ways would survive.
    graph, _ = build(base_town(), tmp_path)
    assert len(graph.data.walk_ways) == 6


@pytest.mark.parametrize(
    "tags",
    [
        {"highway": "footway", "access": "private"},
        {"highway": "footway", "access": "no"},
        {"highway": "footway", "foot": "no"},
        {"highway": "path", "foot": "private"},
        {"highway": "trunk"},
        {"highway": "motorway"},
        {"highway": "construction"},
        {"highway": "footway", "construction": "yes"},
        {"highway": "footway", "indoor": "yes"},
        {"highway": "path", "railway": "abandoned"},
    ],
    ids=lambda t: ",".join(f"{k}={v}" for k, v in t.items()),
)
def test_excluded_ways_never_reach_the_graph(tmp_path, tags):
    b = base_town()
    bad = b.way(["A0", "C1"], tags)  # a tempting diagonal shortcut
    _, g = build(b, tmp_path)
    assert bad not in way_ids(g)
    assert_output_is_safe(g)


def test_trunk_with_sidewalk_is_walkable_but_bare_trunk_is_not(tmp_path):
    b = base_town()
    b.node(400, 0, "T1")
    b.node(400, 100, "T2")
    ok = b.way(["A3", "T1", "T2", "B3"], highway="trunk", sidewalk="both")
    b.node(500, 0, "U1")
    bare = b.way(["T1", "U1"], highway="trunk")
    _, g = build(b, tmp_path)
    assert ok in way_ids(g)
    assert bare not in way_ids(g)


def test_unmapped_railway_crossing_cuts_the_street(tmp_path):
    b = base_town()
    # Railway crossing Main Street at an untagged shared node, Second Street at a level crossing.
    b.node(250, -50, "R0")
    b.node(250, 0, "RA")
    b.node(250, 100, "RB", railway="level_crossing")
    b.node(250, 150, "R1")
    b.ways.clear()
    b.way(["A0", "A1", "A2", "RA", "A3"], highway="residential", name="Main Street")
    b.way(["B0", "B1", "B2", "RB", "B3"], highway="residential", name="Second Street")
    for i in range(4):
        b.way([f"A{i}", f"C{i}", f"B{i}"], highway="residential")
    b.way(["R0", "RA", "RB", "R1"], railway="rail")
    graph, g = build(b, tmp_path)
    assert graph.dropped["node:railway_unmapped_crossing"] == 2  # both segments touching RA
    lat_scale = g.meta["coord_scale"]
    ra_lat = round(0 * lat_scale)
    xs_on_main = {
        g["node_lon"][n] for n in range(g.meta["counts"]["nodes"]) if g["node_lat"][n] == ra_lat
    }
    assert round(250 / 111_320 * lat_scale) not in xs_on_main  # RA is not in the graph
    assert graph.component["node_share"] == 1.0  # still connected via the level crossing
    assert_output_is_safe(g)


def test_railway_crossed_without_a_shared_node_is_dropped(tmp_path):
    b = base_town()
    b.node(150, -50, "R0")
    b.node(150, 150, "R1")
    b.way(["R0", "R1"], railway="rail")  # crosses Main and Second Street mid-segment
    graph, _ = build(b, tmp_path)
    assert graph.dropped["railway_crossing_geometry"] == 2


def test_railway_in_a_tunnel_is_not_a_crossing(tmp_path):
    b = base_town()
    b.node(150, -50, "R0")
    b.node(150, 150, "R1")
    b.way(["R0", "R1"], railway="subway", tunnel="yes", layer="-1")
    graph, _ = build(b, tmp_path)
    assert graph.dropped["railway_crossing_geometry"] == 0


def test_footway_crossing_a_trunk_at_grade_without_a_node_is_dropped(tmp_path):
    b = base_town()
    b.node(-50, 25, "T0")
    b.node(350, 25, "T1")
    b.way(["T0", "T1"], highway="trunk")  # crosses all four cross streets
    graph, _ = build(b, tmp_path)
    assert graph.dropped["fast_road_crossing_geometry"] == 4


def test_untagged_footway_through_a_building_is_dropped(tmp_path):
    b = base_town()
    b.ring([(120, 20), (180, 20), (180, 80), (120, 80)], building="yes")
    sneaky = b.way(["C1", "C2"], highway="footway")
    graph, g = build(b, tmp_path)
    assert graph.dropped["through_building_unmapped"] == 1
    assert sneaky not in way_ids(g)


def test_building_passage_is_kept_and_flagged(tmp_path):
    b = base_town()
    b.ring([(120, 20), (180, 20), (180, 80), (120, 80)], building="yes", name="Maison")
    passage = b.way(["C1", "C2"], highway="footway", tunnel="building_passage")
    _, g = build(b, tmp_path)
    (e,) = edges_of_way(g, passage)
    assert g["edge_flags"][e] & FLAG_THROUGH_BUILDING
    assert g["edge_flags"][e] & FLAG_MAY_CLOSE
    assert g.meta["areas"][g["edge_building"][e]]["name"] == "Maison"


def test_footway_through_a_courtyard_is_not_inside_the_building(tmp_path):
    b = base_town()
    outer = b.ring([(110, 10), (190, 10), (190, 90), (110, 90)])
    hole = b.ring([(115, 40), (185, 40), (185, 60), (115, 60)])  # courtyard band along y=50
    b.multipolygon(outer, [hole], building="yes")
    # The footway enters and leaves through passages, but its middle runs through the courtyard.
    b.node(115, 50, "P1")
    b.node(185, 50, "P2")
    b.way(["C1", "P1"], highway="footway", tunnel="building_passage")
    court = b.way(["P1", "P2"], highway="footway")
    b.way(["P2", "C2"], highway="footway", tunnel="building_passage")
    graph, g = build(b, tmp_path)
    assert graph.dropped["through_building_unmapped"] == 0
    assert court in way_ids(g)


def test_sidewalk_on_a_facade_line_is_not_inside(tmp_path):
    b = base_town()
    b.ring([(120, 0), (180, 0), (180, 60), (120, 60)], building="yes")  # flush with Main Street
    graph, _ = build(b, tmp_path)
    assert graph.dropped["through_building_unmapped"] == 0


def test_indoor_corridor_kept_and_may_close(tmp_path):
    b = base_town()
    b.ring([(120, 20), (180, 20), (180, 80), (120, 80)], building="retail")
    corridor = b.way(["C1", "C2"], highway="corridor", indoor="corridor")
    _, g = build(b, tmp_path)
    (e,) = edges_of_way(g, corridor)
    assert g["edge_flags"][e] & FLAG_MAY_CLOSE


def test_private_gate_splits_a_street(tmp_path):
    b = base_town()
    b.ways.clear()
    b.node(150, 0, "G", barrier="gate", access="private")
    b.way(["A0", "A1", "G", "A2", "A3"], highway="residential")
    b.way(["B0", "B1", "B2", "B3"], highway="residential")
    for i in range(4):
        b.way([f"A{i}", f"C{i}", f"B{i}"], highway="residential")
    graph, g = build(b, tmp_path)
    assert graph.excluded_nodes["node_access"] == 1
    assert graph.dropped["node:node_access"] == 2
    assert_output_is_safe(g)


def test_park_paths_are_tagged_with_their_park(tmp_path):
    b = base_town()
    b.ring([(105, 5), (195, 5), (195, 95), (105, 95)], leisure="park", name="Parc Test")
    path = b.way(["C1", "C2"], highway="path", surface="dirt")
    _, g = build(b, tmp_path)
    (e,) = edges_of_way(g, path)
    assert g.meta["areas"][g["edge_park"][e]] == {
        "kind": "park",
        "name": "Parc Test",
        "osm": g.meta["areas"][g["edge_park"][e]]["osm"],
    }


def test_steps_counts_split_across_edges_and_estimated_when_missing(tmp_path):
    b = base_town()
    b.node(150, 50, "M")
    stairs = b.way(["C1", "M", "C2"], highway="steps", step_count="40")
    b.way(["M", "A1"], highway="footway")  # makes M a junction, splitting the stairs in two
    b.node(50, 50, "S")
    guess = b.way(["C0", "S", "C1"], highway="steps")
    _, g = build(b, tmp_path)
    split = edges_of_way(g, stairs)
    assert len(split) == 2
    assert sum(g["edge_steps"][e] for e in split) == 40
    assert not any(g["edge_flags"][e] & FLAG_STEPS_ESTIMATED for e in split)
    (est,) = edges_of_way(g, guess)
    assert g["edge_flags"][est] & FLAG_STEPS_ESTIMATED
    assert g["edge_steps"][est] == round(100 / 0.3)


def test_oneway_footway_direction_flags(tmp_path):
    b = base_town()
    one = b.way(["C1", "C2"], highway="footway", oneway="yes")
    _, g = build(b, tmp_path)
    (e,) = edges_of_way(g, one)
    assert g["edge_flags"][e] & FLAG_FORWARD
    assert not g["edge_flags"][e] & FLAG_BACKWARD


def test_disconnected_island_is_dropped(tmp_path):
    b = base_town()
    b.node(600, 400, "I0")
    b.node(650, 400, "I1")
    island = b.way(["I0", "I1"], highway="footway")
    graph, g = build(b, tmp_path)
    assert island not in way_ids(g)
    assert graph.component["node_share"] < 1.0


def test_oneway_dead_end_is_not_in_the_strong_component(tmp_path):
    b = base_town()
    b.node(150, 150, "D")
    trap = b.way(["B1", "D"], highway="footway", oneway="yes")  # you can get in, not out
    _, g = build(b, tmp_path)
    assert trap not in way_ids(g)


def test_geometry_round_trips(tmp_path):
    b = base_town()
    b.node(130, 60, "K1")
    b.node(170, 40, "K2")
    wiggle = b.way(["C1", "K1", "K2", "C2"], highway="path")
    _, g = build(b, tmp_path)
    (e,) = edges_of_way(g, wiggle)
    pts = g.edge_points(e)
    assert len(pts) == 4
    assert pts[1] == pytest.approx((130 / 111_320, 60 / 110_574), abs=1e-6)


def test_build_is_deterministic(tmp_path):
    b = base_town()
    b.ring([(105, 5), (195, 5), (195, 95), (105, 95)], leisure="park", name="Parc")
    b.way(["C1", "C2"], highway="path")
    path = b.write(tmp_path / "town.osm")
    first = encode_graph(build_graph(town_city(), path))
    second = encode_graph(build_graph(town_city(), path))
    assert first == second


def test_paths_in_parks_with_opening_hours_may_close(tmp_path):
    b = base_town()
    b.ring([(105, 5), (195, 5), (195, 95), (105, 95)], leisure="park", opening_hours="06:30-22:30")
    gated = b.way(["C1", "C2"], highway="path")
    b.ring([(5, 5), (95, 5), (95, 95), (5, 95)], leisure="park", opening_hours="24/7")
    open_park = b.way(["C0", "C1"], highway="path")
    _, g = build(b, tmp_path)
    (e,) = edges_of_way(g, gated)
    assert g["edge_flags"][e] & FLAG_MAY_CLOSE
    assert g.meta["areas"][g["edge_park"][e]]["opening_hours"] == "06:30-22:30"
    (e,) = edges_of_way(g, open_park)
    assert not g["edge_flags"][e] & FLAG_MAY_CLOSE


def test_only_junctions_and_rule_relevant_points_are_nodes(tmp_path):
    b = base_town()
    b.node(130, 60, "K1")  # plain shape point
    b.node(170, 40, "K2", barrier="bollard")  # tagged: must stay a node for the router re-check
    b.way(["C1", "K1", "K2", "C2"], highway="path")
    _, g = build(b, tmp_path)
    # 8 corners + C1 + C2 (path ends) + K2. C0, C3 and K1 are shape points only.
    assert g.meta["counts"]["nodes"] == 11


def test_mapped_tram_crossing_connects_but_unmapped_one_cuts(tmp_path):
    b = base_town()
    b.ways.clear()
    b.node(250, -50, "T0")
    b.node(250, 0, "TA", railway="tram_level_crossing")
    b.node(250, 100, "TB")  # untagged: not a mapped crossing
    b.node(250, 150, "T1")
    b.way(["A0", "A1", "A2", "TA", "A3"], highway="residential")
    b.way(["B0", "B1", "B2", "TB", "B3"], highway="residential")
    for i in range(4):
        b.way([f"A{i}", f"C{i}", f"B{i}"], highway="residential")
    b.way(["T0", "TA", "TB", "T1"], railway="tram")
    graph, g = build(b, tmp_path)
    assert graph.dropped["node:railway_unmapped_crossing"] == 2  # both segments touching TB
    assert graph.component["node_share"] == 1.0
    assert_output_is_safe(g)


def test_street_under_a_building_is_kept_and_flagged(tmp_path):
    b = base_town()
    # A building straddling Cross Street 1, with no tunnel tag on the street.
    b.ring([(80, 30), (120, 30), (120, 70), (80, 70)], building="yes", name="Pont-Immeuble")
    graph, g = build(b, tmp_path)
    assert graph.dropped["through_building_unmapped"] == 0
    flagged = [
        e for e in range(g.meta["counts"]["edges"]) if g["edge_flags"][e] & FLAG_UNDER_BUILDING
    ]
    assert flagged
    for e in flagged:
        assert not g["edge_flags"][e] & FLAG_THROUGH_BUILDING
        assert g.meta["areas"][g["edge_building"][e]]["name"] == "Pont-Immeuble"
    assert_output_is_safe(g)


def test_footway_under_a_building_is_still_dropped(tmp_path):
    b = base_town()
    b.ring([(120, 20), (180, 20), (180, 80), (120, 80)], building="yes")
    b.way(["C1", "C2"], highway="footway")
    graph, _ = build(b, tmp_path)
    assert graph.dropped["through_building_unmapped"] == 1
