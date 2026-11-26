/**
 * Hard limits. Like the rules in rules.ts, these are not settings: no mode or URL parameter can
 * go beyond them. A walk is an hour at most unless someone asks for a longer one, and an hour
 * and a half at most even then. The app sends people the long way into streets they may not
 * know; the cap keeps that a detour, not a trek, and limits the chance of finishing after dark
 * or finding parks and passages shut.
 */
export const DETOUR = Object.freeze({
  /** A "better" route may take at most this multiple of the normal route's walking time... */
  maxMultiple: 4,
  /** ...and never more than this in total (unless the normal route itself is longer)... */
  maxSeconds: 60 * 60,
  /** ...or this, when the walker asks for a longer walk. Nothing goes beyond it. */
  longMaxSeconds: 90 * 60,
});

/** The longest a "better" route may take, given the normal route's walking time. */
export function detourCapSeconds(normalSeconds: number, long = false): number {
  const max = long ? DETOUR.longMaxSeconds : DETOUR.maxSeconds;
  return Math.max(normalSeconds, Math.min(normalSeconds * DETOUR.maxMultiple, max));
}

export const NOVELTY_NOTICE =
  "For fun. Use common sense, follow signs and local rules, and don't follow it anywhere that looks unsafe or closed.";

/**
 * Loops (GPS art, workouts, crawls) have no "normal route" to compare with, so they're capped by
 * the length chosen: an hour normally, an hour and a half for the long options, never more.
 */
export const LOOP_MAX_SECONDS = DETOUR.maxSeconds;
export const LONG_LOOP_MAX_SECONDS = DETOUR.longMaxSeconds;
export const GPS_ART_MAX_SECONDS = LONG_LOOP_MAX_SECONDS;
/** The cap for a loop of the chosen length. */
export const loopCapSeconds = (minutes: number): number => Math.min(minutes * 60, minutes > 60 ? LONG_LOOP_MAX_SECONDS : LOOP_MAX_SECONDS);
