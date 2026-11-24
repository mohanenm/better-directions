/**
 * GPS art templates: shapes and one-stroke letters as polylines in a unit box ([-1, 1], y up).
 * Closed shapes start and end at the same point, so the walk is a loop. Letters are open.
 * Only letters you can draw without lifting the pen are possible on foot.
 */

export type ShapeId = "heart" | "star" | "circle" | "square" | "triangle" | "L" | "M" | "N" | "U" | "V" | "W" | "Z";

export interface Shape {
  id: ShapeId;
  label: string;
  closed: boolean;
  points: [number, number][];
}

function heart(): [number, number][] {
  const pts: [number, number][] = [];
  const n = 20;
  for (let i = 0; i <= n; i++) {
    const t = Math.PI + (i / n) * 2 * Math.PI; // start and end at the bottom tip
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x / 17, (y + 3) / 15]);
  }
  return pts;
}

function regular(sides: number, rotationDeg: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= sides; i++) {
    const a = ((rotationDeg + (360 * i) / sides) * Math.PI) / 180;
    pts.push([Math.sin(a), Math.cos(a)]);
  }
  return pts;
}

function star(): [number, number][] {
  const outer = regular(5, 0).slice(0, 5);
  return [0, 2, 4, 1, 3, 0].map((i) => outer[i]!);
}

function uShape(): [number, number][] {
  const pts: [number, number][] = [[-0.6, 1]];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    pts.push([0.6 * Math.cos(a), -0.4 + 0.6 * Math.sin(a)]);
  }
  pts.push([0.6, 1]);
  return pts;
}

export const SHAPES: Readonly<Record<ShapeId, Shape>> = Object.freeze({
  heart: { id: "heart", label: "Heart", closed: true, points: heart() },
  star: { id: "star", label: "Star", closed: true, points: star() },
  circle: { id: "circle", label: "Circle", closed: true, points: regular(16, 0) },
  square: { id: "square", label: "Square", closed: true, points: regular(4, 45) },
  triangle: { id: "triangle", label: "Triangle", closed: true, points: regular(3, 0) },
  L: { id: "L", label: "Letter L", closed: false, points: [[-0.5, 1], [-0.5, -1], [0.6, -1]] },
  M: { id: "M", label: "Letter M", closed: false, points: [[-0.7, -1], [-0.7, 1], [0, 0], [0.7, 1], [0.7, -1]] },
  N: { id: "N", label: "Letter N", closed: false, points: [[-0.6, -1], [-0.6, 1], [0.6, -1], [0.6, 1]] },
  U: { id: "U", label: "Letter U", closed: false, points: uShape() },
  V: { id: "V", label: "Letter V", closed: false, points: [[-0.7, 1], [0, -1], [0.7, 1]] },
  W: { id: "W", label: "Letter W", closed: false, points: [[-0.9, 1], [-0.45, -1], [0, 0.3], [0.45, -1], [0.9, 1]] },
  Z: { id: "Z", label: "Letter Z", closed: false, points: [[-0.7, 1], [0.7, 1], [-0.7, -1], [0.7, -1]] },
});

export const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];
