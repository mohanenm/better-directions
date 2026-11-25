/** Curated famous routes per area: point-to-point routes, crawls and workouts. */
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

const LYON: readonly FamousRoute[] = [
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

const DC: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "The Exorcist Steps, Upwards",
    pitch: "From the Georgetown waterfront up to Dumbarton Oaks by every staircase going, including the famous one.",
    mode: "stairs", seed: 1,
    from: [-77.0625, 38.9025], fromName: "Georgetown Waterfront Park",
    to: [-77.0636, 38.9149], toName: "Dumbarton Oaks",
  },
  {
    kind: "plan",
    title: "Memorials, the Green Way",
    pitch: "Lincoln Memorial to the Capitol through as many parks and gardens as fit.",
    mode: "parks", seed: 1,
    from: [-77.0502, 38.8893], fromName: "Lincoln Memorial",
    to: [-77.0091, 38.8899], toName: "United States Capitol",
  },
  {
    kind: "plan",
    title: "Circle to Circle, Leftwards",
    pitch: "Dupont Circle to Logan Circle without turning right.",
    mode: "no-right", seed: 1,
    from: [-77.0434, 38.9096], fromName: "Dupont Circle",
    to: [-77.0297, 38.9096], toName: "Logan Circle",
  },
  {
    kind: "crawl",
    title: "U Street Murals",
    pitch: "Murals around U Street and Shaw, looping back to the Metro.",
    theme: "art", count: 6, minutes: 45,
    from: [-77.0285, 38.917], fromName: "U Street station",
  },
  {
    kind: "plan",
    title: "Union Station, Eventually",
    pitch: "Eastern Market to Union Station the most annoying reasonable way. No extra busy roads.",
    mode: "inconvenient", seed: 1,
    from: [-76.9963, 38.8865], fromName: "Eastern Market",
    to: [-77.0063, 38.8973], toName: "Union Station",
  },
];

const ARLINGTON: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Rosslyn to Clarendon, Green Way",
    pitch: "Along the Orange Line corridor through as many parks as fit.",
    mode: "parks", seed: 1,
    from: [-77.0712, 38.8966], fromName: "Rosslyn",
    to: [-77.0953, 38.8868], toName: "Clarendon",
  },
  {
    kind: "plan",
    title: "King Street Snacks",
    pitch: "Old Town Alexandria from the Metro to the waterfront, past the bakeries and cafés.",
    mode: "snacks", seed: 1,
    from: [-77.0596, 38.8063], fromName: "King Street–Old Town station",
    to: [-77.0396, 38.8048], toName: "Alexandria waterfront",
  },
];

const BALTIMORE: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Federal Hill, the Steep Way",
    pitch: "From the Inner Harbor up Federal Hill by its staircases.",
    mode: "stairs", seed: 1,
    from: [-76.6105, 39.2856], fromName: "Inner Harbor",
    to: [-76.6086, 39.2795], toName: "Federal Hill Park",
  },
  {
    kind: "crawl",
    title: "Fells Point Pubs",
    pitch: "A short evening loop through the pubs of Fells Point.",
    theme: "pub", count: 4, minutes: 30,
    from: [-76.5933, 39.2823], fromName: "Fells Point",
  },
];

const RICHMOND: readonly FamousRoute[] = [
  {
    kind: "plan",
    title: "Up to Libby Hill",
    pitch: "Shockoe Bottom to Libby Hill Park by the Church Hill staircases.",
    mode: "stairs", seed: 1,
    from: [-77.4325, 37.5323], fromName: "Shockoe Bottom",
    to: [-77.4207, 37.5285], toName: "Libby Hill Park",
  },
  {
    kind: "crawl",
    title: "Murals of the Fan",
    pitch: "A loop through Richmond's murals, starting at Monroe Park.",
    theme: "art", count: 6, minutes: 45,
    from: [-77.4502, 37.5468], fromName: "Monroe Park",
  },
];

const SILVER_SPRING: readonly FamousRoute[] = [
  {
    kind: "crawl",
    title: "Downtown Silver Spring Art",
    pitch: "Public art around downtown Silver Spring, back to the Metro.",
    theme: "art", count: 5, minutes: 30,
    from: [-77.0311, 38.9939], fromName: "Silver Spring station",
  },
];

/** Famous routes for each area id (areas without any show an empty list). */
export const FAMOUS: Readonly<Record<string, readonly FamousRoute[]>> = {
  lyon: LYON,
  dc: DC,
  arlington: ARLINGTON,
  "silver-spring": SILVER_SPRING,
  richmond: RICHMOND,
  baltimore: BALTIMORE,
};

/** Lyon's list, kept under its old name for tests and benches. */
export const FAMOUS_ROUTES = LYON;
