/**
 * Planning worker: loads the graph once, then plans routes on request. Runs off the main thread
 * so the page never freezes. Everything happens on the device; nothing is sent anywhere.
 */
import { cityData } from "./city";
import { drawShape } from "./art/fit";
import { SHAPES } from "./art/shapes";
import { Graph, type LonLat } from "./graph/graph";
import { describeRoute, directions } from "./modes/directions";
import { FeatureIndex } from "./modes/features";
import { planMode } from "./modes/plan-mode";
import { Router, type Route } from "./router/astar";
import { NodeIndex } from "./router/snap";
import { costOfFun } from "./modes/stats";
import type { ArtRequestMsg, FromWorker, PlanRequest } from "./ui/protocol";

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

function plan(req: PlanRequest): void {
  if (!state) throw new Error("Still loading the map data.");
  const { g, router, fi, index } = state;
  const t0 = performance.now();
  const start = index.nearest(req.from as LonLat, SNAP_LIMIT_M);
  const goal = index.nearest(req.to as LonLat, SNAP_LIMIT_M);
  if (start === null) throw new Error("The start is too far from any walkable path. Try somewhere closer to a street.");
  if (goal === null) throw new Error("The end is too far from any walkable path. Try somewhere closer to a street.");
  if (start === goal) throw new Error("Start and end are the same spot. Pick somewhere further away.");
  const p = planMode(router, fi, start, goal, req.mode, req.seed);
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

self.addEventListener("message", (event: MessageEvent<PlanRequest | ArtRequestMsg>) => {
  try {
    if (event.data.type === "art") art(event.data);
    else plan(event.data);
  } catch (err) {
    post({ type: "error", id: event.data.id, message: err instanceof Error ? err.message : String(err) });
  }
});

init().catch((err: unknown) => post({ type: "fatal", message: err instanceof Error ? err.message : String(err) }));
