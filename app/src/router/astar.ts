/**
 * A* over directed edges (state = an edge walked in one direction), so turn-aware cost models
 * see the edge they arrived on. Buffers are reused across queries.
 *
 * Determinism: the heap breaks ties on state id, and costs are pure functions of their inputs,
 * so the same query on the same graph always returns the same route.
 */

import type { Graph } from "../graph/graph";
import { haversineM } from "./geometry";
import { MinHeap } from "./heap";
import { MAX_SPEED_MS, edgeTimeSeconds } from "./time";

export interface CostModel {
  readonly id: string;
  /** Whether edgeCost looks at prevDirEdge (documentation; the search always passes it). */
  readonly turnAware: boolean;
  /**
   * A lower bound on cost per second of walking time, over every edge. The heuristic multiplies
   * straight-line time by this, so it must hold for A* to find the cheapest route. The router
   * throws if a model breaks it.
   */
  readonly minCostPerSecond: number;
  /** Cost of walking `dirEdge` (taking `timeS` seconds) after `prevDirEdge` (-1 at the start). */
  edgeCost(g: Graph, dirEdge: number, timeS: number, prevDirEdge: number): number;
}

export const NORMAL: CostModel = Object.freeze({
  id: "normal",
  turnAware: false,
  minCostPerSecond: 1,
  edgeCost: (_g: Graph, _d: number, timeS: number) => timeS,
});

export interface Route {
  /** Directed edges: edge * 2 + (forward ? 0 : 1). */
  dirEdges: number[];
  nodes: number[];
  timeS: number;
  lengthM: number;
  cost: number;
}

export interface RouteOptions {
  /** Prune any partial route that can't finish within this many seconds of walking. */
  maxTimeS?: number;
}

export class CostModelError extends Error {}

export class Router {
  readonly g: Graph;
  private readonly timeS: Float32Array;
  private readonly cost: Float64Array;
  private readonly time: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly hCache: Float64Array;
  private readonly hSeen: Uint32Array;
  private readonly heap = new MinHeap(4096);
  private gen = 0;

  constructor(g: Graph) {
    this.g = g;
    const states = g.edgeCount * 2;
    this.timeS = new Float32Array(states);
    for (let e = 0; e < g.edgeCount; e++) {
      this.timeS[e * 2] = edgeTimeSeconds(g, e, true);
      this.timeS[e * 2 + 1] = edgeTimeSeconds(g, e, false);
    }
    this.cost = new Float64Array(states);
    this.time = new Float64Array(states);
    this.parent = new Int32Array(states);
    this.seen = new Uint32Array(states);
    this.closed = new Uint32Array(states);
    this.hCache = new Float64Array(g.nodeCount);
    this.hSeen = new Uint32Array(g.nodeCount);
  }

  /** Walking time of a directed edge in seconds. */
  edgeTime(dirEdge: number): number {
    return this.timeS[dirEdge]!;
  }

  route(start: number, goal: number, model: CostModel, opts: RouteOptions = {}): Route | null {
    const g = this.g;
    if (start === goal) return { dirEdges: [], nodes: [start], timeS: 0, lengthM: 0, cost: 0 };
    if (!(model.minCostPerSecond > 0)) throw new CostModelError(`${model.id}: minCostPerSecond must be > 0`);

    this.gen++;
    const gen = this.gen;
    const heap = this.heap;
    heap.clear();
    const goalPt = g.nodeLonLat(goal);
    const maxTime = opts.maxTimeS ?? Infinity;
    const hTime = (node: number): number => {
      if (this.hSeen[node] !== gen) {
        this.hSeen[node] = gen;
        this.hCache[node] = haversineM(g.nodeLonLat(node), goalPt) / MAX_SPEED_MS;
      }
      return this.hCache[node]!;
    };

    const relax = (d: number, prev: number, baseCost: number, baseTime: number): void => {
      const e = d >>> 1;
      // Query-time safety re-check: only directions the load-time audit allowed.
      if (!(g.allowedDirs[e]! & (d & 1 ? 2 : 1))) return;
      const t = this.timeS[d]!;
      const c = model.edgeCost(g, d, t, prev);
      if (!(c < Infinity)) return;
      if (c < model.minCostPerSecond * t - 1e-9) {
        throw new CostModelError(`${model.id}: edge cost ${c} is below minCostPerSecond × time`);
      }
      const nt = baseTime + t;
      const head = g.head(d);
      if (nt + hTime(head) > maxTime) return;
      const nc = baseCost + c;
      if (this.seen[d] !== gen || nc < this.cost[d]!) {
        this.seen[d] = gen;
        this.cost[d] = nc;
        this.time[d] = nt;
        this.parent[d] = prev;
        heap.push(nc + hTime(head) * model.minCostPerSecond, d);
      }
    };

    for (let i = g.outStart[start]!; i < g.outStart[start + 1]!; i++) relax(g.outDirEdge[i]!, -1, 0, 0);

    while (heap.size > 0) {
      const d = heap.pop();
      if (this.closed[d] === gen) continue;
      this.closed[d] = gen;
      const head = g.head(d);
      if (head === goal) return this.reconstruct(d);
      const c0 = this.cost[d]!;
      const t0 = this.time[d]!;
      for (let i = g.outStart[head]!; i < g.outStart[head + 1]!; i++) {
        const d2 = g.outDirEdge[i]!;
        if (d2 === (d ^ 1)) continue; // no U-turn back along the same edge
        if (this.closed[d2] !== gen) relax(d2, d, c0, t0);
      }
    }
    return null;
  }

  private reconstruct(last: number): Route {
    const g = this.g;
    const dirEdges: number[] = [];
    for (let d = last; d !== -1; d = this.parent[d]!) dirEdges.push(d);
    dirEdges.reverse();
    const nodes = [g.tail(dirEdges[0]!)];
    let lengthM = 0;
    for (const d of dirEdges) {
      nodes.push(g.head(d));
      lengthM += g.s.edge_length_m[d >>> 1]!;
    }
    return { dirEdges, nodes, timeS: this.time[last]!, lengthM, cost: this.cost[last]! };
  }
}
