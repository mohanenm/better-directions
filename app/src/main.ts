/**
 * Page controller. Everything runs on the device: the planner in a Web Worker, place search over
 * a local list, and location only when the user taps "Use my location".
 */
import { CITY, cityData } from "./city";
import "./style.css";
import { SHAPE_IDS, SHAPES, type ShapeId } from "./art/shapes";
import { MODE_IDS, MODES, type ModeId } from "./modes/modes";
import { attachCombo } from "./ui/combo";
import { FAMOUS_ROUTES } from "./ui/famous";
import { createMap, type RouteMap } from "./ui/map";
import type { ArtResultMsg, FromWorker, PlanResult, ReadyInfo } from "./ui/protocol";
import { artCard, planCard, renderArt, renderResult } from "./ui/render";
import { renderShareImage, type ShareCard } from "./ui/share-image";
import type { Place } from "./ui/search";
import { parseLink, serializeLink, type LinkState } from "./ui/url";

type End = "from" | "to";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const statusEl = $("#status");
const resultEl = $("#result");
const goButton = $<HTMLButtonElement>("#go");

const state: LinkState = { from: null, to: null, fromName: null, toName: null, mode: "stairs", seed: 1, art: null, artMinutes: 40 };
let places: Place[] = [];
let routeMap: RouteMap | null = null;
let info: ReadyInfo | null = null;
let requestId = 0;
let lastCard: ShareCard | null = null;

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
}

// --- Worker ------------------------------------------------------------------------------------

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
setStatus(`Loading the map of ${CITY.name} (about 3 MB the first time)…`);

worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
  const msg = event.data;
  if (msg.type === "ready") onReady(msg.info);
  else if (msg.type === "fatal") setStatus(msg.message, true);
  else if (msg.id !== requestId) return; // a newer request superseded this one
  else if (msg.type === "error") {
    goButton.disabled = false;
    setStatus(msg.message, true);
  } else if (msg.type === "art") onArt(msg.result);
  else onPlan(msg.result);
});

function onReady(ready: ReadyInfo): void {
  info = ready;
  document.documentElement.dataset["loadTimings"] = JSON.stringify(ready.timings);
  if (ready.dataAsOf) $("#data-date").textContent = `, data as of ${ready.dataAsOf.slice(0, 10)}`;
  if (ready.terrainAttribution) $("#terrain-credit").textContent = ready.terrainAttribution;
  Object.assign(state, parseLink(window.location.search, ready.bbox));
  routeMap = createMap($("#map"), ready.bbox);
  routeMap.onTap(onMapTap);
  syncInputs();
  setStatus(state.from && (state.to || state.art) ? "" : "Pick a start and an end: search above, or tap the map.");
  if (state.art && state.from) requestArt();
  else if (state.from && state.to) requestPlan();
}

// --- Choosing start and end ----------------------------------------------------------------------

const input = (end: End) => $<HTMLInputElement>(`#${end}-input`);

function setEnd(end: End, point: [number, number] | null, name: string | null): void {
  state[end] = point;
  state[end === "from" ? "fromName" : "toName"] = name;
  input(end).value = name ?? (point ? "Point on the map" : "");
  routeMap?.setMarker(end, point);
  writeLink();
}

function syncInputs(): void {
  (["from", "to"] as End[]).forEach((end) => {
    const name = end === "from" ? state.fromName : state.toName;
    input(end).value = name ?? (state[end] ? "Point on the map" : "");
    routeMap?.setMarker(end, state[end]);
  });
  const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${state.mode}"]`);
  if (radio) radio.checked = true;
  updateSeedRow();
}

function onMapTap(point: [number, number]): void {
  const end: End = !state.from ? "from" : !state.to ? "to" : document.activeElement === input("from") ? "from" : "to";
  setEnd(end, point, null);
  if (state.from && state.to) requestPlan();
  else setStatus("Start set. Now pick an end.");
}

for (const end of ["from", "to"] as End[]) {
  attachCombo(input(end), $<HTMLUListElement>(`#${end}-list`), () => places, (p) => {
    setEnd(end, [p.lon, p.lat], p.name);
    routeMap?.flyTo([p.lon, p.lat]);
    if (state.from && state.to) requestPlan();
  });
}

