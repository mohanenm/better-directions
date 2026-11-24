"""Read a graph.bin back (used by tests and the stats report; the browser has its own reader)."""

from __future__ import annotations

import json
import sys
from array import array
from dataclasses import dataclass
from pathlib import Path

TYPECODES = {"i32": "i", "u32": "I", "u16": "H", "u8": "B", "f32": "f", "f64": "d"}


@dataclass
class DecodedGraph:
    meta: dict
    sections: dict[str, array | bytes]

    def __getitem__(self, name: str):
        return self.sections[name]

    def edge_points(self, e: int) -> list[tuple[float, float]]:
        """(lon, lat) points of edge e, endpoints included."""
        scale = self.meta["coord_scale"]
        lat, lon = self["node_lat"], self["node_lon"]
        u, v = self["edge_from"][e], self["edge_to"][e]
        x, y = lon[u], lat[u]
        pts = [(x / scale, y / scale)]
        geom: bytes = self["geom"]
        pos, end = self["edge_geom_offset"][e], self["edge_geom_offset"][e + 1]
        vals = []
        while pos < end:
            n = shift = 0
            while True:
                b = geom[pos]
                pos += 1
                n |= (b & 0x7F) << shift
                shift += 7
                if b < 0x80:
                    break
            vals.append((n >> 1) ^ -(n & 1))
        for dx, dy in zip(vals[::2], vals[1::2], strict=True):
            x, y = x + dx, y + dy
            pts.append((x / scale, y / scale))
        pts.append((lon[v] / scale, lat[v] / scale))
        return pts


def decode_graph(blob: bytes) -> DecodedGraph:
    if blob[:4] != b"BDG1":
        raise ValueError("not a Better Directions graph")
    meta_len = int.from_bytes(blob[8:12], "little")
    meta = json.loads(blob[12 : 12 + meta_len].decode("utf-8"))
    pos = 12 + meta_len
    sections: dict[str, array | bytes] = {}
    for s in meta["sections"]:
        pos += -pos % 8
        code = TYPECODES[s["type"]]
        size = array(code).itemsize * s["count"]
        chunk = blob[pos : pos + size]
        if s["name"] == "geom":
            sections[s["name"]] = bytes(chunk)
        else:
            arr = array(code)
            arr.frombytes(chunk)
            if sys.byteorder == "big":
                arr.byteswap()
            sections[s["name"]] = arr
        pos += size
    if pos != len(blob):
        raise ValueError(f"trailing bytes: read {pos} of {len(blob)}")
    return DecodedGraph(meta, sections)


def read_graph(path: Path) -> DecodedGraph:
    return decode_graph(Path(path).read_bytes())
