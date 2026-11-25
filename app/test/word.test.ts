import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GLYPHS, initials, isSpellable, layout, normaliseWord } from "../src/art/font";
import { heightFor, spellWord } from "../src/art/word";
import { Graph } from "../src/graph/graph";
import { FeatureIndex } from "../src/modes/features";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";
import { LOOP_MAX_SECONDS } from "../src/safety/limits";

describe("the walking font", () => {
  it("has every letter and digit, inside the box", () => {
    for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
      const glyph = GLYPHS[c]!;
      expect(glyph, c).toBeDefined();
      for (const s of glyph.strokes) for (const [x, y] of s) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(glyph.width + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-0.15);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });
  it("normalises names and limits their length", () => {
    expect(normaliseWord("  Zoë  O'Brien! ")).toBe("ZOE OBRIEN");
    expect(isSpellable("A")).toBe(false);
    expect(isSpellable("ABCDEFGHIJK")).toBe(false);
    expect(isSpellable("ADA 1815")).toBe(true);
    expect(initials("ADA LOVELACE")).toBe("AL");
    expect(layout("AB").width).toBeCloseTo(0.6 + 0.3 + 0.6);
  });
  it("sizes short words big and refuses words too long for an hour", () => {
    expect(heightFor("HI")).toBe(450);
    expect(heightFor("WWWWWWWWWW")).toBeNull();
  });
});

describe("spelling on Lyon", () => {
  const buf = readFileSync(new URL("../public/data/lyon/graph.bin", import.meta.url));
  const lyon = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const router = new Router(lyon);
  const fi = new FeatureIndex(lyon);
  const index = new NodeIndex(lyon);
  it("spells short words in Guillotière's grid within the hour", () => {
    for (const word of ["HI", "LYON", "EM", "ADA"]) {
      const out = spellWord(router, fi, index, word, [4.845, 45.751]);
      expect(out.ok, word).toBe(true);
      if (!out.ok) continue;
      const r = out.result;
      console.log(`${word}: ${r.likeness}% readable, letters ${r.letters.map((l) => `${l.char} ${l.likeness}%`).join(", ")}, ${Math.round(r.route.timeS / 60)} min, ${r.heightM} m tall, ${r.rotationDeg}°`);
      expect(r.route.timeS).toBeLessThanOrEqual(LOOP_MAX_SECONDS);
      expect(r.letters).toHaveLength(word.length);
    }
  });
});
