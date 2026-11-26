/** Choices for crawls and workouts, shared by the page and the planner (kept free of planner code). */
export type CrawlTheme = "art" | "pub" | "wine";
export type WorkoutFocus = "stairs" | "hills" | "mixed";

export const CRAWL_THEMES: readonly CrawlTheme[] = ["art", "pub", "wine"];
export const CRAWL_MINUTES = [30, 45, 60, 90, 120] as const; // over 60 is a long walk, chosen deliberately
export const MIN_STOPS = 3;
/** Drinking crawls are capped lower than art crawls. */
export const MAX_STOPS: Readonly<Record<CrawlTheme, number>> = { art: 8, pub: 6, wine: 6 };

export const WORKOUT_FOCUSES: readonly WorkoutFocus[] = ["stairs", "hills", "mixed"];
export const WORKOUT_MINUTES = [20, 30, 45, 60, 90, 120] as const;
