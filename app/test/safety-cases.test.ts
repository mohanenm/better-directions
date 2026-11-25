/** The shared safety cases: the Python build passes these too (pipeline/tests/test_safety_cases.py). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  footDirections,
  isTrackRailwayWay,
  mayPassThroughBuilding,
  mayPassUnderBuildingUnmapped,
  nodeExclusion,
  passageExclusion,
  restrictedAreaExclusion,
  wayExclusion,
} from "../src/safety/rules";

type Tags = Record<string, string>;
interface Cases {
  ways: { name: string; tags: Tags; excluded: string | null }[];
  through_building: { name: string; tags: Tags; allowed: boolean }[];
  under_building_unmapped: { name: string; tags: Tags; allowed: boolean }[];
  nodes: { name: string; tags: Tags; context: Record<string, boolean>; excluded: string | null }[];
  directions: { name: string; tags: Tags; forward: boolean; backward: boolean }[];
  track_ways: { name: string; tags: Tags; track: boolean }[];
  passages: {
    name: string; tags: Tags; way_name: string; building: { kind: string; building: string } | null;
    in_public_venue?: boolean; confirmed?: boolean; excluded: string | null;
  }[];
  restricted_areas: { name: string; way: Tags; area: Tags; excluded: string | null }[];
}

const cases = JSON.parse(readFileSync(new URL("../../safety/cases.json", import.meta.url), "utf8")) as Cases;

describe("shared safety cases", () => {
  it.each(cases.ways.map((c) => [c.name, c] as const))("way: %s", (_, c) => {
    expect(wayExclusion(c.tags)).toBe(c.excluded);
  });
  it.each(cases.through_building.map((c) => [c.name, c] as const))("through building: %s", (_, c) => {
    expect(mayPassThroughBuilding(c.tags)).toBe(c.allowed);
  });
  it.each(cases.under_building_unmapped.map((c) => [c.name, c] as const))("under building: %s", (_, c) => {
    expect(mayPassUnderBuildingUnmapped(c.tags)).toBe(c.allowed);
  });
  it.each(cases.nodes.map((c) => [c.name, c] as const))("node: %s", (_, c) => {
    expect(nodeExclusion(c.tags, c.context)).toBe(c.excluded);
  });
  it.each(cases.directions.map((c) => [c.name, c] as const))("direction: %s", (_, c) => {
    expect(footDirections(c.tags)).toEqual([c.forward, c.backward]);
  });
  it.each(cases.track_ways.map((c) => [c.name, c] as const))("track way: %s", (_, c) => {
    expect(isTrackRailwayWay(c.tags)).toBe(c.track);
  });
  it.each(cases.passages.map((c) => [c.name, c] as const))("passage: %s", (_, c) => {
    const opts = { inPublicVenue: c.in_public_venue ?? false, confirmed: c.confirmed ?? false };
    expect(passageExclusion(c.tags, c.way_name, c.building, opts)).toBe(c.excluded);
  });
  it.each(cases.restricted_areas.map((c) => [c.name, c] as const))("restricted area: %s", (_, c) => {
    expect(restrictedAreaExclusion(c.way, c.area)).toBe(c.excluded);
  });
});
