#!/usr/bin/env node
/**
 * Cuts each area's walking graph into the tiles the page loads (see app/src/graph/tiles.ts):
 * reads data/<area>/graph.bin, works out the feature lists over the whole area, and writes
 * app/public/data/<area>/graph/base.json and one .bin per tile, replacing what was there. Areas
 * under TILED_FROM_BYTES aren't cut up: they get the graph as built (whole.bin).
 *
 *   npm run tiles              # every area
 *   npm run tiles -- dc lyon   # just these
 *
 * Runs the app's own TypeScript (the same decoder and feature code the page uses) through Vite.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { decodeGraph } = await server.ssrLoadModule("/app/src/graph/format.ts");
  const { Graph } = await server.ssrLoadModule("/app/src/graph/graph.ts");
  const { FeatureIndex } = await server.ssrLoadModule("/app/src/modes/features.ts");
  const { tileGraph, wholeBase, TILED_FROM_BYTES, WHOLE_FILE } = await server.ssrLoadModule("/app/src/graph/tiles.ts");

  const wanted = process.argv.slice(2);
  const areas = (wanted.length ? wanted : readdirSync(join(root, "data"))).filter((a) => existsSync(join(root, "data", a, "graph.bin")));
  if (!areas.length) throw new Error("no data/<area>/graph.bin found; build the graph first");
  for (const area of areas) {
    const bytes = readFileSync(join(root, "data", area, "graph.bin"));
    const decoded = decodeGraph(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const g = new Graph(decoded);
    if (g.violations.length) throw new Error(`${area}: the graph fails the safety audit (${g.violations.length} violations)`);
    const out = join(root, "app", "public", "data", area, "graph");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    if (bytes.length < TILED_FROM_BYTES) {
      // Small enough to load whole: the graph as built, and a base file that says so.
      writeFileSync(join(out, "base.json"), JSON.stringify(wholeBase(decoded.meta)));
      writeFileSync(join(out, `${WHOLE_FILE}.bin`), bytes);
      console.log(`${area}: whole graph, ${(bytes.length / 1e6).toFixed(1)} MB`);
      continue;
    }
    const { base, tiles } = tileGraph(decoded, new FeatureIndex(g).exportFeatures());
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
