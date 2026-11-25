/**
 * Shareable state in the query string: ?from=lon,lat&to=lon,lat&mode=stairs&seed=7&open=plan,art
 * Works on a static host with no server routing. Coordinates are rounded to 5 decimals (~1 m)
 * and must fall inside the city's bbox; anything invalid is ignored rather than trusted.
 */
import { SHAPE_IDS, type ShapeId } from "../art/shapes";
import { MODE_IDS, type ModeId } from "../modes/modes";

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
}

export const SECTION_IDS = ["plan", "art", "famous", "about"] as const;
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
  const printable = [...value].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join("");
  const clean = printable.trim().slice(0, MAX_NAME);
  return clean || null;
}

export function parseLink(search: string, bbox: Bbox): LinkState {
  const q = new URLSearchParams(search);
  const mode = q.get("mode");
  const seed = Number(q.get("seed"));
  const art = (SHAPE_IDS as string[]).includes(q.get("art") ?? "") ? (q.get("art") as ShapeId) : null;
  return {
    from: parsePoint(q.get("from"), bbox),
    to: parsePoint(q.get("to"), bbox),
    fromName: parseName(q.get("fromName")),
    toName: parseName(q.get("toName")),
    mode: (MODE_IDS as string[]).includes(mode ?? "") ? (mode as ModeId) : DEFAULT_MODE,
    seed: Number.isInteger(seed) && seed > 0 && seed < 2 ** 31 ? seed : 1,
    art,
    artMinutes: (ART_LENGTHS as readonly number[]).includes(Number(q.get("len"))) ? Number(q.get("len")) : 40,
    open: parseOpen(q.get("open"), art ? ["art"] : DEFAULT_OPEN),
  };
}

const fmt = (p: [number, number]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

export function serializeLink(state: LinkState): string {
  const q = new URLSearchParams();
  if (state.art) {
    if (state.from) q.set("from", fmt(state.from));
    if (state.fromName) q.set("fromName", state.fromName);
    q.set("art", state.art);
    q.set("len", String(state.artMinutes));
    serializeOpen(q, state.open, ["art"]);
    return `?${q.toString()}`;
  }
  if (state.from) q.set("from", fmt(state.from));
  if (state.to) q.set("to", fmt(state.to));
  if (state.fromName) q.set("fromName", state.fromName);
  if (state.toName) q.set("toName", state.toName);
  q.set("mode", state.mode);
  if (state.mode === "chaos") q.set("seed", String(state.seed));
  serializeOpen(q, state.open, DEFAULT_OPEN);
  return `?${q.toString()}`;
}
