/**
 * Shareable state in the query string: ?from=lon,lat&to=lon,lat&mode=stairs&seed=7
 * Works on a static host with no server routing. Coordinates are rounded to 5 decimals (~1 m)
 * and must fall inside the city's bbox; anything invalid is ignored rather than trusted.
 */
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
}

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
  return {
    from: parsePoint(q.get("from"), bbox),
    to: parsePoint(q.get("to"), bbox),
    fromName: parseName(q.get("fromName")),
    toName: parseName(q.get("toName")),
    mode: (MODE_IDS as string[]).includes(mode ?? "") ? (mode as ModeId) : DEFAULT_MODE,
    seed: Number.isInteger(seed) && seed > 0 && seed < 2 ** 31 ? seed : 1,
  };
}

const fmt = (p: [number, number]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

export function serializeLink(state: LinkState): string {
  const q = new URLSearchParams();
  if (state.from) q.set("from", fmt(state.from));
  if (state.to) q.set("to", fmt(state.to));
  if (state.fromName) q.set("fromName", state.fromName);
  if (state.toName) q.set("toName", state.toName);
  q.set("mode", state.mode);
  if (state.mode === "chaos") q.set("seed", String(state.seed));
  return `?${q.toString()}`;
}
