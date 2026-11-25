"""Setup step: fetch terrain elevations for every point the walking graph uses.

Usage:
    python -m bdgraph.terrain cities/lyon.json      # after bdgraph.fetch, before bdgraph.build

Runs the graph build in memory to learn which points are used, asks the city's terrain provider
for any not already cached, and writes:

    data/raw/<city>.elevation.bin   cache: sorted (lon, lat, elevation) int32 triples (gitignored)
    data/<city>/terrain.json        provider, licence, attribution, coverage (committed)

The build reads the cache and computes climb and descent per edge. Points the cache doesn't
have are "unknown", never guessed. Only the provider's host is contacted, with public
coordinates of the city's paths; no user data is involved.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from array import array
from collections.abc import Callable, Sequence
from pathlib import Path

from bdgraph.city import load_city

USER_AGENT = "better-directions-build/0.1 (offline graph build)"
COORD_SCALE = 1_000_000  # microdegrees, same as the graph
ELE_SCALE = 10  # decimetres
NO_DATA = -(2**31)

Point = tuple[int, int]  # (lon, lat) in microdegrees
Provider = Callable[[Sequence[Point]], list[float | None]]


# --- Providers ---------------------------------------------------------------------------------

IGN_URL = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
IGN_BATCH = 5000  # the service's documented maximum per request
IGN_NO_DATA = -99999.0


def ign_provider(resource: str, *, pause_s: float = 1.0, retries: int = 5) -> Provider:
    """IGN Géoplateforme altimetry service (RGE ALTI for France)."""

    def fetch(points: Sequence[Point]) -> list[float | None]:
        out: list[float | None] = []
        for start in range(0, len(points), IGN_BATCH):
            batch = points[start : start + IGN_BATCH]
            body = json.dumps(
                {
                    "lon": "|".join(f"{x / COORD_SCALE:.6f}" for x, _ in batch),
                    "lat": "|".join(f"{y / COORD_SCALE:.6f}" for _, y in batch),
                    "resource": resource,
                    "zonly": "true",
                }
            ).encode()
            values = _post_with_retries(body, retries)
            if len(values) != len(batch):
                raise RuntimeError(f"expected {len(batch)} elevations, got {len(values)}")
            out += [None if v <= IGN_NO_DATA + 1 else float(v) for v in values]
            done = start + len(batch)
            print(f"  {done:,} / {len(points):,} points", file=sys.stderr)
            if done < len(points):
                time.sleep(pause_s)
        return out

    return fetch


def _post_with_retries(body: bytes, retries: int) -> list[float]:
    wait = 5.0
    for attempt in range(retries):
        req = urllib.request.Request(
            IGN_URL,
            data=body,
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read())["elevations"]
        except (urllib.error.URLError, TimeoutError, KeyError) as exc:
            if attempt == retries - 1:
                raise
            print(f"  request failed ({exc}); retrying in {wait:.0f}s", file=sys.stderr)
            time.sleep(wait)
            wait *= 2
    raise AssertionError("unreachable")


USGS_URL = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"
)
# Each request costs ~18 s whatever its size, so batches are large; one the service refuses is
# split in half and retried.
USGS_BATCH = 2000


def usgs_3dep_provider(
    *, batch: int = USGS_BATCH, pause_s: float = 0.5, retries: int = 5
) -> Provider:
    """USGS 3D Elevation Program (bare-earth, 1 m lidar where available; public domain)."""

    def sample(points: Sequence[Point]) -> list[float | None]:
        body = urllib.parse.urlencode(
            {
                "geometry": json.dumps(
                    {
                        "points": [[x / COORD_SCALE, y / COORD_SCALE] for x, y in points],
                        "spatialReference": {"wkid": 4326},
                    }
                ),
                "geometryType": "esriGeometryMultipoint",
                "returnFirstValueOnly": "true",
                "interpolation": "RSP_BilinearInterpolation",
                "f": "json",
            }
        ).encode()
        reply = _post_json(USGS_URL, body, "application/x-www-form-urlencoded", retries)
        if "error" in reply:
            raise RuntimeError(f"3DEP error: {reply['error']}")
        out: list[float | None] = [None] * len(points)
        for item in reply.get("samples", []):
            try:
                value = float(item["value"])
            except (KeyError, TypeError, ValueError):
                continue  # "NoData"
            if value > -1000:  # nodata sentinels are large negatives
                out[item["locationId"]] = value
        return out

    def fetch(points: Sequence[Point]) -> list[float | None]:
        out: list[float | None] = []
        size = batch
        start = 0
        while start < len(points):
            chunk = points[start : start + size]
            try:
                out += sample(chunk)
            except (RuntimeError, urllib.error.URLError, TimeoutError) as exc:
                if size <= 100:
                    raise
                size //= 2
                print(f"  batch refused ({exc}); trying {size} points", file=sys.stderr)
                continue
            start += len(chunk)
            print(f"  {start:,} / {len(points):,} points", file=sys.stderr)
            if start < len(points):
                time.sleep(pause_s)
        return out

    return fetch


def _post_json(url: str, body: bytes, content_type: str, retries: int) -> dict:
    wait = 5.0
    for attempt in range(retries):
        req = urllib.request.Request(
            url, data=body, headers={"User-Agent": USER_AGENT, "Content-Type": content_type}
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.loads(resp.read())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            if attempt == retries - 1:
                raise
            print(f"  request failed ({exc}); retrying in {wait:.0f}s", file=sys.stderr)
            time.sleep(wait)
            wait *= 2
    raise AssertionError("unreachable")


PROVIDERS: dict[str, Callable[[dict], Provider]] = {
    "ign-rge-alti": lambda cfg: ign_provider(cfg.get("resource", "ign_rge_alti_wld")),
    "usgs-3dep": lambda cfg: usgs_3dep_provider(),
}


# --- Cache -------------------------------------------------------------------------------------


def load_cache(path: Path) -> dict[Point, int | None]:
    """Elevations in decimetres (None = provider has no data there)."""
    if not path.exists():
        return {}
    arr = array("i")
    arr.frombytes(path.read_bytes())
    if sys.byteorder == "big":
        arr.byteswap()
    return {
        (arr[i], arr[i + 1]): (None if arr[i + 2] == NO_DATA else arr[i + 2])
        for i in range(0, len(arr), 3)
    }


def save_cache(path: Path, cache: dict[Point, int | None]) -> None:
    arr = array("i")
    for (x, y), ele in sorted(cache.items()):
        arr.extend((x, y, NO_DATA if ele is None else ele))
    if sys.byteorder == "big":
        arr.byteswap()
    path.write_bytes(arr.tobytes())


def to_point(lon: float, lat: float) -> Point:
    return (round(lon * COORD_SCALE), round(lat * COORD_SCALE))


def fill_cache(
    points: set[Point], cache: dict[Point, int | None], provider: Provider
) -> dict[Point, int | None]:
    missing = sorted(points - cache.keys())
    if missing:
        print(f"Fetching {len(missing):,} elevations", file=sys.stderr)
        for p, ele in zip(missing, provider(missing), strict=True):
            cache[p] = None if ele is None else round(ele * ELE_SCALE)
    return cache


def main(argv: list[str] | None = None) -> None:
    from bdgraph.build import build_graph

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("city_config", type=Path)
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    args = ap.parse_args(argv)

    city = load_city(args.city_config)
    cfg = json.loads(Path(args.city_config).read_text(encoding="utf-8")).get("terrain")
    if not cfg:
        raise SystemExit(f"{args.city_config} has no 'terrain' section")
    provider = PROVIDERS[cfg["provider"]](cfg)

    graph = build_graph(city, args.data_dir / "raw" / f"{city.id}.osm.pbf")
    points = {to_point(lon, lat) for lon, lat in graph.node_coords.values()}
    cache_path = args.data_dir / "raw" / f"{city.id}.elevation.bin"
    cache = fill_cache(points, load_cache(cache_path), provider)
    save_cache(cache_path, cache)

    known = sum(1 for p in points if cache.get(p) is not None)
    (args.data_dir / city.id / "terrain.json").write_text(
        json.dumps(
            {
                "provider": cfg["provider"],
                "resource": cfg.get("resource"),
                "licence": cfg["licence"],
                "attribution": cfg["attribution"],
                "fetched": dt.date.today().isoformat(),
                "points": len(points),
                "points_with_elevation": known,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Done: {known:,} of {len(points):,} points have elevation", file=sys.stderr)


if __name__ == "__main__":
    main()
