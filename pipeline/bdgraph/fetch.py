"""Explicit setup step: download a city's OSM extract and crop it to the city's bbox.

Usage:
    python -m bdgraph.fetch cities/lyon.json            # download (if needed) + crop
    python -m bdgraph.fetch cities/lyon.json --crop-only

Writes:
    data/raw/<region file>.osm.pbf   the provider's file, verified against its .md5 (gitignored)
    data/raw/<city>.osm.pbf          the cropped extract the graph build reads (gitignored)
    data/<city>/SOURCE.md            source URL, dated file name, download date, checksums, licence

This is the only step that touches the network. It talks to the extract provider only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import osmium

from bdgraph.city import City, extract_urls, load_city

USER_AGENT = "better-directions-build/0.1 (offline graph build)"
CHUNK = 1 << 20

# Relations we need for the build (park and building areas, pedestrian areas).
# Everything else (boundaries, routes) is dropped so the crop stays small.
AREA_RELATION_KEYS = ("building", "leisure", "landuse", "amenity", "shop", "highway", "railway")


def _open(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=60)


def resolve_dated_url(url: str) -> str:
    """Geofabrik's *-latest URL redirects to a dated file. Return the dated URL."""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.geturl()


def file_digest(path: Path, algo: str) -> str:
    h = hashlib.new(algo)
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    with _open(url) as resp, tmp.open("wb") as out:
        total = int(resp.headers.get("Content-Length", 0))
        done = 0
        while chunk := resp.read(CHUNK):
            out.write(chunk)
            done += len(chunk)
            if total and done % (50 * CHUNK) < CHUNK:
                print(f"  {done / total:5.1%} of {total / 1e6:.0f} MB", file=sys.stderr)
    tmp.rename(dest)


def fetch_region(url: str, raw_dir: Path) -> tuple[Path, str]:
    dated_url = resolve_dated_url(url)
    dest = raw_dir / dated_url.rsplit("/", 1)[1]
    with _open(dated_url + ".md5") as resp:
        expected_md5 = resp.read().decode().split()[0]
    if dest.exists() and file_digest(dest, "md5") == expected_md5:
        print(f"Already have {dest.name} (md5 ok)", file=sys.stderr)
    else:
        print(f"Downloading {dated_url}", file=sys.stderr)
        download(dated_url, dest)
        actual = file_digest(dest, "md5")
        if actual != expected_md5:
            dest.unlink()
            raise SystemExit(f"md5 mismatch for {dest.name}: {actual} != {expected_md5}")
    return dest, dated_url


def crop(region: Path, out: Path, city: City) -> dict[str, int]:
    """Keep every node inside the bbox, every way with at least one node inside it, and area
    relations that use a kept way. Referenced objects outside the bbox are added back whole,
    with their tags, so ways and areas are never truncated mid-way."""
    b = city.bbox
    kept_ways: set[int] = set()
    counts = {"nodes": 0, "ways": 0, "relations": 0}

    def inside(loc: osmium.osm.Location) -> bool:
        return loc.valid() and b.west <= loc.lon <= b.east and b.south <= loc.lat <= b.north

    with osmium.BackReferenceWriter(
        str(out), ref_src=str(region), overwrite=True, remove_tags=False
    ) as writer:
        for obj in osmium.FileProcessor(str(region)).with_locations():
            if obj.is_node():
                if inside(obj.location):
                    writer.add(obj)
                    counts["nodes"] += 1
            elif obj.is_way():
                if any(inside(n.location) for n in obj.nodes):
                    writer.add(obj)
                    kept_ways.add(obj.id)
                    counts["ways"] += 1
            elif obj.is_relation():
                tags = obj.tags
                if tags.get("type") != "multipolygon":
                    continue
                if not any(k in tags for k in AREA_RELATION_KEYS):
                    continue
                if any(m.type == "w" and m.ref in kept_ways for m in obj.members):
                    writer.add(obj)
                    counts["relations"] += 1
    return counts


class _Copy:
    """A handler that writes every object it's given, for merging."""

    def __init__(self, writer: osmium.SimpleWriter) -> None:
        self.writer = writer

    def node(self, n) -> None:
        self.writer.add_node(n)

    def way(self, w) -> None:
        self.writer.add_way(w)

    def relation(self, r) -> None:
        self.writer.add_relation(r)


def merge(parts: list[Path], out: Path) -> None:
    """Merge cropped extracts into one file. Objects in more than one (ways crossing the state
    line, shared nodes) are kept once, in their newest version."""
    reader = osmium.MergeInputReader()
    for p in parts:
        reader.add_file(str(p))
    with osmium.SimpleWriter(str(out), overwrite=True) as writer:
        reader.apply(_Copy(writer), simplify=True)


