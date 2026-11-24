/** Messages between the page and the planning worker. */
import type { Step } from "../modes/directions";
import type { ShapeId } from "../art/shapes";
import type { ModeId } from "../modes/modes";
import type { CostOfFun } from "../modes/stats";

export interface ReadyInfo {
  city: string;
  bbox: { west: number; south: number; east: number; north: number };
  attribution: string;
  terrainAttribution: string;
  dataAsOf: string;
  violations: number;
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
  ms: number;
}

export type FromWorker =
  | { type: "ready"; info: ReadyInfo }
  | { type: "plan"; id: number; result: PlanResult }
  | { type: "art"; id: number; result: ArtResultMsg }
  | { type: "error"; id: number; message: string }
  | { type: "fatal"; message: string };
