/** Palette colours live in style.css as custom properties; the map and share image read them here. */
export function colour(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}
