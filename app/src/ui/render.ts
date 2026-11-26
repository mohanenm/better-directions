/**
 * Renders a planned walk as text: summary, stats, notes and directions. Notes come in two kinds:
 * warnings (closures, late finishes, anything to check on the ground), shown together in one
 * amber box, and plain information (how to read the map, why the route is what it is).
 */
import { CITY } from "../city";
import { DETOUR } from "../safety/limits";
import { MAX_LINK_STOPS } from "./url";
import type { CostOfFun } from "../modes/stats";
import type { Step } from "../modes/directions";
import type { ArtResultMsg, PlanResult, SpellResultMsg, TourResult } from "./protocol";
import type { ShareCard } from "./share-image";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export function statItems(r: PlanResult): [string, string][] {
  const b: CostOfFun = r.betterStats;
  const n: CostOfFun = r.normalStats;
  // The summary already gives both times; the tiles add the distance and what the detour collects.
  const extraKm = Math.max(0, (b.lengthM - n.lengthM) / 1000);
  const items: [string, string][] = [["Distance", `${(b.lengthM / 1000).toFixed(1)} km (+${extraKm.toFixed(1)})`]];
  if (b.staircases) items.push(["Staircases", String(b.staircases)]);
  if (b.stepsUp) items.push(["Steps up", String(b.stepsUp)]);
  if (b.climbM >= 5) items.push(["Climb", `${Math.round(b.climbM)} m`]);
  if (b.buildings) items.push(["Buildings walked through", String(b.buildings)]);
  if (b.malls) items.push(["Malls", String(b.malls)]);
  if (b.trailShare >= 0.05) items.push(["On trails", `${Math.round(b.trailShare * 100)}%`]);
  if (b.parks) items.push(["Parks", String(b.parks)]);
  if (r.mode === "no-right") items.push(["Turns", `${b.leftTurns} left, ${b.rightTurns} right`]);
  if (r.mode === "inconvenient") {
    items.push(["Turns", String(b.leftTurns + b.rightTurns + b.uTurns)]);
    if (terrainKnown) items.push(["Up and down", `${Math.round(b.climbM)} m up, ${Math.round(b.descentM)} m down`]);
    items.push(["Could have gone straight", `${b.straightSkips} times`]);
    items.push(["Busy roads crossed", `${b.busyCrossings} (normal: ${n.busyCrossings})`]);
  }
  return items;
}

export function isLate(now = new Date()): boolean {
  const h = now.getHours();
  return h >= 21 || h < 7;
}

const get = (id: string) => document.getElementById(id)!;

/** Whether the area has elevation data; without it, climb figures would only ever read 0. */
let terrainKnown = true;
export function setTerrainKnown(known: boolean): void {
  terrainKnown = known;
}

/** Notes about the area itself (such as missing elevation data), shown with every result. */
let areaNotes: string[] = [];
export function setAreaNotes(notes: string[]): void {
  areaNotes = notes;
}

function renderCard(name: string, summary: string, stats: [string, string][], b: CostOfFun, info: string[], warnings: string[], steps: Step[], legend: [string, string], onStep: (at: [number, number]) => void): void {
  get("route-name").textContent = name;
  get("same-note").hidden = true;
  get("summary").textContent = summary;
  get("legend-better").textContent = legend[0];
  get("legend-normal").textContent = legend[1];
  // Workouts and crawls have no second line to compare.
  for (const el of document.querySelectorAll<HTMLElement>(".swatch.normal, #legend-normal")) el.hidden = legend[1] === "";
  get("stats").replaceChildren(
    ...stats.map(([k, v]) => {
      const wrap = el("div");
      wrap.append(el("dt", k), el("dd", v));
      return wrap;
    }),
  );

  const warn: string[] = [...warnings];
  if (b.underBuildings) {
    warn.push("This route passes under a building where no tunnel is mapped. Check it's open to walkers.");
  }
  for (const c of b.mayClose) {
    warn.push(`${c.name} may be closed outside opening hours${c.openingHours ? ` (${c.openingHours})` : ""}.`);
  }
  get("notes").replaceChildren(...warn.map((t) => el("li", t)));
  get("warnings").hidden = warn.length === 0;
  get("late-hint").hidden = !(isLate() && b.mayClose.length > 0);
  get("info").replaceChildren(...[...info, ...areaNotes].map((t) => el("li", t)));
  renderSteps(steps, onStep);
}

