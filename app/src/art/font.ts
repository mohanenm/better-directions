/**
 * A stroke font for walking: capital letters and digits as polylines, height 1 (y up), baseline
 * at y = 0. Mostly straight lines and right angles, which suit a street grid. No stroke doubles
 * back on itself: the tracer trims out-and-back spurs, so those parts become separate strokes.
 */
type Pt = [number, number];

export interface Glyph {
  width: number;
  strokes: Pt[][];
}

const g = (width: number, ...strokes: Pt[][]): Glyph => ({ width, strokes });

export const GLYPHS: Readonly<Record<string, Glyph>> = {
  A: g(0.6, [[0, 0], [0, 1], [0.6, 1], [0.6, 0]], [[0, 0.5], [0.6, 0.5]]),
  B: g(0.6, [[0, 0], [0, 1], [0.5, 1], [0.6, 0.9], [0.6, 0.6], [0.5, 0.5], [0, 0.5]], [[0.5, 0.5], [0.6, 0.4], [0.6, 0.1], [0.5, 0], [0, 0]]),
  C: g(0.6, [[0.6, 1], [0, 1], [0, 0], [0.6, 0]]),
  D: g(0.6, [[0, 0], [0, 1], [0.4, 1], [0.6, 0.75], [0.6, 0.25], [0.4, 0], [0, 0]]),
  E: g(0.6, [[0.6, 1], [0, 1], [0, 0], [0.6, 0]], [[0, 0.5], [0.45, 0.5]]),
  F: g(0.6, [[0.6, 1], [0, 1], [0, 0]], [[0, 0.5], [0.45, 0.5]]),
  G: g(0.6, [[0.6, 1], [0, 1], [0, 0], [0.6, 0], [0.6, 0.45], [0.3, 0.45]]),
  H: g(0.6, [[0, 1], [0, 0]], [[0, 0.5], [0.6, 0.5]], [[0.6, 1], [0.6, 0]]),
  I: g(0.2, [[0.1, 1], [0.1, 0]]),
  J: g(0.6, [[0.6, 1], [0.6, 0], [0, 0], [0, 0.3]]),
  K: g(0.6, [[0, 1], [0, 0]], [[0.6, 1], [0, 0.5], [0.6, 0]]),
  L: g(0.55, [[0, 1], [0, 0], [0.55, 0]]),
  M: g(0.7, [[0, 0], [0, 1], [0.35, 0.5], [0.7, 1], [0.7, 0]]),
  N: g(0.6, [[0, 0], [0, 1], [0.6, 0], [0.6, 1]]),
  O: g(0.6, [[0, 0], [0, 1], [0.6, 1], [0.6, 0], [0, 0]]),
  P: g(0.6, [[0, 0], [0, 1], [0.6, 1], [0.6, 0.5], [0, 0.5]]),
  Q: g(0.65, [[0, 0], [0, 1], [0.6, 1], [0.6, 0], [0, 0]], [[0.35, 0.25], [0.65, -0.1]]),
  R: g(0.6, [[0, 0], [0, 1], [0.6, 1], [0.6, 0.5], [0, 0.5], [0.6, 0]]),
  S: g(0.6, [[0.6, 1], [0, 1], [0, 0.5], [0.6, 0.5], [0.6, 0], [0, 0]]),
  T: g(0.6, [[0, 1], [0.6, 1]], [[0.3, 1], [0.3, 0]]),
  U: g(0.6, [[0, 1], [0, 0], [0.6, 0], [0.6, 1]]),
  V: g(0.6, [[0, 1], [0.3, 0], [0.6, 1]]),
  W: g(0.8, [[0, 1], [0.2, 0], [0.4, 0.6], [0.6, 0], [0.8, 1]]),
  X: g(0.6, [[0, 1], [0.6, 0]], [[0.6, 1], [0, 0]]),
  Y: g(0.6, [[0, 1], [0.3, 0.5], [0.6, 1]], [[0.3, 0.5], [0.3, 0]]),
  Z: g(0.6, [[0, 1], [0.6, 1], [0, 0], [0.6, 0]]),
  "0": g(0.6, [[0, 0], [0, 1], [0.6, 1], [0.6, 0], [0, 0]]),
  "1": g(0.3, [[0, 0.8], [0.2, 1], [0.2, 0]]),
  "2": g(0.6, [[0, 1], [0.6, 1], [0.6, 0.5], [0, 0.5], [0, 0], [0.6, 0]]),
  "3": g(0.6, [[0, 1], [0.6, 1], [0.6, 0], [0, 0]], [[0.1, 0.5], [0.6, 0.5]]),
  "4": g(0.6, [[0, 1], [0, 0.5], [0.6, 0.5]], [[0.5, 1], [0.5, 0]]),
  "5": g(0.6, [[0.6, 1], [0, 1], [0, 0.5], [0.6, 0.5], [0.6, 0], [0, 0]]),
  "6": g(0.6, [[0.6, 1], [0, 1], [0, 0], [0.6, 0], [0.6, 0.5], [0, 0.5]]),
  "7": g(0.6, [[0, 1], [0.6, 1], [0.2, 0]]),
  "8": g(0.6, [[0, 0], [0, 1], [0.6, 1], [0.6, 0], [0, 0]], [[0, 0.5], [0.6, 0.5]]),
  "9": g(0.6, [[0.6, 0.5], [0, 0.5], [0, 1], [0.6, 1], [0.6, 0], [0, 0]]),
};

export const LETTER_GAP = 0.3;
export const SPACE_WIDTH = 0.5;
export const MIN_LETTERS = 2;
export const MAX_LETTERS = 10;

/** Upper-cases, strips accents, keeps letters, digits and single spaces. */
export function normaliseWord(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/ +/g, " ")
    .trim();
}

export const letterCount = (word: string): number => word.replace(/ /g, "").length;

export function isSpellable(word: string): boolean {
  const n = letterCount(word);
  return n >= MIN_LETTERS && n <= MAX_LETTERS && [...word].every((c) => c === " " || c in GLYPHS);
}

/** Initials of a multi-word name ("Ada Lovelace" -> "AL"), or the first letters of one word. */
export function initials(word: string, max = 3): string {
  const parts = word.split(" ").filter(Boolean);
  if (parts.length > 1) return parts.map((p) => p[0]).join("").slice(0, MAX_LETTERS);
  return word.replace(/ /g, "").slice(0, max);
}

export interface LaidOutLetter {
  char: string;
  /** Strokes in word units: height 1, letters left to right from x = 0. */
  strokes: Pt[][];
}

export function layout(word: string): { letters: LaidOutLetter[]; width: number } {
  const letters: LaidOutLetter[] = [];
  let x = 0;
  for (const char of word) {
    if (char === " ") {
      x += SPACE_WIDTH;
      continue;
    }
    const glyph = GLYPHS[char]!;
    letters.push({ char, strokes: glyph.strokes.map((s) => s.map(([u, v]): Pt => [x + u, v])) });
    x += glyph.width + LETTER_GAP;
  }
  return { letters, width: Math.max(0, x - LETTER_GAP) };
}
