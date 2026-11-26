/**
 * The safety property test: random start/end pairs on the real graphs, across cost models,
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
import { spellWord } from "../src/art/word";
import { SHAPE_IDS } from "../src/art/shapes";
import { decodeGraph } from "../src/graph/format";
import { FeatureIndex } from "../src/modes/features";
import { MODE_IDS } from "../src/modes/modes";
import { planCrawl } from "../src/modes/crawl";
import { CRAWL_MINUTES, CRAWL_THEMES, WORKOUT_FOCUSES, WORKOUT_MINUTES } from "../src/modes/options";
import { planMode, planModeVia } from "../src/modes/plan-mode";
import { planWorkout } from "../src/modes/workout";
import { Graph } from "../src/graph/graph";
import { NORMAL, Router, type CostModel } from "../src/router/astar";
import { haversineM, turnAngleDeg } from "../src/router/geometry";
import { plan } from "../src/router/planner";
import { hashUnit } from "../src/router/rng";
import { NodeIndex } from "../src/router/snap";
import { detourCapSeconds, GPS_ART_MAX_SECONDS, LOOP_MAX_SECONDS, loopCapSeconds } from "../src/safety/limits";
import { footDirections, nodeExclusion, passageExclusion, PUBLIC_AREA_KINDS, wayExclusion } from "../src/safety/rules";

const RUNS = Number(process.env["PROPERTY_RUNS"] ?? 300);
const MAX_PAIR_DISTANCE_M = 5000; // city walks; longer pairs only cost CI time

/** Areas to test, comma-separated (default Lyon, to keep CI quick). Before a release, test them all. */
const AREAS_UNDER_TEST = (process.env["PROPERTY_AREAS"] ?? "lyon").split(",").map((a) => a.trim()).filter(Boolean);

