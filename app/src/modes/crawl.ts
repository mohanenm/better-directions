/**
 * Crawls: a walk through a few stops of one kind (art, pubs, wine) from a start point, ending
 * somewhere else or back at the start. Stops are picked to be spread out but close enough to
 * walk between, ordered with a small travelling-salesman heuristic, and joined by router legs,
 * so the safety rules apply to every step. Venues are never ranked: order is by route only.
 */
import type { CostModel, Route, Router } from "../router/astar";
import { haversineM } from "../router/geometry";
import { assertRouteSafe } from "../router/verify";
import { restSeconds, tripRegion } from "../router/region";
import { loopCapSeconds } from "../safety/limits";
import type { CrawlStop, FeatureIndex } from "./features";
import { MAX_STOPS, MIN_STOPS, type CrawlTheme } from "./options";
import { joinRoutes } from "./plan-mode";
import { costOfFun, type CostOfFun } from "./stats";

export { CRAWL_MINUTES, CRAWL_THEMES, MAX_STOPS, MIN_STOPS } from "./options";
/** Keep evening walks between bars short. */
const MAX_DRINK_GAP_M = 600;
const DETOUR = 1.3;
const SPEED_MS = 1.3;

export const DRINK_NOTE = "Drink responsibly: drink water, eat something, and don't drive. The local legal drinking age applies.";
export const HOURS_NOTE = "Opening hours come from OpenStreetMap and may be out of date.";

export interface CrawlOptions {
  theme: CrawlTheme;
  stops: number;
  minutes: number;
  start: number;
  /** null: loop back to the start. */
  end: number | null;
  /** Crawl stop indices to leave out (skipped or swapped by the user). */
  skip?: readonly number[];
}

export interface CrawlPlan {
  theme: CrawlTheme;
  route: Route;
  stats: CostOfFun;
  stops: CrawlStop[];
  /** Walking time of each leg, start to first stop through last stop to the end. */
  legSeconds: number[];
  longestLegM: number;
  notes: string[];
  /** Per stop, a note about its hours ("may be closed in the evening", "hours not mapped"). */
  stopNotes: string[];
  summary: string;
  name: string;
}

/** Evening walks: lit, busy-ish streets over unlit paths, trails and parks. */
function crawlModel(fi: FeatureIndex, theme: CrawlTheme): CostModel {
  const evening = theme !== "art";
  return {
    id: `crawl-${theme}`,
    turnAware: false,
    minCostPerSecond: 1,
    edgeCost: (g, d, t) => {
      if (!evening) return t;
      const e = d >>> 1;
      let f = 1;
      if (fi.lit[e] === 2) f *= 1.8;
      else if (fi.lit[e] === 0) f *= 1.1;
      if (fi.isTrail[e]) f *= 1.6;
      if (g.s.edge_park[e]) f *= 1.4;
      return t * f;
    },
  };
}

const at = (fi: FeatureIndex, s: CrawlStop): [number, number] => [fi.midLon[s.edge]!, fi.midLat[s.edge]!];

/** Outdoor art is always there; galleries and museums keep hours, so they rank a little lower. */
const preference = (s: CrawlStop): number => (s.kind === "gallery" || s.kind === "museum" ? 0.7 : 1);

/**
 * Picks `count` stops near the walk, spaced at least `spacing` metres apart, as a chain from the
 * start: each next stop is the nearest acceptable one, nudged towards the end for one-way crawls.
 */
