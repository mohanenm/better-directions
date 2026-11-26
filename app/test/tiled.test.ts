/**
 * Planning on tiles gives exactly the answers planning on the whole graph gives. Cuts a real,
 * tiled-in-production area into tiles and answers random requests of every kind three ways: on
 * the whole graph; on only the tiles the request needs (prepareRequest, as the worker does); and
 * on a loader that already holds another nearby request's tiles. Compares the whole message the
 * page would receive (routes, names, summaries, stats, directions, pins), minus the timing.
 */
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SHAPE_IDS } from "../src/art/shapes";
import { Graph, type LonLat } from "../src/graph/graph";
import { TileSource, type Loaded } from "../src/graph/tiled-source";
import { tileGraph } from "../src/graph/tiles";
import { FeatureIndex } from "../src/modes/features";
import { MODE_IDS } from "../src/modes/modes";
import { CRAWL_MINUTES, WORKOUT_FOCUSES, WORKOUT_MINUTES, type CrawlTheme } from "../src/modes/options";
import { handle, prepareRequest } from "../src/requests";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";
import type { PlanRequest, ToWorker } from "../src/ui/protocol";
import { ART_LENGTHS } from "../src/ui/url";

const AREA = process.env["TILED_AREA"] ?? "dc";
const RUNS = Number(process.env["TILED_RUNS"] ?? 12);

const buf = readFileSync(new URL(`../../data/${AREA}/graph.bin`, import.meta.url));
const g = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const whole: Loaded = { g, fi: new FeatureIndex(g), index: new NodeIndex(g), router: new Router(g) };
const cut = tileGraph(g, whole.fi.exportFeatures());
const base = JSON.parse(JSON.stringify(cut.base)) as typeof cut.base; // as the page gets it
const fetchTile = (id: string) => Promise.resolve(cut.tiles.get(id)!.slice().buffer);

// noBias: fast-check otherwise favours 0 and other edge values, which made many cases trivial.
const unbiased = (min: number, max: number) => fc.noBias(fc.double({ min, max, noNaN: true }));
/** A point near a random node, as a tap would give. */
const point = fc.tuple(fc.noBias(fc.nat({ max: g.nodeCount - 1 })), unbiased(-0.0008, 0.0008), unbiased(-0.0008, 0.0008)).map(([n, dx, dy]): LonLat => {
  const [lon, lat] = g.nodeLonLat(n);
  return [lon + dx, lat + dy];
});
/** 400 m to 2.5 km in any direction (as degrees), so trips and crawls are walks people would ask for. */
const near = fc.tuple(unbiased(400, 2500), unbiased(0, 2 * Math.PI)).map(([m, a]): [number, number] => {
  const lat = g.nodeLonLat(0)[1];
  return [(m * Math.cos(a)) / (111_320 * Math.cos((lat * Math.PI) / 180)), (m * Math.sin(a)) / 111_320];
});
/** A crawl starting at one of its own kind of stop, as people tend to (random starts often have none near). */
const crawlStart = fc.noBias(fc.nat({ max: whole.fi.crawlStops.length - 1 })).map((i): [LonLat, CrawlTheme] => {
  const stop = whole.fi.crawlStops[i]!;
  return [g.nodeLonLat(g.tail(stop.dirEdge)), stop.theme];
});
/** The path nearest to a point offset from p, so generated walks start and end somewhere walkable. */
const shift = (p: LonLat, [dx, dy]: [number, number]): LonLat => {
  const n = whole.index.nearest([p[0] + dx, p[1] + dy], 3000);
  return n === null ? p : g.nodeLonLat(n);
};

/** Requests per kind, and how many got a real answer on the whole graph (not an error). */
const tally: Record<string, { asked: number; answered: number }> = {};

