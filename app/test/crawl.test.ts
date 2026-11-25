import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Graph } from "../src/graph/graph";
import { CRAWL_THEMES, eveningNote, MAX_STOPS, planCrawl } from "../src/modes/crawl";
import { FeatureIndex } from "../src/modes/features";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";

const buf = readFileSync(new URL("../public/data/lyon/graph.bin", import.meta.url));
const lyon = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const router = new Router(lyon);
const fi = new FeatureIndex(lyon);
const index = new NodeIndex(lyon);
const node = (lon: number, lat: number) => index.nearest([lon, lat])!;
const terreaux = node(4.8336, 45.7675);
const croixRousse = node(4.8317, 45.7745);

describe("crawls on Lyon", () => {
  it("every theme plans a loop and a one-way crawl within the time, with spread-out stops", () => {
    for (const theme of CRAWL_THEMES) {
      for (const end of [null, croixRousse]) {
        const c = planCrawl(router, fi, { theme, stops: 5, minutes: 45, start: terreaux, end })!;
        console.log(`${theme} ${end === null ? "loop" : "to Croix-Rousse"}: ${c.name}. ${c.summary} [${c.stops.map((s) => s.name).join(" / ")}]`);
        expect(c.stops.length).toBeGreaterThanOrEqual(3);
        expect(c.route.timeS).toBeLessThanOrEqual(45 * 60);
        expect(c.route.nodes[0]).toBe(terreaux);
        expect(c.route.nodes.at(-1)).toBe(end ?? terreaux);
        expect(new Set(c.stops.map((s) => s.index)).size).toBe(c.stops.length);
        for (const s of c.stops) expect(s.theme).toBe(theme);
        for (const s of c.stops) expect(c.route.nodes).toContain(lyon.tail(s.dirEdge));
      }
    }
  });

  it("caps drinking crawls, adds the drinking note, and keeps walks between bars short", () => {
    const c = planCrawl(router, fi, { theme: "pub", stops: 20, minutes: 60, start: terreaux, end: null })!;
    expect(c.stops.length).toBeLessThanOrEqual(MAX_STOPS.pub);
    expect(c.notes.some((n) => n.startsWith("Drink responsibly"))).toBe(true);
    expect(c.longestLegM).toBeLessThanOrEqual(1200);
  });

  it("skipping a stop picks another and keeps the count", () => {
    const first = planCrawl(router, fi, { theme: "art", stops: 4, minutes: 45, start: terreaux, end: null })!;
    const again = planCrawl(router, fi, { theme: "art", stops: 4, minutes: 45, start: terreaux, end: null, skip: [first.stops[1]!.index] })!;
    expect(again.stops.map((s) => s.index)).not.toContain(first.stops[1]!.index);
    expect(again.stops).toHaveLength(4);
  });

  it("flags bars that seem to close before the evening", () => {
    expect(eveningNote("Mo-Sa 08:00-19:00", "pub")).toMatch(/may be closed in the evening/);
    expect(eveningNote("Mo-Su 17:00-01:00", "pub")).toBe("");
    expect(eveningNote("", "wine")).toBe("Opening hours not mapped.");
  });
});
