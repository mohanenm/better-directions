/**
 * The map: MapLibre with the self-hosted Protomaps basemap (tiles, fonts and sprites all served
 * by this site), in the light or dark flavour to match the page, plus the two routes and the
 * start/end markers. The panel floats over the map, so routes are fitted into the part of the
 * map it leaves visible.
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
  Popup,
  type StyleSpecification,
} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { colour } from "./colours";
import { currentTheme, onThemeChange, type Theme } from "./theme";
import type { Pin } from "./protocol";
import type { Bbox } from "./url";

setWorkerUrl(maplibreWorkerUrl);

type Line = [number, number][];
type Lines = Line | Line[];
const asLines = (l: Lines): Line[] => (l.length && Array.isArray(l[0]![0]) ? (l as Line[]) : l.length ? [l as Line] : []);

export interface PinAction {
  label: string;
  run: () => void;
}

/** The part of the map not covered by the panel, in CSS pixels from the map's top left. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RouteMap {
  map: MapLibreMap;
  /** The normal (dashed) and better (solid) lines; each may be several lines. Pen-up walks are dotted. */
  setRoutes(normal: Lines, better: Lines, penUp?: [number, number][][]): void;
  clearRoutes(): void;
  setMarker(end: "from" | "to", point: [number, number] | null): void;
  /** Pins with a popup each; `actions` lists the buttons to offer for a pin. */
  setPins(pins: Pin[], actions: (pin: Pin) => PinAction[]): void;
  /** The centre of the visible part of the map. */
  centre(): [number, number];
  visibleBox(): Box;
  flyTo(point: [number, number]): void;
  onTap(handler: (point: [number, number]) => void): void;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Our own layers, drawn over the basemap, with the palette colour each one takes. */
const ROUTE_LAYERS: Record<string, [string, string]> = {
  "normal-line": ["line-color", "route-normal"],
  "penup-line": ["line-color", "route-better"],
  "better-casing": ["line-color", "route-casing"],
  "better-line": ["line-color", "route-better"],
};
const ROUTE_SOURCES = ["normal", "better", "penup"];

/** How much of the map the floating panel and header cover on each side. */
function coveredInsets(container: HTMLElement): { top: number; right: number; bottom: number; left: number } {
  const map = container.getBoundingClientRect();
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const panel = document.getElementById("panel")?.getBoundingClientRect();
  if (!panel || !panel.width) return insets;
  if (panel.width < map.width * 0.6) insets.left = Math.max(0, panel.right - map.left); // floating card on the left
  else insets.bottom = Math.max(0, map.bottom - panel.top); // bottom sheet
  return insets;
}

