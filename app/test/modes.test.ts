import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Graph, type LonLat } from "../src/graph/graph";
import { directions } from "../src/modes/directions";
import { FeatureIndex, isTrailTags } from "../src/modes/features";
import { MODE_IDS, MODES } from "../src/modes/modes";
import { planMode } from "../src/modes/plan-mode";
import { costOfFun, summarise } from "../src/modes/stats";
import { NORMAL, Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";
import { loadFixture, nodeAt } from "./helpers";

describe("cost of fun on the mini-town", () => {
  const town = loadFixture("minitown.bin");
  const fi = new FeatureIndex(town);
  const router = new Router(town);
  const at = (x: number, y: number) => nodeAt(town, x, y);

  it("counts the staircase, its steps and the park it's in", () => {
    const r = router.route(at(200, 50), at(300, 50), NORMAL)!;
    const s = costOfFun(fi, r);
    expect(s.staircases).toBe(1);
    expect(s.stepsUp + s.stepsDown + s.stepsUnknown).toBe(30);
    expect(s.parkNames).toEqual(["Little Park"]);
  });

  it("counts the traboule as a building walked through, and notes it may close", () => {
    const r = router.route(at(0, 85), at(100, 85), NORMAL)!;
    const s = costOfFun(fi, r);
    expect(s.buildings).toBe(1);
    expect(s.buildingNames).toEqual(["Traboule House"]);
    expect(s.mayClose.length).toBe(1);
  });

  it("summarises in one line", () => {
    const r = router.route(at(200, 50), at(300, 50), NORMAL)!;
    const s = costOfFun(fi, r);
    const normal = { ...s, timeS: 360 };
    const better = { ...s, timeS: 23 * 60, staircases: 4, malls: 2, trails: 1, parks: 0, stepsUp: 0, buildings: 0 };
    expect(summarise(normal, better)).toBe("Normal: 6 min. Better: 23 min, 4 staircases, 2 malls, 1 trail.");
  });

  it("trail classification", () => {
    expect(isTrailTags({ highway: "path" })).toBe(true);
    expect(isTrailTags({ highway: "path", surface: "asphalt" })).toBe(false);
    expect(isTrailTags({ highway: "footway", surface: "gravel" })).toBe(true);
    expect(isTrailTags({ highway: "residential" })).toBe(false);
  });

  it("every mode plans a capped, safe route on the mini-town", () => {
    for (const id of MODE_IDS) {
      const p = planMode(router, fi, at(0, 0), at(300, 100), id, 3)!;
      expect(p.better.timeS).toBeLessThanOrEqual(p.capSeconds);
    }
  });
});

// --- Recognisability on real Lyon trips ---------------------------------------------------------

const PLACES: Record<string, LonLat> = {
  bellecour: [4.832, 45.7578],
  terreaux: [4.8336, 45.7675],
  partDieu: [4.8593, 45.7606],
  saintJean: [4.8274, 45.7606],
  croixRousse: [4.8317, 45.7745],
  fourviere: [4.8225, 45.7623],
  teteDOr: [4.8519, 45.7703],
  jeanMace: [4.8424, 45.7457],
};
const TRIPS: [string, string][] = [
  ["bellecour", "terreaux"],
  ["partDieu", "saintJean"],
  ["terreaux", "croixRousse"],
  ["saintJean", "fourviere"],
  ["teteDOr", "bellecour"],
  ["jeanMace", "bellecour"],
];

describe("each mode is recognisably itself on Lyon sample trips", () => {
  const buf = readFileSync(new URL("../public/data/lyon/graph.bin", import.meta.url));
  const lyon = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const router = new Router(lyon);
  const fi = new FeatureIndex(lyon);
  const index = new NodeIndex(lyon);
  const trips = TRIPS.map(([a, b]) => [index.nearest(PLACES[a]!)!, index.nearest(PLACES[b]!)!] as const);
  const plans = (id: (typeof MODE_IDS)[number], seed = 7) => trips.map(([s, t]) => planMode(router, fi, s, t, id, seed)!);

  it("stairs: at least 5 staircases and 100 steps up on every trip", () => {
    for (const p of plans("stairs")) {
      expect(p.betterStats.staircases).toBeGreaterThanOrEqual(Math.max(5, p.normalStats.staircases + 3));
      expect(p.betterStats.stepsUp).toBeGreaterThanOrEqual(100);
    }
  });

  it("parks: at least 4 parks on every trip", () => {
    for (const p of plans("parks")) expect(p.betterStats.parks).toBeGreaterThanOrEqual(Math.max(4, p.normalStats.parks + 2));
  });

  it("Through buildings: at least 5 buildings walked through on every trip", () => {
    for (const p of plans("buildings")) {
      expect(p.betterStats.buildings).toBeGreaterThanOrEqual(Math.max(5, p.normalStats.buildings + 3));
    }
  });

  it("trails: at least a quarter of the walk on trails", () => {
    for (const p of plans("trail")) {
      expect(p.betterStats.trailShare).toBeGreaterThanOrEqual(0.25);
      expect(p.betterStats.trailShare).toBeGreaterThan(p.normalStats.trailShare);
    }
  });

  it("snacks: 3+ stops, more than normal, at least one bakery-type", () => {
    const count = (s: { snacks: Record<string, number> }) => Object.values(s.snacks).reduce((a, b) => a + b, 0);
    for (const p of plans("snacks")) {
      expect(count(p.betterStats)).toBeGreaterThanOrEqual(3);
      expect(count(p.betterStats)).toBeGreaterThan(count(p.normalStats));
      const s = p.betterStats.snacks;
      expect(s.bakery + s.pastry + s.chocolate + s.ice_cream).toBeGreaterThanOrEqual(1);
    }
  });

  it("left turns only: at most one right turn, and fewer than the normal route", () => {
    for (const p of plans("no-right")) {
      expect(p.betterStats.rightTurns).toBeLessThanOrEqual(1);
      expect(p.betterStats.rightTurns).toBeLessThanOrEqual(p.normalStats.rightTurns);
      // The directions never announce a right turn the count doesn't include. (They can mention
      // fewer: a turn between two unnamed paths is folded into one step.)
      const rights = directions(fi, p, "A", "B").filter((st) => /^(Turn|Bear) right/.test(st.text)).length;
      expect(rights).toBeLessThanOrEqual(p.betterStats.rightTurns);
    }
  });

  it("most inconvenient: many more turns, no extra busy-road crossings", () => {
    for (const p of plans("inconvenient")) {
      const turns = (x: typeof p.betterStats) => x.leftTurns + x.rightTurns + x.uTurns;
      console.log(`inconvenient: ${p.summary} crossings ${p.betterStats.busyCrossings}/${p.normalStats.busyCrossings}`);
      expect(p.betterStats.busyCrossings).toBeLessThanOrEqual(p.normalStats.busyCrossings);
      expect(turns(p.betterStats)).toBeGreaterThanOrEqual(2 * turns(p.normalStats));
      expect(p.betterStats.straightSkips).toBeGreaterThanOrEqual(5);
    }
  });

  it("random: a real detour that changes with the seed and only with the seed", () => {
    const [s, t] = trips[1]!;
    const routes = [1, 2, 3, 4, 5].map((seed) => planMode(router, fi, s, t, "chaos", seed)!);
    expect(new Set(routes.map((p) => p.better.dirEdges.join(","))).size).toBeGreaterThanOrEqual(4);
    for (const p of routes) expect(p.better.timeS - p.normal.timeS).toBeGreaterThan(5 * 60);
    const again = planMode(router, fi, s, t, "chaos", 3)!;
    expect(again.better.dirEdges).toEqual(routes[2]!.better.dirEdges);
  });

  it("every mode keeps to the cap, is deterministic and rarely doubles back", () => {
    for (const id of MODE_IDS) {
      const first = plans(id);
      const second = plans(id);
      first.forEach((p, i) => {
        expect(p.better.timeS).toBeLessThanOrEqual(p.capSeconds);
        expect(p.betterStats.retracedM / p.betterStats.lengthM).toBeLessThanOrEqual(0.25);
        expect(second[i]!.better.dirEdges).toEqual(p.better.dirEdges);
      });
    }
    expect(Object.keys(MODES)).toHaveLength(8);
  });
});
