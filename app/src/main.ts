/**
 * Page controller. Everything runs on the device: the planner in a Web Worker, place search over
 * a local list, and location only when the user taps "My location" or "Nearest to me".
 */
import { AREAS, CITY, cityData, DEFAULT_AREA, nearestArea } from "./city";
import "./style.css";
import { SHAPE_IDS, SHAPES, type ShapeId } from "./art/shapes";
import { MODE_IDS, MODES, type ModeId } from "./modes/modes";
import { CRAWL_MINUTES, MAX_STOPS, MIN_STOPS, type CrawlTheme, type WorkoutFocus } from "./modes/options";
import { attachCombo } from "./ui/combo";
import { FAMOUS } from "./ui/famous";
import { createMap, type RouteMap } from "./ui/map";
import { lineKey, type PinAction } from "./ui/map";
import type { ArtResultMsg, FromWorker, Pin, PlanResult, ReadyInfo, SpellResultMsg, ToWorker, TourResult } from "./ui/protocol";
import { artCard, planCard, renderArt, renderResult, renderSpell, renderTour, sameRouteNote, setAreaNotes, setTerrainKnown, spellCard, tourCard } from "./ui/render";
import { haversineM } from "./router/geometry";
import { renderShareImage, type ShareCard } from "./ui/share-image";
import { initThemeToggle } from "./ui/theme";
import type { Place } from "./ui/search";
import { DEFAULT_OPEN, MAX_LINK_STOPS, parseLink, SECTION_IDS, serializeLink, type LinkState, type SectionId } from "./ui/url";

type End = "from" | "to";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const statusEl = $("#status");
const resultEl = $("#result");
const goButton = $<HTMLButtonElement>("#go");

const state: LinkState = {
  from: null, to: null, fromName: null, toName: null, mode: "stairs", seed: 1, art: null, artMinutes: 40,
  open: [...DEFAULT_OPEN], stops: [], workout: null, crawl: null, spell: null, spellInLink: false, long: false,
};
/** Names for the stops the user picked (links carry only the points). */
const stopNames: string[] = [];
/** Crawl stops the user swapped or skipped this session. */
let crawlSkip: number[] = [];
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

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: CITY.id });
setStatus(`Loading the map of ${CITY.name} (a few MB the first time)…`);

worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
  const msg = event.data;
  if (msg.type === "ready") onReady(msg.info);
  else if (msg.type === "fatal") setStatus(msg.message, true);
  else if (msg.id !== requestId) return; // a newer request superseded this one
  else if (msg.type === "error") {
    goButton.disabled = false;
    setStatus(msg.message, true);
    showSuggestion(msg.suggestion);
    // The inputs changed and nothing new was planned: don't leave the old route looking current.
    resultEl.hidden = true;
    routeMap?.clearRoutes();
    routeMap?.setPins([], parkActions);
  } else if (msg.type === "art") onArt(msg.result);
  else if (msg.type === "tour") onTour(msg.result);
  else if (msg.type === "spell") onSpell(msg.result);
  else onPlan(msg.result);
});

