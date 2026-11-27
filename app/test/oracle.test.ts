/**
 * Every edge and node of every committed graph, checked against the README's promises by the
 * independent oracle (test/oracle.ts), with no routing. No route can break a promise that no
 * edge breaks. This reads the build's output as it is, with the direction flags in the file,
 * not the browser's audit of it, so it checks the build too.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeGraph, type DecodedGraph } from "../src/graph/format";
import { brokenPromises, ORACLE_NODE_KEYS, ORACLE_WAY_KEYS, passagePromiseBroken, walkingDirections, wayPromiseBroken } from "./oracle";

const DATA = new URL("../../data/", import.meta.url);
const AREAS = readdirSync(DATA).filter((a) => existsSync(new URL(`${a}/graph.bin`, DATA))).sort();

function readArea(area: string): DecodedGraph {
  const buf = readFileSync(new URL(`${area}/graph.bin`, DATA));
  return decodeGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

describe("the build keeps every tag the oracle reads", () => {
  const build = readFileSync(new URL("../../pipeline/bdgraph/build.py", import.meta.url), "utf8");
  const tuple = (name: string): string[] => {
    const m = new RegExp(`^${name} = \\(([\\s\\S]*?)\\)`, "m").exec(build);
    expect(m, `${name} in build.py`).not.toBeNull();
    return [...m![1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  };
  it("way keys", () => expect(tuple("WAY_KEYS")).toEqual(expect.arrayContaining([...ORACLE_WAY_KEYS])));
  it("node keys", () => expect(tuple("NODE_KEYS")).toEqual(expect.arrayContaining([...ORACLE_NODE_KEYS])));
});

describe("the oracle itself", () => {
  // A few promises, spelled out, so the oracle can't quietly agree with everything.
  it.each([
    [{ highway: "footway", access: "permit" }, "access=permit"],
    [{ highway: "footway", access: "Private", foot: "yes" }, "access=private"],
    [{ highway: "footway", access: "yes;military" }, "access=military"],
    [{ highway: "footway", foot: "use_sidepath" }, "foot=use_sidepath"],
    [{ highway: "service", service: "driveway" }, "driveway"],
    [{ highway: "unclassified", motorroad: "yes" }, "motorroad=yes"],
    [{ highway: "trunk" }, "trunk without foot=yes or a sidewalk"],
    [{ highway: "primary", "sidewalk:left": "no", "sidewalk:right": "none" }, "busy road with no sidewalk"],
    [{ highway: "secondary", "sidewalk:both": "separate" }, "busy road with separate sidewalks"],
    [{ highway: "footway", railway: "abandoned" }, "railway"],
    [{ highway: "cycleway" }, "cycleway without foot permission"],
    [{ highway: "bus_guideway" }, "highway=bus_guideway"],
    [{ highway: "path", sac_scale: "alpine_hiking" }, "mountain path (sac_scale=alpine_hiking)"],
  ])("%j breaks %s", (tags, reason) => expect(wayPromiseBroken(tags)).toBe(reason));

  it.each([
    { highway: "footway" },
    { highway: "footway", access: "permit", foot: "designated" },
    { highway: "residential", access: "destination" },
    { highway: "service", service: "parking_aisle" },
    { highway: "primary", "sidewalk:left": "separate", "sidewalk:right": "no" },
    { highway: "trunk", sidewalk: "right" },
  ])("%j is walkable", (tags) => expect(wayPromiseBroken(tags)).toBeNull());

  it("reads one-way tags the OSM way", () => {
    expect(walkingDirections({ highway: "footway", oneway: "yes" })).toEqual([true, false]);
    expect(walkingDirections({ highway: "residential", oneway: "yes" })).toEqual([true, true]);
    expect(walkingDirections({ highway: "residential", "oneway:foot": "-1" })).toEqual([false, true]);
    expect(walkingDirections({ highway: "steps", conveying: "backward" })).toEqual([false, true]);
    expect(walkingDirections({ highway: "path", "foot:backward": "no" })).toEqual([true, false]);
  });

  it("passages need a sign they're public", () => {
    const tags = { highway: "footway", tunnel: "building_passage" };
    const flats = { kind: "building", building: "apartments" };
    const none = { inMallOrStation: false, confirmed: false };
    expect(passagePromiseBroken(tags, "", flats, none)).not.toBeNull();
    expect(passagePromiseBroken(tags, "Passage Gonin", flats, none)).toBeNull();
    expect(passagePromiseBroken(tags, "Traboule du Bœuf", flats, none)).not.toBeNull();
    expect(passagePromiseBroken(tags, "", flats, { ...none, confirmed: true })).toBeNull();
    expect(passagePromiseBroken({ highway: "footway" }, "", flats, none)).not.toBeNull();
  });
});

describe.each(AREAS)("%s: no edge or node in the committed graph breaks a README promise", (area) => {
  it("every edge, both ends and the direction flags", () => {
    const g = readArea(area);
    const broken = brokenPromises(g);
    expect(broken.slice(0, 20), `${broken.length} broken promises`).toEqual([]);
  });
});
