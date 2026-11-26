/** The light and dark palettes: the dark one is written twice in style.css, and both must read well. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const light: Record<string, string> = { ...block(':root, [data-theme="light"]'), white: "#ffffff" };
const dark: Record<string, string> = { ...block(':root[data-theme="dark"]'), white: "#ffffff" };
const systemDark = block(':root:not([data-theme="light"])');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// Text and the background it sits on, with the WCAG AA minimum.
const PAIRS: [string, string, number][] = [
  ["ink", "paper", 4.5],
  ["ink-soft", "paper", 4.5],
  ["ink-soft", "wash", 4.5],
  ["accent", "paper", 4.5],
  ["accent", "wash", 4.5],
  ["accent", "accent-tint", 4.5],
  ["accent-ink", "accent", 4.5],
  ["danger", "paper", 4.5],
  ["warn-ink", "warn-bg", 4.5],
  ["field", "paper", 3],
  ["route-better", "paper", 3],
  ["route-normal", "paper", 3],
  ["white", "marker-from", 4.5], // the A and B on the markers
  ["white", "marker-to", 4.5],
];

describe("palettes", () => {
  it("writes the dark palette the same way for the switch and for the system setting", () => {
    expect({ ...systemDark, white: "#ffffff" }).toEqual(dark);
  });

  it("defines the same colours in light and dark", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  for (const [name, palette] of [["light", light], ["dark", dark]] as const) {
    it.each(PAIRS)(`${name}: %s on %s reaches %s:1`, (fg, bg, min) => {
      expect(contrast(palette[fg]!, palette[bg]!)).toBeGreaterThanOrEqual(min);
    });
  }
});
