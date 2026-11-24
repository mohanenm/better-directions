/** Curated "famous better routes" for Lyon, shown on the landing page. */
import type { ModeId } from "../modes/modes";

export interface FamousRoute {
  title: string;
  pitch: string;
  mode: ModeId;
  seed: number;
  from: [number, number];
  fromName: string;
  to: [number, number];
  toName: string;
}

export const FAMOUS_ROUTES: readonly FamousRoute[] = [
  {
    title: "The Fourvière Stair Assault",
    pitch: "From the cathedral to the basilica the hard way: hundreds of steps, all of them up.",
    mode: "stairs", seed: 1,
    from: [4.8274, 45.7606], fromName: "Cathédrale Saint-Jean",
    to: [4.8225, 45.7623], toName: "Basilique de Fourvière",
  },
  {
    title: "The Traboule Crawl",
    pitch: "Up the Croix-Rousse slopes through as many passages as the old silk town will allow.",
    mode: "buildings", seed: 1,
    from: [4.8336, 45.7675], fromName: "Place des Terreaux",
    to: [4.8317, 45.7745], toName: "Place de la Croix-Rousse",
  },
  {
    title: "The Pentes Calf Crusher",
    pitch: "Same hill, stair edition. Your calves will remember Lyon.",
    mode: "stairs", seed: 1,
    from: [4.8336, 45.7675], fromName: "Place des Terreaux",
    to: [4.8317, 45.7745], toName: "Place de la Croix-Rousse",
  },
  {
    title: "The Grand Park Tour",
    pitch: "Leave the Tête d'Or and refuse to stop collecting parks until Bellecour.",
    mode: "parks", seed: 1,
    from: [4.8519, 45.7703], fromName: "Parc de la Tête d'Or",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    title: "The Croissant Crawl",
    pitch: "Bellecour to the Terreaux via every bakery that fits in the budget.",
    mode: "snacks", seed: 1,
    from: [4.832, 45.7578], fromName: "Place Bellecour",
    to: [4.8336, 45.7675], toName: "Place des Terreaux",
  },
  {
    title: "The Rhône Dirt Dash",
    pitch: "Jean Macé to Bellecour with as little pavement as Lyon can manage.",
    mode: "trail", seed: 1,
    from: [4.8424, 45.7457], fromName: "Place Jean Macé",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    title: "The Sinister Circuit",
    pitch: "Jean Macé to Bellecour without a single right turn.",
    mode: "no-right", seed: 1,
    from: [4.8424, 45.7457], fromName: "Place Jean Macé",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    title: "Chaos Route #42",
    pitch: "The station to Vieux Lyon, as decided by the number 42.",
    mode: "chaos", seed: 42,
    from: [4.8593, 45.7606], fromName: "Gare Part-Dieu",
    to: [4.8274, 45.7606], toName: "Cathédrale Saint-Jean",
  },
];
