import { describe, expect, it } from "vitest";
import { fold, searchPlaces, type Place } from "../src/ui/search";
import { parseLink, serializeLink } from "../src/ui/url";

const BBOX = { west: 4.77, south: 45.7, east: 4.93, north: 45.81 };

describe("shareable links", () => {
  it("round-trips start, end, mode, seed and stops", () => {
    const state = { from: [4.832, 45.7578] as [number, number], to: [4.8336, 45.7675] as [number, number], fromName: "Place Bellecour", toName: "Place des Terreaux", mode: "chaos" as const, seed: 42, art: null, artMinutes: 40, kind: "route" as const, stops: [[4.84, 45.76]] as [number, number][], workout: null, crawl: null, spell: null, spellInLink: false, long: false };
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

  it("keeps a longer walk in the link, and only when chosen", () => {
    const base = parseLink("?from=4.83,45.76&to=4.84,45.77", BBOX);
    expect(base.long).toBe(false);
    expect(serializeLink(base)).not.toContain("long");
    expect(parseLink(serializeLink({ ...base, long: true }), BBOX).long).toBe(true);
  });

  it("only includes the seed for random routes", () => {
    expect(serializeLink({ from: null, to: null, fromName: null, toName: null, mode: "parks", seed: 9, art: null, artMinutes: 40, kind: "route", stops: [], workout: null, crawl: null, spell: null, spellInLink: false, long: false })).toBe("?mode=parks");
  });
});

describe("crawl and workout links", () => {
  const base = { from: [4.832, 45.7578] as [number, number], to: [4.84, 45.76] as [number, number], fromName: "Place Bellecour", toName: "Croix-Rousse", mode: "stairs" as const, seed: 1, art: null, artMinutes: 40, stops: [], spell: null, spellInLink: false, long: false };
  it("round-trip a crawl, with and without an end", () => {
    const loop = { ...base, kind: "crawl" as const, workout: null, crawl: { theme: "pub" as const, count: 4, minutes: 60, toEnd: false } };
    const parsed = parseLink(serializeLink(loop), BBOX);
    expect(parsed.crawl).toEqual(loop.crawl);
    expect(parsed.to).toBeNull();
    expect(parsed.kind).toBe("crawl");
    const oneWay = { ...loop, crawl: { ...loop.crawl, toEnd: true } };
    expect(parseLink(serializeLink(oneWay), BBOX).to).toEqual([4.84, 45.76]);
  });
  it("caps drinking crawl stops and ignores unknown themes", () => {
    expect(parseLink("?crawl=pub&count=40", BBOX).crawl?.count).toBe(6);
    expect(parseLink("?crawl=absinthe", BBOX).crawl).toBeNull();
  });
  it("round-trips a workout and rejects unknown lengths", () => {
    const w = { ...base, kind: "workout" as const, crawl: null, workout: { focus: "hills" as const, minutes: 45 } };
    expect(parseLink(serializeLink(w), BBOX).workout).toEqual(w.workout);
    expect(parseLink("?workout=stairs&len=600", BBOX).workout).toEqual({ focus: "stairs", minutes: 30 });
  });
  it("keeps at most three stops, inside the city", () => {
    expect(parseLink("?via=4.80,45.75;2.35,48.85;4.81,45.75;4.82,45.75;4.83,45.75", BBOX).stops).toHaveLength(3);
  });
});

describe("spelled words in links", () => {
  const base = { from: [4.845, 45.751] as [number, number], to: null, fromName: null, toName: null, mode: "stairs" as const, seed: 1, art: null, artMinutes: 40, kind: "word" as const, stops: [], workout: null, crawl: null, long: false };
  it("leaves the word out unless asked", () => {
    const hidden = serializeLink({ ...base, spell: "ADA", spellInLink: false, long: false });
    expect(hidden).not.toContain("ADA");
    // The link still opens the word tool, just empty.
    expect(parseLink(hidden, BBOX)).toMatchObject({ spell: null, kind: "word" });
    const shown = serializeLink({ ...base, spell: "ADA", spellInLink: true });
    expect(parseLink(shown, BBOX)).toMatchObject({ spell: "ADA", spellInLink: true, kind: "word" });
  });
  it("cleans up words from links", () => {
    expect(parseLink("?spell=z%C3%B6%3Cb%3E", BBOX).spell).toBe("ZOB");
    expect(parseLink("?spell=z%C3%B6e%3Cscript%3E", BBOX).spell).toBeNull(); // 9 letters: over the limit
    expect(parseLink("?spell=x", BBOX).spell).toBeNull();
  });
  it("uses the default stop count when a crawl link has none", () => {
    expect(parseLink("?from=4.83,45.76&crawl=art", BBOX).crawl?.count).toBe(5);
  });
  it("keeps one tool per link, and sets the planner to it", () => {
    expect(parseLink("?from=4.83,45.76&crawl=pub&workout=hills", BBOX)).toMatchObject({ crawl: null, workout: { focus: "hills" }, kind: "workout" });
    expect(parseLink("?from=4.83,45.76&spell=HI&art=heart", BBOX)).toMatchObject({ art: null, spell: "HI", kind: "word" });
  });
  it("keeps points to the graph's precision, so a link reopens the same snapped point", () => {
    const base = parseLink("", BBOX);
    const from: [number, number] = [4.832123, 45.757891];
    expect(parseLink(serializeLink({ ...base, from }), BBOX).from).toEqual(from);
  });
  it("drops invisible bidi and zero-width characters from names", () => {
    expect(parseLink("?from=4.83,45.76&fromName=Gare%E2%80%AE%E2%80%8Bx", BBOX).fromName).toBe("Garex");
  });
});

describe("the kind of walk in links", () => {
  it("defaults to a route, and ignores unknown kinds", () => {
    expect(parseLink("", BBOX).kind).toBe("route");
    expect(parseLink("?kind=teleport", BBOX).kind).toBe("route");
    expect(parseLink("?kind=workout", BBOX).kind).toBe("workout");
  });
  it("only writes the kind when the rest of the link doesn't imply it", () => {
    const empty = parseLink("", BBOX);
    expect(serializeLink({ ...empty, kind: "crawl" })).toContain("kind=crawl");
    expect(serializeLink(empty)).not.toContain("kind");
  });
  it("still reads older links that named open panel sections", () => {
    expect(parseLink("?open=plan,about,art", BBOX).kind).toBe("shape");
    expect(parseLink("?open=spell", BBOX).kind).toBe("word");
    expect(parseLink("?open=plan,famous", BBOX).kind).toBe("route");
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
    const link = serializeLink({ from: [4.832, 45.7578], to: [4.84, 45.76], fromName: "Place Bellecour", toName: null, mode: "stairs", seed: 1, art: "heart", artMinutes: 55, kind: "shape", stops: [], workout: null, crawl: null, spell: null, spellInLink: false, long: false });
    expect(link).toBe("?from=4.832%2C45.7578&fromName=Place+Bellecour&art=heart&len=55");
    const parsed = parseLink(link, BBOX);
    expect(parsed.art).toBe("heart");
    expect(parsed.artMinutes).toBe(55);
    expect(parseLink("?art=swastika&len=999", BBOX)).toMatchObject({ art: null, artMinutes: 40 });
  });
});

describe("place search", () => {
  const P = (name: string, kind: Place["kind"], lon = 4.83, lat = 45.76): Place => ({ name, kind, lon, lat });
  it("shows a place once when OpenStreetMap has it twice, differently capitalised", () => {
    const hits = searchPlaces([P("Belvédère Cardinal", "sight"), P("belvedere cardinal", "sight")], "belv");
    expect(hits).toHaveLength(1);
  });
  it("keeps same-named places that are far apart", () => {
    expect(searchPlaces([P("Jardin", "park"), P("Jardin", "park", 4.9, 45.8)], "jar")).toHaveLength(2);
  });
  it("ranks stations above sights for the same kind of match", () => {
    const hits = searchPlaces([P("Belvédère du Sud", "sight"), P("Bellecour", "station")], "be");
    expect(hits[0]!.name).toBe("Bellecour");
  });
});
