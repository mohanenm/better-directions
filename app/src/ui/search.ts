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
  square: 0, landmark: 1, sight: 2, station: 3, park: 4, mall: 5, campus: 6,
};

/** Best matches first: names starting with the query, then words starting with it, then contains. */
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
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, "fr"));
  return scored.slice(0, limit).map(([, p]) => p);
}
