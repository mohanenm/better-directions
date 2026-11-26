/**
 * Shareable state in the query string: ?from=lon,lat&to=lon,lat&mode=stairs&seed=7&open=plan,art
 * Works on a static host with no server routing. Coordinates are rounded to 5 decimals (~1 m)
 * and must fall inside the city's bbox; anything invalid is ignored rather than trusted.
 */
import { isSpellable, normaliseWord } from "../art/font";
import { SHAPE_IDS, type ShapeId } from "../art/shapes";
import { MODE_IDS, type ModeId } from "../modes/modes";
import { CRAWL_MINUTES, CRAWL_THEMES, MAX_STOPS, MIN_STOPS, WORKOUT_FOCUSES, WORKOUT_MINUTES, type CrawlTheme, type WorkoutFocus } from "../modes/options";

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface LinkState {
  from: [number, number] | null;
  to: [number, number] | null;
  fromName: string | null;
  toName: string | null;
  mode: ModeId;
  seed: number;
  /** GPS art: the shape to draw from `from`, and the walk length in minutes. */
  art: ShapeId | null;
  artMinutes: number;
  /** Panel sections that are open. */
  open: SectionId[];
  /** Points a route must pass through, in order (at most MAX_LINK_STOPS). */
  stops: [number, number][];
  workout: { focus: WorkoutFocus; minutes: number } | null;
  /** toEnd: finish at `to` rather than looping back to `from`. */
  crawl: { theme: CrawlTheme; count: number; minutes: number; toEnd: boolean } | null;
  /** A word to spell from `from`. It's only written into links when spellInLink is true. */
  spell: string | null;
  spellInLink: boolean;
}

export const MAX_LINK_STOPS = 3;
export const SECTION_IDS = ["plan", "crawl", "art", "spell", "workout", "famous", "about"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const DEFAULT_OPEN: SectionId[] = ["plan"];

function parseOpen(value: string | null, fallback: SectionId[]): SectionId[] {
  if (value === null) return [...fallback];
  const ids = value.split(",").filter((v): v is SectionId => (SECTION_IDS as readonly string[]).includes(v));
  return SECTION_IDS.filter((id) => ids.includes(id));
}

function serializeOpen(q: URLSearchParams, open: SectionId[], fallback: SectionId[]): void {
  const sorted = SECTION_IDS.filter((id) => open.includes(id));
  if (sorted.join(",") !== fallback.join(",")) q.set("open", sorted.join(","));
}

export const ART_LENGTHS = [25, 40, 55] as const;

export const DEFAULT_MODE: ModeId = "stairs";
const MAX_NAME = 80;

function parsePoint(value: string | null, bbox: Bbox): [number, number] | null {
  if (!value) return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const [lon, lat] = parts.map(Number) as [number, number];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < bbox.west || lon > bbox.east || lat < bbox.south || lat > bbox.north) return null;
  return [lon, lat];
}

function parseName(value: string | null): string | null {
  if (!value) return null;
  // Drop control characters and the invisible bidi and zero-width marks, which can make a name
  // display differently from what it says.
  const printable = [...value].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join("").replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
  const clean = printable.trim().slice(0, MAX_NAME);
  return clean || null;
}