function readArea(area: string): ArrayBuffer {
  const buf = readFileSync(new URL(`../public/data/${area}/graph.bin`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

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

/** Busy-road crossings, counted from raw tags (independently of stats.ts). */
const BUSY = new Set(["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "trunk", "trunk_link"]);
const busyNodeCache = new WeakMap<Graph, Uint8Array>();
function busyCrossings(g: Graph, dirEdges: number[]): number {
  const busyEdge = (e: number) => BUSY.has(g.edgeTags(e)["highway"] ?? "");
  let busyNode = busyNodeCache.get(g);
  if (!busyNode) {
    busyNode = new Uint8Array(g.nodeCount);
    for (let e = 0; e < g.edgeCount; e++) {
      if (g.allowedDirs[e] && busyEdge(e)) busyNode[g.s.edge_from[e]!] = busyNode[g.s.edge_to[e]!] = 1;
    }
    busyNodeCache.set(g, busyNode);
  }
  let count = 0;
  for (let i = 1; i < dirEdges.length; i++) {
    const node = g.tail(dirEdges[i]!);
    if (busyNode[node] && !busyEdge(dirEdges[i - 1]! >>> 1) && !busyEdge(dirEdges[i]! >>> 1)) count++;
  }
  return count;
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

describe.each(AREAS_UNDER_TEST)("safety property: random routes on %s", (area) => {
  const graph = new Graph(decodeGraph(readArea(area)));
  const router = new Router(graph);
  const features = new FeatureIndex(graph);

  it("the real graph passes the load-time audit with no violations", () => {
    expect(graph.violations).toEqual([]);
  });

  for (const model of models) {
    it(`${model.id}: every route is safe, connected and within the detour cap`, () => {
      fc.assert(
        fc.property(pair(graph), ([a, b]) => {
          const p = plan(router, a, b, model);
          expect(p).not.toBeNull(); // one strongly connected component: always routable
          checkRoute(graph, p!.normal.dirEdges, p!.normal.nodes);
          checkRoute(graph, p!.better.dirEdges, p!.better.nodes);
          expect(p!.better.timeS).toBeLessThanOrEqual(detourCapSeconds(p!.normal.timeS) + 1e-6);
        }),
        { numRuns: RUNS, seed: 20261124 },
      );
    });
  }

  for (const mode of MODE_IDS) {
    it(`mode ${mode}: every route is safe, connected and within the detour cap, for any seed`, () => {
      fc.assert(
        fc.property(pair(graph), fc.nat({ max: 2 ** 31 - 1 }), fc.boolean(), ([a, b], seed, long) => {
          const p = planMode(router, features, a, b, mode, seed, undefined, long);
          expect(p).not.toBeNull();
          checkRoute(graph, p!.normal.dirEdges, p!.normal.nodes);
          checkRoute(graph, p!.better.dirEdges, p!.better.nodes);
          expect(p!.better.timeS).toBeLessThanOrEqual(detourCapSeconds(p!.normal.timeS, long) + 1e-6);
          if (mode === "inconvenient") {
            // Inconvenient, not riskier.
            expect(busyCrossings(graph, p!.better.dirEdges)).toBeLessThanOrEqual(busyCrossings(graph, p!.normal.dirEdges));
          }
        }),
        { numRuns: RUNS, seed: 20261126 },
      );
    });
  }

  it("GPS art: every drawing is safe, connected and at most an hour, for any start, shape and length", () => {
    const index = new NodeIndex(graph);
    fc.assert(
      fc.property(
        fc.nat({ max: graph.nodeCount - 1 }),
        fc.constantFrom(...SHAPE_IDS),
        fc.constantFrom(25, 40, 55),
        (node, shape, minutes) => {
          const r = drawShape(router, features, index, { shape, start: graph.nodeLonLat(node), minutes });
          if (!r) return; // some places can't fit a shape; that's allowed
          checkRoute(graph, r.route.dirEdges, r.route.nodes);
          expect(r.route.timeS).toBeLessThanOrEqual(GPS_ART_MAX_SECONDS);
        },
      ),
      { numRuns: Math.ceil(RUNS / 5), seed: 20261127 },
    );
  });

  it("spelled words: every walk is safe, connected and at most an hour, for any word and start", () => {
    const index = new NodeIndex(graph);
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    fc.assert(
      fc.property(fc.nat({ max: graph.nodeCount - 1 }), fc.array(fc.constantFrom(...chars), { minLength: 2, maxLength: 5 }), (node, letters) => {
        const out = spellWord(router, features, index, letters.join(""), graph.nodeLonLat(node));
        if (!out.ok) return; // too long or nowhere to fit is allowed
        checkRoute(graph, out.result.route.dirEdges, out.result.route.nodes);
        expect(out.result.route.timeS).toBeLessThanOrEqual(LOOP_MAX_SECONDS + 1e-6);
      }),
      { numRuns: Math.ceil(RUNS / 10), seed: 20261131 },
    );
  });

  it("stops: routes through user-picked stops are safe and within the cap of the normal route through them", () => {
    fc.assert(
      fc.property(pair(graph), fc.array(fc.nat({ max: graph.nodeCount - 1 }), { minLength: 1, maxLength: 3 }), fc.constantFrom(...MODE_IDS), ([a, b], stops, mode) => {
        const near = stops.filter((n) => haversineM(graph.nodeLonLat(n), graph.nodeLonLat(a)) <= MAX_PAIR_DISTANCE_M);
        const points = [a, ...near, b].filter((n, i, all) => i === 0 || n !== all[i - 1]);
        if (points.length < 2) return;
        const p = planModeVia(router, features, points, mode, 7);
        expect(p).not.toBeNull();
        checkRoute(graph, p!.better.dirEdges, p!.better.nodes);
        for (const n of points) expect(p!.better.nodes).toContain(n);
        expect(p!.better.timeS).toBeLessThanOrEqual(detourCapSeconds(p!.normal.timeS) + 1e-6);
      }),
      { numRuns: Math.ceil(RUNS / 5), seed: 20261128 },
    );
  });

  it("workouts: every loop is safe, returns to its start and fits its time", () => {
    fc.assert(
      fc.property(fc.nat({ max: graph.nodeCount - 1 }), fc.constantFrom(...WORKOUT_FOCUSES), fc.constantFrom(...WORKOUT_MINUTES), (node, focus, minutes) => {
        const w = planWorkout(router, features, node, minutes, focus);
        if (!w) return; // a dead end with nowhere to loop is allowed to fail
        checkRoute(graph, w.route.dirEdges, w.route.nodes);
        expect(w.route.nodes.at(-1)).toBe(node);
        expect(w.route.timeS).toBeLessThanOrEqual(loopCapSeconds(minutes) + 1e-6);
      }),
      { numRuns: Math.ceil(RUNS / 5), seed: 20261129 },
    );
  });

  it("crawls: every crawl is safe, passes its stops, fits its time and caps drinking stops", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: graph.nodeCount - 1 }),
        fc.option(fc.nat({ max: graph.nodeCount - 1 }), { nil: null }),
        fc.constantFrom(...CRAWL_THEMES),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom(...CRAWL_MINUTES),
        (start, end, theme, stops, minutes) => {
          const c = planCrawl(router, features, { theme, stops, minutes, start, end });
          if (!c) return; // not enough stops nearby is allowed
          checkRoute(graph, c.route.dirEdges, c.route.nodes);
          expect(c.route.timeS).toBeLessThanOrEqual(loopCapSeconds(minutes) + 1e-6);
          expect(c.route.nodes.at(-1)).toBe(end ?? start);
          for (const s of c.stops) expect(c.route.nodes).toContain(graph.tail(s.dirEdge));
          expect(c.stops.length).toBeLessThanOrEqual(theme === "art" ? 8 : 6);
        },
      ),
      { numRuns: Math.ceil(RUNS / 5), seed: 20261130 },
    );
  });

  it("a tampered graph: routes never use edges or nodes the audit disabled", () => {
    // Mark ~1 in 15 way tagsets private, ~1 in 50 nodes locked and every other building on a
    // passage as flats, then route at random.
    const decoded = decodeGraph(readArea(area));
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
    expect(tampered.violations.length).toBeGreaterThan(tampered.edgeCount / 100);
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