/** The page's answer, without the time it took. */
function answer(l: Loaded, msg: ToWorker): unknown {
  const t = (tally[msg.type] ??= { asked: 0, answered: 0 });
  if (l === whole) t.asked++;
  try {
    const out = handle(l, msg) as { result?: { ms?: number } };
    if (out.result) delete out.result.ms;
    if (l === whole) t.answered++;
    return out;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

async function sameEverywhere(msg: ToWorker, seed: ToWorker): Promise<void> {
  const expected = answer(whole, msg);
  const fresh = new TileSource(base, fetchTile);
  expect(answer(await prepareRequest(fresh, msg), msg)).toEqual(expected);
  // Already holding another request's tiles: the answer mustn't depend on what's loaded beyond.
  const busy = new TileSource(base, fetchTile);
  await prepareRequest(busy, seed);
  expect(answer(await prepareRequest(busy, msg), msg)).toEqual(expected);
}

const trip = (from: LonLat, to: LonLat): PlanRequest => ({ type: "plan", id: 0, from, to, fromName: "A", toName: "B", mode: "parks", seed: 1, stops: [], long: false });

describe(`tiled planning answers as the whole graph does (${AREA})`, { timeout: 3_600_000 }, () => {
  it("cuts the area into tiles that join back into the whole graph", async () => {
    const all = new TileSource(base, fetchTile);
    await all.ensure(base.tiles);
    const l = all.current();
    expect([l.g.nodeCount, l.g.edgeCount, l.g.violations.length]).toEqual([g.nodeCount, g.edgeCount, 0]);
    expect(l.fi.parks).toEqual(whole.fi.parks);
  });

  it("answers the same trips, in every mode, with stops and longer walks", async () => {
    await fc.assert(
      fc.asyncProperty(point, near, fc.array(near, { maxLength: 2 }), fc.constantFrom(...MODE_IDS), fc.nat({ max: 999 }), fc.boolean(), near, async (a, toB, toStops, mode, seed, long, toOther) => {
        const msg: ToWorker = { ...trip(a, shift(a, toB)), mode, seed: seed + 1, long, stops: toStops.map((d) => shift(a, d)) };
        await sameEverywhere(msg, trip(shift(a, toOther), shift(a, [-toOther[0], -toOther[1]])));
      }),
      { numRuns: RUNS, seed: 20261126 },
    );
  });

  it("answers the same crawls (loops and to an end) and workouts", async () => {
    await fc.assert(
      fc.asyncProperty(point, crawlStart, fc.option(near, { nil: null }), fc.integer({ min: 3, max: 6 }), fc.constantFrom(...CRAWL_MINUTES), fc.constantFrom(...WORKOUT_FOCUSES), fc.constantFrom(...WORKOUT_MINUTES), near, async (a, [c, theme], toEnd, stops, crawlMin, focus, workMin, toOther) => {
        const other = trip(shift(a, toOther), a);
        await sameEverywhere({ type: "crawl", id: 0, start: c, end: toEnd ? shift(c, toEnd) : null, fromName: "A", toName: "B", theme, stops, minutes: crawlMin, skip: [] }, other);
        await sameEverywhere({ type: "workout", id: 0, start: a, fromName: "A", focus, minutes: workMin }, other);
      }),
      { numRuns: RUNS, seed: 20261127 },
    );
  });

  it("draws the same shapes and spells the same words", async () => {
    await fc.assert(
      fc.asyncProperty(point, fc.constantFrom(...SHAPE_IDS), fc.constantFrom(...ART_LENGTHS), fc.constantFrom("HI", "DC", "ADA", "OAK"), near, async (a, shape, minutes, word, toOther) => {
        const other = trip(shift(a, toOther), a);
        await sameEverywhere({ type: "art", id: 0, start: a, fromName: "A", shape, minutes }, other);
        await sameEverywhere({ type: "spell", id: 0, start: a, fromName: "A", word }, other);
      }),
      { numRuns: Math.max(4, Math.round(RUNS / 2)), seed: 20261128 },
    );
  });

  it("compared real answers, not just errors, for every kind of request", () => {
    // Guards against the test passing vacuously, with both sides failing the same way.
    for (const kind of ["plan", "crawl", "workout", "art", "spell"]) {
      const t = tally[kind]!;
      expect(t.answered / t.asked, `${kind}: ${t.answered} of ${t.asked} answered`).toBeGreaterThanOrEqual(0.4);
    }
  });
});