function onReady(ready: ReadyInfo): void {
  info = ready;
  document.documentElement.dataset["loadTimings"] = JSON.stringify(ready.timings);
  if (ready.dataAsOf) $("#data-date").textContent = `, data as of ${ready.dataAsOf.slice(0, 10)}`;
  // An area without elevation data says so wherever climbs would appear.
  const noTerrain = !ready.terrainAttribution;
  $("#terrain-credit").textContent = noTerrain ? "No elevation data for this area yet" : ready.terrainAttribution;
  $("#terrain-wrap").hidden = false;
  $("#area-note").textContent = `There's no elevation data for ${CITY.name} yet, so climbs, steps up and hill workouts aren't available. Staircases are still counted.`;
  $("#area-note").hidden = !noTerrain;
  setAreaNotes(noTerrain ? [`There's no elevation data for ${CITY.name} yet, so climbs and steps up aren't known.`] : []);
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="workout-focus"]:not([value="stairs"])')) input.disabled = noTerrain;
  $("#workout-terrain-note").hidden = !noTerrain;
  setTerrainKnown(!noTerrain);
  Object.assign(state, parseLink(window.location.search, ready.bbox));
  // A link whose start or end isn't in this area: say so rather than silently dropping it.
  const asked = new URLSearchParams(window.location.search);
  const dropped = [asked.get("from") && !state.from ? "start" : "", asked.get("to") && !state.to && !state.crawl ? "end" : ""].filter(Boolean);
  applyOpen();
  routeMap = createMap($("#map"), ready.bbox);
  routeMap.onTap(onMapTap);
  syncInputs();
  syncToolForms();
  renderStops();
  // Hill and mixed workouts need elevation data; leave Stairs selected for the next loop.
  if (noTerrain) $<HTMLInputElement>('input[name="workout-focus"][value="stairs"]').checked = true;
  const canPlan = state.from && (state.to || state.art || state.crawl || state.workout);
  if (dropped.length) setStatus(`The ${dropped.join(" and ")} in that link ${dropped.length > 1 ? "aren't" : "isn't"} in ${CITY.name}, so ${dropped.length > 1 ? "they were" : "it was"} left out. Pick ${dropped.length > 1 ? "them" : "it"} again.`, true);
  else setStatus(canPlan ? "" : "Pick a start and an end: search, or tap the map.");
  if (state.spell) {
    $<HTMLInputElement>("#spell-word").value = state.spell;
    $<HTMLInputElement>("#spell-in-link").checked = state.spellInLink;
  }
  if (state.spell && state.from) requestSpell();
  else if (state.art && state.from) requestArt();
  else if (state.crawl && state.from) requestCrawl();
  else if (state.workout && state.from) requestWorkout();
  else if (state.from && state.to) requestPlan();
}

// --- Area ----------------------------------------------------------------------------------------

const areaSelect = $<HTMLSelectElement>("#area");
areaSelect.replaceChildren(
  ...AREAS.map((a) => {
    const o = document.createElement("option");
    o.value = a.id;
    o.textContent = a.name;
    return o;
  }),
);
areaSelect.value = CITY.id;
document.title = `Better Directions: ${CITY.name}, the long way round`;
$("#map").setAttribute("aria-label", `Map of ${CITY.name}. Choose places with the search fields, or tap the map. Arrow keys pan, plus and minus zoom.`);

/** Areas are separate downloads, so switching loads the page afresh for the new one. */
function switchArea(id: string): void {
  if (id === CITY.id) return;
  window.location.search = id === DEFAULT_AREA ? "" : `?area=${id}`;
}

areaSelect.addEventListener("change", () => switchArea(areaSelect.value));

$("#nearest-area").addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    setStatus("Your browser can't share your location.", true);
    return;
  }
  setStatus("Finding the nearest area… (your location stays on this device)");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const here: [number, number] = [pos.coords.longitude, pos.coords.latitude];
      const near = nearestArea(here[0], here[1]);
      const km = Math.round(haversineM(here, near.center) / 1000);
      // Far from every area, don't jump anywhere: say which is nearest and how far.
      if (km > 150) setStatus(`None of the areas is near you. The nearest is ${near.name}, about ${km.toLocaleString("en")} km away; pick one from the list.`);
      else if (near.id === CITY.id) setStatus(`${CITY.name} is already the nearest area.`);
      else switchArea(near.id);
    },
    () => setStatus("Couldn't get your location. Pick an area from the list instead.", true),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
  );
});

// --- Theme and phone layout ----------------------------------------------------------------------

initThemeToggle($<HTMLButtonElement>("#theme-toggle"));