export function createMap(container: HTMLElement, bbox: Bbox): RouteMap {
  // Absolute URLs under the site's base path (works at /better-directions/ or anywhere else).
  const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
  const basemap = (theme: Theme): StyleSpecification => ({
    version: 8,
    glyphs: `${base}basemap/fonts/{fontstack}/{range}.pbf`,
    sprite: `${base}basemap/sprites/${theme}`,
    sources: {
      protomaps: {
        type: "vector",
        tiles: [`${base}tiles/${CITY.id}/{z}/{x}/{y}.mvt`],
        minzoom: 0,
        maxzoom: CITY.maxTileZoom,
        bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
      },
    },
    layers: layers("protomaps", namedFlavor(theme), { lang: CITY.labelLang }),
  });
  const map = new MapLibreMap({
    container,
    style: basemap(currentTheme()),
    bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
    fitBoundsOptions: { padding: coveredInsets(container) },
    maxBounds: [bbox.west - 0.03, bbox.south - 0.02, bbox.east + 0.03, bbox.north + 0.02],
    minZoom: 11,
    maxZoom: 19,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");

  // A new theme swaps the basemap and keeps the routes, recoloured.
  onThemeChange((theme) => {
    map.setStyle(basemap(theme), {
      transformStyle: (previous, next) => ({
        ...next,
        sources: { ...next.sources, ...Object.fromEntries(ROUTE_SOURCES.flatMap((id) => (previous?.sources[id] ? [[id, previous.sources[id]!]] : []))) },
        layers: [
          ...next.layers,
          ...(previous?.layers ?? [])
            .filter((l) => l.id in ROUTE_LAYERS)
            .map((l) => {
              const [prop, name] = ROUTE_LAYERS[l.id]!;
              return { ...l, paint: { ...("paint" in l ? l.paint : {}), [prop]: colour(name) } } as typeof l;
            }),
        ],
      }),
    });
  });

  const padding = () => {
    const c = coveredInsets(container);
    return { top: 48 + c.top, right: 48 + c.right, bottom: 48 + c.bottom, left: 48 + c.left };
  };
  const visibleBox = (): Box => {
    const c = coveredInsets(container);
    return { x: c.left, y: c.top, width: Math.max(1, container.clientWidth - c.left - c.right), height: Math.max(1, container.clientHeight - c.top - c.bottom) };
  };

  const markers: Record<"from" | "to", Marker | null> = { from: null, to: null };
  let pinMarkers: Marker[] = [];
  let popup: Popup | null = null;
  // Routes that arrive before our sources exist (first load, or mid theme switch) are drawn as
  // soon as they do. Don't wait for isStyleLoaded(): it stays false while any tile is loading, so
  // a route arriving after the map moved would wait for an event that never comes.
  let queued: { normal: Line[]; better: Line[]; penUp: Line[] } | null = null;
  const flushQueued = () => {
    if (!queued || !map.getSource("better")) return;
    const q = queued;
    queued = null;
    draw(q.normal, q.better, q.penUp);
  };
  map.on("styledata", flushQueued);

  map.on("load", () => {
    const empty = { type: "FeatureCollection" as const, features: [] };
    map.addSource("normal", { type: "geojson", data: empty });
    map.addSource("better", { type: "geojson", data: empty });
    map.addSource("penup", { type: "geojson", data: empty });
    map.addLayer({
      id: "normal-line",
      type: "line",
      source: "normal",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": colour("route-normal"), "line-width": 4, "line-dasharray": [1.5, 1.5], "line-opacity": 0.85 },
    });
    map.addLayer({
      id: "penup-line",
      type: "line",
      source: "penup",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": colour("route-better"), "line-width": 3, "line-dasharray": [0.2, 2], "line-opacity": 0.9 },
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
    flushQueued();
  });

  const lines = (coords: Line[]) => ({
    type: "Feature" as const,
    properties: {},
    geometry: { type: "MultiLineString" as const, coordinates: coords },
  });

  function draw(normal: Line[], better: Line[], penUp: Line[]): void {
    (map.getSource("normal") as GeoJSONSource).setData(lines(normal));
    (map.getSource("better") as GeoJSONSource).setData(lines(better));
    (map.getSource("penup") as GeoJSONSource).setData(lines(penUp));
    const all = [...normal.flat(), ...better.flat(), ...penUp.flat()];
    if (!all.length) return;
    const bounds = all.reduce(
      (b, p) => b.extend(p),
      new LngLatBounds(all[0]!, all[0]!),
    );
    map.fitBounds(bounds as LngLatBoundsLike, { padding: padding(), duration: reducedMotion() ? 0 : 600, maxZoom: 17 });
  }

  return {
    map,
    setRoutes(normal, better, penUp = []) {
      const n = asLines(normal);
      const b = asLines(better);
      if (map.getSource("better")) draw(n, b, penUp);
      else queued = { normal: n, better: b, penUp };
    },
    clearRoutes() {
      if (!map.getSource("better")) return;
      const empty = { type: "FeatureCollection" as const, features: [] };
      (map.getSource("normal") as GeoJSONSource).setData(empty);
      (map.getSource("better") as GeoJSONSource).setData(empty);
      (map.getSource("penup") as GeoJSONSource).setData(empty);
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
    setPins(pins, actions) {
      pinMarkers.forEach((m) => m.remove());
      popup?.remove();
      pinMarkers = pins.map((pin) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `pin ${pin.kind}`;
        el.textContent = pin.number ? String(pin.number) : "";
        el.setAttribute("aria-label", `${pin.number ? `${pin.number}: ` : ""}${pin.name}${pin.kind === "park" ? " (park)" : ""}. Show details.`);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          popup?.remove();
          const body = document.createElement("div");
          body.className = "pin-popup";
          const title = document.createElement("strong");
          title.textContent = pin.name;
          body.append(title);
          if (pin.detail) {
            const p = document.createElement("p");
            p.textContent = pin.detail;
            body.append(p);
          }
          for (const action of actions(pin)) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "secondary";
            b.textContent = action.label;
            b.addEventListener("click", () => {
              popup?.remove();
              action.run();
            });
            body.append(b);
          }
          popup = new Popup({ closeButton: true, maxWidth: "260px", offset: 14 }).setLngLat(pin.at).setDOMContent(body).addTo(map);
          body.querySelector<HTMLButtonElement>("button")?.focus();
        });
        return new Marker({ element: el, anchor: "center" }).setLngLat(pin.at).addTo(map);
      });
    },
    centre() {
      const box = visibleBox();
      const c = map.unproject([box.x + box.width / 2, box.y + box.height / 2]);
      return [c.lng, c.lat];
    },
    visibleBox,
    flyTo(point) {
      const box = visibleBox();
      const offset: [number, number] = [box.x + box.width / 2 - container.clientWidth / 2, box.y + box.height / 2 - container.clientHeight / 2];
      map.easeTo({ center: point, offset, zoom: Math.max(map.getZoom(), 16), duration: reducedMotion() ? 0 : 500 });
    },
    onTap(handler) {
      map.on("click", (e: MapMouseEvent) => handler([e.lngLat.lng, e.lngLat.lat]));
    },
  };
}
