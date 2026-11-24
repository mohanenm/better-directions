/** WCAG AA contrast for the page's text colours, read straight from the stylesheet. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const vars = Object.fromEntries([...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("colour contrast (WCAG AA, 4.5:1 for text)", () => {
  const pairs: [string, string, string][] = [
    ["body text", "ink", "paper"],
    ["secondary text", "ink-soft", "paper"],
    ["secondary text on cards", "ink-soft", "wash"],
    ["links and accents", "accent", "paper"],
    ["accent on cards", "accent", "wash"],
    ["button text", "accent-ink", "accent"],
    ["warnings", "warn-ink", "warn-bg"],
  ];
  it.each(pairs)("%s", (_, fg, bg) => {
    expect(vars[fg!], fg).toBeDefined();
    expect(vars[bg!], bg).toBeDefined();
    expect(ratio(vars[fg!]!, vars[bg!]!)).toBeGreaterThanOrEqual(4.5);
  });
});