document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
  const end = button.closest<HTMLElement>("[data-end]")!.dataset["end"] as End;
  button.addEventListener("click", () => {
    const action = button.dataset["action"];
    if (action === "centre" && routeMap) {
      setEnd(end, routeMap.centre(), null);
      if (state.from && state.to) requestPlan();
    } else if (action === "swap") {
      const [f, fn, t, tn] = [state.from, state.fromName, state.to, state.toName];
      setEnd("from", t, tn);
      setEnd("to", f, fn);
      if (state.from && state.to) requestPlan();
    } else if (action === "locate") {
      locate(end);
    }
  });
});

/** Location is used only on the device, and only when the user asks. */
function locate(end: End): void {
  if (!("geolocation" in navigator)) {
    setStatus("Your browser can't share your location.", true);
    return;
  }
  setStatus("Finding you… (your location stays on this device)");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const point: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      const b = info?.bbox;
      if (b && (point[0] < b.west || point[0] > b.east || point[1] < b.south || point[1] > b.north)) {
        setStatus(`You seem to be outside ${CITY.name}. Better Directions only knows ${CITY.name} for now.`, true);
        return;
      }
      setEnd(end, point, "My location");
      routeMap?.flyTo(point);
      if (state.from && state.to) requestPlan();
      else setStatus("Got you. Now pick an end.");
    },
    () => setStatus("Couldn't get your location. You can search or tap the map instead.", true),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

// --- Modes ---------------------------------------------------------------------------------------

const grid = $("#mode-grid");
for (const id of MODE_IDS) {
  const m = MODES[id];
  const wrap = document.createElement("div");
  wrap.className = "mode-option";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "mode";
  radio.value = id;
  radio.id = `mode-${id}`;
  radio.checked = id === state.mode;
  const label = document.createElement("label");
  label.htmlFor = radio.id;
  const strong = document.createElement("strong");
  strong.textContent = m.name;
  const span = document.createElement("span");
  span.textContent = m.tagline;
  label.append(strong, span);
  wrap.append(radio, label);
  grid.append(wrap);
  radio.addEventListener("change", () => {
    state.mode = id as ModeId;
    state.art = null;
    updateSeedRow();
    writeLink();
    if (state.from && state.to) requestPlan();
  });
}

function updateSeedRow(): void {
  $("#seed-row").hidden = state.mode !== "chaos";
  $("#seed-value").textContent = String(state.seed);
}

$("#shuffle").addEventListener("click", () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  state.seed = (buf[0]! % 999_999) + 1;
  updateSeedRow();
  writeLink();
  if (state.from && state.to) requestPlan();
});

// --- Planning ------------------------------------------------------------------------------------

$<HTMLFormElement>("#planner").addEventListener("submit", (e) => {
  e.preventDefault();
  requestPlan();
});

function requestPlan(): void {
  if (!info) return;
  state.art = null;
  if (!state.from || !state.to) {
    setStatus("Pick both a start and an end first.", true);
    return;
  }
  requestId++;
  goButton.disabled = true;
  setStatus(`Finding the ${MODES[state.mode].name.toLowerCase()} route…`);
  worker.postMessage({
    type: "plan",
    id: requestId,
    from: state.from,
    to: state.to,
    fromName: state.fromName ?? "your start",
    toName: state.toName ?? "your destination",
    mode: state.mode,
    seed: state.seed,
  });
}

function onPlan(result: PlanResult): void {
  goButton.disabled = false;
  lastCard = planCard(result);
  // Store the snapped points (on a path), not the exact tap or GPS fix.
  state.from = result.from;
  state.to = result.to;
  routeMap?.setMarker("from", result.from);
  routeMap?.setMarker("to", result.to);
  writeLink();
  routeMap?.setRoutes(result.normal, result.better);
  renderResult(result, (at) => routeMap?.flyTo(at));
  clearShareImage();
  resultEl.hidden = false;
  setStatus("");
  // Screen readers hear the result; sighted users see it in the card.
  $("#announcer").textContent = `Route ready. ${result.summary} Step-by-step directions follow the stats.`;
}

// --- Sharing -------------------------------------------------------------------------------------

function writeLink(): void {
  history.replaceState(null, "", `${window.location.pathname}${serializeLink(state)}`);
}

$("#share").addEventListener("click", async () => {
  if (!lastCard) return;
  const url = window.location.href;
  try {
    if (navigator.share) await navigator.share({ title: "Better Directions", text: lastCard.summary, url });
    else {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied.");
    }
  } catch {
    // The user closed the share sheet, or the clipboard isn't available: nothing to do.
  }
});

