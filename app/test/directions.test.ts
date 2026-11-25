import { describe, expect, it } from "vitest";
import { directions, genericName } from "../src/modes/directions";
import { FeatureIndex } from "../src/modes/features";
import { planMode } from "../src/modes/plan-mode";
import { Router } from "../src/router/astar";
import { loadFixture, nodeAt } from "./helpers";

const town = loadFixture("minitown.bin");
const fi = new FeatureIndex(town);
const router = new Router(town);
const at = (x: number, y: number) => nodeAt(town, x, y);

describe("directions", () => {
  it("starts and ends the steps, and distances add up", () => {
    const p = planMode(router, fi, at(0, 0), at(300, 100), "stairs", 1)!;
    const steps = directions(fi, p, "Main Street corner", "the far corner");
    expect(steps[0]!.kind).toBe("start");
    expect(steps[0]!.text).toContain("Main Street corner");
    expect(steps.at(-1)!.kind).toBe("arrive");
    expect(steps.at(-1)!.text).toMatch(/min instead of/);
    const total = steps.reduce((s, x) => s + x.distanceM, 0);
    expect(total).toBeCloseTo(p.better.lengthM, 0);
  });

  it("the traboule gets its own step, with a closure note", () => {
    const p = planMode(router, fi, at(0, 85), at(100, 85), "buildings", 1)!;
    const steps = directions(fi, p, "W", "E");
    const passage = steps.find((s) => s.kind === "passage")!;
    expect(passage.text).toContain("Traboule House");
    expect(passage.notes.join(" ")).toMatch(/May be closed/);
  });

  it("stairs say how many steps", () => {
    const p = planMode(router, fi, at(200, 50), at(300, 50), "stairs", 1)!;
    const steps = directions(fi, p, "A", "B");
    const stairs = steps.find((s) => s.kind.startsWith("stairs"))!;
    expect(stairs.text).toMatch(/30 steps/);
    expect(steps.some((s) => s.text.includes("Little Park"))).toBe(true);
  });

  it("is deterministic per seed", () => {
    const p = planMode(router, fi, at(0, 0), at(300, 100), "chaos", 5)!;
    expect(directions(fi, p, "A", "B")).toEqual(directions(fi, p, "A", "B"));
  });

  it("names unnamed ways by type", () => {
    expect(genericName("footway")).toBe("the footpath");
    expect(genericName(undefined)).toBe("an unnamed street");
  });
});

describe("snack tour", () => {
  it("stops at the bakery, names it with its hours, and counts it", () => {
    const p = planMode(router, fi, at(0, 0), at(300, 100), "snacks", 1)!;
    expect(p.betterStats.snacks.bakery).toBeGreaterThanOrEqual(1);
    expect(p.summary).toMatch(/bakery/);
    const steps = directions(fi, p, "A", "B");
    expect(steps.some((s) => s.text.includes("You pass Boulangerie Test (open 07:00-19:30)"))).toBe(true);
    expect(fi.snacks.map((s) => s.name).sort()).toEqual(["Boulangerie Test", "Café Test"]); // the far one wasn't snapped
  });
});
