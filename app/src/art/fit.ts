/**
 * GPS art: find a walking route whose trace draws a shape.
 *
 * 1. Placement search: try rotations, sizes and small offsets around the chosen centre; score
 *    each by how far the shape's outline is from the walkable network (a cheap point cloud).
 * 2. Tracing: for the best few placements, route corner to corner with a "corridor" cost that
 *    makes edges far from the ideal line expensive, then trim dead-end spurs.
 * 3. Scoring: symmetric mean distance (chamfer) between the walked trace and the shape, relative
 *    to the shape's size, reported as a likeness percentage.
 *
 * Every route is an ordinary router route, so the safety rules, audit and final check all apply,
 * and the walk may take up to an hour (an hour and a half for the long, 75-minute shapes).
 */
import type { Graph, LonLat } from "../graph/graph";
import type { FeatureIndex } from "../modes/features";
import type { CostModel, Route, Router } from "../router/astar";
import type { NodeIndex } from "../router/snap";
import { assertRouteSafe } from "../router/verify";
import { DETOUR, LOOP_MAX_SECONDS } from "../safety/limits";
import { SHAPES, type ShapeId } from "./shapes";

type XY = [number, number];

const EARTH = 6_371_008.8;
const CLOUD_STEP_M = 20;
const CLOUD_CELL_M = 40;
const QUICK_STEP_M = 40;
export const MISS_M = 150; // a template point this far from any path counts as a miss
const CORRIDOR_SIGMA_M = 30;
const CORRIDOR_MAX_FACTOR = 60;
const LIKENESS_SCALE = 0.08; // chamfer error of 8% of the shape size = 0% likeness

export interface ArtRequest {
  shape: ShapeId;
  /** Where the walk should start: the shape's first point is placed here (give or take). */
  start: LonLat;
  /** How long the walk should take, roughly. The shape is scaled to fit. */
  minutes: number;
}

/** Walking along streets is longer than the shape's outline; this is the typical ratio. */
const STREET_FACTOR = 1.25;
const PLANNING_SPEED_MS = 1.3;

/** Shape width (metres) whose outline, walked along streets, takes about `minutes`. */
/** Shape lengths are 15 to 75 minutes; the planner and the tile loader both clamp to this. */
export const clampArtMinutes = (minutes: number): number => Math.max(15, Math.min(75, minutes));

/**
 * A shape may take up to an hour whatever length was chosen (the length sizes the shape; streets
 * add detours), and up to an hour and a half for the long, over-an-hour option.
 */
export const artCapSeconds = (minutes: number): number => (clampArtMinutes(minutes) > 60 ? DETOUR.longMaxSeconds : DETOUR.maxSeconds);

export function sizeForMinutes(shape: ShapeId, minutes: number): number {
  const pts = SHAPES[shape].points;
  let unitPerimeter = 0; // in half-widths
  for (let i = 0; i < pts.length - 1; i++) {
    unitPerimeter += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
  }
  const walkM = minutes * 60 * PLANNING_SPEED_MS;
  return (2 * walkM) / STREET_FACTOR / unitPerimeter;
}

export interface ArtResult {
  shape: ShapeId;
  route: Route;
  /** The placed shape outline, for drawing next to the walked trace. */
  template: LonLat[];
  /** 0-100: how much the walk looks like the shape. */
  likeness: number;
  meanErrorM: number;
  maxErrorM: number;
  rotationDeg: number;
  sizeM: number;
  placementsTried: number;
}

/** Equirectangular metres around a reference point (accurate enough at city scale). */
export class LocalMetres {
  private readonly kx: number;
  private readonly ky = (Math.PI / 180) * EARTH;
  constructor(readonly lon0: number, readonly lat0: number) {
    this.kx = this.ky * Math.cos((lat0 * Math.PI) / 180);
  }
  xy(p: LonLat): XY {
    return [(p[0] - this.lon0) * this.kx, (p[1] - this.lat0) * this.ky];
  }
  lonLat(p: XY): LonLat {
    return [this.lon0 + p[0] / this.kx, this.lat0 + p[1] / this.ky];
  }
}

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function densify(line: XY[], step: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (line.length) out.push(line[line.length - 1]!);
  return out;
}

