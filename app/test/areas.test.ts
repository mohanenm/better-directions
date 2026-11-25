/** Every area has its data, its graph passes the load-time audit, and its config matches. */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AREAS, nearestArea } from "../src/city";
import { Graph } from "../src/graph/graph";

const file = (path: string) => new URL(`../public/${path}`, import.meta.url);

describe.each(AREAS.map((a) => [a.id, a] as const))("area %s", (id, area) => {
  it("has a graph that passes the audit, a places list and tiles", () => {
    const buf = readFileSync(file(`data/${id}/graph.bin`));
    const g = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(g.violations).toEqual([]);
    expect(g.meta.city.id).toBe(id);
    expect(JSON.parse(readFileSync(file(`data/${id}/places.json`), "utf8")).length).toBeGreaterThan(100);
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
  });
});
