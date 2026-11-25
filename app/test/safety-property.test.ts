/**
 * The safety property test: random start/end pairs on the real Lyon graph, across cost models,
 * must never produce a route that uses an excluded way or node, walks a way the wrong way, is
 * disconnected, or breaks the detour cap.
 *
 * Runs per case: PROPERTY_RUNS (default 300), over four synthetic cost models, every mode with
 * random seeds, GPS art and a tampered graph. Raise PROPERTY_RUNS before a release.
 * The oracle below checks routes itself rather than calling verify.ts, so a bug in the router's
 * own checks can't hide a bug in the router.
 */
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { drawShape } from "../src/art/fit";
import { SHAPE_IDS } from "../src/art/shapes";
import { decodeGraph } from "../src/graph/format";
import { FeatureIndex } from "../src/modes/features";
import { MODE_IDS } from "../src/modes/modes";
import { planMode } from "../src/modes/plan-mode";
import { Graph } from "../src/graph/graph";
import { NORMAL, Router, type CostModel } from "../src/router/astar";
import { haversineM, turnAngleDeg } from "../src/router/geometry";
import { plan } from "../src/router/planner";
import { hashUnit } from "../src/router/rng";
import { NodeIndex } from "../src/router/snap";
import { detourCapSeconds, GPS_ART_MAX_SECONDS } from "../src/safety/limits";
import { footDirections, nodeExclusion, passageExclusion, PUBLIC_AREA_KINDS, wayExclusion } from "../src/safety/rules";

const RUNS = Number(process.env["PROPERTY_RUNS"] ?? 300);
const MAX_PAIR_DISTANCE_M = 5000; // city walks; longer pairs only cost CI time

