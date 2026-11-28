/**
 * The safety property test: random walks from every planner, checked by an independent oracle.
 *
 * The oracle (test/oracle.ts) is written from the README's promises. It imports nothing from
 * src/safety: not the rules, not the limits. So a bug in the router's rules, or a quiet change to
 * a limit, fails here rather than being agreed with. On a real graph every edge already passes
 * (oracle.test.ts checks that directly), so on real graphs this mainly tests connection,
 * direction and time limits. The rules are tested on tampered graphs: copies of the real graph
 * with ways, gates, one-way tags and buildings made forbidden at random. Every planner runs on
 * them too, and none may ever use what was tampered.
 *
 * Runs per case: PROPERTY_RUNS (default 300); tampered graphs get a fifth of that each.
 * TAMPER_SEEDS (default 3) sets how many tampered copies to make. PROPERTY_AREAS picks areas
 * (default Lyon). Before a release, raise the runs and test every area.
 */
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { drawShape } from "../src/art/fit";
import { spellWord } from "../src/art/word";
import { SHAPE_IDS } from "../src/art/shapes";
import { decodeGraph, type DecodedGraph, type Tags } from "../src/graph/format";
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
import { ART_LENGTHS } from "../src/ui/url";
import {
  detourLimitSeconds,
  loopLimitSeconds,
  nodePromiseBroken,
  passagePromiseBroken,
  shapeLimitSeconds,
  underBuildingPromiseBroken,
  walkingDirections,
  WORD_LIMIT_SECONDS,
  wayPromiseBroken,
} from "./oracle";

const RUNS = Number(process.env["PROPERTY_RUNS"] ?? 300);
const TAMPER_SEEDS = Number(process.env["TAMPER_SEEDS"] ?? 3);
const MAX_PAIR_DISTANCE_M = 5000; // city walks; longer pairs only cost CI time
const SLACK = 1e-6;

/** Areas to test, comma-separated (default Lyon, to keep CI quick). Before a release, test them all. */
const AREAS_UNDER_TEST = (process.env["PROPERTY_AREAS"] ?? "lyon").split(",").map((a) => a.trim()).filter(Boolean);

