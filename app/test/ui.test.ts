import { describe, expect, it } from "vitest";
import { fold, searchPlaces, type Place } from "../src/ui/search";
import { parseLink, serializeLink } from "../src/ui/url";

const BBOX = { west: 4.77, south: 45.7, east: 4.93, north: 45.81 };

describe("shareable links", () => {
  it("round-trips start, end, mode, seed and open sections", () => {
    const state = { from: [4.832, 45.7578] as [number, number], to: [4.8336, 45.7675] as [number, number], fromName: "Place Bellecour", toName: "Place des Terreaux", mode: "chaos" as const, seed: 42, art: null, artMinutes: 40, open: ["plan", "famous"] as ("plan" | "famous")[], stops: [[4.84, 45.76]] as [number, number][], workout: null, crawl: null };
    const parsed = parseLink(serializeLink(state), BBOX);
    expect(parsed).toEqual(state);
  });

  it("ignores points outside the city, bad modes, bad seeds and control characters", () => {
    const parsed = parseLink("?from=2.35,48.85&to=4.83,45.76&mode=teleport&seed=-3&fromName=%00%1Bhi", BBOX);
    expect(parsed.from).toBeNull();
    expect(parsed.to).toEqual([4.83, 45.76]);
    expect(parsed.mode).toBe("stairs");
    expect(parsed.seed).toBe(1);
    expect(parsed.fromName).toBe("hi");
  });

  it("only includes the seed for random routes", () => {
    expect(serializeLink({ from: null, to: null, fromName: null, toName: null, mode: "parks", seed: 9, art: null, artMinutes: 40, open: ["plan"], stops: [], workout: null, crawl: null })).toBe("?mode=parks");
  });
});

describe("crawl and workout links", () => {
  const base = { from: [4.832, 45.7578] as [number, number], to: [4.84, 45.76] as [number, number], fromName: "Place Bellecour", toName: "Croix-Rousse", mode: "stairs" as const, seed: 1, art: null, artMinutes: 40, stops: [] };
  it("round-trip a crawl, with and without an end", () => {
    const loop = { ...base, open: ["crawl" as const], workout: null, crawl: { theme: "pub" as const, count: 4, minutes: 60, toEnd: false } };
    const parsed = parseLink(serializeLink(loop), BBOX);
    expect(parsed.crawl).toEqual(loop.crawl);
    expect(parsed.to).toBeNull();
    expect(parsed.open).toEqual(["crawl"]);
    const oneWay = { ...loop, crawl: { ...loop.crawl, toEnd: true } };
    expect(parseLink(serializeLink(oneWay), BBOX).to).toEqual([4.84, 45.76]);
  });
  it("caps drinking crawl stops and ignores unknown themes", () => {
    expect(parseLink("?crawl=pub&count=40", BBOX).crawl?.count).toBe(6);
    expect(parseLink("?crawl=absinthe", BBOX).crawl).toBeNull();
  });
  it("round-trips a workout and rejects unknown lengths", () => {
    const w = { ...base, open: ["workout" as const], crawl: null, workout: { focus: "hills" as const, minutes: 45 } };
    expect(parseLink(serializeLink(w), BBOX).workout).toEqual(w.workout);
    expect(parseLink("?workout=stairs&len=600", BBOX).workout).toEqual({ focus: "stairs", minutes: 30 });
  });
  it("keeps at most three stops, inside the city", () => {
    expect(parseLink("?via=4.80,45.75;2.35,48.85;4.81,45.75;4.82,45.75;4.83,45.75", BBOX).stops).toHaveLength(3);
  });
});

describe("open sections in links", () => {
  it("defaults to the route planner and drops unknown sections", () => {
    expect(parseLink("", BBOX).open).toEqual(["plan"]);
    expect(parseLink("?open=about,nonsense,art", BBOX).open).toEqual(["art", "about"]);
    expect(parseLink("?open=", BBOX).open).toEqual([]);
  });
});

describe("place search", () => {
  const places: Place[] = [
    { name: "Place Bellecour", kind: "square", lon: 0, lat: 0 },
    { name: "Basilique Notre-Dame de Fourvière", kind: "landmark", lon: 0, lat: 0 },
    { name: "Gare de Lyon-Part-Dieu", kind: "station", lon: 0, lat: 0 },
    { name: "Parc de la Tête d'Or", kind: "park", lon: 0, lat: 0 },
  ];
  it("ignores accents and case", () => {
    expect(searchPlaces(places, "fourviere").map((p) => p.name)).toEqual(["Basilique Notre-Dame de Fourvière"]);
    expect(searchPlaces(places, "TETE D OR").map((p) => p.name)).toEqual(["Parc de la Tête d'Or"]);
    expect(fold("Tête-d’Or")).toBe("tete d or");
  });
  it("ranks prefix matches first and needs two characters", () => {
    expect(searchPlaces(places, "pa")[0]!.name).toBe("Parc de la Tête d'Or");
    expect(searchPlaces(places, "p")).toEqual([]);
  });
});

describe("GPS art links", () => {
  it("round-trip shape and length, and ignore unknown shapes and lengths", () => {
    const link = serializeLink({ from: [4.832, 45.7578], to: [4.84, 45.76], fromName: "Place Bellecour", toName: null, mode: "stairs", seed: 1, art: "heart", artMinutes: 55, open: ["art"], stops: [], workout: null, crawl: null });
    expect(link).toBe("?from=4.83200%2C45.75780&fromName=Place+Bellecour&art=heart&len=55");
    const parsed = parseLink(link, BBOX);
    expect(parsed.art).toBe("heart");
    expect(parsed.artMinutes).toBe(55);
    expect(parseLink("?art=swastika&len=999", BBOX)).toMatchObject({ art: null, artMinutes: 40 });
  });
});
