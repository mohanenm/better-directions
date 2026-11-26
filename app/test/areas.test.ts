/** Every area has its data, its graph passes the load-time audit, its tiles match it, and its config matches. */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AREAS, nearestArea } from "../src/city";
import { Graph } from "../src/graph/graph";
import type { BaseFile } from "../src/graph/tiles";

const file = (path: string) => new URL(`../public/${path}`, import.meta.url);

describe.each(AREAS.map((a) => [a.id, a] as const))("area %s", (id, area) => {
  it("has a graph that passes the audit, a places list and tiles", () => {
    const buf = readFileSync(new URL(`../../data/${id}/graph.bin`, import.meta.url));
    const g = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(g.violations).toEqual([]);
    expect(g.meta.city.id).toBe(id);
    // The page loads graph tiles cut from it: they must be there and cut from this graph.
    const base = JSON.parse(readFileSync(file(`data/${id}/graph/base.json`), "utf8")) as BaseFile;
    expect(base.meta.counts).toEqual(g.meta.counts);
    expect(base.meta.source).toEqual(g.meta.source);
    if (base.whole) expect(readFileSync(file(`data/${id}/graph/whole.bin`)).equals(buf)).toBe(true);
    else for (const tile of Object.keys(base.tiles)) expect(existsSync(file(`data/${id}/graph/${tile}.bin`)), tile).toBe(true);
    // Small towns have few named places (Dundee has 8); this catches an empty or broken list.
    expect(JSON.parse(readFileSync(file(`data/${id}/places.json`), "utf8")).length).toBeGreaterThanOrEqual(5);
    expect(existsSync(file(`tiles/${id}/0/0/0.mvt`))).toBe(true);
  });
  it("matches its city config", () => {
    const config = JSON.parse(readFileSync(new URL(`../../cities/${id}.json`, import.meta.url), "utf8"));
    expect(area.name).toBe(config.name);
    expect(area.bbox).toEqual(config.bbox);
  });
});

describe("nearest area", () => {
  it("picks the area whose centre is closest", () => {
    expect(nearestArea(-77.03, 38.9).id).toBe("dc");
    expect(nearestArea(-76.6, 39.3).id).toBe("baltimore");
    expect(nearestArea(4.8, 45.7).id).toBe("lyon");
    expect(nearestArea(-77.45, 37.55).id).toBe("richmond");
    expect(nearestArea(-87.67, 42.0).id).toBe("chicago");
    expect(nearestArea(-122.97, 45.3).id).toBe("newberg");
    expect(nearestArea(-123.01, 45.278).id).toBe("dundee");
    expect(nearestArea(12.59, 55.68).id).toBe("copenhagen");
    expect(nearestArea(13.0, 55.6).id).toBe("malmo");
  });
});
