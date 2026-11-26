/** Accent- and case-insensitive search over the local places list (no geocoding service). */

export interface Place {
  name: string;
  kind: "square" | "station" | "park" | "sight" | "landmark" | "campus" | "mall";
  lon: number;
  lat: number;
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[’'-]/g, " ");
}

const KIND_RANK: Record<Place["kind"], number> = {
  square: 0, station: 1, landmark: 2, sight: 3, park: 4, mall: 5, campus: 6,
};

/** Rough metres between two places, for spotting duplicates. */
const apartM = (a: Place, b: Place) => Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 111_320);

/**
 * Best matches first: names starting with the query, then words starting with it, then contains;
 * then by kind (squares and stations first) and shorter names. The same name and kind within
 * 500 m is shown once (OpenStreetMap sometimes has a place twice, differently capitalised).
 */
export function searchPlaces(places: readonly Place[], query: string, limit = 8): Place[] {
  const q = fold(query).trim();
  if (q.length < 2) return [];
  const scored: [number, Place][] = [];
  for (const p of places) {
    const name = fold(p.name);
    let score: number;
    if (name.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((w) => w.startsWith(q))) score = 1;
    else if (name.includes(q)) score = 2;
    else continue;
    scored.push([score * 10 + KIND_RANK[p.kind], p]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name));
  const out: Place[] = [];
  for (const [, p] of scored) {
    if (out.some((o) => o.kind === p.kind && fold(o.name) === fold(p.name) && apartM(o, p) < 500)) continue;
    out.push(p);
    if (out.length === limit) break;
  }
  return out;
}
