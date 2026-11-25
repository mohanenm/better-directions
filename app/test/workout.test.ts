import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Graph } from "../src/graph/graph";
import { FeatureIndex } from "../src/modes/features";
import { planWorkout, WORKOUT_FOCUSES, WORKOUT_MINUTES } from "../src/modes/workout";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";

const buf = readFileSync(new URL("../public/data/lyon/graph.bin", import.meta.url));
const lyon = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const router = new Router(lyon);
const fi = new FeatureIndex(lyon);
const index = new NodeIndex(lyon);
const STARTS = { saintJean: [4.8274, 45.7606], croixRousse: [4.8317, 45.7745], bellecour: [4.832, 45.7578] } as const;

describe("workout loops on Lyon", () => {
  it("return to the start within the chosen time, for every focus and length", () => {
    for (const [name, at] of Object.entries(STARTS)) {
      const start = index.nearest([at[0], at[1]])!;
      for (const focus of WORKOUT_FOCUSES) {
        for (const minutes of WORKOUT_MINUTES) {
          const w = planWorkout(router, fi, start, minutes, focus)!;
          console.log(`${name} ${focus} ${minutes}: ${w.summary}`);
          expect(w.route.nodes[0]).toBe(start);
          expect(w.route.nodes.at(-1)).toBe(start);
          expect(w.route.timeS).toBeLessThanOrEqual(minutes * 60);
          expect(w.route.timeS).toBeGreaterThanOrEqual(minutes * 60 * 0.5);
        }
      }
    }
  });

  it("stairs loops climb staircases and hill loops climb hills", () => {
    const start = index.nearest([STARTS.saintJean[0], STARTS.saintJean[1]])!;
    const stairs = planWorkout(router, fi, start, 30, "stairs")!;
    expect(stairs.stats.staircases).toBeGreaterThanOrEqual(4);
    expect(stairs.stats.stepsUp).toBeGreaterThanOrEqual(150);
    const hillLoop = planWorkout(router, fi, start, 30, "hills")!;
    expect(hillLoop.stats.climbM).toBeGreaterThanOrEqual(60);
  });
});
