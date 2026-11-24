/**
 * Hard limits. Like the rules in rules.ts, these are not settings: no mode or URL parameter can
 * change them.
 */
export const DETOUR = Object.freeze({
  /** A "better" route may take at most this multiple of the normal route's walking time... */
  maxMultiple: 4,
  /** ...and never more than this in total (unless the normal route itself is longer). */
  maxSeconds: 60 * 60,
});

/** The longest a "better" route may take, given the normal route's walking time. */
export function detourCapSeconds(normalSeconds: number): number {
  return Math.max(normalSeconds, Math.min(normalSeconds * DETOUR.maxMultiple, DETOUR.maxSeconds));
}

export const NOVELTY_NOTICE =
  "For fun. Use common sense, follow signs and local rules, and don't follow it anywhere that looks unsafe or closed.";
