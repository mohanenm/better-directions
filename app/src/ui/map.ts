/**
 * The map: MapLibre with the self-hosted Protomaps basemap (tiles, fonts and sprites all served
 * by this site), plus the two routes and the start/end markers.
 */
import { CITY } from "../city";
import { layers, namedFlavor } from "@protomaps/basemaps";
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapMouseEvent,
} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { colour } from "./colours";
import type { Bbox } from "./url";

setWorkerUrl(maplibreWorkerUrl);

export interface RouteMap {
  map: MapLibreMap;
  setRoutes(normal: [number, number][], better: [number, number][]): void;
  clearRoutes(): void;
  setMarker(end: "from" | "to", point: [number, number] | null): void;
  centre(): [number, number];
  flyTo(point: [number, number]): void;
  onTap(handler: (point: [number, number]) => void): void;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createMap(container: HTMLElement, bbox: Bbox): RouteMap {
  // Absolute URLs under the site's base path (works at /better-directions/ or anywhere else).
  const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
  const map = new MapLibreMap({
    container,
    style: {
      version: 8,
      glyphs: `${base}basemap/fonts/{fontstack}/{range}.pbf`,
      sprite: `${base}basemap/sprites/light`,
      sources: {
        protomaps: {
          type: "vector",
          tiles: [`${base}tiles/{z}/{x}/{y}.mvt`],
          minzoom: 0,
          maxzoom: 15,
          bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
        },
      },
      layers: layers("protomaps", namedFlavor("light"), { lang: CITY.labelLang }),
    },
    bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
    maxBounds: [bbox.west - 0.03, bbox.south - 0.02, bbox.east + 0.03, bbox.north + 0.02],
    minZoom: 11,
    maxZoom: 19,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");

  const markers: Record<"from" | "to", Marker | null> = { from: null, to: null };
  // Routes that arrive before the style has loaded are drawn once it has.
  let queued: { normal: [number, number][]; better: [number, number][] } | null = null;

  map.on("load", () => {
    const empty = { type: "FeatureCollection" as const, features: [] };
    map.addSource("normal", { type: "geojson", data: empty });
    map.addSource("better", { type: "geojson", data: empty });
    map.addLayer({
      id: "normal-line",
      type: "line",
      source: "normal",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": colour("route-normal"), "line-width": 4, "line-dasharray": [1.5, 1.5], "line-opacity": 0.85 },
    });
    map.addLayer({
      id: "better-casing",
      type: "line",
      source: "better",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": colour("route-casing"), "line-width": 9 },
    });
    map.addLayer({
      id: "better-line",
      type: "line",
      source: "better",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": colour("route-better"), "line-width": 5.5 },
    });
    if (queued) draw(queued.normal, queued.better);
    queued = null;
  });

  const line = (coords: [number, number][]) => ({
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: coords },
  });

  function draw(normal: [number, number][], better: [number, number][]): void {
    (map.getSource("normal") as GeoJSONSource).setData(line(normal));
    (map.getSource("better") as GeoJSONSource).setData(line(better));
    const all = [...normal, ...better];
    const bounds = all.reduce(
      (b, p) => b.extend(p),
      new LngLatBounds(all[0]!, all[0]!),
    );
    map.fitBounds(bounds as LngLatBoundsLike, { padding: 48, duration: reducedMotion() ? 0 : 600, maxZoom: 17 });
  }

  return {
    map,
    setRoutes(normal, better) {
      if (map.isStyleLoaded() && map.getSource("better")) draw(normal, better);
      else queued = { normal, better };
    },
    clearRoutes() {
      if (!map.getSource("better")) return;
      const empty = { type: "FeatureCollection" as const, features: [] };
      (map.getSource("normal") as GeoJSONSource).setData(empty);
      (map.getSource("better") as GeoJSONSource).setData(empty);
    },
    setMarker(end, point) {
      markers[end]?.remove();
      markers[end] = null;
      if (!point) return;
      const el = document.createElement("div");
      el.className = `marker ${end}`;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", end === "from" ? "Start" : "End");
      const label = document.createElement("span");
      label.textContent = end === "from" ? "A" : "B";
      el.append(label);
      markers[end] = new Marker({ element: el, anchor: "center" }).setLngLat(point).addTo(map);
    },
    centre() {
      const c = map.getCenter();
      return [c.lng, c.lat];
    },
    flyTo(point) {
      map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 16), duration: reducedMotion() ? 0 : 500 });
    },
    onTap(handler) {
      map.on("click", (e: MapMouseEvent) => handler([e.lngLat.lng, e.lngLat.lat]));
    },
  };
}
