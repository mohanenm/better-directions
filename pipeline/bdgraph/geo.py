"""Small geometry helpers: local projection, distances, point-in-polygon, segment intersection,
and a uniform grid index. Pure Python, no dependencies."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from itertools import pairwise

EARTH_RADIUS_M = 6_371_008.8

Point = tuple[float, float]  # projected metres (x east, y north)
Ring = Sequence[Point]


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


class LocalProjection:
    """Equirectangular projection around a reference point; accurate to well under 0.1% over a
    city-sized area, which is plenty for containment and crossing tests."""

    def __init__(self, lon0: float, lat0: float) -> None:
        self.lon0, self.lat0 = lon0, lat0
        self._ky = math.radians(1) * EARTH_RADIUS_M
        self._kx = self._ky * math.cos(math.radians(lat0))

    def __call__(self, lon: float, lat: float) -> Point:
        return ((lon - self.lon0) * self._kx, (lat - self.lat0) * self._ky)


@dataclass
class Polygon:
    outer: list[Point]
    holes: list[list[Point]]
    bbox: tuple[float, float, float, float]

    @classmethod
    def from_rings(cls, outer: list[Point], holes: list[list[Point]]) -> Polygon:
        xs = [p[0] for p in outer]
        ys = [p[1] for p in outer]
        return cls(outer, holes, (min(xs), min(ys), max(xs), max(ys)))

    def contains(self, p: Point) -> bool:
        x, y = p
        x0, y0, x1, y1 = self.bbox
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        if not _in_ring(p, self.outer):
            return False
        return not any(_in_ring(p, h) for h in self.holes)

    def boundary_distance(self, p: Point) -> float:
        best = math.inf
        for ring in (self.outer, *self.holes):
            for a, b in pairwise(ring):
                best = min(best, point_segment_distance(p, a, b))
        return best


def _in_ring(p: Point, ring: Ring) -> bool:
    """Even-odd ray casting. Rings are closed (first point == last point)."""
    x, y = p
    inside = False
    for (xa, ya), (xb, yb) in pairwise(ring):
        if (ya > y) != (yb > y):
            xi = xa + (y - ya) * (xb - xa) / (yb - ya)
            if x < xi:
                inside = not inside
    return inside


def point_segment_distance(p: Point, a: Point, b: Point) -> float:
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    d2 = dx * dx + dy * dy
    t = 0.0 if d2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _orient(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def segments_cross(p1: Point, p2: Point, q1: Point, q2: Point) -> bool:
    """True if the segments properly intersect (cross at a point interior to both).

    Touching at an endpoint or overlapping collinearly doesn't count: shared OSM nodes are
    handled by the node rules, not here.
    """
    d1, d2 = _orient(q1, q2, p1), _orient(q1, q2, p2)
    d3, d4 = _orient(p1, p2, q1), _orient(p1, p2, q2)
    return ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4))


def sample_points(a: Point, b: Point, spacing: float) -> Iterator[Point]:
    """Interior points along a segment, at most `spacing` apart (always at least the midpoint)."""
    length = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, int(length // spacing))
    for i in range(1, n + 1):
        t = i / (n + 1)
        yield (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))


class GridIndex:
    """Buckets items by the grid cells their bounding boxes cover."""

    def __init__(self, cell: float) -> None:
        self.cell = cell
        self._cells: dict[tuple[int, int], list[int]] = defaultdict(list)

    def _range(self, x0: float, y0: float, x1: float, y1: float) -> Iterable[tuple[int, int]]:
        c = self.cell
        for i in range(math.floor(x0 / c), math.floor(x1 / c) + 1):
            for j in range(math.floor(y0 / c), math.floor(y1 / c) + 1):
                yield (i, j)

    def insert(self, item: int, bbox: tuple[float, float, float, float]) -> None:
        for key in self._range(*bbox):
            self._cells[key].append(item)

    def query_point(self, p: Point) -> list[int]:
        c = self.cell
        return self._cells.get((math.floor(p[0] / c), math.floor(p[1] / c)), [])

    def query_bbox(self, bbox: tuple[float, float, float, float]) -> set[int]:
        out: set[int] = set()
        for key in self._range(*bbox):
            out.update(self._cells.get(key, ()))
        return out
