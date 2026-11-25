import { describe, expect, it } from "vitest";
import { CostModelError, NORMAL, Router, type CostModel } from "../src/router/astar";
import { turnAngleDeg } from "../src/router/geometry";
import { hashUnit } from "../src/router/rng";
import { FLAT_SPEED_MS, edgeTimeSeconds, toblerKmh } from "../src/router/time";
import { Graph } from "../src/graph/graph";
import { decodeFixture, loadFixture, nodeAt, wayNames } from "./helpers";

const town = loadFixture("minitown.bin");
const townRouter = new Router(town);
const at = (x: number, y: number) => nodeAt(town, x, y);

describe("router on the mini-town", () => {
  it("finds the known shortest route: the diagonal, then Second Street", () => {
    const r = townRouter.route(at(0, 0), at(300, 100), NORMAL)!;
    expect(wayNames(town, r.dirEdges)).toEqual(["Diagonal", "Second Street"]);
    expect(r.lengthM).toBeCloseTo(Math.hypot(100, 100) + 200, -1);
  });

  it("never uses the private shortcut (the build dropped it)", () => {
    for (let e = 0; e < town.edgeCount; e++) expect(town.edgeName(e)).not.toBe("Private");
    const r = townRouter.route(at(100, 0), at(300, 100), NORMAL)!;
    expect(wayNames(town, r.dirEdges)).not.toContain("Private");
  });

  it("respects one-way footways", () => {
    const there = townRouter.route(at(100, 50), at(200, 50), NORMAL)!;
    expect(wayNames(town, there.dirEdges)).toEqual(["One Way"]);
    const back = townRouter.route(at(200, 50), at(100, 50), NORMAL)!;
    expect(wayNames(town, back.dirEdges)).not.toContain("One Way");
  });

  it("start equal to goal is an empty route", () => {
    expect(townRouter.route(at(0, 0), at(0, 0), NORMAL)).toMatchObject({ dirEdges: [], timeS: 0 });
  });

  it("is deterministic: the same query gives the same route", () => {
    const a = townRouter.route(at(0, 0), at(300, 0), NORMAL)!;
    const b = new Router(town).route(at(0, 0), at(300, 0), NORMAL)!;
    expect(b.dirEdges).toEqual(a.dirEdges);
  });

  it("staircases cost time per step", () => {
    const stairs = [...Array(town.edgeCount).keys()].filter((e) => town.edgeName(e) === "Stairs");
    const steps = stairs.reduce((sum, e) => sum + town.s.edge_steps[e]!, 0);
    expect(steps).toBe(30);
    const t = stairs.reduce((sum, e) => sum + edgeTimeSeconds(town, e, true), 0);
    expect(t).toBeGreaterThanOrEqual(30 * 0.45);
  });

  it("rejects a cost model that undercuts its declared minimum", () => {
    const cheat: CostModel = { id: "cheat", turnAware: false, minCostPerSecond: 1, edgeCost: (_g, _d, t) => t / 2 };
    expect(() => townRouter.route(at(0, 0), at(300, 100), cheat)).toThrow(CostModelError);
  });

  it("turn-aware models see the edge they arrived on", () => {
    // Forbid right turns: from A0 heading east along Main Street, B3 is reachable only by lefts.
    const noRight: CostModel = {
      id: "no-right",
      turnAware: true,
      minCostPerSecond: 1,
      edgeCost: (g, d, t, prev) => (prev >= 0 && turnAngleDeg(g, prev, d) > 30 ? Infinity : t),
    };
    const r = townRouter.route(at(0, 0), at(300, 100), noRight)!;
    for (let i = 1; i < r.dirEdges.length; i++) {
      expect(turnAngleDeg(town, r.dirEdges[i - 1]!, r.dirEdges[i]!)).toBeLessThanOrEqual(30);
    }
  });
});

describe("unusable nodes", () => {
  it("won't start, even a zero-length route, at a node the audit locked", () => {
    const decoded = decodeFixture("minitown.bin");
    const plain = new Graph(decodeFixture("minitown.bin"));
    const n = nodeAt(plain, 100, 0);
    decoded.meta.node_tagsets.push({ barrier: "gate", locked: "yes" });
    decoded.s.node_tagset[n] = decoded.meta.node_tagsets.length - 1;
    const locked = new Router(new Graph(decoded));
    expect(locked.route(n, n, NORMAL)).toBeNull();
    expect(new Router(plain).route(n, n, NORMAL)?.nodes).toEqual([n]);
  });
});

describe("walking time model", () => {
  it("Tobler: fastest on a gentle descent, slower uphill", () => {
    expect(toblerKmh(-0.05)).toBeCloseTo(6);
    expect(toblerKmh(0.1)).toBeLessThan(toblerKmh(0));
    expect(toblerKmh(0)).toBeCloseTo(FLAT_SPEED_MS * 3.6);
  });

  it("on the sloped grid, walking east (uphill) takes longer than walking west", () => {
    const grid = loadFixture("grid.bin");
    const router = new Router(grid);
    const west = nodeAt(grid, 0, 160);
    const east = nodeAt(grid, 400, 160);
    const up = router.route(west, east, NORMAL)!;
    const down = router.route(east, west, NORMAL)!;
    expect(up.lengthM).toBeCloseTo(down.lengthM, 3);
    expect(up.timeS).toBeGreaterThan(down.timeS * 1.2);
    expect(grid.meta.terrain.attribution).toBe("Test terrain");
  });
});

describe("turn angles", () => {
  it("precomputed bearings agree with the geometry, both ways", () => {
    const grid = loadFixture("grid.bin");
    const r = new Router(grid).route(nodeAt(grid, 0, 0), nodeAt(grid, 80, 80), NORMAL)!;
    // Two edges: east then north (a left turn of 90 degrees), or north then east (a right turn).
    expect(r.dirEdges).toHaveLength(2);
    const angle = turnAngleDeg(grid, r.dirEdges[0]!, r.dirEdges[1]!);
    expect(Math.abs(Math.abs(angle) - 90)).toBeLessThan(1);
    // Reversing both edges mirrors the turn.
    const back = turnAngleDeg(grid, r.dirEdges[1]! ^ 1, r.dirEdges[0]! ^ 1);
    expect(back).toBeCloseTo(-angle, 3);
  });
});

describe("seeded determinism", () => {
  const grid = loadFixture("grid.bin");
  const seeded = (seed: number): CostModel => ({
    id: `seed-${seed}`,
    turnAware: false,
    minCostPerSecond: 0.2,
    edgeCost: (_g, d, t) => t * (0.2 + 4 * hashUnit(seed, d >>> 1)),
  });

  it("the same seed gives the same route, on a fresh router too", () => {
    const a = new Router(grid).route(nodeAt(grid, 0, 0), nodeAt(grid, 400, 400), seeded(7))!;
    const b = new Router(grid).route(nodeAt(grid, 0, 0), nodeAt(grid, 400, 400), seeded(7))!;
    expect(b.dirEdges).toEqual(a.dirEdges);
  });

  it("different seeds explore different routes", () => {
    const router = new Router(grid);
    const routes = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((s) => router.route(nodeAt(grid, 0, 0), nodeAt(grid, 400, 400), seeded(s))!.dirEdges.join(",")),
    );
    expect(routes.size).toBeGreaterThan(3);
  });

  it("hashUnit is stable across calls and in [0, 1)", () => {
    expect(hashUnit(42, 99)).toBe(hashUnit(42, 99));
    for (let i = 0; i < 1000; i++) {
      const v = hashUnit(i, i * 31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
