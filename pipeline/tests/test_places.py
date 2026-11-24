from osmfixture import OsmBuilder, town_city

from bdgraph.places import classify, collect


def test_classify():
    assert classify({"place": "square", "name": "Place Bellecour"}) == "square"
    assert classify({"railway": "station", "name": "Part-Dieu"}) == "station"
    assert classify({"leisure": "park", "name": "Parc"}) == "park"
    assert classify({"tourism": "museum", "name": "Musée"}) == "sight"
    assert classify({"amenity": "place_of_worship", "name": "Chapelle"}) is None  # not notable
    assert (
        classify({"amenity": "place_of_worship", "name": "Basilique", "wikidata": "Q1"})
        == "landmark"
    )
    assert classify({"place": "square"}) is None  # unnamed
    assert classify({"amenity": "cafe", "name": "Café"}) is None
    assert classify({"historic": "memorial", "name": "Plaque", "wikidata": "Q2"}) is None


def test_collect_nodes_and_areas_inside_the_bbox(tmp_path):
    b = OsmBuilder()
    # node()'s `name` argument is the builder's label, so set the OSM name tag directly.
    for x, y, label in ((10, 10, "Place Test"), (5000, 5000, "Far Away")):  # second is outside
        b.nodes[b.node(x, y, place="square")][2]["name"] = label
    b.ring([(100, 100), (200, 100), (200, 200), (100, 200)], leisure="park", name="Parc Test")
    places = collect(b.write(tmp_path / "p.osm"), town_city().bbox)
    names = {(p["kind"], p["name"]) for p in places}
    assert names == {("square", "Place Test"), ("park", "Parc Test")}
    park = next(p for p in places if p["kind"] == "park")
    assert abs(park["lon"] * 111_320 - 150) < 1 and abs(park["lat"] * 110_574 - 150) < 1


def test_squares_mapped_as_pedestrian_areas_or_named_streets():
    assert (
        classify({"highway": "pedestrian", "area": "yes", "name": "Place des Terreaux"}) == "square"
    )
    assert (
        classify({"highway": "pedestrian", "name": "Place des Jacobins"}, ("Place ",)) == "square"
    )
    assert classify({"highway": "residential", "name": "Rue de la République"}, ("Place ",)) is None
    assert classify({"highway": "pedestrian", "name": "Place des Jacobins"}) is None  # no prefixes


def test_collect_named_street_square(tmp_path):
    b = OsmBuilder()
    ids = [b.node(x, 0) for x in (0, 50, 100)]
    b.way(ids, {"highway": "pedestrian", "name": "Place Test"})
    places = collect(b.write(tmp_path / "s.osm"), town_city().bbox, ("Place ",))
    assert [(p["kind"], p["name"]) for p in places] == [("square", "Place Test")]
