/**
 * Walking time model. Tobler's hiking function on the edge's net grade (from terrain data),
 * with per-step times on staircases.
 */
import type { Graph } from "../graph/graph";

/** Tobler: km/h at a given grade (rise/run). Peaks at 6 km/h on a gentle 5% descent. */
export function toblerKmh(grade: number): number {
  return 6 * Math.exp(-3.5 * Math.abs(grade + 0.05));
}

/** Fastest walking speed the model can produce (m/s): the admissible A* heuristic uses it. */
export const MAX_SPEED_MS = 6 / 3.6;
export const FLAT_SPEED_MS = toblerKmh(0) / 3.6;

const SECONDS_PER_STEP_UP = 0.6;
const SECONDS_PER_STEP_DOWN = 0.45;
const SECONDS_PER_STEP_UNKNOWN = 0.55;

export function edgeTimeSeconds(g: Graph, edge: number, forward: boolean): number {
  const length = g.s.edge_length_m[edge]!;
  const climb = g.climb(edge, forward);
  const steps = g.s.edge_steps[edge]!;
  if (steps > 0) {
    let perStep = SECONDS_PER_STEP_UNKNOWN;
    if (climb) perStep = climb[0] > climb[1] ? SECONDS_PER_STEP_UP : SECONDS_PER_STEP_DOWN;
    return Math.max(length / MAX_SPEED_MS, steps * perStep);
  }
  let speedMs = FLAT_SPEED_MS;
  if (climb && length >= 1) speedMs = toblerKmh((climb[0] - climb[1]) / length) / 3.6;
  return length / speedMs;
}
