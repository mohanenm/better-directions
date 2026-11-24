import type { Graph, LonLat } from "../graph/graph";

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export function haversineM(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b, degrees clockwise from north, in [0, 360). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x =
    Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/**
 * Signed turn angle going from directed edge `from` into directed edge `to`, in degrees:
 * positive is a right turn, negative a left turn, 0 straight on, ±180 a U-turn.
 * Uses the last segment of `from` and the first segment of `to` (precomputed bearings).
 */
export function turnAngleDeg(g: Graph, from: number, to: number): number {
  const b = g.bearings();
  let d = b.start[to]! - b.end[from]!;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}
