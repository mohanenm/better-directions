/** Every famous route must still live up to its pitch on the current Lyon graph. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Graph } from "../src/graph/graph";
import { FeatureIndex } from "../src/modes/features";
import { planCrawl } from "../src/modes/crawl";
import { planMode } from "../src/modes/plan-mode";
import { planWorkout } from "../src/modes/workout";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";
import { FAMOUS_ROUTES } from "../src/ui/famous";

const buf = readFileSync(new URL("../public/data/lyon/graph.bin", import.meta.url));
const lyon = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const router = new Router(lyon);
const fi = new FeatureIndex(lyon);
const index = new NodeIndex(lyon);

describe("famous better routes", () => {
  for (const f of FAMOUS_ROUTES) {
    it(`${f.title} lives up to its pitch`, () => {
      if (f.kind === "crawl") {
        const c = planCrawl(router, fi, { theme: f.theme, stops: f.count, minutes: f.minutes, start: index.nearest(f.from)!, end: null })!;
        expect(c.stops.length).toBe(f.count);
        console.log(`${f.title}: "${c.name}". ${c.summary}`);
        return;
      }
      if (f.kind === "workout") {
        const w = planWorkout(router, fi, index.nearest(f.from)!, f.minutes, f.focus)!;
        expect(w.stats.staircases).toBeGreaterThanOrEqual(5);
        console.log(`${f.title}: "${w.name}". ${w.summary}`);
        return;
      }
      const p = planMode(router, fi, index.nearest(f.from)!, index.nearest(f.to)!, f.mode, f.seed)!;
      const s = p.betterStats;
      expect(p.better.timeS).toBeLessThanOrEqual(p.capSeconds);
      switch (f.mode) {
        case "stairs": expect(s.stepsUp).toBeGreaterThanOrEqual(250); break;
        case "buildings": expect(s.buildings).toBeGreaterThanOrEqual(6); break;
        case "parks": expect(s.parks).toBeGreaterThanOrEqual(4); break;
        case "snacks": expect(s.snacks.bakery).toBeGreaterThanOrEqual(3); break;
        case "trail": expect(s.trailShare).toBeGreaterThanOrEqual(0.4); break;
        case "no-right": expect(s.rightTurns).toBe(0); break;
        case "chaos": expect(p.better.timeS - p.normal.timeS).toBeGreaterThan(5 * 60); break;
        case "inconvenient": expect(s.straightSkips).toBeGreaterThanOrEqual(20); break;
      }
      console.log(`${f.title}: "${p.name}". ${p.summary}`);
    });
  }
});
