/**
 * Where a request's routes can possibly go. Every route is capped in walking time, and nobody
 * walks faster than MAX_SPEED_MS (edge times are never shorter than length / MAX_SPEED_MS), so a
 * point a route passes must satisfy: straight-line distance from the start, plus from it to the
 * end, is at most cap × speed. That's an ellipse with the start and end as foci; for a trip
 * through stops, the union over its legs; for a loop, a circle around the start.
 *
 * Planners skip candidates outside the region (they could never fit the cap), and the tiled
 * loader loads every tile the region touches, plus REGION_MARGIN_M for snapping and look-ups
 * near the route. Both depend only on the request, so planning on the loaded tiles gives exactly
 * the routes planning on the whole graph would.
 */
import type { LonLat } from "../graph/graph";
import { haversineM } from "./geometry";
import { MAX_SPEED_MS } from "./time";

/** The bound speed, with 1% to spare for the difference between edge lengths and great circles. */
export const REACH_SPEED_MS = MAX_SPEED_MS * 1.01;
/**
 * Room around a region for look-ups that reach past the route itself: snapping a point to the
 * nearest path (300 m), park pins near the route (300 m), shape template points (150 m).
 */
export const REGION_MARGIN_M = 400;
/**
 * Shapes and spelled words start from a path near the template's first point (up to about 270 m
 * from the tap) rather than the snapped start, so they're loaded with a wider margin.
 */
export const DRAWING_MARGIN_M = 800;

export interface Region {
  /** Whether a route under the cap could pass within `slackM` metres of this point (0: pass it). */
  contains(p: LonLat, slackM?: number): boolean;
  /** A box around the region grown by `marginM`, in degrees: [west, south, east, north]. */
  bbox(marginM?: number): [number, number, number, number];
}

const M_PER_DEG_LAT = 111_320;

/** A box around points, grown by reachM + marginM, in degrees: [west, south, east, north]. */
export function boxAround(points: LonLat[], reachM: number, marginM = 0): [number, number, number, number] {
  const dLat = (reachM + marginM) / M_PER_DEG_LAT;
  // A degree of longitude is shortest at the region's most polar point, so size it there.
  const maxAbsLat = Math.min(89, Math.max(...points.map((p) => Math.abs(p[1]))) + dLat);
  const dLon = (reachM + marginM) / (M_PER_DEG_LAT * Math.cos((maxAbsLat * Math.PI) / 180));
  return [
    Math.min(...points.map((p) => p[0])) - dLon,
    Math.min(...points.map((p) => p[1])) - dLat,
    Math.max(...points.map((p) => p[0])) + dLon,
    Math.max(...points.map((p) => p[1])) + dLat,
  ];
}

/**
 * A trip through `points` in order (start, any stops, end; at least two) taking at most
 * `capSeconds`. A point is reachable on leg i if the straight-line chain up to that leg, the
 * detour through the point and the chain after it fit the cap's reach. A loop is the trip from a
 * point to itself: a circle of half the reach.
 */
export function tripRegion(points: LonLat[], capSeconds: number): Region {
  const reach = capSeconds * REACH_SPEED_MS;
  const n = points.length;
  const prefix = [0];
  for (let i = 1; i < n; i++) prefix.push(prefix[i - 1]! + haversineM(points[i - 1]!, points[i]!));
  const total = prefix[n - 1]!;
  return {
    // A point within slack of a reachable one makes each of its two detour distances at most
    // slack longer.
    contains(p, slackM = 0) {
      for (let i = 0; i < n - 1; i++) {
        const sum = prefix[i]! + haversineM(points[i]!, p) + haversineM(p, points[i + 1]!) + (total - prefix[i + 1]!);
        if (sum <= reach + 2 * slackM) return true;
      }
      return false;
    },
    // Every reachable point is within `reach` of some point of the chain.
    bbox: (marginM = 0) => boxAround(points, reach, marginM),
  };
}

/** A circle: a walk from `centre` ending anywhere within its reach, or the area around a point. */
export function circleRegion(centre: LonLat, radiusM: number): Region {
  return {
    contains: (p, slackM = 0) => haversineM(centre, p) <= radiusM + slackM,
    bbox: (marginM = 0) => boxAround([centre], radiusM, marginM),
  };
}

/**
 * The least time the rest of a walk can take: straight lines from `points[from]` through to the
 * last point, at the bound speed. A leg capped at "what's left minus this" can't wander past the
 * region, and anything it would have found beyond that cap couldn't have been finished in time.
 */
export function restSeconds(points: LonLat[], from: number): number {
  let m = 0;
  for (let i = from; i < points.length - 1; i++) m += haversineM(points[i]!, points[i + 1]!);
  return m / REACH_SPEED_MS;
}

/** Whether every node of a path lies in the region. */
export function pathInRegion(region: Region, nodeLonLat: (n: number) => LonLat, nodes: number[]): boolean {
  return nodes.every((n) => region.contains(nodeLonLat(n)));
}
