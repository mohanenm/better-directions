"""Invariants every built graph must satisfy, whatever went into it."""

from __future__ import annotations

from bdgraph import safety
from bdgraph.decode import DecodedGraph


def assert_output_is_safe(g: DecodedGraph) -> None:
    """Re-run the safety rules on what the file actually contains (defence in depth)."""
    tagsets, node_tagsets = g.meta["tagsets"], g.meta["node_tagsets"]
    ctx_bits = g.meta["flags"]["node_ctx"]
    for w in range(g.meta["counts"]["ways"]):
        tags = tagsets[g["way_tagset"][w]]
        assert safety.way_exclusion(tags) is None, tags
    for n in range(g.meta["counts"]["nodes"]):
        ctx = g["node_ctx"][n]
        reason = safety.node_exclusion(
            node_tagsets[g["node_tagset"][n]],
            **{name: bool(ctx & bit) for name, bit in ctx_bits.items()},
        )
        assert reason is None, (n, reason)
    edge_bits = g.meta["flags"]["edge"]
    for e in range(g.meta["counts"]["edges"]):
        flags = g["edge_flags"][e]
        tags = tagsets[g["way_tagset"][g["edge_way"][e]]]
        assert (bool(flags & edge_bits["forward"]), bool(flags & edge_bits["backward"])) == (
            safety.foot_directions(tags)
        )
        assert flags & (edge_bits["forward"] | edge_bits["backward"]), "edge usable in no direction"
        if flags & edge_bits["through_building"]:
            assert safety.may_pass_through_building(tags), tags
