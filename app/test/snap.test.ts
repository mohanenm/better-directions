/** Snapping a tap or place to the walking graph covers its whole radius, at any latitude. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Graph } from "../src/graph/graph";
import { haversineM } from "../src/router/geometry";
import { NodeIndex } from "../src/router/snap";

function load(area: string): Graph {
  const buf = readFileSync(new URL(`../../data/${area}/graph.bin`, import.meta.url));
  return Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("nearest node", () => {
  it("finds a path 260 m away in Copenhagen, where grid cells are narrow", () => {
    const g = load("copenhagen");
    const point: [number, number] = [12.63801, 55.672075];
    const n = new NodeIndex(g).nearest(point);
    expect(n).not.toBeNull();
    const d = haversineM(point, g.nodeLonLat(n!));
    expect(d).toBeGreaterThan(250);
    expect(d).toBeLessThanOrEqual(300);
  });
  it("still refuses points beyond the radius", () => {
    const g = load("copenhagen");
    expect(new NodeIndex(g).nearest([12.63801, 55.672075], 200)).toBeNull();
  });
  it("finds DC's paths from the Arlington area, which merges the DC extract", () => {
    const g = load("arlington");
    const index = new NodeIndex(g);
    for (const point of [[-77.063, 38.905], [-77.0434, 38.9096]] as [number, number][]) { // Georgetown, Dupont Circle
      const n = index.nearest(point);
      expect(n).not.toBeNull();
      expect(haversineM(point, g.nodeLonLat(n!))).toBeLessThan(50);
    }
  });
});
