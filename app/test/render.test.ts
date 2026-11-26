/** Wording shown with results: finish times for long walks, and why a route is just the normal one. */
import { describe, expect, it } from "vitest";
import type { PlanResult } from "../src/ui/protocol";
import { finishNote, longerWalkOffer, sameRouteNote } from "../src/ui/render";

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
  it("offers a longer walk, saying how long it could be", () => {
    expect(longerWalkOffer(result(70 * 60, false))).toBe("2 h 00");
    expect(sameRouteNote(result(70 * 60, false))).toMatch(/As a longer walk it could take up to 2 h 00/);
  });
  it("still offers it for a walk already over two hours: it may add half an hour", () => {
    expect(longerWalkOffer(result(108 * 60, false))).toBe("2 h 18");
    expect(longerWalkOffer(result(150 * 60, false))).toBe("3 h 00");
  });
  it("doesn't offer it once chosen", () => {
    expect(longerWalkOffer(result(95 * 60, true))).toBeNull();
    const long = sameRouteNote(result(95 * 60, true))!;
    expect(long).toMatch(/two hours/);
    expect(long).not.toMatch(/longer walk/);
  });
});
