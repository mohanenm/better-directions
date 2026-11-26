/** Wording shown with results: finish times for long walks, and why a route is just the normal one. */
import { describe, expect, it } from "vitest";
import type { PlanResult } from "../src/ui/protocol";
import { finishNote, sameRouteNote } from "../src/ui/render";

const stats = (timeS: number) => ({ timeS }) as PlanResult["normalStats"];
const result = (normalS: number, long: boolean): PlanResult =>
  ({ sameAsNormal: "too-long", normalStats: stats(normalS), betterStats: stats(normalS), capMinutes: Math.round(normalS / 60), strategy: "normal", long, missingFeature: null }) as unknown as PlanResult;

describe("finish time", () => {
  it("only appears for walks over an hour", () => {
    expect(finishNote(3600)).toBeNull();
    const note = finishNote(65 * 60, new Date(2026, 10, 25, 17, 0))!;
    expect(note).toMatch(/^About 1 h 05 of walking/);
    expect(note).toMatch(/daylight/);
    expect(finishNote(65 * 60, new Date(2026, 10, 25, 22, 30))).toMatch(/That's late/);
  });
});

describe("too long for a detour", () => {
  it("offers the longer walk when it would leave room", () => {
    expect(sameRouteNote(result(70 * 60, false))).toMatch(/Longer walk/);
  });
  it("doesn't offer it when the walk is already near the longer cap, or chosen", () => {
    expect(sameRouteNote(result(100 * 60, false))).not.toMatch(/Longer walk/);
    const long = sameRouteNote(result(95 * 60, true))!;
    expect(long).toMatch(/an hour and a half/);
    expect(long).not.toMatch(/Longer walk/);
  });
});