function readLyon(): ArrayBuffer {
  const buf = readFileSync(new URL("../public/data/lyon/graph.bin", import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const lyon = new Graph(decodeGraph(readLyon()));
const router = new Router(lyon);
const features = new FeatureIndex(lyon);

/** Independent oracle: everything a route must satisfy, checked from raw tags. */
function checkRoute(g: Graph, dirEdges: number[], nodes: number[]): void {
  const ctxBits = g.meta.flags.node_ctx;
  for (const n of nodes) {
    const ctx = g.s.node_ctx[n]!;
    const tags = g.meta.node_tagsets[g.s.node_tagset[n]!]!;
    const reason = nodeExclusion(tags, {
      on_railway: (ctx & ctxBits.on_railway) !== 0,
      on_fast_road: (ctx & ctxBits.on_fast_road) !== 0,
      on_linear_barrier: (ctx & ctxBits.on_linear_barrier) !== 0,
    });
    expect(reason, `node ${n}`).toBeNull();
  }
  dirEdges.forEach((d, i) => {
    const e = d >>> 1;
    const forward = (d & 1) === 0;
    const tags = g.edgeTags(e);
    expect(wayExclusion(tags), `edge ${e} ${JSON.stringify(tags)}`).toBeNull();
    const [fwd, bwd] = footDirections(tags);
    expect(forward ? fwd : bwd, `edge ${e} direction`).toBe(true);
    if (g.s.edge_flags[e]! & g.meta.flags.edge.through_building) {
      const w = g.s.edge_way[e]!;
      const venue = g.area(g.s.edge_venue[e]!);
      const reason = passageExclusion(tags, g.meta.strings[g.s.way_name[w]!] ?? "", g.area(g.s.edge_building[e]!), {
        inPublicVenue: venue !== null && PUBLIC_AREA_KINDS.has(venue.kind),
        confirmed: (g.meta.confirmed_passages ?? []).includes(g.s.way_osm_id[w]!),
      });
      expect(reason, `edge ${e} passage`).toBeNull();
    }
    const from = forward ? g.s.edge_from[e]! : g.s.edge_to[e]!;
    const to = forward ? g.s.edge_to[e]! : g.s.edge_from[e]!;
    expect(from).toBe(nodes[i]);
    expect(to).toBe(nodes[i + 1]);
  });
}

const models: CostModel[] = [
  NORMAL,
  {
    // Like scenic chaos: seeded random weights per edge.
    id: "random-weights",
    turnAware: false,
    minCostPerSecond: 0.2,
    edgeCost: (_g, d, t) => t * (0.2 + 4 * hashUnit(1234, d >>> 1)),
  },
  {
    // Turn-aware and restrictive: right turns forbidden outright.
    id: "never-right",
    turnAware: true,
    minCostPerSecond: 1,
    edgeCost: (g, d, t, prev) => (prev >= 0 && turnAngleDeg(g, prev, d) > 45 ? Infinity : t),
  },
  {
    // Adversarial: craves the edges nearest the rules' edges (passages, corridors, roads under
    // buildings, steps, anything that may close) and hates ordinary streets.
    id: "edge-of-the-rules",
    turnAware: false,
    minCostPerSecond: 0.05,
    edgeCost: (g, d, t) => {
      const e = d >>> 1;
      const f = g.meta.flags.edge;
      const flags = g.s.edge_flags[e]!;
      const risky = flags & (f.through_building | f.under_building | f.may_close) || g.s.edge_steps[e]! > 0;
      return risky ? t * 0.05 : t * 5;
    },
  },
];

const pair = (g: Graph) =>
  fc
    .tuple(fc.nat({ max: g.nodeCount - 1 }), fc.nat({ max: g.nodeCount - 1 }))
    .filter(([a, b]) => haversineM(g.nodeLonLat(a), g.nodeLonLat(b)) <= MAX_PAIR_DISTANCE_M);

describe("safety property: random routes on the real Lyon graph", () => {
  it("the real graph passes the load-time audit with no violations", () => {
    expect(lyon.violations).toEqual([]);
  });

  for (const model of models) {
    it(`${model.id}: every route is safe, connected and within the detour cap`, () => {
      fc.assert(
        fc.property(pair(lyon), ([a, b]) => {
          const p = plan(router, a, b, model);
          expect(p).not.toBeNull(); // one strongly connected component: always routable
          checkRoute(lyon, p!.normal.dirEdges, p!.normal.nodes);
          checkRoute(lyon, p!.better.dirEdges, p!.better.nodes);
          expect(p!.better.timeS).toBeLessThanOrEqual(detourCapSeconds(p!.normal.timeS) + 1e-6);
        }),
        { numRuns: RUNS, seed: 20261124 },
      );
    });
  }

  for (const mode of MODE_IDS) {
    it(`mode ${mode}: every route is safe, connected and within the detour cap, for any seed`, () => {
      fc.assert(
        fc.property(pair(lyon), fc.nat({ max: 2 ** 31 - 1 }), ([a, b], seed) => {
          const p = planMode(router, features, a, b, mode, seed);
          expect(p).not.toBeNull();
          checkRoute(lyon, p!.normal.dirEdges, p!.normal.nodes);
          checkRoute(lyon, p!.better.dirEdges, p!.better.nodes);
          expect(p!.better.timeS).toBeLessThanOrEqual(detourCapSeconds(p!.normal.timeS) + 1e-6);
        }),
        { numRuns: RUNS, seed: 20261126 },
      );
    });
  }

  it("GPS art: every drawing is safe, connected and at most an hour, for any start, shape and length", () => {
    const index = new NodeIndex(lyon);
    fc.assert(
      fc.property(
        fc.nat({ max: lyon.nodeCount - 1 }),
        fc.constantFrom(...SHAPE_IDS),
        fc.constantFrom(25, 40, 55),
        (node, shape, minutes) => {
          const r = drawShape(router, features, index, { shape, start: lyon.nodeLonLat(node), minutes });
          if (!r) return; // some places can't fit a shape; that's allowed
          checkRoute(lyon, r.route.dirEdges, r.route.nodes);
          expect(r.route.timeS).toBeLessThanOrEqual(GPS_ART_MAX_SECONDS);
        },
      ),
      { numRuns: Math.ceil(RUNS / 5), seed: 20261127 },
    );
  });

  it("a tampered graph: routes never use edges or nodes the audit disabled", () => {
    // Mark ~1 in 15 way tagsets private, ~1 in 50 nodes locked and every other building on a
    // passage as flats, then route at random.
    const decoded = decodeGraph(readLyon());
    decoded.meta.tagsets = decoded.meta.tagsets.map((t, i) => (hashUnit(7, i) < 1 / 15 ? { ...t, access: "private" } : t));
    decoded.meta.areas = decoded.meta.areas.map((a, i) =>
      a && a.kind !== "park" && hashUnit(9, i) < 1 / 2 ? { ...a, kind: "building", building: "apartments" } : a,
    );
    decoded.meta.node_tagsets.push({ barrier: "gate", locked: "yes" });
    const locked = decoded.meta.node_tagsets.length - 1;
    for (let n = 0; n < decoded.meta.counts.nodes; n++) {
      if (hashUnit(8, n) < 1 / 50) decoded.s.node_tagset[n] = locked;
    }
    const tampered = new Graph(decoded);
    expect(tampered.violations.length).toBeGreaterThan(1000);
    const r = new Router(tampered);
    fc.assert(
      fc.property(pair(tampered), ([a, b]) => {
        for (const model of models.slice(0, 2)) {
          const route = r.route(a, b, model);
          if (route) checkRoute(tampered, route.dirEdges, route.nodes); // may be unreachable now
        }
      }),
      { numRuns: Math.ceil(RUNS / 2), seed: 20261125 },
    );
  });
});