function readArea(area: string): DecodedGraph {
  const buf = readFileSync(new URL(`../../data/${area}/graph.bin`, import.meta.url));
  return decodeGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** The oracle on a route: every promise, plus a connected path along real edges. */
function checkRoute(g: Graph, dirEdges: number[], nodes: number[]): void {
  const ctx = g.meta.flags.node_ctx;
  const bits = g.meta.flags.edge;
  const confirmed = new Set(g.meta.confirmed_passages ?? []);
  expect(nodes.length).toBe(dirEdges.length + 1);
  for (const n of nodes) {
    const c = g.s.node_ctx[n]!;
    const tags = g.meta.node_tagsets[g.s.node_tagset[n]!]!;
    const broken = nodePromiseBroken(tags, {
      onRailway: (c & ctx.on_railway) !== 0,
      onFastRoad: (c & ctx.on_fast_road) !== 0,
      onFenceOrWall: (c & ctx.on_linear_barrier) !== 0,
    });
    expect(broken, `node ${n} ${JSON.stringify(tags)}`).toBeNull();
  }
  dirEdges.forEach((d, i) => {
    const e = d >>> 1;
    const forward = (d & 1) === 0;
    const tags = g.edgeTags(e);
    const where = `edge ${e} ${JSON.stringify(tags)}`;
    expect(wayPromiseBroken(tags), where).toBeNull();
    const [fwd, bwd] = walkingDirections(tags);
    expect(forward ? fwd : bwd, `${where} walked the wrong way`).toBe(true);
    const flags = g.s.edge_flags[e]!;
    expect(flags & (forward ? bits.forward : bits.backward), `${where} against the file's direction`).not.toBe(0);
    if (flags & bits.through_building) {
      const w = g.s.edge_way[e]!;
      const venue = g.area(g.s.edge_venue[e]!);
      const broken = passagePromiseBroken(tags, g.edgeName(e), g.area(g.s.edge_building[e]!), {
        inMallOrStation: venue !== null && (venue.kind === "mall" || venue.kind === "station"),
        confirmed: confirmed.has(g.s.way_osm_id[w]!),
      });
      expect(broken, where).toBeNull();
    }
    if (flags & bits.under_building) expect(underBuildingPromiseBroken(tags), where).toBeNull();
    const from = forward ? g.s.edge_from[e]! : g.s.edge_to[e]!;
    const to = forward ? g.s.edge_to[e]! : g.s.edge_from[e]!;
    expect(from, `step ${i} starts where the last ended`).toBe(nodes[i]);
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

// --- Tampering ---------------------------------------------------------------------------------

const without = (t: Tags, ...keys: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(t).filter(([k]) => !keys.includes(k)));
const SIDEWALKS = ["sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right"];

/** Ways to make a way forbidden. Each one is written so the README rules it out whatever else the way has. */
const FORBID_WAY: ((t: Tags) => Record<string, string>)[] = [
  (t) => ({ ...t, access: "private" }),
  (t) => ({ ...t, access: "No" }),
  (t) => ({ ...t, access: "yes;private" }),
  (t) => ({ ...without(t, "foot"), access: "permit" }),
  (t) => ({ ...without(t, "foot"), access: "military" }),
  (t) => ({ ...without(t, "foot"), access: "emergency" }),
  (t) => ({ ...without(t, "foot"), access: "delivery" }),
  (t) => ({ ...without(t, "foot"), access: " Unknown " }),
  (t) => ({ ...t, foot: "no" }),
  (t) => ({ ...t, foot: "use_sidepath" }),
  (t) => ({ ...t, foot: "discouraged" }),
  (t) => ({ ...t, railway: "abandoned" }),
  (t) => ({ ...t, construction: "yes" }),
  (t) => ({ ...t, highway: "construction" }),
  (t) => ({ ...without(t, "foot", ...SIDEWALKS), highway: "motorway" }),
  (t) => ({ ...without(t, "foot", ...SIDEWALKS), highway: "trunk_link" }),
  (t) => ({ ...without(t, "foot"), motorroad: "yes" }),
  (t) => ({ ...without(t, "foot", "access"), highway: "service", service: "driveway" }),
  (t) => ({ ...without(t, "foot", ...SIDEWALKS), highway: "primary", sidewalk: "no" }),
  (t) => ({ ...without(t, "foot", ...SIDEWALKS), highway: "secondary", "sidewalk:both": "separate" }),
  (t) => ({ ...without(t, "foot", ...SIDEWALKS), highway: "tertiary", "sidewalk:left": "none", "sidewalk:right": "no" }),
  (t) => ({ ...without(t, "foot"), highway: "cycleway" }),
  (t) => ({ ...t, highway: "bus_guideway" }),
  (t) => ({ ...t, conveying: "yes" }),
  (t) => ({ ...t, sac_scale: "alpine_hiking" }),
  (t) => without(t, "highway"),
];
/** Ways to make a way one-way for walkers. */
const ONE_WAY: ((t: Tags) => Record<string, string>)[] = [
  (t) => ({ ...t, "oneway:foot": "yes" }),
  (t) => ({ ...t, "oneway:foot": "-1" }),
  (t) => ({ ...without(t, "oneway:foot"), highway: "footway", oneway: "yes" }),
  (t) => ({ ...t, conveying: "backward" }),
  (t) => ({ ...t, "foot:backward": "no" }),
  (t) => ({ ...t, "foot:forward": "use_sidepath" }),
];
const FORBID_NODE: Tags[] = [
  { barrier: "gate", locked: "yes" },
  { barrier: "gate", access: "private" },
  { barrier: "gate", access: "permit" },
  { barrier: "gate", access: "military", foot: "no" },
  { barrier: "bollard", foot: "no" },
  { highway: "crossing", crossing: "no" },
];

interface Tampered {
  graph: Graph;
  forbiddenWays: number;
  onewayWays: number;
  /** Whether the area has a passage through a building at all (Dundee has none). */
  hasPassages: boolean;
}

/** A copy of the area's graph with forbidden tags, one-way tags, gates and buildings added at random. */
function tamper(area: string, seed: number): Tampered {
  const g = readArea(area);
  const { meta, s } = g;
  const bits = meta.flags.edge;
  const ctx = meta.flags.node_ctx;
  const r = (salt: number, i: number) => hashUnit(seed * 1009 + salt, i);
  let forbiddenWays = 0;
  let onewayWays = 0;
  // Strip the evidence from half the passages through buildings (street name, access tags), so
  // the relabelled buildings below leave some passages with no sign they're public.
  let unnamed = meta.strings.indexOf("");
  if (unnamed < 0) unnamed = meta.strings.push("") - 1;
  const stripped = new Set<number>();
  const strip = (w: number) => {
    if (stripped.has(w)) return;
    stripped.add(w);
    s.way_name[w] = unnamed;
    meta.tagsets.push(without(meta.tagsets[s.way_tagset[w]!]!, "access", "foot"));
    s.way_tagset[w] = meta.tagsets.length - 1;
  };
  // One passage loses all its evidence for certain, so even an area with few passages has one to refuse.
  let surePassage = -1;
  for (let e = 0; e < meta.counts.edges; e++) {
    if (!(s.edge_flags[e]! & bits.through_building) || s.edge_building[e] === 0) continue;
    const tags = meta.tagsets[s.way_tagset[s.edge_way[e]!]!]!;
    const passage = tags["tunnel"] === "building_passage" || tags["covered"] === "yes" || tags["highway"] === "corridor" || tags["indoor"] === "corridor";
    if (passage && surePassage < 0) {
      surePassage = e;
      strip(s.edge_way[e]!);
    }
    if (r(13, s.edge_way[e]!) < 0.5) strip(s.edge_way[e]!);
  }
  const keep = surePassage < 0 ? null : { way: s.edge_way[surePassage]!, nodes: [s.edge_from[surePassage]!, s.edge_to[surePassage]!] };
  for (let w = 0; w < meta.counts.ways; w++) {
    if (w === keep?.way) continue; // the sure passage must fail for being a passage, nothing else
    const tags = meta.tagsets[s.way_tagset[w]!]!;
    let next: Record<string, string> | null = null;
    if (r(1, w) < 1 / 12) {
      next = FORBID_WAY[Math.floor(r(2, w) * FORBID_WAY.length)]!(tags);
      expect(wayPromiseBroken(next), `tampering ${JSON.stringify(next)} must be forbidden`).not.toBeNull();
      forbiddenWays++;
    } else if (r(3, w) < 1 / 12) {
      next = ONE_WAY[Math.floor(r(4, w) * ONE_WAY.length)]!(tags);
      if (wayPromiseBroken(next)) continue; // e.g. conveying on a way that can't take it; leave it
      onewayWays++;
    }
    if (next) {
      meta.tagsets.push(next);
      s.way_tagset[w] = meta.tagsets.length - 1;
    }
  }
  const firstNodeTagset = meta.node_tagsets.length;
  meta.node_tagsets.push(...FORBID_NODE);
  for (let n = 0; n < meta.counts.nodes; n++) {
    if (keep?.nodes.includes(n)) continue;
    if (r(5, n) < 1 / 50) s.node_tagset[n] = firstNodeTagset + Math.floor(r(6, n) * FORBID_NODE.length);
    else if (r(7, n) < 1 / 200) s.node_ctx[n]! |= r(8, n) < 0.5 ? ctx.on_railway : ctx.on_linear_barrier;
  }
  // Half the buildings with passages become flats, and some passages lose their mall or station.
  meta.areas = meta.areas.map((a, i) => (a && a.kind !== "park" && a.kind !== "grounds" && r(9, i) < 0.5 ? { ...a, kind: "building", building: "apartments" } : a));
  if (seed % 2) meta.confirmed_passages = [];
  for (let e = 0; e < meta.counts.edges; e++) {
    if (r(10, e) < 0.3) s.edge_venue[e] = 0;
    // Mark a few ordinary edges as running through or under a building.
    if (r(11, e) < 1 / 100) s.edge_flags[e]! |= bits.through_building;
    else if (r(12, e) < 1 / 100) s.edge_flags[e]! |= bits.under_building;
  }
  if (surePassage >= 0) {
    const w = s.edge_way[surePassage]!;
    const b = s.edge_building[surePassage]!;
    meta.areas[b] = { ...meta.areas[b]!, kind: "building", building: "apartments" };
    s.edge_venue[surePassage] = 0;
    meta.confirmed_passages = (meta.confirmed_passages ?? []).filter((id) => id !== s.way_osm_id[w]);
  }
  return { graph: new Graph(g), forbiddenWays, onewayWays, hasPassages: surePassage >= 0 };
}

// --- The cases, for real and tampered graphs ------------------------------------------------------

interface Setup {
  graph: Graph;
  router: Router;
  features: FeatureIndex;
  index: NodeIndex;
  /** Every pair of nodes is connected (real graphs: the build keeps one strongly connected part). */
  connected: boolean;
}

const pair = (g: Graph) =>
  fc
    .tuple(fc.nat({ max: g.nodeCount - 1 }), fc.nat({ max: g.nodeCount - 1 }))
    .filter(([a, b]) => haversineM(g.nodeLonLat(a), g.nodeLonLat(b)) <= MAX_PAIR_DISTANCE_M);

/** Declares every planner's case. `get` is called inside each test, so setup runs once, lazily. */
function planners(get: () => Setup, runs: number, seedBase: number): void {
  const nodeArb = () => fc.nat({ max: get().graph.nodeCount - 1 });

  for (const model of models) {
    it(`${model.id}: every route keeps the promises and the detour limit`, () => {
      const { graph, router, connected } = get();
      fc.assert(
        fc.property(pair(graph), fc.boolean(), ([a, b], long) => {
          const p = plan(router, a, b, model, undefined, long);
          if (connected) expect(p).not.toBeNull();
          if (!p) return;
          checkRoute(graph, p.normal.dirEdges, p.normal.nodes);
          checkRoute(graph, p.better.dirEdges, p.better.nodes);
          expect(p.better.timeS).toBeLessThanOrEqual(detourLimitSeconds(p.normal.timeS, long) + SLACK);
        }),
        { numRuns: runs, seed: seedBase + 1 },
      );
    });
  }

  for (const mode of MODE_IDS) {
    it(`mode ${mode}: every route keeps the promises and the detour limit, for any seed`, () => {
      const { graph, router, features, connected } = get();
      fc.assert(
        fc.property(pair(graph), fc.nat({ max: 2 ** 31 - 1 }), fc.boolean(), ([a, b], seed, long) => {
          const p = planMode(router, features, a, b, mode, seed, undefined, long);
          if (connected) expect(p).not.toBeNull();
          if (!p) return;
          checkRoute(graph, p.normal.dirEdges, p.normal.nodes);
          checkRoute(graph, p.better.dirEdges, p.better.nodes);
          expect(p.better.timeS).toBeLessThanOrEqual(detourLimitSeconds(p.normal.timeS, long) + SLACK);
          if (mode === "inconvenient") {
            // Inconvenient, not riskier.
            expect(busyCrossings(graph, p.better.dirEdges)).toBeLessThanOrEqual(busyCrossings(graph, p.normal.dirEdges));
          }
        }),
        { numRuns: runs, seed: seedBase + 2 },
      );
    });
  }

  it("stops: routes through picked stops keep the promises and the limit of the normal route through them", () => {
    const { graph, router, features, connected } = get();
    fc.assert(
      fc.property(pair(graph), fc.array(nodeArb(), { minLength: 1, maxLength: 3 }), fc.constantFrom(...MODE_IDS), fc.boolean(), ([a, b], stops, mode, long) => {
        const near = stops.filter((n) => haversineM(graph.nodeLonLat(n), graph.nodeLonLat(a)) <= MAX_PAIR_DISTANCE_M);
        const points = [a, ...near, b].filter((n, i, all) => i === 0 || n !== all[i - 1]);
        if (points.length < 2) return;
        const p = planModeVia(router, features, points, mode, 7, long);
        if (connected) expect(p).not.toBeNull();
        if (!p) return;
        checkRoute(graph, p.normal.dirEdges, p.normal.nodes);
        checkRoute(graph, p.better.dirEdges, p.better.nodes);
        for (const n of points) expect(p.better.nodes).toContain(n);
        expect(p.better.timeS).toBeLessThanOrEqual(detourLimitSeconds(p.normal.timeS, long) + SLACK);
      }),
      { numRuns: Math.ceil(runs / 5), seed: seedBase + 3 },
    );
  });

  it("workouts: every loop keeps the promises, returns to its start and fits its time", () => {
    const { graph, router, features } = get();
    fc.assert(
      fc.property(nodeArb(), fc.constantFrom(...WORKOUT_FOCUSES), fc.constantFrom(...WORKOUT_MINUTES), (node, focus, minutes) => {
        const w = planWorkout(router, features, node, minutes, focus);
        if (!w) return; // a dead end with nowhere to loop is allowed to fail
        checkRoute(graph, w.route.dirEdges, w.route.nodes);
        expect(w.route.nodes.at(-1)).toBe(node);
        expect(w.route.timeS).toBeLessThanOrEqual(loopLimitSeconds(minutes) + SLACK);
      }),
      { numRuns: Math.ceil(runs / 5), seed: seedBase + 4 },
    );
  });

  it("crawls: every crawl keeps the promises, passes its stops, fits its time and caps drinking stops", () => {
    const { graph, router, features } = get();
    fc.assert(
      fc.property(
        nodeArb(),
        fc.option(nodeArb(), { nil: null }),
        fc.constantFrom(...CRAWL_THEMES),
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom(...CRAWL_MINUTES),
        (start, end, theme, stops, minutes) => {
          const c = planCrawl(router, features, { theme, stops, minutes, start, end });
          if (!c) return; // not enough stops nearby is allowed
          checkRoute(graph, c.route.dirEdges, c.route.nodes);
          expect(c.route.timeS).toBeLessThanOrEqual(loopLimitSeconds(minutes) + SLACK);
          expect(c.route.nodes.at(-1)).toBe(end ?? start);
          for (const s of c.stops) expect(c.route.nodes).toContain(graph.tail(s.dirEdge));
          expect(c.stops.length).toBeLessThanOrEqual(theme === "art" ? 8 : 6);
        },
      ),
      { numRuns: Math.ceil(runs / 5), seed: seedBase + 5 },
    );
  });

  it("GPS art: every drawing keeps the promises and its limit, for any start, shape and length", () => {
    const { graph, router, features, index } = get();
    fc.assert(
      fc.property(nodeArb(), fc.constantFrom(...SHAPE_IDS), fc.constantFrom(...ART_LENGTHS), (node, shape, minutes) => {
        const r = drawShape(router, features, index, { shape, start: graph.nodeLonLat(node), minutes });
        if (!r) return; // some places can't fit a shape; that's allowed
        checkRoute(graph, r.route.dirEdges, r.route.nodes);
        expect(r.route.timeS).toBeLessThanOrEqual(shapeLimitSeconds(minutes) + SLACK);
      }),
      { numRuns: Math.ceil(runs / 5), seed: seedBase + 6 },
    );
  });

  it("spelled words: every walk keeps the promises and takes at most an hour, for any word and start", () => {
    const { graph, router, features, index } = get();
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    fc.assert(
      fc.property(nodeArb(), fc.array(fc.constantFrom(...chars), { minLength: 2, maxLength: 5 }), (node, letters) => {
        const out = spellWord(router, features, index, letters.join(""), graph.nodeLonLat(node));
        if (!out.ok) return; // too long or nowhere to fit is allowed
        checkRoute(graph, out.result.route.dirEdges, out.result.route.nodes);
        expect(out.result.route.timeS).toBeLessThanOrEqual(WORD_LIMIT_SECONDS + SLACK);
      }),
      { numRuns: Math.ceil(runs / 10), seed: seedBase + 7 },
    );
  });
}

function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

function setupFor(graph: Graph, connected: boolean): Setup {
  return { graph, router: new Router(graph), features: new FeatureIndex(graph), index: new NodeIndex(graph), connected };
}

describe.each(AREAS_UNDER_TEST)("safety property on %s", (area) => {
  describe("the real graph", () => {
    const get = lazy(() => setupFor(new Graph(readArea(area)), true));
    it("passes the load-time audit with no violations", () => {
      expect(get().graph.violations).toEqual([]);
    });
    planners(get, RUNS, 20261200);
  });

  for (let t = 1; t <= TAMPER_SEEDS; t++) {
    describe(`tampered copy ${t}`, () => {
      const tampered = lazy(() => tamper(area, t));
      const get = lazy(() => setupFor(tampered().graph, false));
      it("really is tampered: many forbidden ways, one-way ways and disabled edges", () => {
        const { graph, forbiddenWays, onewayWays } = tampered();
        expect(forbiddenWays).toBeGreaterThan(graph.meta.counts.ways / 20);
        expect(onewayWays).toBeGreaterThan(graph.meta.counts.ways / 30);
        expect(graph.violations.length).toBeGreaterThan(graph.edgeCount / 10);
      });
      it("the audit disables every kind of tampering: ways, gates, passages, directions, buildings", () => {
        const { graph, hasPassages } = tampered();
        const kinds = new Set(graph.violations.map((v) => v.kind));
        const expected = ["direction", "node", "through_building", "under_building", "way", ...(hasPassages ? ["passage"] : [])];
        expect([...kinds].sort()).toEqual(expected.sort());
      });
      planners(get, Math.ceil(RUNS / 5), 20261300 + 100 * t);
    });
  }
});