function pickStops(fi: FeatureIndex, pool: CrawlStop[], count: number, start: [number, number], end: [number, number], spacing: number, maxGap: number): CrawlStop[] {
  const chosen: CrawlStop[] = [];
  let here = start;
  const oneWay = haversineM(start, end) > 50;
  while (chosen.length < count) {
    let best: CrawlStop | null = null;
    let bestScore = Infinity;
    for (const s of pool) {
      if (chosen.includes(s)) continue;
      const p = at(fi, s);
      const step = haversineM(here, p);
      if (step > maxGap) continue;
      if (chosen.some((c) => haversineM(at(fi, c), p) < spacing)) continue;
      const towardsEnd = oneWay ? haversineM(p, end) * 0.5 : 0;
      const score = (step + towardsEnd) / preference(s);
      if (score < bestScore || (score === bestScore && best && s.index < best.index)) {
        best = s;
        bestScore = score;
      }
    }
    if (!best) break;
    chosen.push(best);
    here = at(fi, best);
  }
  return chosen;
}

/** Straight-line tour length start -> stops -> end. */
function tourM(points: [number, number][]): number {
  let m = 0;
  for (let i = 0; i < points.length - 1; i++) m += haversineM(points[i]!, points[i + 1]!);
  return m;
}

/** 2-opt on the stop order, with the start and end fixed. */
function twoOpt(fi: FeatureIndex, stops: CrawlStop[], start: [number, number], end: [number, number]): CrawlStop[] {
  let order = [...stops];
  const length = (o: CrawlStop[]) => tourM([start, ...o.map((s) => at(fi, s)), end]);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (length(next) < length(order) - 1) {
          order = next;
          improved = true;
        }
      }
    }
  }
  return order;
}

