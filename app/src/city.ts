/**
 * The areas the site covers, and which one this page is showing. Each area has its own graph,
 * places list and tiles under app/public/data/<id>/ and app/public/tiles/<id>/, loaded only when
 * chosen. The page picks the area from ?area=; the planning worker is named after it.
 */
export interface Area {
  id: string;
  name: string;
  bbox: { west: number; south: number; east: number; north: number };
  center: [number, number];
  /** Language for map labels (OSM name:<lang>), passed to the basemap style. */
  labelLang: string;
  /** Deepest tile zoom shipped; the map overzooms beyond it. */
  maxTileZoom: number;
}

export const AREAS: readonly Area[] = Object.freeze([
  { id: "lyon", name: "Lyon", bbox: { west: 4.77, south: 45.7, east: 4.93, north: 45.81 }, center: [4.835, 45.762], labelLang: "fr", maxTileZoom: 15 },
  { id: "dc", name: "Washington, DC", bbox: { west: -77.12, south: 38.791, east: -76.909, north: 38.996 }, center: [-77.0365, 38.8977], labelLang: "en", maxTileZoom: 15 },
  { id: "arlington", name: "Arlington and Alexandria", bbox: { west: -77.172, south: 38.785, east: -77.035, north: 38.935 }, center: [-77.09, 38.87], labelLang: "en", maxTileZoom: 15 },
  { id: "silver-spring", name: "Silver Spring and Bethesda", bbox: { west: -77.135, south: 38.965, east: -76.985, north: 39.025 }, center: [-77.06, 38.99], labelLang: "en", maxTileZoom: 15 },
  { id: "richmond", name: "Richmond", bbox: { west: -77.52, south: 37.5, east: -77.4, north: 37.58 }, center: [-77.44, 37.54], labelLang: "en", maxTileZoom: 15 },
  { id: "baltimore", name: "Baltimore", bbox: { west: -76.68, south: 39.25, east: -76.56, north: 39.33 }, center: [-76.61, 39.29], labelLang: "en", maxTileZoom: 15 },
  { id: "chicago", name: "Chicago", bbox: { west: -87.725, south: 41.84, east: -87.595, north: 42.023 }, center: [-87.6278, 41.8819], labelLang: "en", maxTileZoom: 15 },
]);

export const DEFAULT_AREA = "lyon";

function currentAreaId(): string {
  // In the worker there's no page URL: the page names the worker after the area.
  const raw = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("area") : typeof self !== "undefined" ? self.name : null;
  return AREAS.some((a) => a.id === raw) ? raw! : DEFAULT_AREA;
}

export const CITY: Area = AREAS.find((a) => a.id === currentAreaId())!;

export const cityData = (file: string): string => `${import.meta.env.BASE_URL}data/${CITY.id}/${file}`;

/** The area whose centre is nearest, for "nearest to me" (computed on the device). */
export function nearestArea(lon: number, lat: number): Area {
  const d = (a: Area) => (a.center[0] - lon) ** 2 * Math.cos((lat * Math.PI) / 180) ** 2 + (a.center[1] - lat) ** 2;
  return [...AREAS].sort((a, b) => d(a) - d(b))[0]!;
}
