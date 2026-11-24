#!/usr/bin/env node
/** Screenshot a URL with a local Chromium-based browser over DevTools (no dependencies).
 *  node scripts/screenshot.mjs <url> <out.png> [width] [height] */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, width = "1280", height = "900"] = process.argv.slice(2);
const BROWSER = process.env.BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = spawn(BROWSER, ["--headless=new", "--no-first-run", `--user-data-dir=${mkdtempSync(join(tmpdir(), "bd-shot-"))}`, `--remote-debugging-port=${PORT}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Emulation.setDeviceMetricsOverride", { width: Number(width), height: Number(height), deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(1500);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  ws.close();
} finally {
  browser.kill();
}
