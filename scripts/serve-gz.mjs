#!/usr/bin/env node
/**
 * Serves dist/ under /better-directions/ with gzip, as GitHub Pages does, for `npm run perf`.
 * Vite's preview server doesn't compress, which roughly triples the graph download.
 *
 *   npm run pages:gz &      # http://localhost:4174/better-directions/
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = resolve(process.argv[2] ?? "dist");
const BASE = "/better-directions/";
const PORT = 4174;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain" };
const cache = new Map();

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith(BASE)) return res.writeHead(404).end();
  const file = normalize(join(ROOT, decodeURIComponent(url.pathname.slice(BASE.length)) || "index.html"));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    let body = cache.get(file);
    if (!body) {
      const raw = await readFile(file);
      body = { raw, gz: gzipSync(raw, { level: 6 }) };
      cache.set(file, body);
    }
    const gz = /gzip/.test(req.headers["accept-encoding"] ?? "");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", ...(gz ? { "content-encoding": "gzip" } : {}) });
    res.end(gz ? body.gz : body.raw);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`Serving ${ROOT} with gzip at http://localhost:${PORT}${BASE}`));
