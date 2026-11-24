"""The TypeScript router tests read graphs built by this pipeline; keep them current."""

import os

import pytest
from ts_fixtures import FIXTURE_DIR, FIXTURES


@pytest.mark.parametrize("name", sorted(FIXTURES))
def test_ts_fixture_is_current(name, tmp_path):
    blob = FIXTURES[name](tmp_path)
    path = FIXTURE_DIR / name
    if os.environ.get("UPDATE_TS_FIXTURES"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(blob)
    assert path.exists(), "run with UPDATE_TS_FIXTURES=1 to create it"
    assert path.read_bytes() == blob, "fixture is stale: run with UPDATE_TS_FIXTURES=1"
