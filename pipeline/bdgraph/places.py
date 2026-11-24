"""Local list of public places for search, so the app needs no geocoding service.

Usage:
    python -m bdgraph.places cities/lyon.json      # writes app/public/data/<city>/places.json

Named squares, stations, parks, sights, notable landmarks (those with a Wikidata link), campuses
and malls inside the city's bbox. Areas are represented by the average of their outer ring.
Output is deterministic: sorted by kind, then name.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import osmium

from bdgraph.city import BBox, load_city

KEYS = (
    "place", "railway", "public_transport", "leisure", "tourism", "historic", "amenity", "shop",
    "highway",
)  # fmt: skip


def classify(tags: dict[str, str], square_prefixes: tuple[str, ...] = ()) -> str | None:
    if "name" not in tags:
        return None
    notable = "wikidata" in tags
    if tags.get("place") == "square":
        return "square"
    if tags.get("highway") == "pedestrian" and tags.get("area") == "yes":
        return "square"  # many squares are mapped only as pedestrian areas
    if "highway" in tags and tags["name"].startswith(square_prefixes):
        return "square"  # ...or only as a street called "Place ..." (city-specific prefixes)
    if tags.get("railway") == "station" or (
        tags.get("public_transport") == "station" and tags.get("railway") in ("station", "halt")
    ):
        return "station"
    if tags.get("leisure") == "park":
        return "park"
    if tags.get("tourism") in ("attraction", "museum", "viewpoint"):
        return "sight"
    historic = tags.get("historic")
    if notable and historic not in (None, "memorial", "wayside_cross", "boundary_stone"):
        return "landmark"
    if notable and tags.get("amenity") == "place_of_worship":
        return "landmark"
    if tags.get("amenity") in ("university", "college") and notable:
        return "campus"
    if tags.get("shop") == "mall":
        return "mall"
    return None


def collect(path: Path, bbox: BBox, square_prefixes: tuple[str, ...] = ()) -> list[dict]:
    found: dict[tuple[str, str], tuple[float, float]] = {}

    def add(kind: str, name: str, lon: float, lat: float) -> None:
        if bbox.contains(lon, lat):
            found.setdefault((kind, name), (lon, lat))

    for obj in (
        osmium.FileProcessor(str(path)).with_areas().with_filter(osmium.filter.KeyFilter(*KEYS))
    ):
        tags = {t.k: t.v for t in obj.tags}
        kind = classify(tags, square_prefixes)
        if kind is None:
            continue
        if obj.is_node():
            add(kind, tags["name"], obj.location.lon, obj.location.lat)
        elif obj.is_way() and "highway" in tags and tags.get("area") != "yes":
            # An open street named like a square: use the middle of its nodes.
            locs = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
            if locs:
                mid = locs[len(locs) // 2]
                add(kind, tags["name"], mid[0], mid[1])
        elif obj.is_area():
            for outer in obj.outer_rings():
                pts = [(n.lon, n.lat) for n in outer][:-1]
                if pts:
                    lon = sum(p[0] for p in pts) / len(pts)
                    lat = sum(p[1] for p in pts) / len(pts)
                    add(kind, tags["name"], lon, lat)
                break
    return [
        {"name": name, "kind": kind, "lon": round(lon, 6), "lat": round(lat, 6)}
        for (kind, name), (lon, lat) in sorted(found.items())
    ]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("city_config", type=Path)
    ap.add_argument("--osm", type=Path)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args(argv)
    city = load_city(args.city_config)
    osm = args.osm or Path("data/raw") / f"{city.id}.osm.pbf"
    out = args.out or Path("app/public/data") / city.id / "places.json"
    raw = json.loads(Path(args.city_config).read_text(encoding="utf-8"))
    prefixes = tuple(raw.get("places", {}).get("square_name_prefixes", []))
    places = collect(osm, city.bbox, prefixes)
    out.write_text(
        json.dumps(places, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    kinds: dict[str, int] = {}
    for p in places:
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print(f"Wrote {len(places)} places to {out}: {kinds}", file=sys.stderr)


if __name__ == "__main__":
    main()
