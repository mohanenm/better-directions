/** Benchmark: load the Lyon graph and time random routes. Run: npm run bench */
import { readFileSync } from "node:fs";
import { it } from "vitest";
import { Graph } from "../src/graph/graph";
import { NORMAL, Router } from "../src/router/astar";
import { haversineM } from "../src/router/geometry";
import { plan } from "../src/router/planner";
import { mulberry32 } from "../src/router/rng";

it("routes Lyon", () => {
const path = process.env["GRAPH"] ?? "data/lyon/graph.bin";
const buf = readFileSync(path);
let t0 = performance.now();
const g = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const loadMs = performance.now() - t0;
t0 = performance.now();
const router = new Router(g);
const routerMs = performance.now() - t0;
console.log(`load+audit ${loadMs.toFixed(0)} ms, router setup ${routerMs.toFixed(0)} ms, violations ${g.violations.length}`);

const rand = mulberry32(42);
const times: number[] = [];
const dists: number[] = [];
for (let i = 0; i < 200; i++) {
  const a = Math.floor(rand() * g.nodeCount);
  const b = Math.floor(rand() * g.nodeCount);
  const d = haversineM(g.nodeLonLat(a), g.nodeLonLat(b));
  if (d < 500 || d > 3000) { i--; continue; } // typical walk: 0.5-3 km
  const s = performance.now();
  const r = router.route(a, b, NORMAL);
  times.push(performance.now() - s);
  dists.push(d);
  if (!r) throw new Error("no route");
}
times.sort((x, y) => x - y);
const q = (p: number) => times[Math.floor(p * (times.length - 1))]!.toFixed(1);
console.log(`normal route, 0.5-3 km: median ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${q(1)} ms`);
const scenic = { id: "x", turnAware: false, minCostPerSecond: 0.3, edgeCost: (_g: Graph, d: number, t: number) => t * (0.3 + ((d * 2654435761) >>> 0) / 2 ** 32 * 2.7) };
const planTimes: number[] = [];
for (let i = 0; i < 40; i++) {
  const a = Math.floor(rand() * g.nodeCount), b = Math.floor(rand() * g.nodeCount);
  const d = haversineM(g.nodeLonLat(a), g.nodeLonLat(b));
  if (d < 500 || d > 3000) { i--; continue; }
  const s = performance.now();
  plan(router, a, b, scenic);
  planTimes.push(performance.now() - s);
}
planTimes.sort((x, y) => x - y);
const pq = (p: number) => planTimes[Math.floor(p * (planTimes.length - 1))]!.toFixed(1);
console.log(`full plan (normal + random-weights better), 0.5-3 km: median ${pq(0.5)} ms, p90 ${pq(0.9)} ms, max ${pq(1)} ms`);
});
