/**
 * Spell a word with a walk. Letters are laid out left to right, sized so the whole walk fits in
 * an hour, and tried at a few rotations (including the local street grid's), sizes and offsets.
 * Each stroke is traced with the GPS-art corridor search; between strokes the walk takes the
 * shortest way to the next one ("pen up"), drawn differently on the map. Readability is scored
 * per letter. Every piece is an ordinary router route, so all the safety checks apply.
 */
import type { Graph, LonLat } from "../graph/graph";
import type { FeatureIndex } from "../modes/features";
import { NORMAL, type Route, type Router } from "../router/astar";
import type { NodeIndex } from "../router/snap";
import { assertRouteSafe } from "../router/verify";
import { LOOP_MAX_SECONDS } from "../safety/limits";
import { cloudFor, densify, LocalMetres, MISS_M, polylineDist, trace } from "./fit";
import { isSpellable, layout } from "./font";

type XY = [number, number];

const SPEED_MS = 1.3;
const STREET_FACTOR = 1.35;
/** Leave room for the router's detours: plan the template for this share of the hour. */
const PLAN_SHARE = 0.8;
/** Below this letter height a grid can't draw the letters; above it the walk gets silly. */
export const MIN_HEIGHT_M = 160;
export const MAX_HEIGHT_M = 450;
const QUICK_STEP_M = 40;
const SCORE_STEP_M = 20;
/** Mean error of this share of the letter height = 0% readable. */
const READABLE_SCALE = 0.12;
const FULL_TRACES = 5;
/** Below this, say the area spells poorly. */
export const POOR_LIKENESS = 60;

export interface SpellResult {
  word: string;
  route: Route;
  /** Walked strokes and pen-up walks, for drawing. */
  strokeLines: LonLat[][];
  penUpLines: LonLat[][];
  /** The ideal letter outlines. */
  template: LonLat[][];
  likeness: number;
  letters: { char: string; likeness: number; startNode: number }[];
  heightM: number;
  rotationDeg: number;
}

export type SpellOutcome =
  | { ok: true; result: SpellResult }
  | { ok: false; reason: "invalid" | "too-long" | "no-fit" };

/** Template length in units of letter height: strokes plus straight pen-up gaps. */
function unitLength(strokes: XY[][]): number {
  let len = 0;
  strokes.forEach((s, i) => {
    for (let k = 1; k < s.length; k++) len += Math.hypot(s[k]![0] - s[k - 1]![0], s[k]![1] - s[k - 1]![1]);
    const next = strokes[i + 1];
    if (next) len += Math.hypot(next[0]![0] - s.at(-1)![0], next[0]![1] - s.at(-1)![1]);
  });
  return len;
}

/** The tallest letters whose walk should fit the hour, or null if even the smallest won't. */
export function heightFor(word: string): number | null {
  const strokes = layout(word).letters.flatMap((l) => l.strokes);
  const fit = (LOOP_MAX_SECONDS * PLAN_SHARE * SPEED_MS) / (STREET_FACTOR * unitLength(strokes));
  if (fit < MIN_HEIGHT_M) return null;
  return Math.min(MAX_HEIGHT_M, fit);
}