/** On phones the panel is a bottom sheet; its handle switches it between half and full height. */
const sheetToggle = $<HTMLButtonElement>("#sheet-toggle");
function setSheetFull(full: boolean): void {
  document.body.classList.toggle("sheet-full", full);
  sheetToggle.setAttribute("aria-expanded", String(full));
}
// Tap the handle to toggle, or drag it: up for full height, down for half.
let dragFrom: number | null = null;
let dragged = false;
sheetToggle.addEventListener("pointerdown", (e) => {
  dragFrom = e.clientY;
  dragged = false;
  sheetToggle.setPointerCapture(e.pointerId);
});
sheetToggle.addEventListener("pointermove", (e) => {
  if (dragFrom === null || Math.abs(e.clientY - dragFrom) < 24) return;
  dragged = true;
  setSheetFull(e.clientY < dragFrom);
});
sheetToggle.addEventListener("pointerup", () => (dragFrom = null));
sheetToggle.addEventListener("pointercancel", () => (dragFrom = null));
sheetToggle.addEventListener("click", () => {
  if (dragged) dragged = false; // the drag already decided
  else setSheetFull(!document.body.classList.contains("sheet-full"));
});

/** Draw routes, first lowering a full-height sheet so they can be seen. */
function drawRoutes(...args: Parameters<RouteMap["setRoutes"]>): void {
  setSheetFull(false);
  resultEl.dataset["routeKey"] = lineKey(args[1]); // the map's copy should match (checked by the smoke test)
  routeMap?.setRoutes(...args);
}

// --- Panel sections ------------------------------------------------------------------------------

const sectionHead = (id: SectionId) => $<HTMLButtonElement>(`#${id}-head`);
const sectionBody = (id: SectionId) => $(`#${id}-body`);

function applyOpen(): void {
  for (const id of SECTION_IDS) {
    const open = state.open.includes(id);
    sectionHead(id).setAttribute("aria-expanded", String(open));
    sectionBody(id).hidden = !open;
  }
}

function setOpen(id: SectionId, open: boolean): void {
  state.open = SECTION_IDS.filter((s) => (s === id ? open : state.open.includes(s)));
  applyOpen();
  writeLink();
}

for (const id of SECTION_IDS) {
  sectionHead(id).addEventListener("click", () => setOpen(id, !state.open.includes(id)));
}

// Links can open sections before the map has loaded.
state.open = parseLink(window.location.search, { west: -180, south: -90, east: 180, north: 90 }).open;
applyOpen();

$(".skip-link").addEventListener("click", () => {
  if (!state.open.includes("plan")) setOpen("plan", true);
});

// --- Choosing start and end ----------------------------------------------------------------------

const input = (end: End) => $<HTMLInputElement>(`#${end}-input`);

/** Sets one end. Moving an end clears the park stops, which belonged to the old route. */
function setEnd(end: End, point: [number, number] | null, name: string | null, keepStops = false): void {
  const moved = state[end]?.[0] !== point?.[0] || state[end]?.[1] !== point?.[1];
  if (moved && !keepStops && state.stops.length) {
    state.stops = [];
    stopNames.length = 0;
    renderStops();
  }
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
  $<HTMLInputElement>("#long-walk").checked = state.long;
  updateSeedRow();
}

/** After one end is chosen, say what's next. */
function promptNext(): void {
  if (state.from && !state.to) setStatus("Start set. Now pick an end: search, or tap the map.");
  else if (!state.from && state.to) setStatus("End set. Now pick a start: search, or tap the map.");
}

/** The end a map tap moves once both are set: the one whose field was focused last, else the end. */
let tapMoves: End | null = null;
for (const end of ["from", "to"] as End[]) input(end).addEventListener("focus", () => (tapMoves = end));

function onMapTap(point: [number, number]): void {
  const end: End = !state.from ? "from" : !state.to ? "to" : (tapMoves ?? "to");
  tapMoves = null;
  setEnd(end, point, null);
  if (state.from && state.to) requestPlan();
  else promptNext();
}

for (const end of ["from", "to"] as End[]) {
  attachCombo(input(end), $<HTMLUListElement>(`#${end}-list`), () => places, (p) => {
    setEnd(end, [p.lon, p.lat], p.name);
    tapMoves = null;
    routeMap?.flyTo([p.lon, p.lat]);
    if (state.from && state.to) requestPlan();
    else promptNext();
  });
}