/** Why the better route is (nearly) the normal one, or null when it isn't. */
export function sameRouteNote(r: PlanResult): string | null {
  const minutes = Math.max(1, Math.round(r.normalStats.timeS / 60));
  const stops = r.strategy === "via-stops";
  switch (r.sameAsNormal) {
    case "too-long": {
      const cap = r.long ? "an hour and a half" : "an hour";
      // Offer the longer walk when it would actually leave room for a detour.
      const offer = !r.long && minutes < DETOUR.longMaxSeconds / 60 - 5 ? ` Tick "Longer walk" to allow up to 1 h 30, or ${stops ? "drop a stop" : "pick places closer together"}.` : ` ${stops ? "Drop a stop, or pick" : "Pick"} places closer together, or plan a loop from your start.`;
      return `This walk${stops ? " with its stops" : ""} already takes ${minutes} minutes and detours are capped at ${cap}, so every mode gives the normal route.${offer}`;
    }
    case "already":
      return "The normal route already has no right turns, so it's the better route too.";
    case "nothing-here":
      return `There are no ${r.missingFeature} within reach here, so the better route is the normal one. Try another mode.`;
    case "no-detour":
      return `No detour in this mode fits within ${r.capMinutes} minutes here, so the better route is the normal one. Try another mode or a different pair of places.`;
    default:
      return null;
  }
}

/** For walks over an hour: roughly when you'd finish if you set off now (the device's clock). */
export function finishNote(seconds: number, now = new Date()): string | null {
  if (seconds <= 60 * 60) return null;
  const total = Math.round(seconds / 60);
  const end = new Date(now.getTime() + seconds * 1000);
  const at = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const late = isLate(end) || isLate(now);
  return `About ${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} of walking: set off now and you'd finish around ${at}.${late ? " That's late: it may be dark, and parks and passages may be shut." : " Check you'll have daylight."}`;
}

/** The card's title: the route's own name, unless it's really just the normal route. */
export function planTitle(r: PlanResult): string {
  return r.sameAsNormal && r.sameAsNormal !== "already" ? "Just the Normal Route" : r.name;
}

export function renderResult(r: PlanResult, onStep: (at: [number, number]) => void): void {
  const same = sameRouteNote(r);
  const info = [
    ...(!same && r.missingFeature ? [`This route doesn't pass any ${r.missingFeature}: there are none within reach, so it's just a different way round.`] : []),
    ...(r.strategy === "via-stops" ? ["Goes through the stops you picked, in order. The normal route goes through them too."] : []),
    ...(r.sameAsNormal !== "too-long" && r.pins.some((p) => p.kind === "park") ? [`Tap a green park pin on the map to add it as a stop (up to ${MAX_LINK_STOPS}).`] : []),
  ];
  const finish = finishNote(r.betterStats.timeS);
  renderCard(planTitle(r), r.summary, statItems(r), r.betterStats, info, finish ? [finish] : [], r.steps, ["Better route", "Normal route"], onStep);
  // Why it's just the normal route goes straight under the name, where it can't be missed.
  get("same-note").textContent = same ?? "";
  get("same-note").hidden = !same;
}

export function renderTour(r: TourResult, onStep: (at: [number, number]) => void): void {
  const finish = finishNote(r.stats.timeS);
  renderCard(r.name, r.summary, r.statItems, r.stats, [], finish ? [...r.notes, finish] : r.notes, r.steps, [r.kind === "crawl" ? "The crawl" : "The loop", ""], onStep);
}

export function tourCard(r: TourResult): ShareCard {
  return { name: r.name, summary: r.summary, chips: r.statItems.slice(0, 3), from: r.start, to: r.end, legend: [r.kind === "crawl" ? "The crawl" : "The loop", ""] };
}

export function artSummary(r: ArtResultMsg): string {
  return `A ${r.label.toLowerCase()} drawn with ${CITY.name}'s streets: ${r.likeness}% likeness, ${(r.stats.lengthM / 1000).toFixed(1)} km, ${Math.max(1, Math.round(r.stats.timeS / 60))} min.`;
}

export function artName(r: ArtResultMsg): string {
  return `The ${CITY.name} ${r.label.replace("Letter ", "")}`;
}

