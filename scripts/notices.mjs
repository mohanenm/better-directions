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
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  seen.set(name, { version: pj.version, license: pj.license ?? "see text", text: file ? readFileSync(join(dir, file), "utf8").trim() : "" });
  for (const dep of Object.keys(pj.dependencies ?? {})) walk(dep);
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
  "",
  "Third-party software shipped in this page:",
  "",
];
for (const [name, { version, license, text }] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  parts.push("=".repeat(72), `${name} ${version} (${license})`, "=".repeat(72), text || "(no licence file in the package; licence field above)", "");
}
writeFileSync("app/public/licenses.txt", parts.join("\n"));
console.log(`Wrote app/public/licenses.txt (${seen.size} packages)`);
