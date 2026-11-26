import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { densify, drawShape, sizeForMinutes, trimSpurs } from "../src/art/fit";
import { SHAPE_IDS, SHAPES } from "../src/art/shapes";
import { Graph } from "../src/graph/graph";
import { FeatureIndex } from "../src/modes/features";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";
import { DETOUR } from "../src/safety/limits";

describe("GPS art building blocks", () => {
  it("closed shapes end where they start; every shape fits the unit box", () => {
    for (const id of SHAPE_IDS) {
      const pts = SHAPES[id].points;
      if (SHAPES[id].closed) {
        expect(pts[0]![0]).toBeCloseTo(pts.at(-1)![0], 6);
        expect(pts[0]![1]).toBeCloseTo(pts.at(-1)![1], 6);
      }
      for (const [x, y] of pts) {
        expect(Math.abs(x)).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(y)).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it("trims walk-in-walk-out spurs, including nested ones", () => {
    expect(trimSpurs([2, 4, 5, 6])).toEqual([2, 6]); // 4 then 5 (= 4 reversed) cancel
    expect(trimSpurs([2, 4, 8, 9, 5, 6])).toEqual([2, 6]);
    expect(trimSpurs([2, 4, 6])).toEqual([2, 4, 6]);
  });

  it("densifies polylines at the requested spacing", () => {
    const pts = densify([[0, 0], [100, 0]], 25);
    expect(pts).toHaveLength(5);
    expect(pts.at(-1)).toEqual([100, 0]);
  });

  it("longer walks make bigger shapes", () => {
    expect(sizeForMinutes("heart", 55)).toBeGreaterThan(sizeForMinutes("heart", 25));
    expect(sizeForMinutes("star", 40)).toBeLessThan(sizeForMinutes("circle", 40)); // the star's outline is longer
  });
});

describe("GPS art on Lyon", () => {
  const buf = readFileSync(new URL("../../data/lyon/graph.bin", import.meta.url));
  const lyon = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const router = new Router(lyon);
  const fi = new FeatureIndex(lyon);
  const index = new NodeIndex(lyon);

  it("draws a recognisable square near Guillotière within the hour", () => {
    const req = { shape: "square" as const, start: [4.845, 45.751] as [number, number], minutes: 40 };
    const a = drawShape(router, fi, index, req)!;
    expect(a.likeness).toBeGreaterThanOrEqual(70);
    expect(a.route.timeS).toBeLessThanOrEqual(DETOUR.maxSeconds);
    const b = drawShape(router, fi, index, req)!;
    expect(b.route.dirEdges).toEqual(a.route.dirEdges);
  });

  it("closed shapes are loops back to the start", () => {
    const r = drawShape(router, fi, index, { shape: "heart", start: [4.845, 45.751], minutes: 55 })!;
    expect(r.route.nodes[0]).toBe(r.route.nodes.at(-1));
  });
});