/** The dominant street direction near a point, in degrees within (-45, 45]. */
function gridAngle(g: Graph, fi: FeatureIndex, m: LocalMetres, at: XY, radiusM = 700): number {
  const bins = new Float64Array(18); // 5-degree bins over 90 degrees
  for (let e = 0; e < g.edgeCount; e++) {
    if (!g.allowedDirs[e]) continue;
    const mid = m.xy([fi.midLon[e]!, fi.midLat[e]!]);
    if (Math.abs(mid[0] - at[0]) > radiusM || Math.abs(mid[1] - at[1]) > radiusM) continue;
    const [a, b] = [m.xy(g.nodeLonLat(g.s.edge_from[e]!)), m.xy(g.nodeLonLat(g.s.edge_to[e]!))];
    const deg = (((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) % 90 + 90) % 90;
    bins[Math.floor(deg / 5) % 18]! += g.s.edge_length_m[e]!;
  }
  let best = 0;
  for (let i = 1; i < 18; i++) if (bins[i]! > bins[best]!) best = i;
  const deg = best * 5 + 2.5;
  return deg > 45 ? deg - 90 : deg;
}

function placeStrokes(strokes: XY[][], heightM: number, rotationDeg: number, anchor: XY): XY[][] {
  const a = (rotationDeg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const turned = strokes.map((s) => s.map(([u, v]): XY => [heightM * (u * cos - v * sin), heightM * (u * sin + v * cos)]));
  const [fx, fy] = turned[0]![0]!;
  return turned.map((s) => s.map(([x, y]): XY => [anchor[0] + x - fx, anchor[1] + y - fy]));
}

function joinRoutes(routes: Route[]): Route {
  const dirEdges: number[] = [];
  const nodes: number[] = [];
  let timeS = 0;
  let lengthM = 0;
  for (const r of routes) {
    dirEdges.push(...r.dirEdges);
    nodes.push(...(nodes.length ? r.nodes.slice(1) : r.nodes));
    timeS += r.timeS;
    lengthM += r.lengthM;
  }
  return { dirEdges, nodes, timeS, lengthM, cost: NaN };
}

function routeLine(g: Graph, m: LocalMetres, r: Route): XY[] {
  const pts: XY[] = [];
  for (const d of r.dirEdges) {
    const edgePts = g.edgePoints(d >>> 1, (d & 1) === 0).map((p) => m.xy(p));
    pts.push(...(pts.length ? edgePts.slice(1) : edgePts));
  }
  return pts;
}

/** Symmetric mean distance between walked lines and template lines (metres). */
function chamfer(walked: XY[][], template: XY[][]): number {
  const minDist = (p: XY, lines: XY[][]) => lines.reduce((best, l) => Math.min(best, l.length > 1 ? polylineDist(p, l) : Infinity), Infinity);
  const w = walked.flatMap((l) => densify(l, SCORE_STEP_M));
  const t = template.flatMap((l) => densify(l, SCORE_STEP_M));
  if (!w.length || !t.length) return Infinity;
  const a = w.reduce((s, p) => s + minDist(p, template), 0) / w.length;
  const b = t.reduce((s, p) => s + minDist(p, walked), 0) / t.length;
  return (a + b) / 2;
}

const readable = (meanM: number, heightM: number) => Math.max(0, Math.min(100, Math.round(100 * (1 - meanM / (READABLE_SCALE * heightM)))));

export function spellWord(router: Router, fi: FeatureIndex, index: NodeIndex, rawWord: string, start: LonLat): SpellOutcome {
  const word = rawWord;
  if (!isSpellable(word)) return { ok: false, reason: "invalid" };
  const baseHeight = heightFor(word);
  if (baseHeight === null) return { ok: false, reason: "too-long" };
  const g = router.g;
  const cloud = cloudFor(g);
  const m = cloud.m;
  const anchor = m.xy(start);
  const { letters } = layout(word);
  const unitStrokes = letters.flatMap((l) => l.strokes as XY[][]);
  const letterOf = letters.flatMap((l, i) => l.strokes.map(() => i));

  const grid = gridAngle(g, fi, m, anchor);
  const rotations = [...new Set([0, -8, 8, Math.round(grid), Math.round(grid) - 5, Math.round(grid) + 5].filter((r) => Math.abs(r) <= 30))];
  const offsets: XY[] = [[0, 0], [120, 0], [-120, 0], [0, 120], [0, -120]];
  const candidates: { strokes: XY[][]; heightM: number; rotationDeg: number; quick: number }[] = [];
  for (const rotationDeg of rotations) {
    for (const scale of [1, 0.85]) {
      const heightM = baseHeight * scale;
      if (heightM < MIN_HEIGHT_M) continue;
      for (const off of offsets) {
        const strokes = placeStrokes(unitStrokes, heightM, rotationDeg, [anchor[0] + off[0], anchor[1] + off[1]]);
        const samples = strokes.flatMap((s) => densify(s, QUICK_STEP_M));
        const quick = samples.reduce((sum, p) => sum + cloud.nearest(p), 0) / samples.length / heightM;
        candidates.push({ strokes, heightM, rotationDeg, quick });
      }
    }
  }
  candidates.sort((a, b) => a.quick - b.quick || a.rotationDeg - b.rotationDeg || b.heightM - a.heightM);

  let best: SpellResult | null = null;
  for (const c of candidates.slice(0, FULL_TRACES)) {
    const pieces: { route: Route; kind: "stroke" | "pen-up"; stroke: number }[] = [];
    let prevEnd: number | null = null;
    let spent = 0;
    let failed = false;
    for (let i = 0; i < c.strokes.length && !failed; i++) {
      const pts = c.strokes[i]!;
      const startNode = index.nearest(m.lonLat(pts[0]!), MISS_M);
      if (startNode === null) {
        failed = true;
        break;
      }
      if (prevEnd !== null && prevEnd !== startNode) {
        const pen = router.route(prevEnd, startNode, NORMAL, { maxTimeS: LOOP_MAX_SECONDS - spent });
        if (!pen) {
          failed = true;
          break;
        }
        spent += pen.timeS;
        pieces.push({ route: pen, kind: "pen-up", stroke: i });
      }
      const stroke = trace(router, fi, index, m, pts, startNode);
      if (!stroke) {
        failed = true;
        break;
      }
      spent += stroke.timeS;
      if (spent > LOOP_MAX_SECONDS) failed = true;
      pieces.push({ route: stroke, kind: "stroke", stroke: i });
      prevEnd = stroke.nodes.at(-1)!;
    }
    if (failed || !pieces.length) continue;
    const route = joinRoutes(pieces.map((p) => p.route));
    if (route.timeS > LOOP_MAX_SECONDS) continue;

    const walkedByStroke = c.strokes.map((_, i) => pieces.filter((p) => p.kind === "stroke" && p.stroke === i).map((p) => routeLine(g, m, p.route)));
    const overall = readable(chamfer(walkedByStroke.flat(), c.strokes), c.heightM);
    const perLetter = letters.map((l, li) => {
      const idx = letterOf.flatMap((x, i) => (x === li ? [i] : []));
      const firstStroke = pieces.find((p) => p.kind === "stroke" && p.stroke === idx[0]);
      return {
        char: l.char,
        likeness: readable(chamfer(idx.flatMap((i) => walkedByStroke[i]!), idx.map((i) => c.strokes[i]!)), c.heightM),
        startNode: firstStroke ? firstStroke.route.nodes[0]! : route.nodes[0]!,
      };
    });
    if (!best || overall > best.likeness) {
      best = {
        word,
        route,
        strokeLines: pieces.filter((p) => p.kind === "stroke").map((p) => routeLine(g, m, p.route).map((q) => m.lonLat(q))),
        penUpLines: pieces.filter((p) => p.kind === "pen-up").map((p) => routeLine(g, m, p.route).map((q) => m.lonLat(q))),
        template: c.strokes.map((s) => s.map((q) => m.lonLat(q))),
        likeness: overall,
        letters: perLetter,
        heightM: Math.round(c.heightM),
        rotationDeg: c.rotationDeg,
      };
    }
  }
  if (!best) return { ok: false, reason: "no-fit" };
  assertRouteSafe(g, best.route, LOOP_MAX_SECONDS);
  return { ok: true, result: best };
}
