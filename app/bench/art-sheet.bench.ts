/** Contact sheet of GPS art results as SVG (trace vs ideal shape), for judging likeness by eye. */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { drawShape, LocalMetres } from "../src/art/fit";
import { SHAPES, type ShapeId } from "../src/art/shapes";
import { Graph, type LonLat } from "../src/graph/graph";
import { FeatureIndex } from "../src/modes/features";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";

const CASES: [ShapeId, string, LonLat, number][] = [
  ["heart", "Guillotière", [4.845, 45.751], 55],
  ["heart", "Part-Dieu", [4.856, 45.7605], 40],
  ["star", "Guillotière", [4.845, 45.751], 55],
  ["star", "Villeurbanne", [4.88, 45.7695], 55],
  ["circle", "Part-Dieu", [4.856, 45.7605], 40],
  ["square", "Guillotière", [4.845, 45.751], 40],
  ["triangle", "Part-Dieu", [4.856, 45.7605], 40],
  ["L", "Bellecour", [4.832, 45.7578], 25],
  ["V", "Croix-Rousse", [4.832, 45.7745], 40],
  ["Z", "Guillotière", [4.845, 45.751], 40],
  ["N", "Villeurbanne", [4.88, 45.7695], 40],
  ["heart", "Bellecour", [4.832, 45.7578], 40],
];

it("art contact sheet", () => {
  const buf = readFileSync("data/lyon/graph.bin");
  const g = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const router = new Router(g);
  const fi = new FeatureIndex(g);
  const index = new NodeIndex(g);
  const cards: string[] = [];
  for (const [shape, place, centre, minutes] of CASES) {
    const r = drawShape(router, fi, index, { shape, start: centre, minutes });
    if (!r) { cards.push(`<div class="card"><p>${SHAPES[shape].label} at ${place}: none</p></div>`); continue; }
    const m = new LocalMetres(centre[0], centre[1]);
    const walked: [number, number][] = [];
    for (const d of r.route.dirEdges) for (const p of g.edgePoints(d >>> 1, (d & 1) === 0)) walked.push(m.xy(p));
    const tpl = r.template.map((p) => m.xy(p));
    const all = [...walked, ...tpl];
    const xs = all.map((p) => p[0]); const ys = all.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const span = Math.max(x1 - x0, y1 - y0) * 1.08;
    const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
    const pt = (p: [number, number]) => `${(((p[0] - cx) / span + 0.5) * 300).toFixed(1)},${((0.5 - (p[1] - cy) / span) * 300).toFixed(1)}`;
    cards.push(`<div class="card"><svg viewBox="0 0 300 300" width="300" height="300">
      <polyline points="${tpl.map(pt).join(" ")}" fill="none" stroke="#9aa1ad" stroke-width="3" stroke-dasharray="6 5"/>
      <polyline points="${walked.map(pt).join(" ")}" fill="none" stroke="#a21caf" stroke-width="3.5" stroke-linejoin="round"/>
    </svg><p><b>${SHAPES[shape].label}</b> · ${place} · ${r.likeness}% · ${(r.route.lengthM / 1000).toFixed(1)} km, ${Math.round(r.route.timeS / 60)} min</p></div>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;margin:12px;display:grid;grid-template-columns:repeat(4,310px);gap:10px}.card{border:1px solid #ddd;border-radius:8px;padding:4px}p{margin:4px}</style>${cards.join("")}`;
  writeFileSync(`${process.env["OUT_DIR"]}/art-sheet.html`, html);
});
