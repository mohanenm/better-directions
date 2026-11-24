import { describe, expect, it } from "vitest";
import { FeatureIndex } from "../src/modes/features";
import { MODE_IDS } from "../src/modes/modes";
import { planMode } from "../src/modes/plan-mode";
import { Router } from "../src/router/astar";
import { loadFixture, nodeAt } from "./helpers";

const town = loadFixture("minitown.bin");
const fi = new FeatureIndex(town);
const router = new Router(town);

describe("route names", () => {
  it("every mode gets a non-empty, deterministic name", () => {
    for (const mode of MODE_IDS) {
      const a = planMode(router, fi, nodeAt(town, 0, 0), nodeAt(town, 300, 100), mode, 4)!;
      const b = planMode(router, fi, nodeAt(town, 0, 0), nodeAt(town, 300, 100), mode, 4)!;
      expect(a.name.length).toBeGreaterThan(3);
      expect(b.name).toBe(a.name);
    }
  });

  it("chaos names change with the seed", () => {
    const names = new Set([1, 2, 3, 4, 5, 6].map((seed) => planMode(router, fi, nodeAt(town, 0, 0), nodeAt(town, 300, 100), "chaos", seed)!.name));
    expect(names.size).toBeGreaterThan(2);
  });
});