export function parseLink(search: string, bbox: Bbox): LinkState {
  const q = new URLSearchParams(search);
  const mode = q.get("mode");
  const seed = Number(q.get("seed"));
  const art = (SHAPE_IDS as string[]).includes(q.get("art") ?? "") ? (q.get("art") as ShapeId) : null;
  const len = Number(q.get("len"));
  const focus = q.get("workout");
  const workout = (WORKOUT_FOCUSES as readonly string[]).includes(focus ?? "")
    ? { focus: focus as WorkoutFocus, minutes: (WORKOUT_MINUTES as readonly number[]).includes(len) ? len : 30 }
    : null;
  const theme = q.get("crawl");
  const rawCount = q.get("count");
  const count = rawCount === null ? NaN : Number(rawCount); // a missing count means the default, not 0
  const crawl = (CRAWL_THEMES as readonly string[]).includes(theme ?? "")
    ? {
        theme: theme as CrawlTheme,
        count: Number.isInteger(count) ? Math.max(MIN_STOPS, Math.min(MAX_STOPS[theme as CrawlTheme], count)) : 5,
        minutes: (CRAWL_MINUTES as readonly number[]).includes(len) ? len : 45,
        toEnd: q.get("end") === "1",
      }
    : null;
  const word = normaliseWord(q.get("spell") ?? "");
  const spell = isSpellable(word) ? word : null;
  // One tool at a time, in this order: spell, shape, workout, crawl. The open panel follows suit.
  const fallbackOpen: SectionId[] = spell ? ["spell"] : art ? ["art"] : workout ? ["workout"] : crawl ? ["crawl"] : DEFAULT_OPEN;
  return {
    from: parsePoint(q.get("from"), bbox),
    to: parsePoint(q.get("to"), bbox),
    fromName: parseName(q.get("fromName")),
    toName: parseName(q.get("toName")),
    mode: (MODE_IDS as string[]).includes(mode ?? "") ? (mode as ModeId) : DEFAULT_MODE,
    seed: Number.isInteger(seed) && seed > 0 && seed < 2 ** 31 ? seed : 1,
    art: spell ? null : art,
    artMinutes: (ART_LENGTHS as readonly number[]).includes(Number(q.get("len"))) ? Number(q.get("len")) : 40,
    open: parseOpen(q.get("open"), fallbackOpen),
    stops: (q.get("via") ?? "").split(";").map((v) => parsePoint(v, bbox)).filter((p): p is [number, number] => p !== null).slice(0, MAX_LINK_STOPS),
    workout: art || spell ? null : workout,
    crawl: art || spell || workout ? null : crawl,
    spell,
    spellInLink: spell !== null,
  };
}

// Six decimals is the graph's own precision (microdegrees), so a link names exactly the point
// that was planned from and reopens the same route. Five could round onto a neighbouring node.
const fmt = (p: [number, number]) => `${+p[0].toFixed(6)},${+p[1].toFixed(6)}`; // no trailing zeros

export function serializeLink(state: LinkState): string {
  const q = new URLSearchParams();
  if (state.spell) {
    // The word stays on the device unless the user asked to put it in the link.
    if (state.from) q.set("from", fmt(state.from));
    if (state.fromName) q.set("fromName", state.fromName);
    if (state.spellInLink) q.set("spell", state.spell);
    serializeOpen(q, state.open, state.spellInLink ? ["spell"] : DEFAULT_OPEN);
    return `?${q.toString()}`;
  }
  if (state.art) {
    if (state.from) q.set("from", fmt(state.from));
    if (state.fromName) q.set("fromName", state.fromName);
    q.set("art", state.art);
    q.set("len", String(state.artMinutes));
    serializeOpen(q, state.open, ["art"]);
    return `?${q.toString()}`;
  }
  if (state.crawl) {
    if (state.from) q.set("from", fmt(state.from));
    if (state.fromName) q.set("fromName", state.fromName);
    if (state.crawl.toEnd && state.to) {
      q.set("to", fmt(state.to));
      if (state.toName) q.set("toName", state.toName);
      q.set("end", "1");
    }
    q.set("crawl", state.crawl.theme);
    q.set("count", String(state.crawl.count));
    q.set("len", String(state.crawl.minutes));
    serializeOpen(q, state.open, ["crawl"]);
    return `?${q.toString()}`;
  }
  if (state.workout) {
    if (state.from) q.set("from", fmt(state.from));
    if (state.fromName) q.set("fromName", state.fromName);
    q.set("workout", state.workout.focus);
    q.set("len", String(state.workout.minutes));
    serializeOpen(q, state.open, ["workout"]);
    return `?${q.toString()}`;
  }
  if (state.from) q.set("from", fmt(state.from));
  if (state.to) q.set("to", fmt(state.to));
  if (state.fromName) q.set("fromName", state.fromName);
  if (state.toName) q.set("toName", state.toName);
  if (state.stops.length) q.set("via", state.stops.map(fmt).join(";"));
  q.set("mode", state.mode);
  if (state.mode === "chaos") q.set("seed", String(state.seed));
  serializeOpen(q, state.open, DEFAULT_OPEN);
  return `?${q.toString()}`;
}
