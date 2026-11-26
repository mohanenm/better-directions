#!/usr/bin/env node
/**
 * Makes what the page loads of each area's walking graph, in app/public/data/<area>/graph/
 * (generated, not committed; npm run build and npm run dev run this first):
 *
 * - most areas: whole.bin, the graph as built;
 * - areas marked `tiled` in app/src/city.ts (the big ones): base.json (meta, tile grid, feature
 *   lists worked out over the whole area) and one .bin per tile (see app/src/graph/tiles.ts).
 *
 *   npm run tiles              # every area with a data/<area>/graph.bin
 *   npm run tiles -- dc lyon   # just these
 *
 * Runs the app's own TypeScript (the same graph and feature code the page uses) through Vite.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { Graph } = await server.ssrLoadModule("/app/src/graph/graph.ts");
  const { FeatureIndex } = await server.ssrLoadModule("/app/src/modes/features.ts");
  const { tileGraph, WHOLE_FILE } = await server.ssrLoadModule("/app/src/graph/tiles.ts");
  const { AREAS } = await server.ssrLoadModule("/app/src/city.ts");

  const wanted = process.argv.slice(2);
  const areas = (wanted.length ? wanted : readdirSync(join(root, "data"))).filter((a) => existsSync(join(root, "data", a, "graph.bin")));
  if (!areas.length) throw new Error("no data/<area>/graph.bin found; build the graph first");
  for (const area of areas) {
    const bytes = readFileSync(join(root, "data", area, "graph.bin"));
    const g = Graph.fromBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (g.violations.length) throw new Error(`${area}: the graph fails the safety audit (${g.violations.length} violations)`);
    const out = join(root, "app", "public", "data", area, "graph");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    if (!AREAS.find((a) => a.id === area)?.tiled) {
      writeFileSync(join(out, `${WHOLE_FILE}.bin`), bytes);
      console.log(`${area}: whole graph, ${(bytes.length / 1e6).toFixed(1)} MB`);
      continue;
    }
    const { base, tiles } = tileGraph(g, new FeatureIndex(g).exportFeatures());
    const baseJson = JSON.stringify(base);
    writeFileSync(join(out, "base.json"), baseJson);
    let total = 0;
    for (const [id, data] of tiles) {
      writeFileSync(join(out, `${id}.bin`), data);
      total += data.length;
    }
    console.log(`${area}: ${tiles.size} tiles, ${(total / 1e6).toFixed(1)} MB; base ${(baseJson.length / 1e6).toFixed(2)} MB`);
  }
} finally {
  await server.close();
}
