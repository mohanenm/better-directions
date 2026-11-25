/** Curated famous routes for Lyon: point-to-point routes, plus a crawl and a workout. */
import type { ModeId } from "../modes/modes";
import type { CrawlTheme, WorkoutFocus } from "../modes/options";

interface FamousBase {
  title: string;
  pitch: string;
  from: [number, number];
  fromName: string;
}

export interface FamousPlan extends FamousBase {
  kind: "plan";
  mode: ModeId;
  seed: number;
  to: [number, number];
  toName: string;
}

export interface FamousCrawl extends FamousBase {
  kind: "crawl";
  theme: CrawlTheme;
  count: number;
  minutes: number;
}

export interface FamousWorkout extends FamousBase {
  kind: "workout";
  focus: WorkoutFocus;
  minutes: number;
}

export type FamousRoute = FamousPlan | FamousCrawl | FamousWorkout;

export const FAMOUS_ROUTES: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Fourvière by Stairs",
    pitch: "Cathedral to basilica by the staircases. Several hundred steps, nearly all up.",
    mode: "stairs", seed: 1,
    from: [4.8274, 45.7606], fromName: "Cathédrale Saint-Jean",
    to: [4.8225, 45.7623], toName: "Basilique de Fourvière",
  },
  {
    kind: "plan",
    title: "Through the Pentes",
    pitch: "Up the Croix-Rousse slopes through whatever public passages are mapped.",
    mode: "buildings", seed: 1,
    from: [4.8336, 45.7675], fromName: "Place des Terreaux",
    to: [4.8317, 45.7745], toName: "Place de la Croix-Rousse",
  },
  {
    kind: "plan",
    title: "The Pentes, Upwards",
    pitch: "The same hill, by its staircases.",
    mode: "stairs", seed: 1,
    from: [4.8336, 45.7675], fromName: "Place des Terreaux",
    to: [4.8317, 45.7745], toName: "Place de la Croix-Rousse",
  },
  {
    kind: "plan",
    title: "Park to Park",
    pitch: "From the Tête d'Or to Bellecour without leaving the greenery for long.",
    mode: "parks", seed: 1,
    from: [4.8519, 45.7703], fromName: "Parc de la Tête d'Or",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    kind: "plan",
    title: "The Croissant Route",
    pitch: "Bellecour to the Terreaux past as many bakeries as fit.",
    mode: "snacks", seed: 1,
    from: [4.832, 45.7578], fromName: "Place Bellecour",
    to: [4.8336, 45.7675], toName: "Place des Terreaux",
  },
  {
    kind: "plan",
    title: "Jean Macé, Unpaved",
    pitch: "Jean Macé to Bellecour on as little pavement as Lyon allows.",
    mode: "trail", seed: 1,
    from: [4.8424, 45.7457], fromName: "Place Jean Macé",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    kind: "plan",
    title: "Left to Bellecour",
    pitch: "Jean Macé to Bellecour without turning right.",
    mode: "no-right", seed: 1,
    from: [4.8424, 45.7457], fromName: "Place Jean Macé",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    kind: "plan",
    title: "Seed 42",
    pitch: "Part-Dieu to Vieux Lyon, routed by the number 42.",
    mode: "chaos", seed: 42,
    from: [4.8593, 45.7606], fromName: "Gare Part-Dieu",
    to: [4.8274, 45.7606], toName: "Cathédrale Saint-Jean",
  },
  {
    kind: "plan",
    title: "Terreaux, Eventually",
    pitch: "Bellecour to the Terreaux the most annoying reasonable way. No extra busy roads.",
    mode: "inconvenient", seed: 1,
    from: [4.832, 45.7578], fromName: "Place Bellecour",
    to: [4.8336, 45.7675], toName: "Place des Terreaux",
  },
  {
    kind: "crawl",
    title: "Croix-Rousse Art Loop",
    pitch: "Murals, sculptures and pavement mosaics around the Croix-Rousse, back where you started.",
    theme: "art", count: 6, minutes: 45,
    from: [4.8317, 45.7745], fromName: "Place de la Croix-Rousse",
  },
  {
    kind: "workout",
    title: "Fourvière Stair Loop",
    pitch: "Half an hour of the Vieux Lyon staircases, starting and ending at the cathedral.",
    focus: "stairs", minutes: 30,
    from: [4.8274, 45.7606], fromName: "Cathédrale Saint-Jean",
  },
];
