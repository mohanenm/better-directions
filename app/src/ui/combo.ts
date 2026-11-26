/**
 * Accessible combobox over the local places list (WAI-ARIA combobox pattern with a listbox):
 * type to filter, arrow keys to move, Enter to choose, Escape to close.
 */
import { searchPlaces, type Place } from "./search";

const KIND_LABEL: Record<Place["kind"], string> = {
  square: "square", station: "station", park: "park", sight: "sight", landmark: "landmark",
  campus: "campus", mall: "mall",
};

export function attachCombo(input: HTMLInputElement, list: HTMLUListElement, places: () => readonly Place[], onPick: (p: Place) => void): void {
  let matches: Place[] = [];
  let active = -1;

  const close = () => {
    empty = false;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };

  let empty = false; // typed enough, but nothing matched
  const render = () => {
    if (empty) {
      const li = document.createElement("li");
      li.className = "empty";
      li.setAttribute("role", "option");
      li.setAttribute("aria-disabled", "true");
      li.textContent = "No matching places. You can tap the map instead.";
      list.replaceChildren(li);
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");
      return;
    }
    list.replaceChildren(
      ...matches.map((p, i) => {
        const li = document.createElement("li");
        li.id = `${list.id}-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === active));
        li.textContent = p.name;
        const kind = document.createElement("small");
        kind.textContent = KIND_LABEL[p.kind];
        li.append(kind);
        li.addEventListener("mousedown", (e) => {
          e.preventDefault(); // keep focus in the input
          choose(i);
        });
        return li;
      }),
    );
    const open = matches.length > 0;
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  };

  const choose = (i: number) => {
    const p = matches[i];
    if (!p) return;
    input.value = p.name;
    close();
    onPick(p);
  };

  input.addEventListener("input", () => {
    matches = searchPlaces(places(), input.value);
    empty = matches.length === 0 && input.value.trim().length >= 2;
    active = -1;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!matches.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      render();
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      close();
    }
  });
  input.addEventListener("blur", close);
}