document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
  const end = button.closest<HTMLElement>("[data-end]")!.dataset["end"] as End;
  button.addEventListener("click", () => {
    const action = button.dataset["action"];
    if (action === "centre" && routeMap) {
      setEnd(end, routeMap.centre(), null);
      if (state.from && state.to) requestPlan();
      else promptNext();
    } else if (action === "swap") {
      const [f, fn, t, tn] = [state.from, state.fromName, state.to, state.toName];
      setEnd("from", t, tn, true);
      setEnd("to", f, fn, true);
      // The walk now runs the other way, so visit the stops in reverse.
      state.stops.reverse();
      stopNames.reverse();
      renderStops();
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
        const near = nearestArea(point[0], point[1]);
        setStatus(near.id === CITY.id ? `You seem to be outside ${CITY.name}.` : `You seem to be outside ${CITY.name}. ${near.name} is the nearest area; pick it above.`, true);
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

const modeList = $("#mode-list");
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
  modeList.append(wrap);
  radio.addEventListener("change", () => {
    scrollToNextResult = false;
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
  scrollToNextResult = false;
  updateSeedRow();
  writeLink();
  if (state.from && state.to) requestPlan();
});

// --- Longer walks ----------------------------------------------------------------------------------

/** Opting in to a longer walk lets the detour run to 90 minutes instead of an hour. */
$<HTMLInputElement>("#long-walk").addEventListener("change", (e) => {
  state.long = (e.target as HTMLInputElement).checked;
  writeLink();
  if (state.from && state.to) {
    scrollToNextResult = false;
    requestPlan();
  }
});

// --- Planning ------------------------------------------------------------------------------------

$<HTMLFormElement>("#planner").addEventListener("submit", (e) => {
  e.preventDefault();
  requestPlan();
});

function send(msg: ToWorker): void {
  if (msg.type !== "spell") state.spell = null;
  showSuggestion(undefined);
  setShareable(true);
  worker.postMessage(msg);
}

/** Links for a spelled word that's kept off the link would be useless, so sharing is off. */
function setShareable(on: boolean): void {
  $<HTMLButtonElement>("#share").disabled = !on;
  $(".share-note").textContent = on
    ? "Links and images show your start and end points."
    : "Tick \"Include the word in shared links\" to share a link. The image doesn't show the word.";
}

function requestPlan(): void {
  if (!info) return;
  state.art = null;
  state.crawl = null;
  state.workout = null;
  if (!state.from || !state.to) {
    setStatus("Pick both a start and an end first.", true);
    return;
  }
  requestId++;
  goButton.disabled = true;
  setStatus(`Planning a ${MODES[state.mode].name.toLowerCase()} route…`);
  send({
    type: "plan",
    id: requestId,
    from: state.from,
    to: state.to,
    fromName: state.fromName ?? "your start",
    toName: state.toName ?? "your destination",
    mode: state.mode,
    seed: state.seed,
    stops: state.stops,
    long: state.long,
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
  drawRoutes(result.normal, result.better);
  routeMap?.setPins(result.pins, parkActions);
  renderResult(result, (at) => routeMap?.flyTo(at));
  clearShareImage();
  showResult();
  // Screen readers hear the result; sighted users see it in the card.
  const same = sameRouteNote(result);
  $("#announcer").textContent = `Route ready. ${same ?? result.summary} Step-by-step directions follow the stats.`;
}

/**
 * Whether the next result scrolls the panel to itself. Re-planning from the mode cards or a new
 * seed keeps the panel where it is, so modes can be compared; the map shows the new route.
 */
let scrollToNextResult = true;

/** Shows the result card, scrolling the panel to it if it's out of sight. */
function showResult(): void {
  const wasHidden = resultEl.hidden;
  resultEl.hidden = false;
  setStatus("");
  const scroll = scrollToNextResult || wasHidden;
  scrollToNextResult = true;
  const panel = $("#panel").getBoundingClientRect();
  const card = resultEl.getBoundingClientRect();
  if (scroll && (card.top > panel.bottom - 80 || card.bottom < panel.top)) {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultEl.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }
}

// --- Sharing -------------------------------------------------------------------------------------

function writeLink(): void {
  const q = serializeLink(state);
  const withArea = CITY.id === DEFAULT_AREA ? q : `?area=${CITY.id}${q.length > 1 ? `&${q.slice(1)}` : ""}`;
  history.replaceState(null, "", `${window.location.pathname}${withArea}`);
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
    // Frame the route in the visible map first, whatever the user has panned or expanded since.
    setSheetFull(false);
    await routeMap.fitRoute();
    shareBlob = await renderShareImage(routeMap.map, lastCard, routeMap.visibleBox());
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
    setStatus("Pick a From point first; the drawing starts there.", true);
    if (!state.open.includes("plan")) setOpen("plan", true);
    input("from").focus();
    return;
  }
  state.art = artShape.value as ShapeId;
  state.crawl = null;
  state.workout = null;
  state.artMinutes = Number(document.querySelector<HTMLInputElement>('input[name="art-len"]:checked')?.value ?? 40);
  requestArt();
});

function requestArt(): void {
  if (!info || !state.from || !state.art) return;
  requestId++;
  artShape.value = state.art;
  const len = document.querySelector<HTMLInputElement>(`input[name="art-len"][value="${state.artMinutes}"]`);
  if (len) len.checked = true;
  if (!state.open.includes("art")) setOpen("art", true);
  setStatus(`Drawing a ${SHAPES[state.art].label.toLowerCase()} with ${CITY.name}'s streets…`);
  send({ type: "art", id: requestId, start: state.from, fromName: state.fromName ?? "your start", shape: state.art, minutes: state.artMinutes });
}

function onArt(result: ArtResultMsg): void {
  goButton.disabled = false;
  lastCard = artCard(result);
  state.from = result.start;
  routeMap?.setMarker("from", result.start);
  const end = result.line.at(-1)!;
  routeMap?.setMarker("to", SHAPES[result.shape].closed ? null : end);
  writeLink();
  drawRoutes(result.template, result.line);
  routeMap?.setPins([], () => []);
  renderArt(result, (at) => routeMap?.flyTo(at));
  clearShareImage();
  showResult();
  $("#announcer").textContent = `Drawing ready. ${lastCard.summary} Step-by-step directions follow the stats.`;
}

// --- Spell a word --------------------------------------------------------------------------------

const spellInput = $<HTMLInputElement>("#spell-word");
const suggestionButton = $<HTMLButtonElement>("#spell-suggestion");

function showSuggestion(word: string | undefined): void {
  suggestionButton.hidden = !word;
  if (word) {
    suggestionButton.textContent = `Spell ${word} instead`;
    suggestionButton.dataset["word"] = word;
  }
}

suggestionButton.addEventListener("click", () => {
  spellInput.value = suggestionButton.dataset["word"] ?? "";
  $<HTMLFormElement>("#spell-form").requestSubmit();
});

$<HTMLFormElement>("#spell-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!needFrom("word")) return;
  state.spell = spellInput.value;
  state.spellInLink = $<HTMLInputElement>("#spell-in-link").checked;
  requestSpell();
});

$<HTMLInputElement>("#spell-in-link").addEventListener("change", (e) => {
  if (!state.spell) return;
  state.spellInLink = (e.target as HTMLInputElement).checked;
  writeLink();
  setShareable(state.spellInLink);
  if (lastSpell) lastCard = spellCard(lastSpell, state.spellInLink);
});

let lastSpell: SpellResultMsg | null = null;

function requestSpell(): void {
  if (!info || !state.from || !state.spell) return;
  state.art = null;
  state.crawl = null;
  state.workout = null;
  requestId++;
  if (!state.open.includes("spell")) setOpen("spell", true);
  setStatus("Laying out the letters…");
  send({ type: "spell", id: requestId, start: state.from, fromName: state.fromName ?? "your start", word: state.spell });
}

function onSpell(result: SpellResultMsg): void {
  goButton.disabled = false;
  lastSpell = result;
  state.spell = result.word;
  spellInput.value = result.word;
  lastCard = spellCard(result, state.spellInLink);
  state.from = result.start;
  routeMap?.setMarker("from", result.start);
  routeMap?.setMarker("to", result.end);
  writeLink();
  setShareable(state.spellInLink);
  drawRoutes(result.template, result.strokeLines, result.penUpLines);
  routeMap?.setPins([], () => []);
  renderSpell(result, (at) => routeMap?.flyTo(at));
  clearShareImage();
  showResult();
  $("#announcer").textContent = `Word ready. ${result.likeness}% readable, ${Math.max(1, Math.round(result.stats.timeS / 60))} minutes. Step-by-step directions follow the stats.`;
}

// --- Stops from park pins ------------------------------------------------------------------------

function parkActions(pin: Pin): PinAction[] {
  if (pin.kind !== "park") return [];
  const already = state.stops.some((p) => p[0] === pin.at[0] && p[1] === pin.at[1]);
  if (already) return [{ label: "Already one of your stops." }];
  if (!state.to) return [{ label: "Pick an end first to add stops." }];
  if (state.stops.length >= MAX_LINK_STOPS) return [{ label: `You have ${MAX_LINK_STOPS} stops already. Remove one to add this.` }];
  return [{
    label: "Add as a stop",
    run: () => {
      state.stops.push(pin.at);
      stopNames[state.stops.length - 1] = pin.name;
      renderStops();
      requestPlan();
    },
  }];
}

function renderStops(): void {
  $("#stops").hidden = state.stops.length === 0;
  $("#stop-list").replaceChildren(
    ...state.stops.map((_, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = stopNames[i] ?? `Stop ${i + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link-button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${name.textContent}`);
      remove.addEventListener("click", () => {
        state.stops.splice(i, 1);
        stopNames.splice(i, 1);
        renderStops();
        if (state.from && state.to) requestPlan();
        else writeLink();
      });
      li.append(name, remove);
      return li;
    }),
  );
}

// --- Crawls and workouts -------------------------------------------------------------------------

const radioValue = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? "";
const setRadio = (name: string, value: string | number) => {
  const r = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
};
const crawlCount = $<HTMLSelectElement>("#crawl-count");

function fillCrawlCounts(theme: CrawlTheme, selected: number): void {
  crawlCount.replaceChildren(
    ...Array.from({ length: MAX_STOPS[theme] - MIN_STOPS + 1 }, (_, i) => {
      const o = document.createElement("option");
      o.value = String(MIN_STOPS + i);
      o.textContent = String(MIN_STOPS + i);
      return o;
    }),
  );
  crawlCount.value = String(Math.min(selected, MAX_STOPS[theme]));
}
fillCrawlCounts("art", 5);
document.querySelectorAll<HTMLInputElement>('input[name="crawl-theme"]').forEach((r) =>
  r.addEventListener("change", () => fillCrawlCounts(r.value as CrawlTheme, Number(crawlCount.value))),
);

function syncToolForms(): void {
  if (state.crawl) {
    setRadio("crawl-theme", state.crawl.theme);
    fillCrawlCounts(state.crawl.theme, state.crawl.count);
    setRadio("crawl-len", state.crawl.minutes);
    $<HTMLInputElement>("#crawl-end").checked = state.crawl.toEnd;
  }
  if (state.workout) {
    setRadio("workout-focus", state.workout.focus);
    setRadio("workout-len", state.workout.minutes);
  }
}

function needFrom(what: string): boolean {
  if (state.from) return true;
  setStatus(`Pick a From point first; the ${what} starts there.`, true);
  if (!state.open.includes("plan")) setOpen("plan", true);
  input("from").focus();
  return false;
}

$<HTMLFormElement>("#crawl-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!needFrom("crawl")) return;
  const toEnd = $<HTMLInputElement>("#crawl-end").checked;
  if (toEnd && !state.to) {
    setStatus("Pick a To point to finish there, or untick the box to loop back.", true);
    return;
  }
  const minutes = Number(radioValue("crawl-len"));
  state.crawl = {
    theme: radioValue("crawl-theme") as CrawlTheme,
    count: Number(crawlCount.value),
    minutes: (CRAWL_MINUTES as readonly number[]).includes(minutes) ? minutes : 45,
    toEnd,
  };
  crawlSkip = [];
  requestCrawl();
});

