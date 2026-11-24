"""Write small made-up OSM files for tests. Coordinates are given in metres around (0, 0).

The base town is a 3 x 1 block grid, 100 m blocks:

    B0 ---- B1 ---- B2 ---- B3      y = 100  "Second Street"
    |       |       |       |
    C0      C1      C2      C3      y = 50   (mid-block nodes on the cross streets)
    |       |       |       |
    A0 ---- A1 ---- A2 ---- A3      y = 0    "Main Street"
   x=0    x=100   x=200   x=300
"""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import quoteattr

from bdgraph.city import BBox, City

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON = 111_320.0  # at the equator


def lonlat(x: float, y: float) -> tuple[float, float]:
    return x / M_PER_DEG_LON, y / M_PER_DEG_LAT


class OsmBuilder:
    def __init__(self) -> None:
        self.nodes: dict[int, tuple[float, float, dict[str, str]]] = {}
        self.ways: dict[int, tuple[list[int], dict[str, str]]] = {}
        self.relations: dict[int, tuple[list[tuple[str, int, str]], dict[str, str]]] = {}
        self._next = {"n": 1, "w": 1, "r": 1}
        self.named: dict[str, int] = {}

    def _id(self, kind: str) -> int:
        i = self._next[kind]
        self._next[kind] += 1
        return i

    def node(self, x: float, y: float, name: str | None = None, **tags: str) -> int:
        nid = self._id("n")
        self.nodes[nid] = (x, y, _fix(tags))
        if name:
            self.named[name] = nid
        return nid

    def way(self, nodes: list[int | str], tags: dict[str, str] | None = None, **kw: str) -> int:
        wid = self._id("w")
        refs = [self.named[n] if isinstance(n, str) else n for n in nodes]
        self.ways[wid] = (refs, {**(tags or {}), **_fix(kw)})
        return wid

    def ring(self, corners: list[tuple[float, float]], tags: dict[str, str] | None = None,
             **kw: str) -> int:  # fmt: skip
        ids = [self.node(x, y) for x, y in corners]
        return self.way([*ids, ids[0]], tags, **kw)

    def multipolygon(self, outer: int, inners: list[int], **tags: str) -> int:
        rid = self._id("r")
        members = [("way", outer, "outer")] + [("way", i, "inner") for i in inners]
        self.relations[rid] = (members, {"type": "multipolygon", **_fix(tags)})
        return rid

    def write(self, path: Path) -> Path:
        out = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6" generator="test">']
        for nid, (x, y, tags) in self.nodes.items():
            lon, lat = lonlat(x, y)
            out.append(f'<node id="{nid}" version="1" lat="{lat:.9f}" lon="{lon:.9f}">')
            out += _tag_xml(tags)
            out.append("</node>")
        for wid, (refs, tags) in self.ways.items():
            out.append(f'<way id="{wid}" version="1">')
            out += [f'<nd ref="{r}"/>' for r in refs]
            out += _tag_xml(tags)
            out.append("</way>")
        for rid, (members, tags) in self.relations.items():
            out.append(f'<relation id="{rid}" version="1">')
            out += [f'<member type="{t}" ref="{r}" role="{role}"/>' for t, r, role in members]
            out += _tag_xml(tags)
            out.append("</relation>")
        out.append("</osm>")
        path.write_text("\n".join(out), encoding="utf-8")
        return path


def _fix(tags: dict[str, str]) -> dict[str, str]:
    """Allow Python-friendly keys: foot__backward -> foot:backward."""
    return {k.replace("__", ":"): v for k, v in tags.items()}


def _tag_xml(tags: dict[str, str]) -> list[str]:
    return [f"<tag k={quoteattr(k)} v={quoteattr(v)}/>" for k, v in tags.items()]


def base_town() -> OsmBuilder:
    b = OsmBuilder()
    for i in range(4):
        b.node(i * 100, 0, f"A{i}")
        b.node(i * 100, 50, f"C{i}")
        b.node(i * 100, 100, f"B{i}")
    b.way(["A0", "A1", "A2", "A3"], highway="residential", name="Main Street")
    b.way(["B0", "B1", "B2", "B3"], highway="residential", name="Second Street")
    for i in range(4):
        b.way([f"A{i}", f"C{i}", f"B{i}"], highway="residential", name=f"Cross Street {i}")
    return b


def town_city() -> City:
    w, s = lonlat(-500, -500)
    e, n = lonlat(800, 600)
    return City(
        id="mini",
        name="Mini Town",
        bbox=BBox(west=w, south=s, east=e, north=n),
        extract_url="file://test",
        extract_provider="test",
        extract_licence="test",
        extract_attribution="test",
    )