/** Distance from p to the nearest point of a polyline. */
export function polylineDist(p: XY, line: XY[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) best = Math.min(best, segDist(p, line[i]!, line[i + 1]!));
  return best;
}

/** Points every 20 m along every walkable edge, bucketed for nearest-point queries. */
class NetworkCloud {
  private readonly cells = new Map<string, number[]>();
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];

  constructor(g: Graph, readonly m: LocalMetres) {
    for (let e = 0; e < g.edgeCount; e++) {
      if (!g.allowedDirs[e]) continue;
      for (const p of densify(g.edgePoints(e).map((q) => m.xy(q)), CLOUD_STEP_M)) {
        const i = this.xs.length;
        this.xs.push(p[0]);
        this.ys.push(p[1]);
        const key = `${Math.floor(p[0] / CLOUD_CELL_M)},${Math.floor(p[1] / CLOUD_CELL_M)}`;
        const list = this.cells.get(key);
        if (list) list.push(i);
        else this.cells.set(key, [i]);
      }
    }
  }

  nearest(p: XY, maxR = MISS_M): number {
    const cx = Math.floor(p[0] / CLOUD_CELL_M);
    const cy = Math.floor(p[1] / CLOUD_CELL_M);
    const r = Math.ceil(maxR / CLOUD_CELL_M);
    let best = maxR;
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cy - r; j <= cy + r; j++) {
        for (const k of this.cells.get(`${i},${j}`) ?? []) {
          best = Math.min(best, Math.hypot(this.xs[k]! - p[0], this.ys[k]! - p[1]));
        }
      }
    }
    return best;
  }
}

const clouds = new WeakMap<Graph, NetworkCloud>();
export function cloudFor(g: Graph): NetworkCloud {
  let c = clouds.get(g);
  if (!c) {
    const b = g.meta.city.bbox;
    c = new NetworkCloud(g, new LocalMetres((b.west + b.east) / 2, (b.south + b.north) / 2));
    clouds.set(g, c);
  }
  return c;
}

interface Placement {
  rotationDeg: number;
  sizeM: number;
  points: XY[];
  quickError: number;
}

/** Place the shape so its first point sits at `anchor` + `offset`. */
function place(shape: ShapeId, anchor: XY, sizeM: number, rotationDeg: number, offset: XY): XY[] {
  const half = sizeM / 2;
  const a = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const rotated = SHAPES[shape].points.map(([u, v]): XY => [half * (u * cos - v * sin), half * (u * sin + v * cos)]);
  const [fx, fy] = rotated[0]!;
  return rotated.map(([x, y]) => [anchor[0] + offset[0] + x - fx, anchor[1] + offset[1] + y - fy]);
}

function corridor(m: LocalMetres, fi: FeatureIndex, a: XY, b: XY): CostModel {
  return {
    id: "gps-art-corridor",
    turnAware: false,
    minCostPerSecond: 1,
    edgeCost: (_g, d, t) => {
      const e = d >>> 1;
      const dist = segDist(m.xy([fi.midLon[e]!, fi.midLat[e]!]), a, b);
      return t * Math.min(CORRIDOR_MAX_FACTOR, 1 + (dist / CORRIDOR_SIGMA_M) ** 2);
    },
  };
}

/** Remove immediate back-and-forth pairs (walking into a dead end and straight back out). */
export function trimSpurs(dirEdges: number[]): number[] {
  const out: number[] = [];
  for (const d of dirEdges) {
    if (out.length && out[out.length - 1] === (d ^ 1)) out.pop();
    else out.push(d);
  }
  return out;
}

export function trace(router: Router, fi: FeatureIndex, index: NodeIndex, m: LocalMetres, pts: XY[], start: number, capSeconds = LOOP_MAX_SECONDS): Route | null {
  const g = router.g;
  const nodes = pts.map((p, i) => (i === 0 ? start : index.nearest(m.lonLat(p), MISS_M)));
  if (nodes.some((n) => n === null)) return null;
  const dirEdges: number[] = [];
  let spent = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    if (a === b) continue;
    const leg = router.route(a, b, corridor(m, fi, pts[i]!, pts[i + 1]!), { maxTimeS: capSeconds - spent });
    if (!leg) return null;
    spent += leg.timeS;
    dirEdges.push(...leg.dirEdges);
  }
  const trimmed = trimSpurs(dirEdges);
  if (!trimmed.length) return null;
  const routeNodes = [g.tail(trimmed[0]!)];
  let timeS = 0;
  let lengthM = 0;
  for (const d of trimmed) {
    routeNodes.push(g.head(d));
    timeS += router.edgeTime(d);
    lengthM += g.s.edge_length_m[d >>> 1]!;
  }
  return { dirEdges: trimmed, nodes: routeNodes, timeS, lengthM, cost: NaN };
}

