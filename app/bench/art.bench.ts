/** GPS art experiments on Lyon: shapes x centres x sizes. Run: npx vitest run --config vitest.bench.config.ts app/bench/art.bench.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { drawShape } from "../src/art/fit";
import { SHAPES, type ShapeId } from "../src/art/shapes";
import { Graph, type LonLat } from "../src/graph/graph";
import { FeatureIndex } from "../src/modes/features";
import { Router } from "../src/router/astar";
import { NodeIndex } from "../src/router/snap";

const CENTRES: Record<string, LonLat> = {
  "Presqu'île (Bellecour)": [4.832, 45.7578],
  "Part-Dieu": [4.856, 45.7605],
  "Croix-Rousse": [4.832, 45.7745],
  "Guillotière": [4.845, 45.751],
  "Villeurbanne (Gratte-Ciel)": [4.88, 45.7695],
};
const SHAPE_LIST: ShapeId[] = ["heart", "star", "circle", "square", "triangle", "L", "V", "Z", "N"];

it("gps art grid", () => {
  const buf = readFileSync("data/lyon/graph.bin");
  const g = Graph.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const router = new Router(g);
  const fi = new FeatureIndex(g);
  const index = new NodeIndex(g);
  const rows: string[] = ["| Shape | Centre | Asked | Likeness | Mean / max error | Walk | Time to plan |", "|---|---|---:|---:|---|---|---:|"];
  for (const shape of SHAPE_LIST) {
    for (const [name, centre] of Object.entries(CENTRES)) {
      for (const minutes of [25, 40, 55]) {
        const t0 = performance.now();
        const r = drawShape(router, fi, index, { shape, start: centre, minutes });
        const ms = performance.now() - t0;
        rows.push(r
          ? `| ${SHAPES[shape].label} | ${name} | ${minutes} min (${r.sizeM} m wide) | ${r.likeness}% | ${r.meanErrorM} / ${r.maxErrorM} m | ${(r.route.lengthM / 1000).toFixed(1)} km, ${Math.round(r.route.timeS / 60)} min | ${ms.toFixed(0)} ms |`
          : `| ${SHAPES[shape].label} | ${name} | ${minutes} min | none | | | ${ms.toFixed(0)} ms |`);
      }
    }
  }
  writeFileSync("/tmp/art-grid.md".replace("/tmp", process.env["OUT_DIR"] ?? "/tmp"), rows.join("\n") + "\n");
  console.log(rows.join("\n"));
});
