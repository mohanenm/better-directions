"""City configuration (cities/<id>.json)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def contains(self, lon: float, lat: float) -> bool:
        return self.west <= lon <= self.east and self.south <= lat <= self.north


@dataclass(frozen=True)
class City:
    id: str
    name: str
    bbox: BBox
    extract_url: str
    extract_provider: str
    extract_licence: str
    extract_attribution: str
    # More extracts merged with the main one, for areas that cross a region boundary (DC's box
    # reaches into Virginia and Maryland). Geofabrik's state extracts stop at the state line.
    extract_also: tuple[str, ...] = ()
    # Passages and corridors confirmed open to the public, by OSM way id. See
    # docs/ADDING_A_CITY.md: the build excludes unconfirmed ones through private-looking buildings.
    confirmed_passages: frozenset[int] = frozenset()
    # Areas closed to the public that OpenStreetMap doesn't tag as such (a campus with ID checks
    # at every gate, say), as ("w" or "r", OSM id). Inside them only explicitly public ways are
    # walkable. Each entry in the config carries a note saying why.
    closed_areas: frozenset[tuple[str, int]] = frozenset()


def _area_ref(ref: str) -> tuple[str, int]:
    """ "w42921793" -> ("w", 42921793)."""
    if len(ref) < 2 or ref[0] not in "wr" or not ref[1:].isdigit():
        raise ValueError(f"closed_areas: {ref!r} isn't an OSM way or relation like w123 or r456")
    return ref[0], int(ref[1:])


def extract_urls(city: City) -> tuple[str, ...]:
    """Every extract the area is built from, the main one first."""
    return (city.extract_url, *city.extract_also)


def load_city(path: Path) -> City:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    ex = raw["extract"]
    return City(
        id=raw["id"],
        name=raw["name"],
        bbox=BBox(**raw["bbox"]),
        extract_url=ex["url"],
        extract_provider=ex["provider"],
        extract_licence=ex["licence"],
        extract_attribution=ex["attribution"],
        extract_also=tuple(ex.get("also", [])),
        confirmed_passages=frozenset(int(p["way"]) for p in raw.get("confirmed_passages", [])),
        closed_areas=frozenset(_area_ref(a["area"]) for a in raw.get("closed_areas", [])),
    )
