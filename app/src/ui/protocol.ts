/** Messages between the page and the planning worker. */
import type { Step } from "../modes/directions";
import type { ShapeId } from "../art/shapes";
import type { ModeId } from "../modes/modes";
import type { SameAsNormal } from "../modes/names";
import type { CrawlTheme, WorkoutFocus } from "../modes/options";
import type { CostOfFun } from "../modes/stats";

export interface ReadyInfo {
  city: string;
  bbox: { west: number; south: number; east: number; north: number };
  attribution: string;
  terrainAttribution: string;
  dataAsOf: string;
  violations: number;
  /** Milliseconds spent loading in the worker (for performance checks). */
  timings: { fetchMs: number; decodeAuditMs: number; indexMs: number; graphBytes: number };
}

export interface PlanRequest {
  type: "plan";
  id: number;
  from: [number, number];
  to: [number, number];
  fromName: string;
  toName: string;
  mode: ModeId;
  seed: number;
  /** Points the route must pass through, in order. */
  stops: [number, number][];
  /** A longer walk: detours may take up to 90 minutes instead of an hour. */
  long: boolean;
}

export interface WorkoutRequest {
  type: "workout";
  id: number;
  start: [number, number];
  fromName: string;
  minutes: number;
  focus: WorkoutFocus;
}

export interface CrawlRequest {
  type: "crawl";
  id: number;
  start: [number, number];
  end: [number, number] | null;
  fromName: string;
  toName: string;
  theme: CrawlTheme;
  stops: number;
  minutes: number;
  skip: number[];
}

export interface SpellRequest {
  type: "spell";
  id: number;
  start: [number, number];
  fromName: string;
  word: string;
}

export interface SpellResultMsg {
  word: string;
  start: [number, number];
  end: [number, number];
  strokeLines: [number, number][][];
  penUpLines: [number, number][][];
  template: [number, number][][];
  likeness: number;
  letters: { char: string; likeness: number }[];
  heightM: number;
  stats: CostOfFun;
  steps: Step[];
  ms: number;
}

export type ToWorker = PlanRequest | ArtRequestMsg | WorkoutRequest | CrawlRequest | SpellRequest;

/** A pin on the map: a park near the route, or a numbered crawl stop. */
export interface Pin {
  kind: "park" | "stop";
  at: [number, number];
  name: string;
  /** 1-based order along the route, or 0 for parks the route doesn't visit. */
  number: number;
  detail: string;
  /** Crawl stop index, for swapping or skipping. */
  stopIndex?: number;
}

/** Workouts and crawls: a walk with no normal route to compare. */
export interface TourResult {
  kind: "workout" | "crawl";
  start: [number, number];
  end: [number, number];
  line: [number, number][];
  name: string;
  summary: string;
  stats: CostOfFun;
  statItems: [string, string][];
  notes: string[];
  pins: Pin[];
  steps: Step[];
  ms: number;
}

export interface ArtRequestMsg {
  type: "art";
  id: number;
  start: [number, number];
  fromName: string;
  shape: ShapeId;
  minutes: number;
}

export interface ArtResultMsg {
  shape: ShapeId;
  label: string;
  minutes: number;
  start: [number, number];
  line: [number, number][];
  template: [number, number][];
  likeness: number;
  meanErrorM: number;
  maxErrorM: number;
  stats: CostOfFun;
  steps: Step[];
  ms: number;
}

export interface PlanResult {
  mode: ModeId;
  seed: number;
  /** Snapped start and end (nodes on the walking graph), for the URL and markers. */
  from: [number, number];
  to: [number, number];
  normal: [number, number][];
  better: [number, number][];
  normalStats: CostOfFun;
  betterStats: CostOfFun;
  capMinutes: number;
  summary: string;
  name: string;
  steps: Step[];
  strategy: string;
  /**
   * Set when the better route is the normal one, or adds under a minute, and why: the normal
   * walk already fills the time limit; it already does what the mode asks (no right turns);
   * there's none of the mode's feature within reach; or no detour fits.
   */
  sameAsNormal: SameAsNormal | null;
  /** Whether the walker asked for a longer walk (detours up to 90 minutes). */
  long: boolean;
  /** What the mode looks for, when the route found none of it ("staircases"), else null. */
  missingFeature: string | null;
  /** Parks along or near the better route. */
  pins: Pin[];
  ms: number;
}

export type FromWorker =
  | { type: "ready"; info: ReadyInfo }
  | { type: "plan"; id: number; result: PlanResult }
  | { type: "art"; id: number; result: ArtResultMsg }
  | { type: "tour"; id: number; result: TourResult }
  | { type: "spell"; id: number; result: SpellResultMsg }
  | { type: "error"; id: number; message: string; suggestion?: string }
  | { type: "fatal"; message: string };
