/** Renders a planned route as text: summary, stats, notes and step-by-step directions. */
import type { CostOfFun } from "../modes/stats";
import type { PlanResult } from "./protocol";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

function statItems(r: PlanResult): [string, string][] {
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
  return items;
}

export function isLate(now = new Date()): boolean {
  const h = now.getHours();
  return h >= 21 || h < 7;
}

export function renderResult(r: PlanResult, onStep: (at: [number, number]) => void): void {
  const get = (id: string) => document.getElementById(id)!;
  get("summary").textContent = r.summary;

  get("stats").replaceChildren(
    ...statItems(r).map(([k, v]) => {
      const wrap = el("div");
      wrap.append(el("dt", k), el("dd", v));
      return wrap;
    }),
  );

  const notes: string[] = [];
  if (r.betterStats.underBuildings) {
    notes.push("This route passes under a building where no tunnel is mapped. Check it's open to walkers.");
  }
  for (const c of r.betterStats.mayClose) {
    notes.push(`${c.name} may be closed outside opening hours${c.openingHours ? ` (${c.openingHours})` : ""}.`);
  }
  get("notes").replaceChildren(...notes.map((t) => el("li", t)));
  get("late-hint").hidden = !(isLate() && r.betterStats.mayClose.length > 0);

  get("steps").replaceChildren(
    ...r.steps.map((s) => {
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