// --- Share image ---------------------------------------------------------------------------------

let shareBlob: Blob | null = null;
let shareUrl: string | null = null;

function clearShareImage(): void {
  if (shareUrl) URL.revokeObjectURL(shareUrl);
  shareBlob = null;
  shareUrl = null;
  $("#share-image").hidden = true;
}

$("#make-image").addEventListener("click", async () => {
  if (!lastCard || !routeMap) return;
  clearShareImage();
  setStatus("Drawing your share image…");
  try {
    shareBlob = await renderShareImage(routeMap.map, lastCard);
    shareUrl = URL.createObjectURL(shareBlob);
    $<HTMLImageElement>("#share-preview").src = shareUrl;
    $<HTMLAnchorElement>("#share-image-download").href = shareUrl;
    $("#share-image").hidden = false;
    setStatus("Share image ready. It was drawn on your device.");
  } catch {
    setStatus("Couldn't draw the share image on this device.", true);
  }
});

$("#share-image-share").addEventListener("click", async () => {
  if (!shareBlob || !lastCard) return;
  const file = new File([shareBlob], "better-directions.png", { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: lastCard.name, text: lastCard.summary });
    } else {
      $<HTMLAnchorElement>("#share-image-download").click();
    }
  } catch {
    // Share sheet closed: nothing to do.
  }
});

// --- GPS art ---------------------------------------------------------------------------------------

const artShape = $<HTMLSelectElement>("#art-shape");
artShape.replaceChildren(
  ...SHAPE_IDS.map((id) => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = SHAPES[id].label;
    return o;
  }),
);

$<HTMLFormElement>("#art-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!state.from) {
    setStatus("Pick a From point first: the drawing starts there.", true);
    input("from").focus();
    return;
  }
  state.art = artShape.value as ShapeId;
  state.artMinutes = Number(document.querySelector<HTMLInputElement>('input[name="art-len"]:checked')?.value ?? 40);
  requestArt();
});

function requestArt(): void {
  if (!info || !state.from || !state.art) return;
  requestId++;
  artShape.value = state.art;
  const len = document.querySelector<HTMLInputElement>(`input[name="art-len"][value="${state.artMinutes}"]`);
  if (len) len.checked = true;
  $<HTMLDetailsElement>("#art").open = true;
  setStatus(`Drawing a ${SHAPES[state.art].label.toLowerCase()} with ${CITY.name}'s streets…`);
  worker.postMessage({ type: "art", id: requestId, start: state.from, fromName: state.fromName ?? "your start", shape: state.art, minutes: state.artMinutes });
}

function onArt(result: ArtResultMsg): void {
  goButton.disabled = false;
  lastCard = artCard(result);
  state.from = result.start;
  routeMap?.setMarker("from", result.start);
  const end = result.line.at(-1)!;
  routeMap?.setMarker("to", SHAPES[result.shape].closed ? null : end);
  writeLink();
  routeMap?.setRoutes(result.template, result.line);
  renderArt(result, (at) => routeMap?.flyTo(at));
  clearShareImage();
  resultEl.hidden = false;
  setStatus("");
  $("#announcer").textContent = `Drawing ready. ${lastCard.summary} Step-by-step directions follow the stats.`;
}

// --- Famous better routes --------------------------------------------------------------------------

$("#famous-list").replaceChildren(
  ...FAMOUS_ROUTES.map((f) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = f.title;
    const pitch = document.createElement("span");
    pitch.textContent = f.pitch;
    const meta = document.createElement("small");
    meta.textContent = `${MODES[f.mode].name} · ${f.fromName} to ${f.toName}`;
    button.append(title, pitch, meta);
    button.addEventListener("click", () => {
      state.mode = f.mode;
      state.seed = f.seed;
      setEnd("from", f.from, f.fromName);
      setEnd("to", f.to, f.toName);
      syncInputs();
      requestPlan();
      $("#planner").scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
    li.append(button);
    return li;
  }),
);

// --- Places --------------------------------------------------------------------------------------

fetch(cityData("places.json"))
  .then((res) => (res.ok ? res.json() : []))
  .then((list: Place[]) => {
    places = list;
  })
  .catch(() => {
    places = [];
  });
