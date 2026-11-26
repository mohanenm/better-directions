/**
 * Planning on tiles gives exactly the routes planning on the whole graph gives. Cuts a real area
 * into tiles and plans random requests of every kind both ways: on the whole graph, and on only
 * the tiles the request needs (from a fresh loader, and from one that already has other tiles).
 * Routes are compared node by node in whole-graph numbering, with their names and summaries.
 */
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeGraph } from "../src/graph/format";
import { Graph, type LonLat } from "../src/graph/graph";
import { TileSource, type Loaded } from "../src/graph/tiled-source";
import { tileGraph, wholeBase, type BaseFile } from "../src/graph/tiles";
import { planCrawl } from "../src/modes/crawl";
import { FeatureIndex } from "../src/modes/features";
import { MODE_IDS } from "../src/modes/modes";
import { CRAWL_MINUTES, CRAWL_THEMES, WORKOUT_FOCUSES, WORKOUT_MINUTES } from "../src/modes/options";
import { planModeVia } from "../src/modes/plan-mode";
import { planWorkout } from "../src/modes/workout";
import { Router, type Route } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";
import { drawShape } from "../src/art/fit";
import { SHAPE_IDS } from "../src/art/shapes";
import { spellWord } from "../src/art/word";
import { ART_LENGTHS } from "../src/ui/url";
import { GPS_ART_MAX_SECONDS, LOOP_MAX_SECONDS, loopCapSeconds } from "../src/safety/limits";

const AREA = process.env["TILED_AREA"] ?? "lyon";
const RUNS = Number(process.env["TILED_RUNS"] ?? 25);

const buf = readFileSync(new URL(`../../data/${AREA}/graph.bin`, import.meta.url));
const decoded = decodeGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const g = new Graph(decoded);
const whole: Loaded = { g, fi: new FeatureIndex(g), index: new NodeIndex(g), router: new Router(g) };
const cut = tileGraph(decoded, whole.fi.exportFeatures());
// As the page gets it: the base file through JSON, tiles as bytes.
const base = JSON.parse(JSON.stringify(cut.base)) as BaseFile;
const fetchTile = (id: string) => {
  const bytes = cut.tiles.get(id)!;
  return Promise.resolve(bytes.slice().buffer);
};
const shared = new TileSource(base, fetchTile); // accumulates tiles across requests, like the page

/** A point near a random node, as a tap would give. */
const point = fc.tuple(fc.nat({ max: g.nodeCount - 1 }), fc.double({ min: -0.0008, max: 0.0008, noNaN: true }), fc.double({ min: -0.0008, max: 0.0008, noNaN: true }))
  .map(([n, dx, dy]): LonLat => {
    const [lon, lat] = g.nodeLonLat(n);
    return [lon + dx, lat + dy];
  });

/** A route as whole-graph node numbers, for comparing across graphs. */
const globalNodes = (l: Loaded, r: Route) => r.nodes.map((n) => (l.g.tiled ? l.g.tiled.nodeGlobal[n]! : n));

async function both<T>(prepare: (src: TileSource) => Promise<Loaded>, plan: (l: Loaded) => T, summary: (l: Loaded, t: T) => unknown): Promise<void> {
  const expected = summary(whole, plan(whole));
  for (const src of [new TileSource(base, fetchTile), shared]) {
    const l = await prepare(src);
    expect(summary(l, plan(l))).toEqual(expected);
  }
}

