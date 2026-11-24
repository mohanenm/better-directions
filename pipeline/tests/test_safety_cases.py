"""Every shared safety case must hold. The TypeScript router runs the same file."""

import json
from pathlib import Path

import pytest

from bdgraph import safety

CASES = json.loads((Path(__file__).parents[2] / "safety" / "cases.json").read_text())


@pytest.mark.parametrize("case", CASES["ways"], ids=lambda c: c["name"])
def test_way_cases(case):
    assert safety.way_exclusion(case["tags"]) == case["excluded"]


@pytest.mark.parametrize("case", CASES["through_building"], ids=lambda c: c["name"])
def test_through_building_cases(case):
    assert safety.may_pass_through_building(case["tags"]) is case["allowed"]


@pytest.mark.parametrize("case", CASES["nodes"], ids=lambda c: c["name"])
def test_node_cases(case):
    assert safety.node_exclusion(case["tags"], **case["context"]) == case["excluded"]


@pytest.mark.parametrize("case", CASES["directions"], ids=lambda c: c["name"])
def test_direction_cases(case):
    assert safety.foot_directions(case["tags"]) == (case["forward"], case["backward"])


def test_every_way_reason_is_covered():
    """Each exclusion reason the code can return has at least one case."""
    reasons = {c["excluded"] for c in CASES["ways"]} - {None}
    expected = {
        "not_highway",
        "railway",
        "construction",
        "access",
        "foot",
        "fast_road",
        "no_foot_permission",
        "highway_kind",
        "indoor_not_corridor",
        "escalator_direction_unknown",
        "sac_scale",
        "trail_visibility",
    }
    assert reasons == expected
