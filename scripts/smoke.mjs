#!/usr/bin/env node
/**
 * Browser smoke test (local only; needs a Chromium-based browser, no npm dependencies).
 * Drives the browser over the DevTools protocol: loads the preview build under the sub-path,
 * waits for a route, saves screenshots, and fails on any CSP violation, script error or
 * request to another host.
 *
 *   npm run pages:gz &   # serves http://localhost:4174/better-directions/ like Pages: gzip, and real 404s
 *   BROWSER="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" node scripts/smoke.mjs [outdir]
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSER = process.env.BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:4174";
const BASE = "/better-directions/";
const OUT = process.argv[2] ?? mkdtempSync(join(tmpdir(), "bd-smoke-"));
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const CASES = [
  { name: "phone-stairs", width: 390, height: 844, mobile: true, scroll: true,
    query: "?from=4.83200,45.75780&to=4.83360,45.76750&fromName=Place%20Bellecour&toName=Place%20des%20Terreaux&mode=stairs" },
  { name: "desktop-buildings", width: 1280, height: 800, mobile: false, scroll: true,
    query: "?from=4.82740,45.76060&to=4.82250,45.76230&fromName=Cath%C3%A9drale%20Saint-Jean&toName=Basilique%20de%20Fourvi%C3%A8re&mode=buildings" },
  { name: "phone-empty", width: 420, height: 900, mobile: true, query: "", expectRoute: false },
  { name: "keyboard-only", width: 390, height: 844, mobile: true, query: "", keyboard: true },
  { name: "famous-and-share", width: 390, height: 844, mobile: true, query: "", famous: true },
  { name: "gps-art-heart", width: 1280, height: 900, mobile: false,
    query: "?from=4.84500,45.75100&fromName=Guilloti%C3%A8re&art=heart&len=55" },
  { name: "pub-crawl", width: 1280, height: 800, mobile: false, crawl: true,
    query: "?from=4.83360,45.76750&fromName=Place%20des%20Terreaux&crawl=pub&count=4&len=45" },
  { name: "workout-stairs", width: 390, height: 844, mobile: true,
    query: "?from=4.82740,45.76060&fromName=Cath%C3%A9drale%20Saint-Jean&workout=stairs&len=30" },
  { name: "spell-from-link", width: 1280, height: 800, mobile: false,
    query: "?from=4.84500,45.75100&fromName=Guilloti%C3%A8re&spell=HI" },
  { name: "spell-private", width: 390, height: 844, mobile: true, spellPrivate: "ADA",
    query: "?from=4.84500,45.75100&fromName=Guilloti%C3%A8re&open=spell" },
  { name: "dc-left-turns", width: 1280, height: 800, mobile: false,
    query: "?area=dc&from=-77.04340,38.90960&to=-77.02970,38.90960&fromName=Dupont%20Circle&toName=Logan%20Circle&mode=no-right" },
  { name: "phone-dark", width: 390, height: 844, mobile: true, dark: true, keyboard: true,
    query: "" },
  { name: "dark-switch", width: 1280, height: 800, mobile: false, theme: true,
    query: "?area=chicago&from=-87.64030,41.87890&to=-87.62330,41.88270&fromName=Union%20Station&toName=Cloud%20Gate&mode=stairs" },
  { name: "no-elevation", width: 390, height: 844, mobile: true, noTerrain: true,
    query: "?area=copenhagen&from=12.56830,55.67610&to=12.58780,55.69260&fromName=R%C3%A5dhuspladsen&toName=%C3%98sterport&mode=parks" },
  { name: "rapid-modes", width: 1280, height: 800, mobile: false, rapidModes: true,
    query: "?from=4.83200,45.75780&to=4.83360,45.76750&fromName=Place%20Bellecour&toName=Place%20des%20Terreaux&mode=stairs" },
  { name: "error-visible", width: 390, height: 844, mobile: true, expectRoute: false, expectError: true,
    query: "?from=4.83200,45.75780&to=4.83200,45.75780&mode=stairs&open=plan,crawl,art,spell,workout,famous,about" },
  { name: "too-long", width: 1280, height: 800, mobile: false, tooLong: true,
    query: "?area=arlington&from=-77.04670,38.82970&to=-77.09540,38.88680&fromName=Potomac%20Yard&toName=Clarendon&mode=stairs" },
  { name: "park-as-stop", width: 1280, height: 800, mobile: false, parkStop: true,
    query: "?from=4.85190,45.77030&to=4.83200,45.75780&fromName=T%C3%AAte%20d%27Or&toName=Place%20Bellecour&mode=trail" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "bd-profile-"));
const browser = spawn(BROWSER, [
  "--headless=new", "--no-first-run", `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

let failures = 0;
try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(200); }
  }
  if (!version) throw new Error("browser didn't start");
  for (const c of CASES) failures += await runCase(c);
} finally {
  browser.kill();
}
console.log(failures ? `FAILED (${failures} problems)` : `OK. Screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);

async function runCase(c) {
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const problems = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    if (msg.method === "Log.entryAdded" && ["error"].includes(msg.params.entry.level)) problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") problems.push(`console: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (msg.method === "Network.requestWillBeSent") {
      const url = new URL(msg.params.request.url);
      if (!["data:", "blob:"].includes(url.protocol) && url.origin !== ORIGIN) problems.push(`third-party request: ${url.href}`);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.result?.value;

  await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: c.width, height: c.height, deviceScaleFactor: 1, mobile: c.mobile });
  // A known system theme, so results and the theme switch do not depend on the machine running this.
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: c.dark ? "dark" : "light" }] });
  await send("Page.navigate", { url: `${ORIGIN}${BASE}${c.query}` });

  const key = async (k, code) => {
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: code });
  };
  if (c.keyboard) {
    // Choose both places and plan using only the keyboard.
    for (let i = 0; i < 60; i++) { await sleep(250); if ((await evaluate("document.getElementById('status').textContent")).startsWith("Pick a start")) break; }
    for (const [field, text] of [["from-input", "bellecour"], ["to-input", "terreaux"]]) {
      await evaluate(`document.getElementById('${field}').focus()`);
      await send("Input.insertText", { text });
      await sleep(300);
      await key("ArrowDown", 40);
      await key("Enter", 13);
      await sleep(200);
    }
    if (!(await evaluate("document.getElementById('from-input').value")).includes("Bellecour")) problems.push("keyboard: start not chosen");
    if (!(await evaluate("document.getElementById('to-input').value")).includes("Terreaux")) problems.push("keyboard: end not chosen");
  }
  if (c.famous) {
    for (let i = 0; i < 60; i++) { await sleep(250); if ((await evaluate("document.getElementById('status').textContent")).startsWith("Pick a start")) break; }
    // Famous routes are listed in the planner from the start; pick the first.
    const listed = await evaluate("document.querySelectorAll('#famous-list button').length > 0 && document.getElementById('famous-list').getBoundingClientRect().height > 0");
    if (!listed) problems.push("famous routes aren't listed in the planner");
    await evaluate("document.querySelector('#famous-list button').click()");
  }
  const wantRoute = c.expectRoute !== false;
  const READY = /^(Route|Drawing|Crawl|Loop|Word) ready/;
  let status = "";
  const waitForReady = async () => {
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      status = (await evaluate("(document.getElementById('announcer')?.textContent || document.getElementById('status')?.textContent) ?? ''")) ?? "";
      if (c.expectError ? await evaluate("document.getElementById('status').classList.contains('error')") : wantRoute ? READY.test(status) : status.startsWith("Pick a start")) break;
    }
  };
  if (c.spellPrivate) {
    // Type a word without ticking "include the word": it must not reach the URL.
    for (let i = 0; i < 60; i++) { await sleep(250); if ((await evaluate("document.getElementById('status').textContent")) === "") break; }
    await evaluate(`document.getElementById('spell-word').value = '${c.spellPrivate}'; document.getElementById('spell-form').requestSubmit();`);
  }
  await waitForReady();
  await sleep(1500); // let the map draw the route
  if (c.spellPrivate) {
    const leaked = await evaluate(`location.href.toUpperCase().includes('${c.spellPrivate}')`);
    const shareOff = await evaluate("document.getElementById('share').disabled");
    if (leaked) problems.push("spell: the word is in the URL without consent");
    if (!shareOff) problems.push("spell: Share link should be off while the word is kept out of links");
  }
  if (c.parkStop) {
    // Open a park pin's popup, add it as a stop, and check the route replans through it.
    await evaluate("document.getElementById('announcer').textContent = ''");
    const added = await evaluate(`(() => {
      const pin = [...document.querySelectorAll('.pin.park')][0];
      if (!pin) return 'no park pins';
      pin.click();
      const button = [...document.querySelectorAll('.pin-popup button')].find((b) => b.textContent === 'Add as a stop');
      if (!button) return 'no Add as a stop button';
      button.click();
      return 'ok';
    })()`);
    if (added !== "ok") problems.push(`park stop: ${added}`);
    await waitForReady();
    await sleep(800);
    const via = await evaluate("new URLSearchParams(location.search).get('via')");
    const listed = await evaluate("document.querySelectorAll('#stop-list li').length");
    if (!via || listed !== 1) problems.push(`park stop: link via=${via}, ${listed} stops listed`);
  }
  if (c.theme) {
    // Switch to dark with a route on the map: the page, the basemap and the route all follow,
    // and the route is still drawn. The share image is a snapshot of the map, so sample it.
    const before = await evaluate("document.getElementById('theme-toggle').getAttribute('aria-pressed')");
    await evaluate("document.getElementById('theme-toggle').click()");
    await sleep(2500);
    const after = JSON.parse(await evaluate(`JSON.stringify({ pressed: document.getElementById('theme-toggle').getAttribute('aria-pressed'),
      theme: document.documentElement.dataset.theme, paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() })`));
    if (before !== "false" || after.pressed !== "true" || after.theme !== "dark" || after.paper !== "#121826") problems.push(`theme: switch didn't turn dark (${before} -> ${JSON.stringify(after)})`);
    await evaluate("document.getElementById('make-image').click()");
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) { await sleep(250); ready = await evaluate("!document.getElementById('share-image').hidden && document.getElementById('share-preview').naturalWidth > 0"); }
    const seen = JSON.parse(await evaluate(`JSON.stringify((() => {
      const img = document.getElementById('share-preview');
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, 820).data; let dark = 0, route = 0, n = 0;
      for (let i = 0; i < px.length; i += 4 * 7) { n++; const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        if (r + g + b < 160) dark++;
        if (Math.abs(r - 0x8f) < 30 && Math.abs(g - 0x97) < 30 && Math.abs(b - 0xff) < 30) route++; }
      return { darkShare: dark / n, routeShare: route / n };
    })())`));
    if (!ready || seen.darkShare < 0.5) problems.push(`theme: the map didn't turn dark (${JSON.stringify(seen)})`);
    if (seen.routeShare < 0.002) problems.push(`theme: no route drawn after the switch (${JSON.stringify(seen)})`);
    console.log(`  dark map ${Math.round(seen.darkShare * 100)}% dark pixels, route ${(seen.routeShare * 100).toFixed(1)}% of the map`);
  }
  if (c.rapidModes) {
    // Switch modes quickly: the line on the map must end up as the last result's line.
    await evaluate("document.getElementById('announcer').textContent = ''");
    // From the result's own mode chips, as someone comparing modes would.
    for (const m of ["parks", "trail", "snacks", "no-right"]) { await evaluate(`document.querySelector('#mode-chips [data-mode="${m}"]').click()`); await sleep(60); }
    await waitForReady();
    await sleep(2500);
    const keys = JSON.parse(await evaluate("JSON.stringify([document.getElementById('map').dataset.routeKey, document.getElementById('result').dataset.routeKey, new URLSearchParams(location.search).get('mode')])"));
    if (!keys[0] || keys[0] !== keys[1]) problems.push(`rapid modes: the map shows ${keys[0]} but the result is ${keys[1]}`);
    if (keys[2] !== "no-right") problems.push(`rapid modes: link mode is ${keys[2]}, not the last one clicked`);
  }
  if (c.expectError) {
    // The error must be on screen, not below the sections or under the sheet.
    const seen = JSON.parse(await evaluate(`JSON.stringify((() => {
      const s = document.getElementById('status'); const b = s.getBoundingClientRect();
      const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { error: s.classList.contains('error'), text: s.textContent, onScreen: b.top >= 0 && b.bottom <= innerHeight && b.height > 0, uncovered: !!at && s.contains(at) };
    })())`));
    if (!seen.error || !seen.onScreen || !seen.uncovered) problems.push(`error not visible: ${JSON.stringify(seen)}`);
  }
  if (c.tooLong) {
    const seen = JSON.parse(await evaluate("JSON.stringify({ title: document.getElementById('route-name').textContent, notes: document.getElementById('same-note').textContent, chips: document.getElementById('mode-chips').hidden })"));
    if (seen.title !== "Just the Normal Route" || !/capped at an hour/.test(seen.notes) || !seen.chips) problems.push(`too long: not explained (${JSON.stringify(seen)})`);
  }
  if (c.noTerrain) {
    // An area without elevation data says so: under the area picker, in the result and the footer.
    const seen = JSON.parse(await evaluate(`JSON.stringify({
      areaNote: !document.getElementById('area-note').hidden && document.getElementById('area-note').textContent.includes('no elevation data'),
      resultNote: document.getElementById('info').textContent.includes('no elevation data'),
      footer: document.querySelector('.attribution').textContent.includes('No elevation data'),
      hillsOff: document.querySelector('input[name="workout-focus"][value="hills"]').disabled })`));
    for (const [k, ok] of Object.entries(seen)) if (!ok) problems.push(`no elevation: ${k} doesn't say so`);
  }
  if (c.crawl) {
    const pins = await evaluate("document.querySelectorAll('.pin.stop').length");
    const notes = await evaluate("document.getElementById('notes').textContent");
    if (pins < 3) problems.push(`crawl: ${pins} stop pins`);
    if (!/Drink responsibly/.test(notes)) problems.push("crawl: no drinking note");
  }
  if (c.famous) {
    await evaluate("document.getElementById('share-open').click()");
    if (!(await evaluate("document.getElementById('share-dialog').open"))) problems.push("share: the Share button didn't open the share dialog");
    await evaluate("document.getElementById('make-image').click()");
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) { await sleep(250); ready = await evaluate("!document.getElementById('share-image').hidden && document.getElementById('share-preview').complete && document.getElementById('share-preview').naturalWidth > 0"); }
    const img = await evaluate(`(() => {
      const img = document.getElementById('share-preview');
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 100, c.width, 700).data; const colours = new Set();
      for (let i = 0; i < px.length; i += 4 * 997) colours.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
      return { w: img.naturalWidth, h: img.naturalHeight, colours: colours.size, name: document.getElementById('route-name').textContent, png: c.toDataURL('image/png').split(',')[1] };
    })()`);
    writeFileSync(join(OUT, "share-image.png"), Buffer.from(img.png, "base64"));
    delete img.png;
    if (!ready || img.w !== 1080 || img.h !== 1350) problems.push(`share image wrong size: ${JSON.stringify(img)}`);
    if (img.colours < 20) problems.push(`share image map area looks blank (${img.colours} colours)`);
    console.log(`  share image ${img.w}x${img.h}, ${img.colours} sampled colours, route "${img.name}"`);
    await evaluate("document.getElementById('share-dialog').close()");
  }
  if (c.scroll) {
    // Scrolling the panel to the bottom must move only the panel: not the page, map or footer.
    const layout = () => evaluate(`JSON.stringify({
      pageScroll: window.scrollY, pageTaller: document.scrollingElement.scrollHeight - innerHeight,
      mapTop: Math.round(document.getElementById('map').getBoundingClientRect().top),
      footerBottom: Math.round(document.querySelector('.attribution').getBoundingClientRect().bottom),
      panelScroll: document.getElementById('panel').scrollTop })`).then(JSON.parse);
    const before = await layout();
    const box = JSON.parse(await evaluate("JSON.stringify(document.getElementById('panel').getBoundingClientRect())"));
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    for (let i = 0; i < 20; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: 400 });
      await sleep(50);
    }
    await sleep(500);
    const after = await layout();
    if (after.panelScroll <= before.panelScroll) problems.push("scroll: the panel didn't scroll");
    if (after.pageScroll !== 0 || after.pageTaller > 0) problems.push(`scroll: the page scrolls (${JSON.stringify(after)})`);
    if (after.mapTop !== before.mapTop) problems.push(`scroll: the map moved from ${before.mapTop} to ${after.mapTop}`);
    if (after.footerBottom !== c.height) problems.push(`scroll: the footer isn't at the bottom (${after.footerBottom})`);
    await evaluate("document.getElementById('panel').scrollTop = 0");
    await sleep(200);
  }
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${c.name}.png`), Buffer.from(shot.result.data, "base64"));

  const checks = {
    novelty: await evaluate("getComputedStyle(document.getElementById('novelty')).display !== 'none' && document.getElementById('novelty').textContent.includes('For fun')"),
    attribution: await evaluate("document.querySelector('.attribution').textContent.includes('OpenStreetMap')"),
    cspMeta: await evaluate("!!document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')"),
    noCookies: await evaluate("document.cookie === ''"),
    noStorage: await evaluate("localStorage.length === 0 && sessionStorage.length === 0"),
    aboutOutOfPanel: await evaluate("!document.getElementById('panel').contains(document.getElementById('about-dialog')) && !!document.getElementById('about-open')"),
  };
  if (wantRoute) {
    checks.route = READY.test(status);
    checks.steps = (await evaluate("document.querySelectorAll('#steps li').length")) > 2;
    const summary = (await evaluate("document.getElementById('summary').textContent")) ?? "";
    checks.summary = /Normal: \d+ min\. Better: \d+ min/.test(summary) || /likeness|-minute loop|min of walking|readable/.test(summary);
    checks.seedRowHiddenUnlessChaos = await evaluate("(getComputedStyle(document.getElementById('seed-row')).display === 'none') === !location.search.includes('mode=chaos')");
    // The result replaces the planner, and its directions start within the first screen or so of
    // it (later only when there are many warnings, which come first).
    const view = JSON.parse(await evaluate(`JSON.stringify((() => {
      const panel = document.getElementById('panel');
      const top = document.getElementById('result').getBoundingClientRect().top + panel.scrollTop - panel.getBoundingClientRect().top;
      const directions = document.getElementById('directions-title').getBoundingClientRect().top + panel.scrollTop - panel.getBoundingClientRect().top;
      return { planHidden: document.getElementById('plan-view').hidden, directionsAt: Math.round(directions - top), screen: panel.clientHeight };
    })())`));
    checks.resultReplacesPlanner = view.planHidden;
    if (view.directionsAt > view.screen * 1.5) problems.push(`directions start ${view.directionsAt}px into the result, with ${view.screen}px of panel on screen`);
  }
  // Accessibility tree: every interactive control and image needs a name; landmarks must exist.
  await send("Accessibility.enable");
  const ax = (await send("Accessibility.getFullAXTree")).result?.nodes ?? [];
  const NAMED = new Set(["button", "textbox", "combobox", "radio", "link", "checkbox", "listbox", "img", "image", "slider"]);
  const unnamed = ax.filter((n) => !n.ignored && NAMED.has(n.role?.value) && !(n.name?.value ?? "").trim());
  for (const n of unnamed.slice(0, 5)) problems.push(`a11y: unnamed ${n.role.value}`);
  const roles = new Set(ax.filter((n) => !n.ignored).map((n) => n.role?.value));
  for (const landmark of ["banner", "main", "contentinfo"]) if (!roles.has(landmark)) problems.push(`a11y: no ${landmark} landmark`);
  // Page structure: ids, references, heading order, target sizes (WCAG 2.5.8), tab order.
  const structure = JSON.parse(await evaluate(`JSON.stringify((() => {
    const out = [];
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    for (const d of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) out.push('duplicate id ' + d);
    for (const e of document.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby],label[for]')) {
      for (const a of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for']) {
        for (const id of (e.getAttribute(a) || '').split(/\\s+/).filter(Boolean)) if (!document.getElementById(id)) out.push(a + ' points at missing #' + id);
      }
    }
    let prev = 0;
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if (h.closest('[hidden]')) continue;
      const level = +h.tagName[1];
      if (prev && level > prev + 1) out.push('heading skips a level: ' + h.textContent.trim().slice(0, 30));
      prev = level;
    }
    for (const e of document.querySelectorAll('button, a[href], input, select, summary')) {
      if (e.closest('.attribution p') || e.closest('[hidden]')) continue; // inline links in a sentence are exempt
      const b = e.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      // A radio inside a tall enough label is covered by the label.
      const label = e.type === 'radio' || e.type === 'checkbox' ? e.closest('label') ?? e.nextElementSibling : null;
      const t = label ? label.getBoundingClientRect() : b;
      if (t.height < 24 || t.width < 24) out.push('small target: ' + (e.textContent || e.value).trim().slice(0, 30) + ' ' + Math.round(t.width) + 'x' + Math.round(t.height));
    }
    if ([...document.querySelectorAll('[tabindex]')].some((e) => +e.getAttribute('tabindex') > 0)) out.push('positive tabindex');
    return out;
  })())`));
  for (const p of structure.slice(0, 8)) problems.push(`a11y: ${p}`);
  if (c.keyboard) {
    // Every tab stop must be on screen and show a focus indicator.
    await evaluate("document.activeElement?.blur()");
    let stops = 0;
    for (let i = 0; i < 200; i++) {
      await key("Tab", 9);
      const f = JSON.parse(await evaluate(`JSON.stringify((() => {
        const e = document.activeElement;
        if (!e || e === document.body) return null;
        if (e.dataset.smokeSeen) return { repeat: true };
        e.dataset.smokeSeen = '1';
        const ring = (el) => { const s = getComputedStyle(el); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; };
        const b = e.getBoundingClientRect();
        return { name: e.tagName + ' ' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 25),
          ring: ring(e) || (e.type === 'radio' && e.nextElementSibling && ring(e.nextElementSibling)),
          visible: b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight };
      })())`));
      if (!f) continue;
      if (f.repeat) break;
      stops++;
      if (!f.ring) problems.push(`a11y: no focus indicator on ${f.name}`);
      if (!f.visible) problems.push(`a11y: focused element off screen: ${f.name}`);
    }
    if (stops < 10) problems.push(`a11y: only ${stops} tab stops`);
  }
  for (const [k, ok] of Object.entries(checks)) if (!ok) problems.push(`check failed: ${k}`);
  console.log(`${c.name}: ${problems.length ? "PROBLEMS" : "ok"} | ${status.slice(0, 140)}`);
  for (const p of problems) console.log(`  - ${p}`);
  ws.close();
  await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`);
  return problems.length;
}
