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
    title: "Fourvière by Stairs",
    pitch: "Cathedral to basilica by the staircases. Several hundred steps, nearly all up.",
    mode: "stairs", seed: 1,
    from: [4.8274, 45.7606], fromName: "Cathédrale Saint-Jean",
    to: [4.8225, 45.7623], toName: "Basilique de Fourvière",
  },
  {
    title: "Through the Pentes",
    pitch: "Up the Croix-Rousse slopes through whatever public passages are mapped.",
    mode: "buildings", seed: 1,
    from: [4.8336, 45.7675], fromName: "Place des Terreaux",
    to: [4.8317, 45.7745], toName: "Place de la Croix-Rousse",
  },
  {
    title: "The Pentes, Upwards",
    pitch: "The same hill, by its staircases.",
    mode: "stairs", seed: 1,
    from: [4.8336, 45.7675], fromName: "Place des Terreaux",
    to: [4.8317, 45.7745], toName: "Place de la Croix-Rousse",
  },
  {
    title: "Park to Park",
    pitch: "From the Tête d'Or to Bellecour without leaving the greenery for long.",
    mode: "parks", seed: 1,
    from: [4.8519, 45.7703], fromName: "Parc de la Tête d'Or",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    title: "The Croissant Route",
    pitch: "Bellecour to the Terreaux past as many bakeries as fit.",
    mode: "snacks", seed: 1,
    from: [4.832, 45.7578], fromName: "Place Bellecour",
    to: [4.8336, 45.7675], toName: "Place des Terreaux",
  },
  {
    title: "Jean Macé, Unpaved",
    pitch: "Jean Macé to Bellecour on as little pavement as Lyon allows.",
    mode: "trail", seed: 1,
    from: [4.8424, 45.7457], fromName: "Place Jean Macé",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    title: "Left to Bellecour",
    pitch: "Jean Macé to Bellecour without turning right.",
    mode: "no-right", seed: 1,
    from: [4.8424, 45.7457], fromName: "Place Jean Macé",
    to: [4.832, 45.7578], toName: "Place Bellecour",
  },
  {
    title: "Seed 42",
    pitch: "Part-Dieu to Vieux Lyon, routed by the number 42.",
    mode: "chaos", seed: 42,
    from: [4.8593, 45.7606], fromName: "Gare Part-Dieu",
    to: [4.8274, 45.7606], toName: "Cathédrale Saint-Jean",
  },
];
