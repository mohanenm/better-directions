/**
 * Hard limits. Like the rules in rules.ts, these are not settings: no mode or URL parameter can
 * go beyond them. A walk is an hour at most unless someone asks for a longer one, and two hours
 * at most even then, except that a longer walk may always add up to half an hour to the normal
 * walk (so a walk that's already long still gets a detour). The app sends people the long way
 * into streets they may not know; the cap keeps that a detour, not a trek, and limits the chance
 * of finishing after dark or finding parks and passages shut. Walks over an hour say when you'd
 * finish.
 */
export const DETOUR = Object.freeze({
  /** A "better" route may take at most this multiple of the normal route's walking time... */
  maxMultiple: 4,
  /** ...and never more than this in total (unless the normal route itself is longer)... */
  maxSeconds: 60 * 60,
  /** ...or this, when the walker asks for a longer walk... */
  longMaxSeconds: 120 * 60,
  /** ...though a longer walk may always add this much to the normal route (within maxMultiple). */
  longExtraSeconds: 30 * 60,
});

/** The longest a "better" route may take, given the normal route's walking time. */
export function detourCapSeconds(normalSeconds: number, long = false): number {
  const max = long ? DETOUR.longMaxSeconds : DETOUR.maxSeconds;
  const most = normalSeconds * DETOUR.maxMultiple;
  const cap = Math.max(normalSeconds, Math.min(most, max));
  return long ? Math.max(cap, Math.min(normalSeconds + DETOUR.longExtraSeconds, most)) : cap;
}

export const NOVELTY_NOTICE =
  "For fun. Use common sense, follow signs and local rules, and don't follow it anywhere that looks unsafe or closed.";

/** Loops (workouts, crawls, shapes, words) have no "normal route" to compare with: an hour by default. */
export const LOOP_MAX_SECONDS = DETOUR.maxSeconds;
/** Crawls and workouts are capped at the length chosen (up to two hours). */
export const loopCapSeconds = (minutes: number): number => Math.min(minutes * 60, DETOUR.longMaxSeconds);