describe(`tiled planning matches the whole graph (${AREA})`, { timeout: 1_800_000 }, () => {
  it("cuts the area into tiles that hold everything", () => {
    const edges = new Set<number>();
    for (const bytes of cut.tiles.values()) {
      const t = new DataView(bytes.buffer);
      expect(t.byteLength).toBeGreaterThan(12);
    }
    const all = new TileSource(base, fetchTile);
    return all.ensure(Object.keys(base.tiles)).then(() => {
      const l = all.current();
      for (let e = 0; e < l.g.edgeCount; e++) edges.add(l.g.tiled!.edgeGlobal[e]!);
      expect(edges.size).toBe(g.edgeCount);
      expect(l.g.nodeCount).toBe(g.nodeCount);
      expect(l.g.violations).toEqual([]);
    });
  });

  it("loads a small area whole, as built, working out its own features", async () => {
    const src = new TileSource(wholeBase(decoded.meta), () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
    await src.preloadIfWhole();
    const l = src.current();
    expect([l.g.nodeCount, l.g.edgeCount, l.g.tiled]).toEqual([g.nodeCount, g.edgeCount, undefined]);
    expect(l.fi.parks).toEqual(whole.fi.parks);
    expect(await src.prepareTrip([g.nodeLonLat(0), g.nodeLonLat(1)], false)).toBe(l); // nothing more to load
  });

  it("plans the same trips, in every mode, with and without stops and longer walks", async () => {
    await fc.assert(
      fc.asyncProperty(point, point, fc.array(point, { maxLength: 2 }), fc.constantFrom(...MODE_IDS), fc.nat({ max: 999 }), fc.boolean(), async (a, b, stops, mode, seed, long) => {
        const pts = [a, ...stops, b];
        const nodesIn = (l: Loaded) => pts.map((p) => l.index.nearest(p, 300));
        await both(
          (src) => src.prepareTrip(pts, long),
          (l) => {
            const nodes = nodesIn(l);
            if (nodes.includes(null)) return null;
            const distinct = nodes.filter((n, i) => i === 0 || n !== nodes[i - 1]) as number[];
            return distinct.length < 2 ? null : planModeVia(l.router, l.fi, distinct, mode, seed + 1, long);
          },
          (l, p) => (p ? { nodes: globalNodes(l, p.better), normal: globalNodes(l, p.normal), name: p.name, summary: p.summary, strategy: p.strategy } : null),
        );
      }),
      { numRuns: RUNS, seed: 20261126 },
    );
  });

  it("plans the same crawls and workouts", async () => {
    await fc.assert(
      fc.asyncProperty(point, fc.option(point, { nil: null }), fc.constantFrom(...CRAWL_THEMES), fc.integer({ min: 3, max: 6 }), fc.constantFrom(...CRAWL_MINUTES), fc.constantFrom(...WORKOUT_FOCUSES), fc.constantFrom(...WORKOUT_MINUTES), async (a, end, theme, count, crawlMin, focus, workMin) => {
        await both(
          (src) => (end ? src.prepareTrip([a, end], false) : src.prepareLoop(a, loopCapSeconds(crawlMin), true)),
          (l) => {
            const s = l.index.nearest(a, 300);
            const e = end ? l.index.nearest(end, 300) : null;
            if (s === null || (end && e === null)) return null;
            return planCrawl(l.router, l.fi, { theme, stops: count, minutes: crawlMin, start: s, end: e });
          },
          (l, c) => (c ? { nodes: globalNodes(l, c.route), name: c.name, summary: c.summary } : null),
        );
        await both(
          (src) => src.prepareLoop(a, loopCapSeconds(workMin), true),
          (l) => {
            const s = l.index.nearest(a, 300);
            return s === null ? null : planWorkout(l.router, l.fi, s, workMin, focus);
          },
          (l, w) => (w ? { nodes: globalNodes(l, w.route), name: w.name, summary: w.summary } : null),
        );
      }),
      { numRuns: Math.max(10, Math.round(RUNS / 2)), seed: 20261127 },
    );
  });

  it("draws the same shapes and spells the same words", async () => {
    await fc.assert(
      fc.asyncProperty(point, fc.constantFrom(...SHAPE_IDS), fc.constantFrom(...ART_LENGTHS), fc.constantFrom("HI", "DC", "ADA", "LYON"), async (a, shape, minutes, word) => {
        // As the worker loads them: an open walk from the start, with the wider margin.
        await both(
          (src) => src.prepareLoop(a, Math.min(GPS_ART_MAX_SECONDS, loopCapSeconds(minutes)), false, 800),
          (l) => drawShape(l.router, l.fi, l.index, { shape, start: a, minutes }),
          (l, r) => (r ? { nodes: globalNodes(l, r.route), likeness: r.likeness } : null),
        );
        await both(
          (src) => src.prepareLoop(a, LOOP_MAX_SECONDS, false, 800),
          (l) => spellWord(l.router, l.fi, l.index, word, a),
          (l, out) => (out.ok ? { nodes: globalNodes(l, out.result.route), likeness: out.result.likeness } : out.reason),
        );
      }),
      { numRuns: Math.max(6, Math.round(RUNS / 4)), seed: 20261128 },
    );
  });
});
