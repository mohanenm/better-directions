"""Binary graph encoding. The format is documented in docs/GRAPH_FORMAT.md; keep them in step.

Layout (little-endian):
    "BDG1" | u32 version | u32 meta_length | meta JSON (UTF-8, space-padded to 8 bytes)
    then each section listed in meta.sections, in order, each starting on an 8-byte boundary.
"""

from __future__ import annotations

import json
import sys
from array import array
from pathlib import Path

from bdgraph import safety
from bdgraph.build import WAY_KEYS, Graph, edge_may_close, edge_steps

MAGIC = b"BDG1"
VERSION = 1
COORD_SCALE = 1_000_000  # microdegrees, ~0.1 m

# Edge flag bits
FLAG_FORWARD = 1 << 0
FLAG_BACKWARD = 1 << 1
FLAG_STEPS_ESTIMATED = 1 << 2
FLAG_MAY_CLOSE = 1 << 3
FLAG_THROUGH_BUILDING = 1 << 4

# Node context bits (for the router's node safety re-check)
CTX_ON_RAILWAY = 1 << 0
CTX_ON_FAST_ROAD = 1 << 1
CTX_ON_LINEAR_BARRIER = 1 << 2

U16_MAX = 0xFFFF


class _Interner:
    """Assigns stable indices in first-seen order. Index 0 is reserved for `empty`."""

    def __init__(self, empty) -> None:
        self.items = [empty]
        self._index: dict[str, int] = {self._key(empty): 0}

    @staticmethod
    def _key(item) -> str:
        return json.dumps(item, sort_keys=True, ensure_ascii=False)

    def add(self, item) -> int:
        key = self._key(item)
        if key not in self._index:
            self._index[key] = len(self.items)
            self.items.append(item)
        return self._index[key]


def _zigzag(n: int) -> int:
    return (n << 1) ^ (n >> 63)


def _varint(out: bytearray, n: int) -> None:
    while n >= 0x80:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n)


def _scaled(v: float) -> int:
    return round(v * COORD_SCALE)


