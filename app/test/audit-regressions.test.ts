/** Cases found by the November 2026 audit, each pinned to the place it was found. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Graph } from "../src/graph/graph";
import { planCrawl } from "../src/modes/crawl";
import { directions } from "../src/modes/directions";
import { FeatureIndex } from "../src/modes/features";
import { deliversMode, sameAsNormalReason } from "../src/modes/names";
import { planMode } from "../src/modes/plan-mode";
import { planWorkout } from "../src/modes/workout";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";

const cache = new Map<string, { router: Router; fi: FeatureIndex; index: NodeIndex }>();
function area(id: string) {
  let a = cache.get(id);
  if (!a) {
    const buf = readFileSync(new URL(`../../data/${id}/graph.bin`, import.meta.url));
    const g = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    a = { router: new Router(g), fi: new FeatureIndex(g), index: new NodeIndex(g) };
    cache.set(id, a);
  }
  return a;
}
type P = [number, number];
function plan(id: string, from: P, to: P, mode: Parameters<typeof planMode>[4]) {
  const { router, fi, index } = area(id);
  return { fi, p: planMode(router, fi, index.nearest(from)!, index.nearest(to)!, mode, 1)! };
}

describe("the better route that is really the normal one says why", () => {
  it("too long: Potomac Yard to Clarendon is already over an hour", () => {
    const { p } = plan("arlington", [-77.0467, 38.8297], [-77.0954, 38.8868], "stairs");
    expect(p.normal.timeS).toBeGreaterThan(3600);
    expect(sameAsNormalReason(p)).toBe("too-long");
  });
  it("too long, even when the route differs but takes the same time", () => {
    const { p } = plan("lyon", [4.88468, 45.76472], [4.82477, 45.76749], "stairs");
    expect(sameAsNormalReason(p)).toBe("too-long");
  });
  it("nothing here: Dundee has no public passages", () => {
    const { p } = plan("dundee", [-123.01449, 45.28104], [-123.01124, 45.28272], "buildings");
    expect(sameAsNormalReason(p)).toBe("nothing-here");
  });
});

describe("names and arrival lines only claim what the route has", () => {
  it("a buildings route with no buildings gets a plain name and plain arrival line", () => {
    const { fi, p } = plan("lyon", [4.90689, 45.73512], [4.90836, 45.73228], "buildings");
    if (deliversMode("buildings", p.betterStats)) return; // the data changed; nothing to check
    expect(["A Different Way Round", "The Long Way, Plainly"]).toContain(p.name);
    const arrive = directions(fi, p, "A", "B").at(-1)!.text;
    expect(arrive).not.toMatch(/courtyards|indoors/);
  });
});

describe("directions read properly", () => {
  it("one step is a step", () => {
    const { fi, p } = plan("dc", [-77.04985, 38.88819], [-77.07478, 38.90738], "parks");
    expect(directions(fi, p, "A", "B").map((s) => s.text).join(" ")).not.toMatch(/\b1 steps\b/);
  });
  it("never says 'for 0 m'", () => {
    const { fi, p } = plan("copenhagen", [12.53185, 55.66291], [12.53096, 55.66022], "trail");
    expect(directions(fi, p, "A", "B").map((s) => s.text).join(" ")).not.toMatch(/for 0 m/);
  });
});

describe("workouts and crawls are honest about what they found", () => {
  it("a 45-minute stairs workout keeps the staircases it found", () => {
    const { router, fi, index } = area("chicago");
    const w = planWorkout(router, fi, index.nearest([-87.65207, 41.8632])!, 45, "stairs")!;
    expect(w.stats.staircases).toBeGreaterThan(0);
    expect(w.notes.join(" ")).not.toMatch(/No staircases/);
    expect(w.name).not.toMatch(/45-Minute/); // named for its real length unless it really is 45
  });
  it("a crawl with fewer stops than asked says so", () => {
    const { router, fi, index } = area("dundee");
    const c = planCrawl(router, fi, { theme: "wine", stops: 6, minutes: 30, start: index.nearest([-123.01688, 45.27935])!, end: null })!;
    if (c.stops.length < 6) expect(c.notes[0]).toMatch(/^Only \d of the 6 stops/);
    expect(c.notes.join(" ")).not.toMatch(/France|the US/);
  });
});
