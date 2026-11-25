/**
 * Planning worker: loads the graph once, then plans routes on request. Runs off the main thread
 * so the page never freezes. Everything happens on the device; nothing is sent anywhere.
 */
import { cityData } from "./city";
import { drawShape } from "./art/fit";
import { initials, isSpellable, normaliseWord } from "./art/font";
import { heightFor, spellWord } from "./art/word";
import { SHAPES } from "./art/shapes";
import { Graph, type LonLat } from "./graph/graph";
import { describeRoute, directions } from "./modes/directions";
import { FeatureIndex } from "./modes/features";
import { planCrawl } from "./modes/crawl";
import { planModeVia } from "./modes/plan-mode";
import { planWorkout, WORKOUT_FOCUSES, WORKOUT_MINUTES } from "./modes/workout";
import { haversineM } from "./router/geometry";
import { Router, type Route } from "./router/astar";
import { NodeIndex } from "./router/snap";
import { costOfFun } from "./modes/stats";
import type { ArtRequestMsg, CrawlRequest, FromWorker, Pin, PlanRequest, SpellRequest, ToWorker, WorkoutRequest } from "./ui/protocol";

const SNAP_LIMIT_M = 300;

let state: { g: Graph; router: Router; fi: FeatureIndex; index: NodeIndex } | null = null;
const post = (msg: FromWorker) => self.postMessage(msg);

async function init(): Promise<void> {
  const t0 = performance.now();
  const res = await fetch(cityData("graph.bin"));
  if (!res.ok) throw new Error(`Couldn't load the map data (${res.status}).`);
  const buffer = await res.arrayBuffer();
  const t1 = performance.now();
  const g = Graph.fromBuffer(buffer);
  const t2 = performance.now();
  state = { g, router: new Router(g), fi: new FeatureIndex(g), index: new NodeIndex(g) };
  const t3 = performance.now();
  const timings = { fetchMs: Math.round(t1 - t0), decodeAuditMs: Math.round(t2 - t1), indexMs: Math.round(t3 - t2), graphBytes: buffer.byteLength };
  post({
    type: "ready",
    info: {
      city: g.meta.city.name,
      bbox: g.meta.city.bbox,
      attribution: g.meta.attribution,
      terrainAttribution: g.meta.terrain.attribution ?? "",
      dataAsOf: g.meta.source.data_as_of ?? "",
      violations: g.violations.length,
      timings,
    },
  });
}

function line(g: Graph, route: Route): [number, number][] {
  const pts: [number, number][] = [];
  for (const d of route.dirEdges) {
    const edgePts = g.edgePoints(d >>> 1, (d & 1) === 0);
    pts.push(...(pts.length ? edgePts.slice(1) : edgePts));
  }
  if (!pts.length) pts.push(g.nodeLonLat(route.nodes[0]!));
  return pts;
}

const PARK_PIN_RADIUS_M = 300;
const MAX_STOPS = 3;

/** Parks the route visits (numbered in order) and others within PARK_PIN_RADIUS_M of it. */
function parkPins(route: Route): Pin[] {
  const { g, fi } = state!;
  const order: number[] = [];
  for (const d of route.dirEdges) {
    const park = g.s.edge_park[d >>> 1]!;
    if (park && !order.includes(park)) order.push(park);
  }
  const samples = route.nodes.filter((_, i) => i % 4 === 0).map((n) => g.nodeLonLat(n));
  const pins: Pin[] = [];
  for (const park of fi.parks) {
    const at: [number, number] = [fi.midLon[park.dirEdge >>> 1]!, fi.midLat[park.dirEdge >>> 1]!];
    const visited = order.indexOf(park.area) + 1;
    if (!visited && !samples.some((p) => haversineM(p, at) <= PARK_PIN_RADIUS_M)) continue;
    const hours = g.area(park.area)?.opening_hours ?? "";
    pins.push({ kind: "park", at, name: park.name, number: visited, detail: hours ? `May close outside ${hours}.` : "" });
  }
  return pins.sort((a, b) => (a.number || 99) - (b.number || 99) || a.name.localeCompare(b.name));
}

function snap(point: [number, number], what: string): number {
  const n = state!.index.nearest(point as LonLat, SNAP_LIMIT_M);
  if (n === null) throw new Error(`The ${what} is too far from any walkable path. Try somewhere closer to a street.`);
  return n;
}

