#!/usr/bin/env node
/** Writes app/public/licenses.txt: licences of everything shipped in the page and the data/assets credits. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const seen = new Map();
function walk(name) {
  if (seen.has(name)) return;
  const dir = join("node_modules", name);
  if (!existsSync(join(dir, "package.json"))) return;
  const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  seen.set(name, { version: pj.version, license: pj.license ?? "see text", text: licenceText(name, dir) });
  for (const dep of Object.keys(pj.dependencies ?? {})) walk(dep);
}
/**
 * The package's licence file; else a copy kept in scripts/licence-texts/ (from the package's
 * upstream repository, for packages published without one); else the "License" section of its
 * README. A licence that requires its notice to ship must not be left out, so none found fails.
 */
function licenceText(name, dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  if (file) return readFileSync(join(dir, file), "utf8").trim();
  const kept = join("scripts", "licence-texts", `${name.replace("/", "__")}.md`);
  if (existsSync(kept)) return readFileSync(kept, "utf8").trim();
  const readme = readdirSync(dir).find((f) => /^readme/i.test(f));
  const section = readme && readFileSync(join(dir, readme), "utf8").match(/^#+\s*Licen[cs]e\b[^\n]*\n([\s\S]*?)(?=^#+\s|$(?![\s\S]))/im);
  if (section && /copyright/i.test(section[1])) return section[0].trim();
  throw new Error(`No licence text for ${name}: add one to scripts/licence-texts/`);
}

const root = JSON.parse(readFileSync("package.json", "utf8"));
for (const dep of Object.keys(root.dependencies)) walk(dep);

const parts = [
  "Better Directions: licences and credits",
  "",
  "Code: MIT licence (see LICENSE in the source repository).",
  "Map data: © OpenStreetMap contributors, Open Database License (ODbL) 1.0, https://www.openstreetmap.org/copyright",
  "Basemap tiles and style: Protomaps (https://protomaps.com), built from OpenStreetMap data.",
  "Fonts: Noto Sans, SIL Open Font License 1.1 (basemap/fonts/OFL.txt).",
  "Map sprites: protomaps/basemaps-assets, derived from MIT-licensed tangrams/icons.",
  "Elevation (Lyon): IGN RGE ALTI®, Licence Ouverte 2.0 (Etalab).",
  "Elevation (US areas): USGS 3D Elevation Program (3DEP), public domain.",
  "",
  "Third-party software shipped in this page:",
  "",
];
for (const [name, { version, license, text }] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  parts.push("=".repeat(72), `${name} ${version} (${license})`, "=".repeat(72), text, "");
}
writeFileSync("app/public/licenses.txt", parts.join("\n"));
console.log(`Wrote app/public/licenses.txt (${seen.size} packages)`);