function requestCrawl(): void {
  if (!info || !state.from || !state.crawl) return;
  state.art = null;
  state.workout = null;
  requestId++;
  if (!state.open.includes("crawl")) setOpen("crawl", true);
  setStatus("Planning the crawl…");
  send({
    type: "crawl",
    id: requestId,
    start: state.from,
    end: state.crawl.toEnd ? state.to : null,
    fromName: state.fromName ?? "your start",
    toName: state.toName ?? "your end",
    theme: state.crawl.theme,
    stops: state.crawl.count,
    minutes: state.crawl.minutes,
    skip: crawlSkip,
  });
}

$<HTMLFormElement>("#workout-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!needFrom("loop")) return;
  state.workout = { focus: radioValue("workout-focus") as WorkoutFocus, minutes: Number(radioValue("workout-len")) };
  requestWorkout();
});

function requestWorkout(): void {
  if (!info || !state.from || !state.workout) return;
  state.art = null;
  state.crawl = null;
  requestId++;
  if (!state.open.includes("workout")) setOpen("workout", true);
  setStatus("Planning the loop…");
  send({ type: "workout", id: requestId, start: state.from, fromName: state.fromName ?? "your start", minutes: state.workout.minutes, focus: state.workout.focus });
}

function stopActions(pin: Pin): PinAction[] {
  if (pin.kind !== "stop" || pin.stopIndex === undefined || !state.crawl) return [];
  const index = pin.stopIndex;
  const actions: PinAction[] = [{
    label: "Swap for another",
    run: () => {
      crawlSkip.push(index);
      requestCrawl();
    },
  }];
  if (state.crawl.count > MIN_STOPS) {
    actions.push({
      label: "Skip this stop",
      run: () => {
        crawlSkip.push(index);
        state.crawl!.count--;
        syncToolForms();
        requestCrawl();
      },
    });
  }
  return actions;
}

