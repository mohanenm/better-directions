/**
 * Checks on the built static site (dist/). Run `npm run build` first; skipped if dist is missing.
 * Guards the static-host constraints: CSP present, no inline scripts, everything under the
 * base path, no third-party requests, and a size budget well under GitHub Pages' 1 GB.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE, CSP } from "../../vite.config";

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(join(DIST, "index.html"));
const SIZE_BUDGET_MB = 300; // six areas come to about 185 MB
/** The only external sites the page links to (user-initiated attribution links, never fetched). */
const LINK_HOSTS = new Set(["www.openstreetmap.org", "protomaps.com"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe.skipIf(!built)("built site", () => {
  const html = built ? readFileSync(join(DIST, "index.html"), "utf8") : "";

  it("has the Content-Security-Policy meta tag, exactly as configured", () => {
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`);
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it("has no inline scripts or inline style attributes", () => {
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\ssrc="/);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/\son[a-z]+="/); // no inline event handlers
  });

  it("loads only local files under the base path; links out only for attribution", () => {
    for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (url!.startsWith("#")) continue;
      if (url!.startsWith("http")) expect(LINK_HOSTS.has(new URL(url!).host), url).toBe(true);
      else if (url!.startsWith("/")) expect(url!.startsWith(BASE), url).toBe(true); // root-absolute must include the base
      else expect(existsSync(join(DIST, url!)), `relative link to a missing file: ${url}`).toBe(true);
    }
  });

  it("ships the graph, places, tiles, fonts and sprites", () => {
    for (const f of ["data/lyon/graph.bin", "data/lyon/places.json", "basemap/sprites/light.json", "basemap/fonts/OFL.txt", "basemap/fonts/Noto Sans Regular/0-255.pbf"]) {
      expect(existsSync(join(DIST, f)), f).toBe(true);
    }
    expect(walk(join(DIST, "tiles")).filter((f) => f.endsWith(".mvt")).length).toBeGreaterThan(100);
  });

  it(`stays under ${SIZE_BUDGET_MB} MB, with no file near GitHub's 100 MB limit`, () => {
    const files = walk(DIST);
    const total = files.reduce((s, f) => s + statSync(f).size, 0);
    expect(total / 1e6).toBeLessThan(SIZE_BUDGET_MB);
    for (const f of files) expect(statSync(f).size / 1e6, f).toBeLessThan(25);
  });
});
