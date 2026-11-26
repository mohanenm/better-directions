"""Setup step: self-hosted basemap tiles, fonts and sprites for a city.

Usage:
    python -m bdgraph.tiles cities/lyon.json --build 20261123

1. Downloads the pinned `pmtiles` CLI (checked against its SHA-256) into data/raw/tools/.
2. Extracts the city's bbox (zoom 0-15) from the dated Protomaps daily build.
3. Unpacks it into plain files: app/public/tiles/<city>/{z}/{x}/{y}.mvt (decompressed). GitHub Pages
   gzips responses and applies byte ranges to the compressed stream, so no single .pmtiles file.
4. Downloads only the glyph ranges and sprites the style needs, from a pinned commit of
   protomaps/basemaps-assets, with their licences.
5. Records what it did in data/<city>/tiles.json.

Hosts contacted: github.com (and GitHub's download hosts), build.protomaps.com. Build time only;
the published page never talks to them.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import Compression

from bdgraph.city import load_city

USER_AGENT = "better-directions-build/0.1 (offline tile build)"
PMTILES_VERSION = "1.31.2"
PMTILES_ASSETS = {
    ("Darwin", "arm64"): (
        f"go-pmtiles-{PMTILES_VERSION}_Darwin_arm64.zip",
        "40528f7f616fcbf91207cd48c8fc023d213f6d86c0cbf1f748732803d1880f3d",
    ),
    ("Darwin", "x86_64"): (
        f"go-pmtiles-{PMTILES_VERSION}_Darwin_x86_64.zip",
        "1f0dc02eee6c58312dd6c509faee1b5c32f0596568af1bf51f1b034e7a88a65b",
    ),
    ("Linux", "x86_64"): (
        f"go-pmtiles_{PMTILES_VERSION}_Linux_x86_64.tar.gz",
        "3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f",
    ),
}
PMTILES_RELEASE = f"https://github.com/protomaps/go-pmtiles/releases/download/v{PMTILES_VERSION}/"
PROTOMAPS_BUILDS = "https://build.protomaps.com/"
MAX_ZOOM = 15

ASSETS_COMMIT = "028c18f713baecad011301ff7a69acc39bcc2ae7"
ASSETS_RAW = f"https://raw.githubusercontent.com/protomaps/basemaps-assets/{ASSETS_COMMIT}/"
FONTS = ("Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic")
# Basic Latin + Latin-1 (French accents), Latin Extended-A (oe ligature), general punctuation
# (curly quotes, dashes, ellipsis).
GLYPH_RANGES = ("0-255", "256-511", "512-767", "768-1023", "7680-7935", "8192-8447")
SPRITES = tuple(
    f"{flavor}{suffix}"
    for flavor in ("light", "dark")
    for suffix in (".json", ".png", "@2x.json", "@2x.png")
)


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read()


def ensure_pmtiles_cli(tools: Path) -> Path:
    exe = tools / "pmtiles"
    if exe.exists():
        return exe
    key = (platform.system(), platform.machine())
    if key not in PMTILES_ASSETS:
        raise SystemExit(f"no pinned pmtiles build for {key}; add one to PMTILES_ASSETS")
    name, sha256 = PMTILES_ASSETS[key]
    blob = _get(PMTILES_RELEASE + name)
    actual = hashlib.sha256(blob).hexdigest()
    if actual != sha256:
        raise SystemExit(f"pmtiles download checksum mismatch: {actual} != {sha256}")
    tools.mkdir(parents=True, exist_ok=True)
    if name.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            data = z.read("pmtiles")
    else:
        with tarfile.open(fileobj=io.BytesIO(blob)) as t:
            member = t.extractfile("pmtiles")
            assert member is not None
            data = member.read()
    exe.write_bytes(data)
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
    return exe


def extract(exe: Path, build: str, city, out: Path) -> None:
    b = city.bbox
    subprocess.run(
        [
            str(exe),
            "extract",
            f"{PROTOMAPS_BUILDS}{build}.pmtiles",
            str(out),
            f"--bbox={b.west},{b.south},{b.east},{b.north}",
            f"--maxzoom={MAX_ZOOM}",
        ],
        check=True,
    )


def unpack(pmtiles_path: Path, out_dir: Path) -> tuple[int, int]:
    """Write every tile as a plain decompressed .mvt file. Returns (count, total bytes)."""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    count = total = 0
    with pmtiles_path.open("rb") as f:
        source = MmapSource(f)
        header = Reader(source).header()
        gzipped = header["tile_compression"] == Compression.GZIP
        for (z, x, y), data in all_tiles(source):
            tile = gzip.decompress(data) if gzipped else data
            path = out_dir / str(z) / str(x) / f"{y}.mvt"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(tile)
            count += 1
            total += len(tile)
    return count, total


def fetch_assets(out_dir: Path) -> int:
    total = 0
    for font in FONTS:
        for rng in GLYPH_RANGES:
            data = _get(ASSETS_RAW + f"fonts/{urllib.request.quote(font)}/{rng}.pbf")
            path = out_dir / "fonts" / font / f"{rng}.pbf"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            total += len(data)
    (out_dir / "fonts" / "OFL.txt").write_bytes(_get(ASSETS_RAW + "fonts/OFL.txt"))
    for name in SPRITES:
        data = _get(ASSETS_RAW + f"sprites/v4/{name}")
        path = out_dir / "sprites" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        total += len(data)
    (out_dir / "sprites" / "LICENSE.md").write_text(
        "Sprites from protomaps/basemaps-assets, derived from MIT-licensed tangrams/icons:\n"
        "https://github.com/tangrams/icons/blob/master/LICENSE.md\n",
        encoding="utf-8",
    )
    return total


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("city_config", type=Path)
    ap.add_argument("--build", required=True, help="Protomaps daily build date, e.g. 20261123")
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    ap.add_argument("--public-dir", type=Path, default=Path("app/public"))
    args = ap.parse_args(argv)

    city = load_city(args.city_config)
    raw = args.data_dir / "raw"
    exe = ensure_pmtiles_cli(raw / "tools")
    extracted = raw / f"{city.id}-basemap.pmtiles"
    if not extracted.exists():
        print(f"Extracting {city.name} from Protomaps build {args.build}", file=sys.stderr)
        extract(exe, args.build, city, extracted)
    count, tile_bytes = unpack(extracted, args.public_dir / "tiles" / city.id)
    asset_bytes = fetch_assets(args.public_dir / "basemap")
    record = {
        "source": f"{PROTOMAPS_BUILDS}{args.build}.pmtiles",
        "build": args.build,
        "bbox": vars(city.bbox),
        "max_zoom": MAX_ZOOM,
        "tiles": count,
        "tile_bytes": tile_bytes,
        "assets_commit": ASSETS_COMMIT,
        "asset_bytes": asset_bytes,
        "pmtiles_cli": PMTILES_VERSION,
        "licence": "Map data © OpenStreetMap contributors (ODbL); basemap by Protomaps",
    }
    out = args.data_dir / city.id / "tiles.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(
        f"Done: {count:,} tiles, {tile_bytes / 1e6:.1f} MB; assets {asset_bytes / 1e6:.1f} MB",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