/** Rough check for evening opening: some mapped time range running to 21:00 or later. */
export function eveningNote(openingHours: string, theme: CrawlTheme): string {
  if (!openingHours) return theme === "art" ? "" : "Opening hours not mapped.";
  if (/24\/7/.test(openingHours)) return "";
  const ranges = [...openingHours.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
  if (!ranges.length) return "";
  const lateEnough = ranges.some((m) => {
    const startH = Number(m[1]);
    const endH = Number(m[3]) + Number(m[4]) / 60;
    return endH >= 21 || endH < startH; // past midnight counts
  });
  if (theme === "art") return `Open ${openingHours}.`;
  return lateEnough ? "" : `Hours (${openingHours}) suggest it may be closed in the evening.`;
}

/** Crawls are 15 to 90 minutes; the planner and the tile loader both use these. */
export const clampCrawlMinutes = (minutes: number): number => Math.max(15, Math.min(90, minutes));
export const crawlCapSeconds = (minutes: number): number => loopCapSeconds(clampCrawlMinutes(minutes));

export function planCrawl(router: Router, fi: FeatureIndex, opts: CrawlOptions): CrawlPlan | null {
  const g = fi.g;
  const count = Math.max(MIN_STOPS, Math.min(MAX_STOPS[opts.theme], Math.round(opts.stops)));
  const minutes = clampCrawlMinutes(opts.minutes);
  const capSeconds = crawlCapSeconds(minutes);
  const startNode = opts.start;
  const endNode = opts.end ?? opts.start;
  const start = g.nodeLonLat(startNode);
  const end = g.nodeLonLat(endNode);
  const budgetM = (capSeconds * SPEED_MS) / DETOUR;
  const skip = new Set(opts.skip ?? []);
  const drinks = opts.theme !== "art";
  // Only stops the cap can reach at all (see router/region.ts), then a rough distance budget.
  const region = tripRegion([start, end], capSeconds); // a loop when end is the start
  const pool = fi.crawlStops.filter((s) => {
    if (s.theme !== opts.theme || skip.has(s.index) || s.dirEdge < 0) return false;
    if (!region.contains(g.nodeLonLat(g.tail(s.dirEdge))) || !region.contains(g.nodeLonLat(g.head(s.dirEdge)))) return false;
    const p = at(fi, s);
    return haversineM(start, p) + haversineM(p, end) <= budgetM;
  });
  if (pool.length < MIN_STOPS) return null;

  const model = crawlModel(fi, opts.theme);
  // Start tight and spread out while the walk is well under the chosen length.
  let best: { stops: CrawlStop[]; legs: Route[] } | null = null;
  for (const spacing of [120, 200, 320, 500]) {
    let stops = pickStops(fi, pool, count, start, end, spacing, drinks ? MAX_DRINK_GAP_M : budgetM / 2);
    if (stops.length < MIN_STOPS) break;
    stops = twoOpt(fi, stops, start, end);
    // Route the legs; drop the last stop until it fits the time.
    while (stops.length >= MIN_STOPS) {
      const legs = routeLegs(router, model, [startNode, ...stops.map((s) => g.tail(s.dirEdge)), endNode], capSeconds);
      if (legs) {
        best = { stops, legs };
        break;
      }
      stops = stops.slice(0, -1);
    }
    const total = best ? best.legs.reduce((s, l) => s + l.timeS, 0) : 0;
    if (!best || total >= capSeconds * 0.6 || best.stops.length < count) break;
  }
  if (!best) return null;

  const route = joinRoutes(best.legs);
  assertRouteSafe(g, route, capSeconds);
  const stats = costOfFun(fi, route);
  const legSeconds = best.legs.map((l) => l.timeS);
  const longestLegM = Math.max(...best.legs.slice(1, -1).map((l) => l.lengthM), 0);
  const notes: string[] = [];
  if (drinks) notes.push(DRINK_NOTE);
  if (stats.unlitM >= 50) notes.push(`About ${Math.round(stats.unlitM / 10) * 10} m of the walk is on paths tagged as unlit.`);
  const stopNotes = best.stops.map((s) => {
    if (opts.theme !== "art") return eveningNote(s.openingHours, opts.theme);
    if (s.kind !== "gallery" && s.kind !== "museum") return ""; // outdoor art is always there
    return s.openingHours ? `Open ${s.openingHours}.` : "Opening hours not mapped.";
  });
  if (stopNotes.some(Boolean)) notes.push(HOURS_NOTE);
  const noun = { art: ["artwork", "artworks"], pub: ["pub", "pubs"], wine: ["wine stop", "wine stops"] }[opts.theme];
  const n = best.stops.length;
  if (n < count) notes.unshift(`Only ${n} of the ${count} stops you asked for fit within ${minutes} minutes from here.`);
  return {
    theme: opts.theme,
    route,
    stats,
    stops: best.stops,
    legSeconds,
    longestLegM,
    notes,
    stopNotes,
    summary: `${n} ${noun[n === 1 ? 0 : 1]}, ${(route.lengthM / 1000).toFixed(1)} km, ${Math.max(1, Math.round(route.timeS / 60))} min of walking. Longest walk between stops: ${Math.round(longestLegM / 10) * 10} m.`,
    name: crawlName(opts.theme, n, opts.end === null),
  };
}

function routeLegs(router: Router, model: CostModel, points: number[], capSeconds: number): Route[] | null {
  const legs: Route[] = [];
  const at = points.map((n) => router.g.nodeLonLat(n));
  let spent = 0;
  for (let i = 0; i < points.length - 1; i++) {
    // Leave room for the legs after this one (see restSeconds).
    const maxTimeS = capSeconds - spent - restSeconds(at, i + 1);
    const leg = points[i] === points[i + 1] ? { dirEdges: [], nodes: [points[i]!], timeS: 0, lengthM: 0, cost: 0 } : router.route(points[i]!, points[i + 1]!, model, { maxTimeS });
    if (!leg) return null;
    spent += leg.timeS;
    if (spent > capSeconds) return null;
    legs.push(leg);
  }
  return legs;
}

function crawlName(theme: CrawlTheme, stops: number, loop: boolean): string {
  if (theme === "art") return loop ? "Art, in a Loop" : `${stops} Artworks, Roughly in Order`;
  if (theme === "pub") return loop ? "Round and Round" : `${stops} Pubs, One Direction`;
  return loop ? "The Wine Loop" : `${stops} Glasses, Spread Out`;
}
