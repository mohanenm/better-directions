/**
 * The city this build serves. To add or switch cities, see docs/ADDING_A_CITY.md: data lives in
 * app/public/data/<id>/, and app/index.html and app/src/ui/famous.ts have city-specific text.
 */
export const CITY = Object.freeze({
  id: "lyon",
  name: "Lyon",
  /** Language for map labels (OSM name:<lang>), passed to the basemap style. */
  labelLang: "fr",
});

export const cityData = (file: string): string => `${import.meta.env.BASE_URL}data/${CITY.id}/${file}`;