def encode_graph(graph: Graph) -> bytes:
    data = graph.data
    node_ids = graph.junctions  # edge endpoints, sorted by OSM id
    node_index = {n: i for i, n in enumerate(node_ids)}

    strings = _Interner("")
    tagsets = _Interner({})
    node_tagsets = _Interner({})
    areas = _Interner(None)

    def area_ref(ai: int) -> int:
        if ai == -1:
            return 0
        a = data.areas[ai]
        entry = {"kind": a.kind, "name": a.name, "osm": f"{a.osm_type}{a.osm_id}"}
        if a.opening_hours:
            entry["opening_hours"] = a.opening_hours
        return areas.add(entry)

    # Nodes
    node_lat, node_lon = array("i"), array("i")
    node_tags, node_ctx = array("H"), array("B")
    for n in node_ids:
        lon, lat = graph.node_coords[n]
        node_lat.append(_scaled(lat))
        node_lon.append(_scaled(lon))
        node_tags.append(node_tagsets.add(data.node_tags.get(n, {})))
        ctx = (
            (CTX_ON_RAILWAY if n in data.rail_nodes else 0)
            | (CTX_ON_FAST_ROAD if n in data.fast_nodes else 0)
            | (CTX_ON_LINEAR_BARRIER if n in data.barrier_nodes else 0)
        )
        node_ctx.append(ctx)

    # Ways (only those used by kept edges), ordered by OSM id
    used_ways = sorted({e.way for e in graph.edges}, key=lambda wi: data.walk_ways[wi].osm_id)
    way_index = {wi: i for i, wi in enumerate(used_ways)}
    way_osm, way_tagset = array("d"), array("H")
    way_name, way_oh = array("I"), array("I")
    for wi in used_ways:
        w = data.walk_ways[wi]
        way_osm.append(float(w.osm_id))
        way_tagset.append(tagsets.add({k: w.tags[k] for k in WAY_KEYS if k in w.tags}))
        way_name.append(strings.add(w.tags.get("name", "")))
        way_oh.append(strings.add(w.tags.get("opening_hours", "")))

    # Edges
    e_from, e_to, e_way = array("I"), array("I"), array("I")
    e_len, e_flags, e_steps = array("f"), array("B"), array("H")
    e_park, e_venue, e_building = array("H"), array("H"), array("H")
    e_geom = array("I", [0])
    geom = bytearray()
    for e in graph.edges:
        w = data.walk_ways[e.way]
        fwd, bwd = safety.foot_directions(w.tags)
        steps, estimated = edge_steps(e, w)
        flags = (
            (FLAG_FORWARD if fwd else 0)
            | (FLAG_BACKWARD if bwd else 0)
            | (FLAG_STEPS_ESTIMATED if estimated else 0)
            | (FLAG_MAY_CLOSE if edge_may_close(e, w, data.areas) else 0)
            | (FLAG_THROUGH_BUILDING if e.attrs.building != -1 else 0)
        )
        e_from.append(node_index[e.nodes[0]])
        e_to.append(node_index[e.nodes[-1]])
        e_way.append(way_index[e.way])
        e_len.append(e.length)
        e_flags.append(flags)
        e_steps.append(min(steps, U16_MAX))
        e_park.append(area_ref(e.attrs.park))
        e_venue.append(area_ref(e.attrs.venue))
        e_building.append(area_ref(e.attrs.building))
        # Intermediate points as zigzag varint deltas from the start node.
        px, py = graph.node_coords[e.nodes[0]]
        prev = (_scaled(px), _scaled(py))
        for n in e.nodes[1:-1]:
            lon, lat = graph.node_coords[n]
            cur = (_scaled(lon), _scaled(lat))
            _varint(geom, _zigzag(cur[0] - prev[0]))
            _varint(geom, _zigzag(cur[1] - prev[1]))
            prev = cur
        e_geom.append(len(geom))

    for name, interner in (("tagsets", tagsets), ("node tagsets", node_tagsets), ("areas", areas)):
        if len(interner.items) > U16_MAX:
            raise ValueError(f"too many {name} for a u16 index: {len(interner.items)}")

    sections: list[tuple[str, str, array | bytes]] = [
        ("node_lat", "i32", node_lat),
        ("node_lon", "i32", node_lon),
        ("node_tagset", "u16", node_tags),
        ("node_ctx", "u8", node_ctx),
        ("edge_from", "u32", e_from),
        ("edge_to", "u32", e_to),
        ("edge_way", "u32", e_way),
        ("edge_length_m", "f32", e_len),
        ("edge_flags", "u8", e_flags),
        ("edge_steps", "u16", e_steps),
        ("edge_park", "u16", e_park),
        ("edge_venue", "u16", e_venue),
        ("edge_building", "u16", e_building),
        ("edge_geom_offset", "u32", e_geom),
        ("geom", "u8", bytes(geom)),
        ("way_osm_id", "f64", way_osm),
        ("way_tagset", "u16", way_tagset),
        ("way_name", "u32", way_name),
        ("way_opening_hours", "u32", way_oh),
    ]

    meta = {
        "format": "better-directions-graph",
        "version": VERSION,
        "city": {
            "id": graph.city.id,
            "name": graph.city.name,
            "bbox": vars(graph.city.bbox),
        },
        "attribution": graph.city.extract_attribution,
        "source": graph.source,
        "licence": graph.city.extract_licence,
        "coord_scale": COORD_SCALE,
        "counts": {"nodes": len(node_ids), "edges": len(graph.edges), "ways": len(used_ways)},
        "flags": {
            "edge": {
                "forward": FLAG_FORWARD,
                "backward": FLAG_BACKWARD,
                "steps_estimated": FLAG_STEPS_ESTIMATED,
                "may_close": FLAG_MAY_CLOSE,
                "through_building": FLAG_THROUGH_BUILDING,
            },
            "node_ctx": {
                "on_railway": CTX_ON_RAILWAY,
                "on_fast_road": CTX_ON_FAST_ROAD,
                "on_linear_barrier": CTX_ON_LINEAR_BARRIER,
            },
        },
        "strings": strings.items,
        "tagsets": tagsets.items,
        "node_tagsets": node_tagsets.items,
        "areas": areas.items,
        "sections": [{"name": n, "type": t, "count": len(a)} for n, t, a in sections],
    }
    meta_bytes = json.dumps(meta, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    meta_raw = meta_bytes.encode("utf-8")
    header_len = 12 + len(meta_raw)
    meta_raw += b" " * (-header_len % 8)

    out = bytearray(MAGIC)
    out += VERSION.to_bytes(4, "little")
    out += len(meta_raw).to_bytes(4, "little")
    out += meta_raw
    for _, _, arr in sections:
        out += b"\0" * (-len(out) % 8)
        if isinstance(arr, array):
            if sys.byteorder == "big":
                arr = array(arr.typecode, arr)
                arr.byteswap()
            out += arr.tobytes()
        else:
            out += arr
    return bytes(out)


def write_graph(graph: Graph, path: Path) -> int:
    blob = encode_graph(graph)
    path.write_bytes(blob)
    return len(blob)