def count_inside(path: Path, city: City) -> dict[str, int]:
    """Nodes inside the bbox, and ways and area relations, in a cropped file."""
    b = city.bbox
    counts = {"nodes": 0, "ways": 0, "relations": 0}
    for obj in osmium.FileProcessor(str(path)):
        if obj.is_node():
            loc = obj.location
            inside = loc.valid() and b.west <= loc.lon <= b.east and b.south <= loc.lat <= b.north
            counts["nodes"] += int(inside)
        elif obj.is_way():
            counts["ways"] += 1
        elif obj.is_relation():
            counts["relations"] += 1
    return counts


def _replication(region: Path) -> str:
    header = osmium.io.Reader(str(region), osmium.osm.osm_entity_bits.NOTHING).header()
    return header.get("osmosis_replication_timestamp", "unknown")


def write_source(
    city: City,
    path: Path,
    *,
    dated_urls: list[str],
    regions: list[Path],
    cropped: Path,
    counts: dict[str, int],
) -> None:
    # Merged extracts are only as current as the oldest of them.
    replication = min(_replication(r) for r in regions)
    dated_url = dated_urls[0]
    path.parent.mkdir(parents=True, exist_ok=True)
    b = city.bbox
    cropped_sha256 = file_digest(cropped, "sha256")
    # Machine-readable copy; the build embeds data_as_of in the graph for the app's attribution.
    (path.parent / "source.json").write_text(
        json.dumps(
            {
                "provider": city.extract_provider,
                "dated_url": dated_url,
                **({"also": dated_urls[1:]} if len(dated_urls) > 1 else {}),
                "data_as_of": replication,
                "licence": city.extract_licence,
                "attribution": city.extract_attribution,
                "cropped_sha256": cropped_sha256,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    plural_req = "s" if city.extract_also else ""
    plural_files = "s" if len(dated_urls) > 1 else ""
    oldest_note = " (the oldest of the merged files)" if len(regions) > 1 else ""
    md5s = ", ".join(f"`{file_digest(r, 'md5')}`" for r in regions)
    path.write_text(
        f"""# Data source: {city.name}

| | |
|---|---|
| Provider | {city.extract_provider} |
| Requested URL{plural_req} | {", ".join(extract_urls(city))} |
| Dated file{plural_files} | {", ".join(dated_urls)} |
| OSM data as of | {replication}{oldest_note} |
| Downloaded | {dt.date.today().isoformat()} |
| Region file md5 | {md5s} |
| Crop bbox (W,S,E,N) | {b.west}, {b.south}, {b.east}, {b.north} |
| Cropped file sha256 | `{cropped_sha256}` |
| Cropped contents | {counts["nodes"]} nodes in bbox, {counts["ways"]} ways, \
{counts["relations"]} area relations (plus referenced objects) |
| Licence | {city.extract_licence}: https://opendatacommons.org/licenses/odbl/1-0/ |
| Attribution | {city.extract_attribution} |

Regenerate with `python -m bdgraph.fetch cities/{city.id}.json`.
""",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("city_config", type=Path)
    ap.add_argument("--crop-only", action="store_true", help="reuse the region file in data/raw")
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    args = ap.parse_args(argv)

    city = load_city(args.city_config)
    raw_dir = args.data_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    meta_path = raw_dir / f"{city.id}.region.json"
    if args.crop_only:
        meta = json.loads(meta_path.read_text())
        # Older records name a single file.
        entries = meta.get("regions", [meta])
        regions = [raw_dir / e["file"] for e in entries]
        dated_urls = [e["dated_url"] for e in entries]
    else:
        fetched = [fetch_region(url, raw_dir) for url in extract_urls(city)]
        regions = [r for r, _ in fetched]
        dated_urls = [u for _, u in fetched]
        record = {"regions": [{"file": r.name, "dated_url": u} for r, u in fetched]}
        meta_path.write_text(json.dumps(record, indent=2))

    cropped = raw_dir / f"{city.id}.osm.pbf"
    if len(regions) == 1:
        print(f"Cropping {regions[0].name} -> {cropped.name}", file=sys.stderr)
        counts = crop(regions[0], cropped, city)
    else:
        parts = []
        for i, region in enumerate(regions):
            part = raw_dir / f"{city.id}.part{i}.osm.pbf"
            print(f"Cropping {region.name} -> {part.name}", file=sys.stderr)
            crop(region, part, city)
            parts.append(part)
        print(f"Merging {len(parts)} parts -> {cropped.name}", file=sys.stderr)
        merge(parts, cropped)
        for part in parts:
            part.unlink()
        counts = count_inside(cropped, city)
    write_source(
        city,
        args.data_dir / city.id / "SOURCE.md",
        dated_urls=dated_urls,
        regions=regions,
        cropped=cropped,
        counts=counts,
    )
    print(f"Done: {counts}", file=sys.stderr)


if __name__ == "__main__":
    main()