function plan(req: PlanRequest): void {
  if (!state) throw new Error("Still loading the map data.");
  const { g, router, fi } = state;
  const t0 = performance.now();
  const start = snap(req.from, "start");
  const goal = snap(req.to, "end");
  const stops = req.stops.slice(0, MAX_STOPS).map((p, i) => snap(p, `stop ${i + 1}`));
  const points = [start, ...stops, goal].filter((n, i, all) => i === 0 || n !== all[i - 1]);
  if (points.length < 2) throw new Error("Start and end are the same spot. Pick somewhere further away.");
  const p = planModeVia(router, fi, points, req.mode, req.seed);
  if (!p) throw new Error("No walking route found between those points.");
  post({
    type: "plan",
    id: req.id,
    result: {
      mode: p.mode,
      seed: p.seed,
      from: g.nodeLonLat(start),
      to: g.nodeLonLat(goal),
      normal: line(g, p.normal),
      better: line(g, p.better),
      normalStats: p.normalStats,
      betterStats: p.betterStats,
      capMinutes: Math.round(p.capSeconds / 60),
      summary: p.summary,
      name: p.name,
      steps: directions(fi, p, req.fromName, req.toName),
      strategy: p.strategy,
      pins: parkPins(p.better),
      ms: Math.round(performance.now() - t0),
    },
  });
}

function art(req: ArtRequestMsg): void {
  if (!state) throw new Error("Still loading the map data.");
  const { g, router, fi, index } = state;
  const t0 = performance.now();
  if (!(req.shape in SHAPES)) throw new Error("Unknown shape.");
  const minutes = Math.max(15, Math.min(55, req.minutes));
  const r = drawShape(router, fi, index, { shape: req.shape, start: req.start as LonLat, minutes });
  if (!r) throw new Error("Couldn't fit that shape around here. Try another start point, shape or length.");
  const shape = SHAPES[req.shape];
  post({
    type: "art",
    id: req.id,
    result: {
      shape: req.shape,
      label: shape.label,
      minutes,
      start: g.nodeLonLat(r.route.nodes[0]!),
      line: line(g, r.route),
      template: r.template,
      likeness: r.likeness,
      meanErrorM: r.meanErrorM,
      maxErrorM: r.maxErrorM,
      stats: costOfFun(fi, r.route),
      steps: describeRoute(fi, r.route, {
        quips: "art",
        seed: r.route.dirEdges.length,
        fromName: req.fromName,
        arriveText: shape.closed ? `Back where you started: ${shape.label.toLowerCase()} complete.` : `${shape.label}: done.`,
      }),
      ms: Math.round(performance.now() - t0),
    },
  });
}

function workout(req: WorkoutRequest): void {
  if (!state) throw new Error("Still loading the map data.");
  const { g, router, fi } = state;
  const t0 = performance.now();
  if (!WORKOUT_FOCUSES.includes(req.focus) || !(WORKOUT_MINUTES as readonly number[]).includes(req.minutes)) throw new Error("Unknown workout.");
  const start = snap(req.start, "start");
  const w = planWorkout(router, fi, start, req.minutes, req.focus);
  if (!w) throw new Error("Couldn't make a loop from here. Try another start.");
  const s = w.stats;
  const statItems: [string, string][] = [
    ["Walk", `${Math.max(1, Math.round(s.timeS / 60))} min · ${(s.lengthM / 1000).toFixed(1)} km`],
    ["Staircases", String(s.staircases)],
    ["Steps up", s.stepsUp ? String(s.stepsUp) : "0"],
    ["Climb", `${Math.round(s.climbM)} m`],
  ];
  post({
    type: "tour",
    id: req.id,
    result: {
      kind: "workout",
      start: g.nodeLonLat(start),
      end: g.nodeLonLat(start),
      line: line(g, w.route),
      name: w.name,
      summary: w.summary,
      stats: s,
      statItems,
      notes: w.notes,
      pins: [],
      steps: describeRoute(fi, w.route, { quips: "workout", seed: start, fromName: req.fromName, arriveText: "Back where you started." }),
      ms: Math.round(performance.now() - t0),
    },
  });
}

const CRAWL_KIND_LABEL: Record<string, string> = {
  artwork: "Artwork", gallery: "Gallery", museum: "Museum", pub: "Pub", bar: "Bar", brewery: "Brewery",
  wine_bar: "Wine bar", winery: "Winery", wine_shop: "Wine shop",
};