function onTour(result: TourResult): void {
  goButton.disabled = false;
  lastCard = tourCard(result);
  state.from = result.start;
  routeMap?.setMarker("from", result.start);
  const loops = result.end[0] === result.start[0] && result.end[1] === result.start[1];
  routeMap?.setMarker("to", loops ? null : result.end);
  writeLink();
  drawRoutes([], result.line);
  routeMap?.setPins(result.pins, stopActions);
  renderTour(result, (at) => routeMap?.flyTo(at));
  clearShareImage();
  showResult();
  $("#announcer").textContent = `${result.kind === "crawl" ? "Crawl" : "Loop"} ready. ${result.summary} Step-by-step directions follow the stats.`;
}

// --- Famous routes -------------------------------------------------------------------------------

$("#famous-list").replaceChildren(
  ...(FAMOUS[CITY.id] ?? []).map((f) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = f.title;
    const pitch = document.createElement("span");
    pitch.textContent = f.pitch;
    const meta = document.createElement("small");
    meta.textContent =
      f.kind === "plan" ? `${MODES[f.mode].name} · ${f.fromName} to ${f.toName}` : `${f.kind === "crawl" ? "Crawl" : "Workout"} · from ${f.fromName}`;
    button.append(title, pitch, meta);
    button.addEventListener("click", () => {
      setEnd("from", f.from, f.fromName);
      if (f.kind === "plan") {
        state.mode = f.mode;
        state.seed = f.seed;
        setEnd("to", f.to, f.toName);
        syncInputs();
        requestPlan();
      } else if (f.kind === "crawl") {
        state.crawl = { theme: f.theme, count: f.count, minutes: f.minutes, toEnd: false };
        crawlSkip = [];
        syncToolForms();
        requestCrawl();
      } else {
        state.workout = { focus: f.focus, minutes: f.minutes };
        syncToolForms();
        requestWorkout();
      }
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
