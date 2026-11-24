from bdgraph.geo import GridIndex, Polygon, haversine_m, sample_points, segments_cross

SQUARE = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)]
HOLE = [(4.0, 4.0), (6.0, 4.0), (6.0, 6.0), (4.0, 6.0), (4.0, 4.0)]


def test_polygon_with_hole():
    poly = Polygon.from_rings(SQUARE, [HOLE])
    assert poly.contains((2, 2))
    assert not poly.contains((5, 5))  # in the courtyard
    assert not poly.contains((11, 5))


def test_boundary_distance():
    poly = Polygon.from_rings(SQUARE, [HOLE])
    assert poly.boundary_distance((1, 5)) == 1
    assert poly.boundary_distance((3.5, 5)) == 0.5  # nearest is the hole's edge


def test_segments_cross_only_properly():
    assert segments_cross((0, 0), (10, 10), (0, 10), (10, 0))
    assert not segments_cross((0, 0), (5, 5), (5, 5), (10, 0))  # touching at an endpoint
    assert not segments_cross((0, 0), (1, 1), (5, 0), (6, 1))


def test_sample_points_spacing():
    pts = list(sample_points((0, 0), (10, 0), 4))
    assert len(pts) == 2
    assert all(0 < x < 10 for x, _ in pts)
    assert list(sample_points((0, 0), (1, 0), 4)) == [(0.5, 0.0)]


def test_grid_index():
    idx = GridIndex(10)
    idx.insert(1, (0, 0, 15, 5))
    assert idx.query_point((12, 1)) == [1]
    assert idx.query_point((25, 1)) == []
    assert idx.query_bbox((14, 0, 30, 1)) == {1}


def test_haversine_one_degree_latitude():
    assert abs(haversine_m(0, 0, 0, 1) - 111_195) < 10