function artStats(r: ArtResultMsg): [string, string][] {
  return [
    ["Likeness", `${r.likeness}%`],
    ["Walk", `${Math.max(1, Math.round(r.stats.timeS / 60))} min · ${(r.stats.lengthM / 1000).toFixed(1)} km`],
    ["Off the ideal line", `${r.meanErrorM} m on average`],
  ];
}

export function renderArt(r: ArtResultMsg, onStep: (at: [number, number]) => void): void {
  const info = ["Experimental: streets rarely match a shape exactly, so expect wobbles. The dashed line is the ideal shape."];
  if (r.likeness < 60) info.unshift("The streets here don't follow this shape well, so it may be hard to make out. Try another start point.");
  const finish = finishNote(r.stats.timeS);
  renderCard(artName(r), artSummary(r), artStats(r), r.stats, info, finish ? [finish] : [], r.steps, ["Your walk", "Ideal shape"], onStep);
}

export function planCard(r: PlanResult): ShareCard {
  const extra = Math.round((r.betterStats.timeS - r.normalStats.timeS) / 60);
  return { name: planTitle(r), summary: r.summary, chips: [["Extra time", `+${extra} min`], ...statItems(r).slice(1, 3)], from: r.from, to: r.to, legend: ["Better route", "Normal route"] };
}

export function artCard(r: ArtResultMsg): ShareCard {
  return { name: artName(r), summary: artSummary(r), chips: artStats(r).slice(0, 2).concat([["Shape", r.label]]), from: r.start, to: r.line.at(-1)!, legend: ["Your walk", "Ideal shape"] };
}

function renderSteps(steps: Step[], onStep: (at: [number, number]) => void): void {
  get("step-count").textContent = `(${steps.length} ${steps.length === 1 ? "step" : "steps"})`;
  // A place's note (its opening hours, say) is shown at the first step through it, not at every one.
  const seen = new Set<string>();
  const list = get("steps");
  list.replaceChildren(
    ...steps.map((s) => {
      const li = el("li");
      const text = el("div", undefined, "step-text");
      const button = el("button", s.text);
      button.type = "button";
      button.setAttribute("aria-label", `${s.text} Show on map.`);
      button.addEventListener("click", () => {
        for (const other of list.querySelectorAll("[aria-current]")) other.removeAttribute("aria-current");
        li.setAttribute("aria-current", "step");
        onStep(s.at);
      });
      text.append(button);
      for (const note of s.notes) {
        if (seen.has(note)) continue;
        seen.add(note);
        text.append(el("span", note, "step-note"));
      }
      li.append(text);
      return li;
    }),
  );
}

/** What a spelled walk is called when the word itself isn't to be shown or shared. */
export const HIDDEN_WORD_NAME = "A word, walked";

export function spellSummary(r: SpellResultMsg): string {
  return `${r.likeness}% readable, ${(r.stats.lengthM / 1000).toFixed(1)} km, ${Math.max(1, Math.round(r.stats.timeS / 60))} min.`;
}

function spellStats(r: SpellResultMsg): [string, string][] {
  const hardest = [...r.letters].sort((a, b) => a.likeness - b.likeness)[0];
  const items: [string, string][] = [
    ["Readable", `${r.likeness}%`],
    ["Walk", `${Math.max(1, Math.round(r.stats.timeS / 60))} min · ${(r.stats.lengthM / 1000).toFixed(1)} km`],
    ["Letter height", `${r.heightM} m`],
  ];
  if (hardest && r.letters.length > 1) items.push(["Hardest letter", `${hardest.char}, ${hardest.likeness}%`]);
  return items;
}

export function renderSpell(r: SpellResultMsg, onStep: (at: [number, number]) => void): void {
  const info = ["Solid lines are the letters; dotted lines are walks between strokes. The dashed outline is the ideal lettering."];
  if (r.likeness < 60) info.push("Streets here don't spell well. A neighbourhood with a regular grid will read better.");
  renderCard(r.word, spellSummary(r), spellStats(r), r.stats, info, [], r.steps, ["Letters", "Ideal outline"], onStep);
}

export function spellCard(r: SpellResultMsg, showWord: boolean): ShareCard {
  return {
    name: showWord ? r.word : HIDDEN_WORD_NAME,
    summary: spellSummary(r),
    chips: spellStats(r).slice(0, 3),
    from: r.start,
    to: r.end,
    legend: ["Letters", "Ideal outline"],
  };
}