function score(g: Graph, m: LocalMetres, route: Route, template: XY[], sizeM: number): { mean: number; max: number; likeness: number } {
  const walked: XY[] = [];
  for (const d of route.dirEdges) {
    const pts = g.edgePoints(d >>> 1, (d & 1) === 0).map((p) => m.xy(p));
    walked.push(...(walked.length ? pts.slice(1) : pts));
  }
  const walkSamples = densify(walked, 20);
  const shapeSamples = densify(template, 20);
  let sumA = 0;
  let maxA = 0;
  for (const p of walkSamples) {
    const d = polylineDist(p, template);
    sumA += d;
    maxA = Math.max(maxA, d);
  }
  let sumB = 0;
  let maxB = 0;
  for (const p of shapeSamples) {
    const d = polylineDist(p, walked);
    sumB += d;
    maxB = Math.max(maxB, d);
  }
  const mean = (sumA / walkSamples.length + sumB / shapeSamples.length) / 2;
  return { mean, max: Math.max(maxA, maxB), likeness: Math.max(0, Math.min(100, 100 * (1 - mean / (LIKENESS_SCALE * sizeM)))) };
}

const SHAPE_ROTATIONS = [-30, -15, 0, 15, 30];
const LETTER_ROTATIONS = [-10, -5, 0, 5, 10]; // tilted letters stop reading as letters
const SCALES = [0.8, 0.9, 1];
const OFFSETS: XY[] = [[0, 0], [100, 0], [-100, 0], [0, 100], [0, -100]];
const FULL_TRACES = 4;

export function drawShape(router: Router, fi: FeatureIndex, index: NodeIndex, req: ArtRequest): ArtResult | null {
  const g = router.g;
  const cloud = cloudFor(g);
  const m = cloud.m;
  const anchor = m.xy(req.start);
  const rotations = SHAPES[req.shape].closed ? SHAPE_ROTATIONS : LETTER_ROTATIONS;
  const cap = artCapSeconds(req.minutes);

  // 1. Cheap placement search.
  const placements: Placement[] = [];
  for (const rotationDeg of rotations) {
    for (const s of SCALES) {
      for (const offset of OFFSETS) {
        const sizeM = sizeForMinutes(req.shape, req.minutes) * s;
        const points = place(req.shape, anchor, sizeM, rotationDeg, offset);
        const samples = densify(points, QUICK_STEP_M);
        const quickError = samples.reduce((sum, p) => sum + cloud.nearest(p), 0) / samples.length / sizeM;
        placements.push({ rotationDeg, sizeM, points, quickError });
      }
    }
  }
  placements.sort((a, b) => a.quickError - b.quickError || a.rotationDeg - b.rotationDeg || a.sizeM - b.sizeM);

  // 2-3. Trace the most promising placements and keep the best likeness that fits the limit.
  let best: ArtResult | null = null;
  for (const p of placements.slice(0, FULL_TRACES)) {
    const start = index.nearest(m.lonLat(p.points[0]!), MISS_M);
    if (start === null) continue;
    const route = trace(router, fi, index, m, p.points, start, cap);
    if (!route || route.timeS > cap) continue;
    const s = score(g, m, route, p.points, p.sizeM);
    if (!best || s.likeness > best.likeness) {
      best = {
        shape: req.shape,
        route,
        template: p.points.map((q) => m.lonLat(q)),
        likeness: Math.round(s.likeness),
        meanErrorM: Math.round(s.mean),
        maxErrorM: Math.round(s.max),
        rotationDeg: p.rotationDeg,
        sizeM: Math.round(p.sizeM),
        placementsTried: placements.length,
      };
    }
  }
  if (best) assertRouteSafe(g, best.route, cap);
  return best;
}
