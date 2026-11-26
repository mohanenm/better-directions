import { describe, expect, it } from "vitest";
import type { CostModel } from "../src/router/astar";
import { Router } from "../src/router/astar";
import { plan } from "../src/router/planner";
import { DETOUR, detourCapSeconds, loopCapSeconds } from "../src/safety/limits";
import { loadFixture, nodeAt } from "./helpers";

const grid = loadFixture("grid.bin");
const router = new Router(grid);

describe("detour cap", () => {
  it("is 4x the normal time, at most 60 minutes, never below the normal time", () => {
    expect(detourCapSeconds(300)).toBe(1200);
    expect(detourCapSeconds(1800)).toBe(3600);
    expect(detourCapSeconds(5000)).toBe(5000);
    expect(Object.isFrozen(DETOUR)).toBe(true);
  });

  it("is at most two hours for a longer walk, but always leaves half an hour of room", () => {
    expect(detourCapSeconds(300, true)).toBe(1200); // the 4x rule still applies
    expect(detourCapSeconds(1800, true)).toBe(7200);
    expect(detourCapSeconds(5000, true)).toBe(7200);
    expect(detourCapSeconds(6900, true)).toBe(8700); // 1 h 55 may add half an hour
    expect(detourCapSeconds(6480, true)).toBe(8280); // 1 h 48 to 2 h 18
    expect(detourCapSeconds(500, true)).toBe(2000); // the 4x rule still wins for short walks
    expect(detourCapSeconds(9000, true)).toBe(10800); // 2 h 30 to 3 h
    expect(loopCapSeconds(45)).toBe(2700);
    expect(loopCapSeconds(120)).toBe(7200);
    expect(loopCapSeconds(240)).toBe(7200);
  });

  it("a mode that loves detours stays within the cap", () => {
    // Avenue 5 (the far east edge) is irresistible; everything else is expensive.
    const loveTheEdge: CostModel = {
      id: "edge-lover",
      turnAware: false,
      minCostPerSecond: 0.05,
      edgeCost: (g, d, t) => (g.edgeName(d >>> 1) === "Avenue 5" ? t * 0.05 : t * 3),
    };
    const p = plan(router, nodeAt(grid, 0, 0), nodeAt(grid, 80, 0), loveTheEdge)!;
    expect(p.better.timeS).toBeLessThanOrEqual(p.capSeconds);
    expect(p.capSeconds).toBe(detourCapSeconds(p.normal.timeS));
  });

  it("when the mode's favourite route is too long, the cap still holds", () => {
    // Every avenue except the far-east Avenue 5 costs 1000x. Uncapped, the cheapest way from
    // (0,0) to (0,80) is an 880 m loop via Avenue 5: 11x the normal 80 m, far over the cap.
    const onlyAvenue5: CostModel = {
      id: "only-avenue-5",
      turnAware: false,
      minCostPerSecond: 1,
      edgeCost: (g, d, t) => {
        const name = g.edgeName(d >>> 1);
        return name.startsWith("Avenue") && name !== "Avenue 5" ? t * 1000 : t;
      },
    };
    const start = nodeAt(grid, 0, 0);
    const goal = nodeAt(grid, 0, 80);
    const p = plan(router, start, goal, onlyAvenue5)!;
    const uncapped = router.route(start, goal, onlyAvenue5)!;
    expect(uncapped.timeS).toBeGreaterThan(p.capSeconds); // the cap really had to act
    expect(p.better.timeS).toBeLessThanOrEqual(p.capSeconds);
  });

  it("returns the normal route as 'better' when the normal mode is used", () => {
    const normalAsMode: CostModel = { id: "normal-mode", turnAware: false, minCostPerSecond: 1, edgeCost: (_g, _d, t) => t };
    const p = plan(router, nodeAt(grid, 0, 0), nodeAt(grid, 400, 400), normalAsMode)!;
    expect(p.better.dirEdges).toEqual(p.normal.dirEdges);
    expect(p.blend).toBe(0);
  });
});
