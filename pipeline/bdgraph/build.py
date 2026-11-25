"""Build the walking graph for one city from its cropped OSM extract.

Usage:
    python -m bdgraph.build cities/lyon.json [--osm PBF] [--out DIR]

Pipeline:
  1. Areas pass: parks, enclosed buildings, venues (malls, stations) as projected polygons.
  2. Ways pass: walkable ways (safety.way_exclusion), plus the railway, fast-road and linear-barrier
     ways the node and geometry checks need.
  3. Segments: drop any segment that touches an excluded node, crosses a railway or fast road
     at grade without a shared node, or lies inside a building without being a mapped passage.
  4. Simplify runs of segments into edges between junctions.
  5. Keep the largest strongly connected component, so every pair of nodes is routable.
  6. Encode (encode.py) and report stats (stats.py).

Output is deterministic for the same input: everything is ordered by OSM id.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from itertools import pairwise
from pathlib import Path

import osmium

from bdgraph import safety
from bdgraph.city import BBox, City, load_city
from bdgraph.geo import (
    GridIndex,
    LocalProjection,
    Point,
    Polygon,
    haversine_m,
    point_segment_distance,
    sample_points,
    segments_cross,
)

# Way tags kept per edge (deduplicated into "tagsets"). The router re-runs the safety rules on
# these at query time, and the modes read them, so every key either rule set uses must be here.
WAY_KEYS = (
    # safety
    "highway", "railway", "construction", "access", "foot", "sidewalk", "sidewalk:left",
    "sidewalk:right", "sidewalk:both", "indoor", "conveying", "sac_scale", "trail_visibility",
    "tunnel", "covered", "bridge", "layer", "oneway", "oneway:foot", "foot:forward",
    "foot:backward",
    # modes and directions
    "surface", "tracktype", "smoothness", "lit", "informal", "incline", "area", "level",
    "footway", "crossing",
)  # fmt: skip
NODE_KEYS = ("barrier", "access", "foot", "railway", "highway", "crossing", "locked", "entrance")

BUILDING_SAMPLE_SPACING_M = 4.0
RESTRICTED_SAMPLE_SPACING_M = 10.0
# Pavements drawn along a base's or estate's fence line stay walkable.
RESTRICTED_EDGE_TOLERANCE_M = 2.0
BUILDING_EDGE_TOLERANCE_M = 0.75  # sidewalks drawn on a facade line aren't "inside"
STEP_RUN_M = 0.3  # horizontal run per step, for estimating step counts
EXAMPLES_PER_REASON = 8  # OSM way ids listed per drop reason in the stats, for map review


# --- Collected OSM data --------------------------------------------------------------------------


@dataclass
class AreaFeature:
    osm_type: str  # "w" or "r"
    osm_id: int
    name: str | None
    kind: str  # park | building | mall | station
    polygons: list[Polygon]
    layer: int = 0
    opening_hours: str | None = None
    building: str | None = None  # the building tag, for the public-passage rule

    @property
    def key(self) -> tuple[str, int]:
        return (self.osm_type, self.osm_id)


@dataclass
class WayData:
    osm_id: int
    tags: dict[str, str]
    nodes: list[int]
    coords: list[tuple[float, float]]  # lon, lat


@dataclass
class OsmData:
    areas: list[AreaFeature] = field(default_factory=list)
    walk_ways: list[WayData] = field(default_factory=list)
    node_tags: dict[int, dict[str, str]] = field(default_factory=dict)
    rail_nodes: set[int] = field(default_factory=set)
    fast_nodes: set[int] = field(default_factory=set)
    barrier_nodes: set[int] = field(default_factory=set)
    rail_segments: list[tuple[Point, Point, int]] = field(default_factory=list)
    fast_segments: list[tuple[Point, Point, int]] = field(default_factory=list)
    way_reasons: Counter[str] = field(default_factory=Counter)
    rail_values_crossed: Counter[str] = field(default_factory=Counter)
    pois: list[Poi] = field(default_factory=list)
    # Restricted ground (military, or access=private|no areas): polygons and the tags that matter.
    restricted: list[tuple[list[Polygon], dict[str, str]]] = field(default_factory=list)


def _tags(obj) -> dict[str, str]:
    return {t.k: t.v for t in obj.tags}


@dataclass(frozen=True)
class Poi:
    """A place the snack tour or a crawl can stop at."""

    kind: str  # see POI_KINDS
    name: str
    lon: float
    lat: float
    opening_hours: str | None


SNACK_SHOPS = {"bakery": "bakery", "pastry": "pastry", "confectionery": "chocolate",
               "chocolate": "chocolate", "ice_cream": "ice_cream"}  # fmt: skip
SNAP_POI_M = 40.0

# Wine bars are rarely tagged bar=wine; in Lyon most only show it in their name.
WINE_WORDS = re.compile(
    r"\b(vins?|wine|caves?|caviste|vinoth[eè]que|winery|bar [àa] vins?)\b", re.I
)
ARTWORK_LABELS = {"mural": "Mural", "sculpture": "Sculpture", "statue": "Statue", "bust": "Bust",
                  "installation": "Installation", "mosaic": "Mosaic", "street_art": "Street art",
                  "graffiti": "Graffiti", "flacking": "Pavement mosaic", "pixel_art": "Pixel art",
                  "fountain": "Fountain", "relief": "Relief"}  # fmt: skip


def poi_kind(tags: dict[str, str]) -> tuple[str, str] | None:
    """(kind, display name) for a snack or crawl stop, or None."""
    name = tags.get("name")
    if tags.get("tourism") == "artwork" and tags.get("indoor") != "yes":
        label = ARTWORK_LABELS.get(tags.get("artwork_type", ""), "Artwork")
        return "artwork", name or label
    if name is None:
        return None
    if tags.get("shop") in SNACK_SHOPS:
        return SNACK_SHOPS[tags["shop"]], name
    if tags.get("amenity") == "ice_cream":
        return "ice_cream", name
    if tags.get("amenity") == "cafe":
        return "cafe", name
    if tags.get("tourism") == "gallery":
        return "gallery", name
    if tags.get("tourism") == "museum" and (
        tags.get("museum") == "art" or re.search(r"\b(art|arts|beaux-arts)\b", name, re.I)
    ):
        return "museum", name
    if tags.get("craft") == "winery":
        return "winery", name
    if tags.get("shop") == "wine":
        return "wine_shop", name
    if tags.get("amenity") in ("bar", "pub", "biergarten"):
        if (
            tags.get("bar") == "wine"
            or tags.get("drink:wine") in ("yes", "served")
            or WINE_WORDS.search(name)
        ):
            return "wine_bar", name
        if tags.get("microbrewery") == "yes":
            return "brewery", name
        return ("bar" if tags["amenity"] == "bar" else "pub"), name
    if tags.get("craft") == "brewery":
        return "brewery", name
    return None


def snack_kind(tags: dict[str, str]) -> str | None:
    found = poi_kind(tags)
    return found[0] if found and found[0] in SNACK_KINDS else None


SNACK_KINDS = frozenset({"bakery", "pastry", "chocolate", "ice_cream", "cafe"})


# Grounds that lock up: walkable inside, but flagged "may close" (with their hours if mapped).
# Cemeteries close at night whether or not their hours are mapped; gardens and zoos only count
# when they have hours.
CEMETERIES = (("landuse", "cemetery"), ("amenity", "grave_yard"))
HOURS_GROUNDS = (("leisure", "garden"), ("tourism", "zoo"))


def _area_kind(tags: dict[str, str]) -> str | None:
    if tags.get("leisure") == "park":
        return "park"
    if any(tags.get(k) == v for k, v in CEMETERIES):
        return "grounds"
    if any(tags.get(k) == v for k, v in HOURS_GROUNDS) and _has_closing_hours(
        tags.get("opening_hours")
    ):
        return "grounds"
    if tags.get("shop") == "mall":
        return "mall"
    if tags.get("building") == "train_station" or (
        tags.get("public_transport") == "station" and tags.get("railway") == "station"
    ):
        return "station"
    if safety.is_enclosed_building(tags):
        return "building"
    return None


def _on_other_level(tags: dict[str, str]) -> bool:
    return tags.get("bridge") not in (None, "no") or tags.get("tunnel") not in (None, "no")


def read_osm(path: Path, proj: LocalProjection) -> OsmData:
    data = OsmData()

    # Pass 1: areas.
    area_filter = osmium.filter.KeyFilter(
        "leisure",
        "building",
        "shop",
        "public_transport",
        "amenity",
        "tourism",
        "craft",
        "landuse",
        "military",
        "access",
    )
    for obj in (
        osmium.FileProcessor(str(path))
        .with_areas(area_filter)
        .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
    ):
        tags = _tags(obj)
        poi = poi_kind(tags)
        if poi:
            for outer in obj.outer_rings():
                pts = [(n.lon, n.lat) for n in outer][:-1]
                if pts:
                    lon = sum(x for x, _ in pts) / len(pts)
                    lat = sum(y for _, y in pts) / len(pts)
                    data.pois.append(Poi(poi[0], poi[1], lon, lat, tags.get("opening_hours")))
                break
        if safety.is_restricted_area(tags):
            rings = []
            for outer in obj.outer_rings():
                ring = [proj(n.lon, n.lat) for n in outer]
                holes = [[proj(n.lon, n.lat) for n in inner] for inner in obj.inner_rings(outer)]
                if len(ring) >= 4:
                    rings.append(Polygon.from_rings(ring, holes))
            keep = {k: tags[k] for k in ("landuse", "military", "access") if k in tags}
            if rings:
                data.restricted.append((rings, keep))
        kind = _area_kind(tags)
        if kind is None:
            continue
        polys = []
        for outer in obj.outer_rings():
            ring = [proj(n.lon, n.lat) for n in outer]
            holes = [[proj(n.lon, n.lat) for n in inner] for inner in obj.inner_rings(outer)]
            if len(ring) >= 4:
                polys.append(Polygon.from_rings(ring, holes))
        if polys:
            data.areas.append(
                AreaFeature(
                    "w" if obj.from_way() else "r",
                    obj.orig_id(),
                    tags.get("name"),
                    kind,
                    polys,
                    safety.layer_of(tags),
                    tags.get("opening_hours"),
                    tags.get("building"),
                )
            )
    data.areas.sort(key=lambda a: (a.osm_type, a.osm_id))

    # Pass 2: tagged nodes and ways (locations are cached for every node, tagged or not).
    for obj in (
        osmium.FileProcessor(str(path)).with_locations().with_filter(osmium.filter.EmptyTagFilter())
    ):
        if obj.is_node():
            all_tags = _tags(obj)
            tags = {k: v for k, v in all_tags.items() if k in NODE_KEYS}
            if tags:
                data.node_tags[obj.id] = tags
            poi = poi_kind(all_tags)
            if poi:
                loc = obj.location
                data.pois.append(
                    Poi(poi[0], poi[1], loc.lon, loc.lat, all_tags.get("opening_hours"))
                )
            continue
        if not obj.is_way():
            continue
        tags = _tags(obj)
        refs = [n.ref for n in obj.nodes]
        locs = [(n.lon, n.lat) if n.location.valid() else None for n in obj.nodes]

        if safety.is_track_railway_way(tags):
            data.rail_nodes.update(refs)
            if not _on_other_level(tags):
                _add_segments(data.rail_segments, locs, proj, safety.layer_of(tags))
        if safety.is_linear_barrier_way(tags):
            data.barrier_nodes.update(refs)

        hw = tags.get("highway")
        if hw is None:
            continue
        reason = safety.way_exclusion(tags)
        data.way_reasons[reason or "walkable"] += 1
        if reason is not None:
            if hw in safety.FAST_ROADS:
                data.fast_nodes.update(refs)
                if not _on_other_level(tags):
                    _add_segments(data.fast_segments, locs, proj, safety.layer_of(tags))
            continue
        if any(loc is None for loc in locs):
            continue  # incomplete way (shouldn't happen with a back-referenced crop)
        data.walk_ways.append(
            WayData(obj.id, tags, refs, locs)  # type: ignore[arg-type]
        )

    data.walk_ways.sort(key=lambda w: w.osm_id)
    return data


def _add_segments(out, locs, proj: LocalProjection, layer: int) -> None:
    pts = [proj(*loc) if loc else None for loc in locs]
    for a, b in pairwise(pts):
        if a is not None and b is not None:
            out.append((a, b, layer))


# --- Graph construction --------------------------------------------------------------------------


@dataclass(frozen=True)
class SegAttrs:
    park: int  # index into areas, -1 if none
    venue: int
    building: int  # building passed *through* via a mapped passage, -1 if none
    under_building: int = -1  # building a road runs under without a tunnel tag


@dataclass
class Segment:
    way: int  # index into walk_ways
    a: int
    b: int
    length: float
    attrs: SegAttrs


@dataclass
class Edge:
    way: int
    nodes: list[int]  # OSM node ids, first and last are the endpoints
    length: float
    attrs: SegAttrs


@dataclass
class Graph:
    city: City
    data: OsmData
    edges: list[Edge]
    node_coords: dict[int, tuple[float, float]]  # every node used, including shape points
    junctions: list[int]  # edge endpoints, sorted by OSM id: the graph's nodes
    dropped: Counter[str]
    excluded_nodes: Counter[str]
    component: dict[str, float]
    dropped_examples: dict[str, list[int]] = field(default_factory=dict)
    source: dict[str, str] = field(default_factory=dict)  # from data/<city>/source.json
    # Terrain: elevations in decimetres keyed by microdegree (lon, lat); None = no data.
    elevations: dict[tuple[int, int], int | None] = field(default_factory=dict)
    terrain: dict[str, str] = field(default_factory=dict)  # provider, licence, attribution
    # Snack and crawl stops snapped to the street they're on: (edge index, Poi), sorted.
    poi_stops: list[tuple[int, Poi]] = field(default_factory=list)


class _Spatial:
    def __init__(self, data: OsmData) -> None:
        self.areas = data.areas
        self.buildings = GridIndex(50.0)
        self.parks = GridIndex(100.0)
        self.venues = GridIndex(100.0)
        self.polys: list[tuple[int, Polygon]] = []
        for ai, area in enumerate(data.areas):
            # Closing grounds share the park slot so their hours reach the "may close" notes.
            index = {"park": self.parks, "grounds": self.parks, "building": self.buildings}.get(
                area.kind, self.venues
            )
            for poly in area.polygons:
                pi = len(self.polys)
                self.polys.append((ai, poly))
                index.insert(pi, poly.bbox)
                if area.kind in ("mall", "station"):
                    # Station and mall buildings are also buildings for the passage rule.
                    self.buildings.insert(pi, poly.bbox)
        self.restricted_polys: list[tuple[int, Polygon]] = []
        self.restricted = GridIndex(100.0)
        for ri, (polys, _) in enumerate(data.restricted):
            for poly in polys:
                self.restricted.insert(len(self.restricted_polys), poly.bbox)
                self.restricted_polys.append((ri, poly))
        self.rail = GridIndex(50.0)
        for i, (a, b, _) in enumerate(data.rail_segments):
            self.rail.insert(i, _seg_bbox(a, b))
        self.fast = GridIndex(50.0)
        for i, (a, b, _) in enumerate(data.fast_segments):
            self.fast.insert(i, _seg_bbox(a, b))
        self.rail_segments = data.rail_segments
        self.fast_segments = data.fast_segments

    def area_at(self, index: GridIndex, p: Point) -> int:
        """Lowest area index containing p, or -1. Lowest index keeps results deterministic."""
        best = -1
        for pi in index.query_point(p):
            ai, poly = self.polys[pi]
            if (best == -1 or ai < best) and poly.contains(p):
                best = ai
        return best

    def building_on_segment(self, a: Point, b: Point, layer: int) -> int:
        """A building (area index) whose interior the segment passes through, or -1."""
        for p in sample_points(a, b, BUILDING_SAMPLE_SPACING_M):
            for pi in self.buildings.query_point(p):
                ai, poly = self.polys[pi]
                if self.areas[ai].layer != layer:
                    continue
                if poly.contains(p) and poly.boundary_distance(p) > BUILDING_EDGE_TOLERANCE_M:
                    return ai
        return -1

    def restricted_on_segment(self, a: Point, b: Point) -> list[int]:
        """Restricted areas (indices into data.restricted) the segment passes into."""
        found: set[int] = set()
        for p in sample_points(a, b, RESTRICTED_SAMPLE_SPACING_M):
            for pi in self.restricted.query_point(p):
                ri, poly = self.restricted_polys[pi]
                if (
                    ri not in found
                    and poly.contains(p)
                    and poly.boundary_distance(p) > RESTRICTED_EDGE_TOLERANCE_M
                ):
                    found.add(ri)
        return sorted(found)

    def crosses(self, a: Point, b: Point, layer: int, which: str) -> bool:
        index, segs = (
            (self.rail, self.rail_segments) if which == "rail" else (self.fast, self.fast_segments)
        )
        for si in index.query_bbox(_seg_bbox(a, b)):
            q1, q2, qlayer = segs[si]
            if qlayer == layer and segments_cross(a, b, q1, q2):
                return True
        return False


def _seg_bbox(a: Point, b: Point) -> tuple[float, float, float, float]:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))


def build_graph(city: City, osm_path: Path) -> Graph:
    proj = LocalProjection((city.bbox.west + city.bbox.east) / 2,
                           (city.bbox.south + city.bbox.north) / 2)  # fmt: skip
    data = read_osm(osm_path, proj)
    spatial = _Spatial(data)
    bbox: BBox = city.bbox

    node_reason: dict[int, str | None] = {}

    def excluded(n: int) -> str | None:
        if n not in node_reason:
            node_reason[n] = safety.node_exclusion(
                data.node_tags.get(n, {}),
                on_railway=n in data.rail_nodes,
                on_fast_road=n in data.fast_nodes,
                on_linear_barrier=n in data.barrier_nodes,
            )
        return node_reason[n]

    dropped: Counter[str] = Counter()
    examples: dict[str, set[int]] = defaultdict(set)

    def drop(reason: str, way_id: int) -> None:
        dropped[reason] += 1
        examples[reason].add(way_id)

    segments_by_way: list[list[Segment | None]] = []
    node_coords: dict[int, tuple[float, float]] = {}

    for wi, way in enumerate(data.walk_ways):
        tags = way.tags
        layer = safety.layer_of(tags)
        other_level = _on_other_level(tags)
        passage_ok = safety.may_pass_through_building(tags)
        counts_as_through = (
            safety.is_building_passage(tags)
            or safety.is_indoor_corridor(tags)
            or safety.is_covered(tags)
        )
        name = tags.get("name", "")
        confirmed = way.osm_id in city.confirmed_passages
        segs: list[Segment | None] = []
        for i in range(len(way.nodes) - 1):
            a, b = way.nodes[i], way.nodes[i + 1]
            (lon_a, lat_a), (lon_b, lat_b) = way.coords[i], way.coords[i + 1]
            if a == b:
                continue
            if not (bbox.contains(lon_a, lat_a) and bbox.contains(lon_b, lat_b)):
                segs.append(None)
                continue
            reason = excluded(a) or excluded(b)
            if reason:
                drop(f"node:{reason}", way.osm_id)
                segs.append(None)
                continue
            pa, pb = proj(lon_a, lat_a), proj(lon_b, lat_b)
            if not other_level:
                if spatial.crosses(pa, pb, layer, "rail"):
                    drop("railway_crossing_geometry", way.osm_id)
                    segs.append(None)
                    continue
                if spatial.crosses(pa, pb, layer, "fast"):
                    drop("fast_road_crossing_geometry", way.osm_id)
                    segs.append(None)
                    continue
            if not other_level:
                restricted = next(
                    (
                        r
                        for ri in spatial.restricted_on_segment(pa, pb)
                        if (r := safety.restricted_area_exclusion(tags, data.restricted[ri][1]))
                    ),
                    None,
                )
                if restricted:
                    drop(restricted, way.osm_id)
                    segs.append(None)
                    continue
            building = spatial.building_on_segment(pa, pb, layer)
            under = -1
            if building != -1 and not passage_ok:
                if safety.may_pass_under_building_unmapped(tags):
                    under = building  # kept, flagged and disclosed
                else:
                    drop("through_building_unmapped", way.osm_id)
                    segs.append(None)
                    continue
            mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
            venue = spatial.area_at(spatial.venues, mid)
            if building != -1 and passage_ok:
                area = data.areas[building]
                reason = safety.passage_exclusion(
                    tags,
                    name,
                    {"kind": area.kind, "building": area.building},
                    in_public_venue=venue != -1
                    and data.areas[venue].kind in safety.PUBLIC_AREA_KINDS,
                    confirmed=confirmed,
                )
                if reason:
                    drop(reason, way.osm_id)
                    segs.append(None)
                    continue
            attrs = SegAttrs(
                park=spatial.area_at(spatial.parks, mid),
                venue=venue,
                building=building if (building != -1 and counts_as_through) else -1,
                under_building=under,
            )
            node_coords[a] = (lon_a, lat_a)
            node_coords[b] = (lon_b, lat_b)
            segs.append(Segment(wi, a, b, haversine_m(lon_a, lat_a, lon_b, lat_b), attrs))
        segments_by_way.append(segs)

    edges = _simplify(segments_by_way, data)
    edges, component = _largest_scc(edges, data)

    excluded_nodes = Counter(r for r in node_reason.values() if r)
    used = {n for e in edges for n in e.nodes}
    node_coords = {n: node_coords[n] for n in sorted(used)}
    junctions = sorted({e.nodes[0] for e in edges} | {e.nodes[-1] for e in edges})
    poi_stops = _snap_pois(data.pois, edges, node_coords, proj, bbox)
    dropped_examples = {r: sorted(ids)[:EXAMPLES_PER_REASON] for r, ids in sorted(examples.items())}
    return Graph(
        city,
        data,
        edges,
        node_coords,
        junctions,
        dropped,
        excluded_nodes,
        component,
        dropped_examples,
        poi_stops=poi_stops,
    )


def _snap_pois(
    pois: list[Poi],
    edges: list[Edge],
    node_coords: dict[int, tuple[float, float]],
    proj: LocalProjection,
    bbox: BBox,
) -> list[tuple[int, Poi]]:
    """Snap each stop to the nearest edge (the street it's on) within SNAP_POI_M."""
    index = GridIndex(50.0)
    shapes: list[list[Point]] = []
    for ei, e in enumerate(edges):
        pts = [proj(*node_coords[n]) for n in e.nodes]
        shapes.append(pts)
        xs = [x for x, _ in pts]
        ys = [y for _, y in pts]
        index.insert(ei, (min(xs), min(ys), max(xs), max(ys)))
    out: dict[tuple[int, str, str], Poi] = {}
    r = SNAP_POI_M
    for poi in pois:
        if not bbox.contains(poi.lon, poi.lat):
            continue
        p = proj(poi.lon, poi.lat)
        best, best_d = -1, r
        for ei in sorted(index.query_bbox((p[0] - r, p[1] - r, p[0] + r, p[1] + r))):
            pts = shapes[ei]
            d = min(point_segment_distance(p, a, b) for a, b in pairwise(pts))
            if d < best_d:
                best, best_d = ei, d
        if best != -1:
            out.setdefault((best, poi.kind, poi.name), poi)
    return [(ei, s) for (ei, _, _), s in sorted(out.items())]


def _simplify(segments_by_way: list[list[Segment | None]], data: OsmData) -> list[Edge]:
    incidence: Counter[int] = Counter()
    ways_at: dict[int, set[int]] = defaultdict(set)
    for segs in segments_by_way:
        for s in segs:
            if s is not None:
                incidence[s.a] += 1
                incidence[s.b] += 1
                ways_at[s.a].add(s.way)
                ways_at[s.b].add(s.way)

    def junction(n: int) -> bool:
        # Any node a safety rule looks at stays a junction, so it's stored as a node and the
        # router can re-check it. Plain shape points live only in the edge geometry.
        return (
            incidence[n] != 2
            or len(ways_at[n]) > 1
            or n in data.node_tags
            or n in data.rail_nodes
            or n in data.fast_nodes
            or n in data.barrier_nodes
        )

    edges: list[Edge] = []
    for segs in segments_by_way:
        current: Edge | None = None
        for s in segs:
            if s is None:
                if current:
                    edges.append(current)
                current = None
                continue
            if (
                current is not None
                and current.nodes[-1] == s.a
                and current.attrs == s.attrs
                and not junction(s.a)
            ):
                current.nodes.append(s.b)
                current.length += s.length
            else:
                if current:
                    edges.append(current)
                current = Edge(s.way, [s.a, s.b], s.length, s.attrs)
        if current:
            edges.append(current)
    return edges


def _largest_scc(edges: list[Edge], data: OsmData) -> tuple[list[Edge], dict[str, float]]:
    """Keep the edges inside the largest strongly connected component (iterative Tarjan)."""
    adj: dict[int, list[int]] = defaultdict(list)
    nodes: set[int] = set()
    for e in edges:
        u, v = e.nodes[0], e.nodes[-1]
        fwd, bwd = safety.foot_directions(data.walk_ways[e.way].tags)
        nodes.update((u, v))
        if fwd:
            adj[u].append(v)
        if bwd:
            adj[v].append(u)

    index: dict[int, int] = {}
    low: dict[int, int] = {}
    on_stack: set[int] = set()
    stack: list[int] = []
    best: set[int] = set()
    counter = 0
    for root in sorted(nodes):
        if root in index:
            continue
        work = [(root, iter(adj.get(root, ())))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            v, it = work[-1]
            advanced = False
            for w in it:
                if w not in index:
                    index[w] = low[w] = counter
                    counter += 1
                    stack.append(w)
                    on_stack.add(w)
                    work.append((w, iter(adj.get(w, ()))))
                    advanced = True
                    break
                if w in on_stack:
                    low[v] = min(low[v], index[w])
            if advanced:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[v])
            if low[v] == index[v]:
                comp = set()
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    comp.add(w)
                    if w == v:
                        break
                if len(comp) > len(best) or (len(comp) == len(best) and min(comp) < min(best)):
                    best = comp

    kept = [e for e in edges if e.nodes[0] in best and e.nodes[-1] in best]
    total_len = sum(e.length for e in edges) or 1.0
    stats = {
        "nodes_before": len(nodes),
        "nodes_kept": len(best),
        "node_share": len(best) / max(1, len(nodes)),
        "length_share": sum(e.length for e in kept) / total_len,
    }
    return kept, stats


# --- Per-edge derived values ---------------------------------------------------------------------


def parse_step_count(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        n = int(value.strip())
    except ValueError:
        return None
    return n if 0 < n < 10_000 else None


def edge_steps(edge: Edge, way: WayData) -> tuple[int, bool]:
    """(steps, estimated) for an edge. Only highway=steps edges have steps."""
    if way.tags.get("highway") != "steps":
        return 0, False
    known = parse_step_count(way.tags.get("step_count"))
    if known is not None:
        total = sum(
            haversine_m(*way.coords[i], *way.coords[i + 1]) for i in range(len(way.coords) - 1)
        )
        share = edge.length / total if total > 0 else 1.0
        return max(1, round(known * share)), False
    return max(1, round(edge.length / STEP_RUN_M)), True


def edge_climb(edge: Edge, way: WayData, graph: Graph) -> tuple[int, int] | None:
    """(climb, descent) in decimetres walking the edge forward, or None if unknown.

    Bridges, tunnels and anything on a mapped level use only their endpoints: the terrain model
    under a bridge is the river, not the deck.
    """
    if not graph.elevations:
        return None
    nodes = edge.nodes
    tags = way.tags
    if _on_other_level(tags) or "level" in tags:
        nodes = [nodes[0], nodes[-1]]
    eles = []
    for n in nodes:
        lon, lat = graph.node_coords[n]
        ele = graph.elevations.get((round(lon * 1_000_000), round(lat * 1_000_000)))
        if ele is None:
            return None
        eles.append(ele)
    climb = sum(max(0, b - a) for a, b in pairwise(eles))
    descent = sum(max(0, a - b) for a, b in pairwise(eles))
    return climb, descent


def _has_closing_hours(opening_hours: str | None) -> bool:
    return opening_hours is not None and opening_hours.strip() != "24/7"


def edge_may_close(edge: Edge, way: WayData, areas: list[AreaFeature]) -> bool:
    """Passages that may close: corridors, anything through a building, covered ways inside
    malls or stations, anything with opening_hours, and paths in parks and grounds (cemeteries,
    gardens, zoos) with opening hours: Lyon's big parks and Arlington Cemetery lock at night."""
    tags = way.tags
    if _has_closing_hours(tags.get("opening_hours")) or safety.is_indoor_corridor(tags):
        return True
    if edge.attrs.building != -1:
        return True
    if edge.attrs.park != -1:
        area = areas[edge.attrs.park]
        if area.kind == "grounds" or _has_closing_hours(area.opening_hours):
            return True
    return edge.attrs.venue != -1 and safety.is_covered(tags)


def attach_metadata(graph: Graph, data_dir: Path) -> None:
    """Attach source info and terrain from data/<city>/ (what the CLI build embeds)."""
    city_dir = data_dir / graph.city.id
    source_json = city_dir / "source.json"
    if source_json.exists():
        src = json.loads(source_json.read_text(encoding="utf-8"))
        graph.source = {k: src[k] for k in ("data_as_of", "dated_url") if k in src}
    terrain_json = city_dir / "terrain.json"
    cache = data_dir / "raw" / f"{graph.city.id}.elevation.bin"
    if terrain_json.exists() and cache.exists():
        from bdgraph.terrain import load_cache

        t = json.loads(terrain_json.read_text(encoding="utf-8"))
        graph.terrain = {k: t[k] for k in ("provider", "licence", "attribution")}
        graph.elevations = load_cache(cache)
    else:
        print("No terrain cache: climb and descent will be unknown", file=sys.stderr)


def main(argv: list[str] | None = None) -> None:
    from bdgraph.encode import write_graph
    from bdgraph.stats import write_stats

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("city_config", type=Path)
    ap.add_argument("--osm", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)

    city = load_city(args.city_config)
    osm = args.osm or Path("data/raw") / f"{city.id}.osm.pbf"
    out = args.out or Path("app/public/data") / city.id
    out.mkdir(parents=True, exist_ok=True)

    graph = build_graph(city, osm)
    attach_metadata(graph, Path("data"))
    size = write_graph(graph, out / "graph.bin")
    write_stats(graph, out, graph_bytes=size)
    print(f"Wrote {out / 'graph.bin'} ({size / 1e6:.2f} MB), {len(graph.edges)} edges, "
          f"{len(graph.junctions)} nodes", file=sys.stderr)  # fmt: skip


if __name__ == "__main__":
    main()
