import { describe, expect, it } from "vitest";
import { Graph } from "../src/graph/graph";
import { NORMAL, Router } from "../src/router/astar";
import { decodeFixture, loadFixture, nodeAt, wayNames } from "./helpers";

describe("graph and load-time safety audit", () => {
  it("a pipeline-built graph passes the audit untouched", () => {
    const g = loadFixture("minitown.bin");
    expect(g.violations).toEqual([]);
  });

  it("edge geometry starts and ends at the edge's nodes", () => {
    const g = loadFixture("minitown.bin");
    for (let e = 0; e < g.edgeCount; e++) {
      const pts = g.edgePoints(e);
      expect(pts[0]).toEqual(g.nodeLonLat(g.s.edge_from[e]!));
      expect(pts[pts.length - 1]).toEqual(g.nodeLonLat(g.s.edge_to[e]!));
    }
  });

  it("a tampered graph is caught: edges whose tags break a rule are disabled", () => {
    const decoded = decodeFixture("minitown.bin");
    // Pretend the file says the Diagonal footway is private.
    const way = [...decoded.s.way_name].findIndex((i) => decoded.meta.strings[i] === "Diagonal");
    const tagset = decoded.s.way_tagset[way]!;
    decoded.meta.tagsets[tagset] = { ...decoded.meta.tagsets[tagset], access: "private" };
    const g = new Graph(decoded);
    expect(g.violations.some((v) => v.kind === "way" && v.reason === "access")).toBe(true);
    const route = new Router(g).route(nodeAt(g, 0, 0), nodeAt(g, 300, 100), NORMAL);
    expect(route).not.toBeNull();
    expect(wayNames(g, route!.dirEdges)).not.toContain("Diagonal");
  });

  it("a tampered node is caught: edges touching it are disabled", () => {
    const decoded = decodeFixture("minitown.bin");
    const g0 = new Graph(decoded);
    const b1 = nodeAt(g0, 100, 100);
    decoded.meta.node_tagsets.push({ barrier: "gate", access: "private" });
    decoded.s.node_tagset[b1] = decoded.meta.node_tagsets.length - 1;
    const g = new Graph(decoded);
    expect(g.violations.some((v) => v.kind === "node" && v.reason === "node_access")).toBe(true);
    const route = new Router(g).route(nodeAt(g, 0, 0), nodeAt(g, 300, 100), NORMAL);
    expect(route!.nodes).not.toContain(b1);
  });

  it("direction flags that disagree with the rules only allow what both permit", () => {
    const decoded = decodeFixture("minitown.bin");
    const way = [...decoded.s.way_name].findIndex((i) => decoded.meta.strings[i] === "One Way");
    const edge = [...decoded.s.edge_way].indexOf(way);
    decoded.s.edge_flags[edge]! |= decoded.meta.flags.edge.backward; // file claims two-way
    const g = new Graph(decoded);
    expect(g.violations.some((v) => v.kind === "direction")).toBe(true);
    expect(g.allowedDirs[edge]).toBe(1);
  });
});
