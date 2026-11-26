#!/usr/bin/env node
/**
 * Low-end phone emulation over DevTools (no dependencies): 6x CPU slowdown, slow-4G network,
 * cold cache, phone viewport. Measures time to interactive, worker load phases, time to plan
 * a route, bytes transferred and JS heap in the page and the planning worker.
 *
 *   npm run pages:gz &                 # gzip, like Pages; Vite's preview server doesn't compress
 *   AREA=dc node scripts/perf.mjs      # default: lyon
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSER = process.env.BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const URL_BASE = process.env.ORIGIN ?? "http://localhost:4174";
const PORT = 9335;
const CPU_SLOWDOWN = Number(process.env.CPU ?? 6);
const NET = { latency: 150, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8 }; // ~slow 4G
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AREA = process.env.AREA ?? "lyon";
// A typical route in each area, between two well-known places.
const ROUTES = {
  lyon: "from=4.83200,45.75780&to=4.83360,45.76750&mode=stairs",
  dc: "from=-77.04340,38.90960&to=-77.00910,38.88990&mode=stairs",
  arlington: "from=-77.07120,38.89660&to=-77.09530,38.88680&mode=stairs",
  "silver-spring": "from=-77.03110,38.99390&to=-77.09460,38.98470&mode=stairs",
  richmond: "from=-77.43250,37.53230&to=-77.45020,37.54680&mode=stairs",
  baltimore: "from=-76.61050,39.28560&to=-76.59330,39.28230&mode=stairs",
  chicago: "from=-87.64030,41.87890&to=-87.62330,41.88270&mode=stairs",
  dundee: "from=-123.01030,45.27790&to=-123.00500,45.28300&mode=stairs",
  newberg: "from=-122.97180,45.30060&to=-122.96750,45.30750&mode=stairs",
  copenhagen: "from=12.56830,55.67610&to=12.58550,55.68030&mode=stairs",
  malmo: "from=13.00070,55.60500&to=12.97650,55.61330&mode=stairs",
};

const browser = spawn(BROWSER, ["--headless=new", "--no-first-run", `--user-data-dir=${mkdtempSync(join(tmpdir(), "bd-perf-"))}`, `--remote-debugging-port=${PORT}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const workers = [];
  let bytes = 0;
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Network.loadingFinished") bytes += m.params.encodedDataLength;
    if (m.method === "Target.attachedToTarget") {
      const sid = m.params.sessionId;
      if (m.params.targetInfo.type === "worker") workers.push(sid);
      // Throttle workers too (throttling is per target), then let them start.
      (async () => {
        await send("Network.enable", {}, sid);
        await send("Network.setCacheDisabled", { cacheDisabled: true }, sid);
        await send("Network.emulateNetworkConditions", { offline: false, ...NET }, sid);
        await send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN }, sid);
        await send("Runtime.runIfWaitingForDebugger", {}, sid);
      })();
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Network.emulateNetworkConditions", { offline: false, ...NET });
  await send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  // ROUTE="from=…&to=…&mode=…" measures another route instead.
  const query = `?${AREA === "lyon" ? "" : `area=${AREA}&`}${process.env.ROUTE ?? ROUTES[AREA]}`;
  const t0 = Date.now();
  await send("Page.navigate", { url: `${URL_BASE}/better-directions/${query}` });
  let ready = 0, routed = 0;
  for (let i = 0; i < 1200 && !routed; i++) {
    await sleep(100);
    if (!ready && (await evaluate("!!document.documentElement.dataset.loadTimings"))) ready = Date.now() - t0;
    if (/^Route ready/.test((await evaluate("document.getElementById('announcer').textContent")) ?? "")) routed = Date.now() - t0;
  }
  const timings = JSON.parse((await evaluate("document.documentElement.dataset.loadTimings")) ?? "{}");

  // Plan the same trip in another mode on the already-loaded graph (planning time only).
  await evaluate("document.getElementById('announcer').textContent = ''");
  const p0 = Date.now();
  await evaluate("document.getElementById('mode-parks').click()");
  let planned = 0;
  for (let i = 0; i < 600 && !planned; i++) {
    await sleep(50);
    if (/^Route ready/.test((await evaluate("document.getElementById('announcer').textContent")) ?? "")) planned = Date.now() - p0;
  }

  await send("Runtime.enable");
  const pageHeap = (await send("Runtime.getHeapUsage")).result;
  let workerHeap = 0;
  for (const sid of workers) {
    await send("Runtime.enable", {}, sid);
    const h = (await send("Runtime.getHeapUsage", {}, sid)).result;
    if (h) workerHeap = Math.max(workerHeap, h.usedSize);
  }
  const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
  console.log(JSON.stringify({ area: AREA, cpuSlowdown: CPU_SLOWDOWN, network: "4 Mbps / 150 ms", timeToReadyMs: ready, timeToFirstRouteMs: routed, workerLoad: timings, secondRoutePlanMs: planned, transferred: mb(bytes), pageHeap: mb(pageHeap?.usedSize ?? 0), workerHeap: mb(workerHeap) }, null, 2));
  ws.close();
} finally {
  browser.kill();
}
