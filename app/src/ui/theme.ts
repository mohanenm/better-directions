/**
 * Light or dark. The page follows the system setting (in CSS, so there's no flash) until the
 * theme switch sets data-theme on <html>. The choice lasts for this visit only: the page stores
 * nothing on the device.
 */
export type Theme = "light" | "dark";

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const listeners: ((theme: Theme) => void)[] = [];

export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset["theme"];
  if (chosen === "light" || chosen === "dark") return chosen;
  return systemDark.matches ? "dark" : "light";
}

/** Called with the new theme whenever it changes, by the switch or by the system. */
export function onThemeChange(listener: (theme: Theme) => void): void {
  listeners.push(listener);
}

function changed(): void {
  const theme = currentTheme();
  // The browser's toolbar colour follows the page, not just the system.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
  });
  for (const l of listeners) l(theme);
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
  changed();
}

systemDark.addEventListener("change", () => {
  if (!document.documentElement.dataset["theme"]) changed();
});

/** Wires the header's switch: a toggle button, pressed when dark. */
export function initThemeToggle(button: HTMLButtonElement): void {
  const sync = () => button.setAttribute("aria-pressed", String(currentTheme() === "dark"));
  sync();
  onThemeChange(sync);
  button.addEventListener("click", () => setTheme(currentTheme() === "dark" ? "light" : "dark"));
}
