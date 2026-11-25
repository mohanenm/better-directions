/** Renders a planned route as text: summary, stats, notes and step-by-step directions. */
import { CITY } from "../city";
import type { CostOfFun } from "../modes/stats";
import type { Step } from "../modes/directions";
import type { ArtResultMsg, PlanResult, TourResult } from "./protocol";
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
  const min = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
  const items: [string, string][] = [
    ["Normal", `${min(n.timeS)} · ${(n.lengthM / 1000).toFixed(1)} km`],
    ["Better", `${min(b.timeS)} · ${(b.lengthM / 1000).toFixed(1)} km`],
  ];
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
    items.push(["Up and down", `${Math.round(b.climbM)} m up, ${Math.round(b.descentM)} m down`]);
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

function renderCard(name: string, summary: string, stats: [string, string][], b: CostOfFun, extraNotes: string[], steps: Step[], legend: [string, string], onStep: (at: [number, number]) => void): void {
  get("route-name").textContent = name;
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

  const notes: string[] = [...extraNotes];
  if (b.underBuildings) {
    notes.push("This route passes under a building where no tunnel is mapped. Check it's open to walkers.");
  }
  for (const c of b.mayClose) {
    notes.push(`${c.name} may be closed outside opening hours${c.openingHours ? ` (${c.openingHours})` : ""}.`);
  }
  get("notes").replaceChildren(...notes.map((t) => el("li", t)));
  get("late-hint").hidden = !(isLate() && b.mayClose.length > 0);
  renderSteps(steps, onStep);
}

export function renderResult(r: PlanResult, onStep: (at: [number, number]) => void): void {
  const notes = r.strategy === "via-stops" ? ["Goes through the stops you picked, in order."] : [];
  renderCard(r.name, r.summary, statItems(r), r.betterStats, notes, r.steps, ["Better route", "Normal route"], onStep);
}

export function renderTour(r: TourResult, onStep: (at: [number, number]) => void): void {
  renderCard(r.name, r.summary, r.statItems, r.stats, r.notes, r.steps, [r.kind === "crawl" ? "The crawl" : "The loop", ""], onStep);
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
  const notes = ["Experimental: streets rarely match a shape exactly, so expect wobbles. The dashed line is the ideal shape."];
  renderCard(artName(r), artSummary(r), artStats(r), r.stats, notes, r.steps, ["Your walk", "Ideal shape"], onStep);
}

export function planCard(r: PlanResult): ShareCard {
  const extra = Math.round((r.betterStats.timeS - r.normalStats.timeS) / 60);
  return { name: r.name, summary: r.summary, chips: [["Extra time", `+${extra} min`], ...statItems(r).slice(2, 4)], from: r.from, to: r.to, legend: ["Better route", "Normal route"] };
}

export function artCard(r: ArtResultMsg): ShareCard {
  return { name: artName(r), summary: artSummary(r), chips: artStats(r).slice(0, 2).concat([["Shape", r.label]]), from: r.start, to: r.line.at(-1)!, legend: ["Your walk", "Ideal shape"] };
}

function renderSteps(steps: Step[], onStep: (at: [number, number]) => void): void {
  get("steps").replaceChildren(
    ...steps.map((s) => {
      const li = el("li");
      const button = el("button", s.text);
      button.type = "button";
      button.setAttribute("aria-label", `${s.text} Show on map.`);
      button.addEventListener("click", () => onStep(s.at));
      li.append(button);
      for (const note of s.notes) li.append(el("span", note, "step-note"));
      return li;
    }),
  );
}
