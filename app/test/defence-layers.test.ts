/**
 * Each of the browser's safety layers, tested on its own. The load-time audit decides which edges
 * and directions are allowed. The adjacency list holds only those. The search re-checks them as it
 * goes. assertRouteSafe re-checks every finished route from the raw tags. On a graph that already
 * passes, a later layer can't fail, so removing one would go unnoticed by routing tests. These
 * tests break the layers before it on purpose.
 */
import { describe, expect, it } from "vitest";
import { Graph } from "../src/graph/graph";
import { NORMAL, Router, type Route } from "../src/router/astar";
import { assertRouteSafe, RouteSafetyError } from "../src/router/verify";
import { decodeFixture, nodeAt } from "./helpers";

const fresh = () => new Graph(decodeFixture("minitown.bin"));

/** A route along Second Street and the diagonal, from (0,0) to (300,100). */
function sampleRoute(g: Graph): Route {
  const r = new Router(g).route(nodeAt(g, 0, 0), nodeAt(g, 300, 100), NORMAL);
  expect(r).not.toBeNull();
  expect(r!.dirEdges.length).toBeGreaterThan(1);
  return r!;
}

describe("assertRouteSafe, the last check on every route", () => {
  it("passes a route the router found", () => {
    const g = fresh();
    expect(() => assertRouteSafe(g, sampleRoute(g))).not.toThrow();
  });

  it("refuses a route over its time limit", () => {
    const g = fresh();
    const r = sampleRoute(g);
    expect(() => assertRouteSafe(g, r, r.timeS - 1)).toThrow(RouteSafetyError);
  });

  it("refuses a route with a gap in it", () => {
    const g = fresh();
    const r = sampleRoute(g);
    const gappy = { ...r, dirEdges: [r.dirEdges[0]!, ...r.dirEdges.slice(2)], nodes: [r.nodes[0]!, ...r.nodes.slice(2)] };
    expect(() => assertRouteSafe(g, gappy)).toThrow(RouteSafetyError);
  });

  it("refuses an edge whose way became private after the audit ran", () => {
    const g = fresh();
    const r = sampleRoute(g);
    const w = g.s.edge_way[r.dirEdges[0]! >>> 1]!;
    g.meta.tagsets.push({ ...g.wayTags(w), access: "private" });
    g.s.way_tagset[w] = g.meta.tagsets.length - 1;
    expect(() => assertRouteSafe(g, r)).toThrow(/excluded way/);
  });

  it("refuses a node that became a locked gate after the audit ran", () => {
    const g = fresh();
    const r = sampleRoute(g);
    g.meta.node_tagsets.push({ barrier: "gate", locked: "yes" });
    g.s.node_tagset[r.nodes[1]!] = g.meta.node_tagsets.length - 1;
    expect(() => assertRouteSafe(g, r)).toThrow(/excluded node/);
  });

  it("refuses an edge walked against its one-way tag", () => {
    const g = fresh();
    const r = sampleRoute(g);
    const d = r.dirEdges[0]!;
    const w = g.s.edge_way[d >>> 1]!;
    g.meta.tagsets.push({ ...g.wayTags(w), "oneway:foot": d & 1 ? "yes" : "-1" });
    g.s.way_tagset[w] = g.meta.tagsets.length - 1;
    expect(() => assertRouteSafe(g, r)).toThrow(/wrong way/);
  });

  it("refuses an edge the audit disabled, even if its tags look fine", () => {
    const g = fresh();
    const r = sampleRoute(g);
    (g.allowedDirs as Uint8Array)[r.dirEdges[0]! >>> 1] = 0;
    expect(() => assertRouteSafe(g, r)).toThrow(/disabled by audit/);
  });
});

describe("the adjacency list holds only what the audit allowed", () => {
  it("leaves out an edge whose way is private", () => {
    const decoded = decodeFixture("minitown.bin");
    const plain = fresh();
    const r = sampleRoute(plain);
    const e = r.dirEdges[0]! >>> 1;
    const w = decoded.s.edge_way[e]!;
    decoded.meta.tagsets.push({ ...decoded.meta.tagsets[decoded.s.way_tagset[w]!]!, access: "private" });
    decoded.s.way_tagset[w] = decoded.meta.tagsets.length - 1;
    const g = new Graph(decoded);
    expect(g.allowedDirs[e]).toBe(0);
    let listed = 0;
    for (let n = 0; n < g.nodeCount; n++) {
      for (let i = g.outStart[n]!; i < g.outStart[n + 1]!; i++) {
        const d = g.outDirEdge[i]!;
        expect(g.tail(d)).toBe(n);
        expect(g.allowedDirs[d >>> 1]! & (d & 1 ? 2 : 1), `directed edge ${d}`).not.toBe(0);
        listed++;
      }
    }
    let allowed = 0;
    for (let x = 0; x < g.edgeCount; x++) allowed += (g.allowedDirs[x]! & 1) + ((g.allowedDirs[x]! & 2) >> 1);
    expect(listed).toBe(allowed);
  });
});

describe("the search re-checks the audit on its own", () => {
  it("won't use an edge the audit disabled, even while the adjacency list still has it", () => {
    const g = fresh();
    const before = sampleRoute(g);
    // Disable the route's edges after the adjacency list was built from them.
    for (const d of before.dirEdges) (g.allowedDirs as Uint8Array)[d >>> 1] = 0;
    const after = new Router(g).route(before.nodes[0]!, before.nodes.at(-1)!, NORMAL);
    for (const d of after?.dirEdges ?? []) expect(before.dirEdges.map((x) => x >>> 1)).not.toContain(d >>> 1);
  });
});
