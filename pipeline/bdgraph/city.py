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
    )