function crawl(req: CrawlRequest): void {
  if (!state) throw new Error("Still loading the map data.");
  const { g, router, fi } = state;
  const t0 = performance.now();
  const start = snap(req.start, "start");
  const end = req.end ? snap(req.end, "end") : null;
  const c = planCrawl(router, fi, { theme: req.theme, stops: req.stops, minutes: req.minutes, start, end, skip: req.skip });
  if (!c) throw new Error("Not enough stops of that kind within reach. Try a longer walk or another start.");
  const s = c.stats;
  const statItems: [string, string][] = [
    ["Stops", String(c.stops.length)],
    ["Walk", `${Math.max(1, Math.round(s.timeS / 60))} min · ${(s.lengthM / 1000).toFixed(1)} km`],
    ["Longest walk between stops", `${Math.round(c.longestLegM / 10) * 10} m`],
  ];
  const pins: Pin[] = c.stops.map((stop, i) => ({
    kind: "stop",
    at: [fi.midLon[stop.edge]!, fi.midLat[stop.edge]!],
    name: stop.name,
    number: i + 1,
    detail: [CRAWL_KIND_LABEL[stop.kind], c.stopNotes[i] || (stop.openingHours ? `Open ${stop.openingHours}.` : "")].filter(Boolean).join(". "),
    stopIndex: stop.index,
  }));
  post({
    type: "tour",
    id: req.id,
    result: {
      kind: "crawl",
      start: g.nodeLonLat(start),
      end: g.nodeLonLat(end ?? start),
      line: line(g, c.route),
      name: c.name,
      summary: c.summary,
      stats: s,
      statItems,
      notes: c.notes,
      pins,
      steps: describeRoute(fi, c.route, {
        quips: "crawl",
        seed: start,
        fromName: req.fromName,
        arriveText: end === null ? "Back where you started." : `You're at ${req.toName}.`,
        stops: c.stops.map((stop, i) => ({ node: g.tail(stop.dirEdge), label: `Stop ${i + 1}: ${stop.name}` })),
      }),
      ms: Math.round(performance.now() - t0),
    },
  });
}

class SpellError extends Error {
  constructor(message: string, readonly suggestion?: string) {
    super(message);
  }
}

/** The longest prefix of initials (or letters) that fits an hour, as a suggestion. */
function shorterWord(word: string): string | undefined {
  for (let n = 4; n >= 2; n--) {
    const s = initials(word, n);
    if (isSpellable(s) && heightFor(s) !== null && s !== word) return s;
  }
  return undefined;
}

function spell(req: SpellRequest): void {
  if (!state) throw new Error("Still loading the map data.");
  const { g, router, fi, index } = state;
  const t0 = performance.now();
  const word = normaliseWord(req.word);
  if (!isSpellable(word)) throw new SpellError("Use 2 to 10 letters or digits.");
  const out = spellWord(router, fi, index, word, req.start as LonLat);
  if (!out.ok) {
    if (out.reason === "too-long") {
      const s = shorterWord(word);
      throw new SpellError(`That's too long to walk in an hour${s ? `. Try ${s}` : ""}.`, s);
    }
    throw new SpellError("Couldn't fit that word around here. Try another start, or fewer letters.", shorterWord(word));
  }
  const r = out.result;
  post({
    type: "spell",
    id: req.id,
    result: {
      word,
      start: g.nodeLonLat(r.route.nodes[0]!),
      end: g.nodeLonLat(r.route.nodes.at(-1)!),
      strokeLines: r.strokeLines,
      penUpLines: r.penUpLines,
      template: r.template,
      likeness: r.likeness,
      letters: r.letters.map((l) => ({ char: l.char, likeness: l.likeness })),
      heightM: r.heightM,
      stats: costOfFun(fi, r.route),
      steps: describeRoute(fi, r.route, {
        quips: "art",
        seed: r.route.dirEdges.length,
        fromName: req.fromName,
        arriveText: "That's the last stroke.",
        stops: r.letters.map((l, i) => ({ node: l.startNode, label: `Letter ${i + 1} (${l.char}) starts here` })),
      }),
      ms: Math.round(performance.now() - t0),
    },
  });
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  try {
    const msg = event.data;
    if (msg.type === "art") art(msg);
    else if (msg.type === "workout") workout(msg);
    else if (msg.type === "crawl") crawl(msg);
    else if (msg.type === "spell") spell(msg);
    else plan(msg);
  } catch (err) {
    const suggestion = err instanceof SpellError ? err.suggestion : undefined;
    post({ type: "error", id: event.data.id, message: err instanceof Error ? err.message : String(err), ...(suggestion ? { suggestion } : {}) });
  }
});

init().catch((err: unknown) => post({ type: "fatal", message: err instanceof Error ? err.message : String(err) }));
