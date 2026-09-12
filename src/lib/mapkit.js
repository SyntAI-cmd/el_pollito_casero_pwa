/**
 * Utilidades de mapa (MapLibre GL). Estilo vectorial gratuito de OpenFreeMap;
 * si no carga, se usa OpenStreetMap raster. Marcadores propios e interpolación
 * de la posición del repartidor para que se deslice entre lecturas GPS.
 */
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export const VECTOR_STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};
export const DEFAULT_CENTER = [-68.4686, -33.0806];

/** Crea el mapa con el estilo vectorial y cae al raster si falla. */
export function createMap(
  container,
  { center = DEFAULT_CENTER, zoom = 13, interactive = true } = {},
) {
  const map = new maplibregl.Map({
    container,
    style: VECTOR_STYLE,
    center,
    zoom,
    attributionControl: { compact: true },
    interactive,
    cooperativeGestures: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.addControl(
    new maplibregl.NavigationControl({ showCompass: false }),
    "top-left",
  );
  let fellBack = false;
  map.on("error", (e) => {
    const msg = String(e?.error?.message || "");
    if (
      !fellBack &&
      (msg.includes("style") ||
        msg.includes("Failed to fetch") ||
        e?.error?.status >= 400) &&
      !map.isStyleLoaded()
    ) {
      fellBack = true;
      map.setStyle(RASTER_STYLE);
    }
  });
  return map;
}

export function pinElement(kind, text) {
  const el = document.createElement("div");
  el.className = `map-pin map-pin-${kind}`;
  el.innerHTML = `<span>${text}</span>${kind === "driver" ? '<i class="map-heading"></i>' : ""}`;
  return el;
}
export const marker = (kind, text, lngLat, options = {}) =>
  new maplibregl.Marker({
    element: pinElement(kind, text),
    anchor: "center",
    ...options,
  }).setLngLat(lngLat);

export const toLngLat = (p) =>
  Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat];

export function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) *
      Math.cos(toRad(b[1])) *
      Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Desliza un marcador desde su posición actual a la nueva en `ms`, rotando el rumbo. */
export function glide(mk, to, ms = 1200) {
  const from = mk.getLngLat().toArray();
  if (Math.abs(from[0] - to[0]) < 1e-7 && Math.abs(from[1] - to[1]) < 1e-7)
    return;
  const heading = mk.getElement().querySelector(".map-heading");
  if (heading && distanceKm(from, to) > 0.005)
    heading.style.transform = `rotate(${bearing(from, to)}deg)`;
  const start = performance.now();
  cancelAnimationFrame(mk._glide);
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    mk.setLngLat([
      from[0] + (to[0] - from[0]) * e,
      from[1] + (to[1] - from[1]) * e,
    ]);
    if (k < 1) mk._glide = requestAnimationFrame(step);
  };
  mk._glide = requestAnimationFrame(step);
}

/** Capas de ruta (línea principal, recorrido recorrido y borde). */
export function ensureRouteLayers(map) {
  if (map.getSource("route")) return;
  map.addSource("route", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("track", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "track-line",
    type: "line",
    source: "track",
    paint: { "line-color": "#20201e", "line-width": 3, "line-opacity": 0.28 },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route",
    paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    paint: {
      "line-color": "#cc242a",
      "line-width": 5,
      "line-dasharray": [
        "case",
        ["get", "estimated"],
        ["literal", [1.5, 1.5]],
        ["literal", [1, 0]],
      ],
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
}
export const lineFeature = (coords, props = {}) => ({
  type: "FeatureCollection",
  features:
    coords.length > 1
      ? [
          {
            type: "Feature",
            properties: props,
            geometry: { type: "LineString", coordinates: coords },
          },
        ]
      : [],
});

export async function osrmRoute(from, to, signal) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
  const r = await fetch(url, { signal });
  const data = await r.json();
  const route = data.routes?.[0];
  if (!route) throw Error("sin ruta");
  return {
    coords: route.geometry.coordinates,
    minutes: Math.round(route.duration / 60),
    km: route.distance / 1000,
  };
}

export function fitTo(
  map,
  points,
  { padding = 60, maxZoom = 16, animate = true } = {},
) {
  if (!points.length) return;
  if (points.length === 1)
    return map.easeTo({
      center: points[0],
      zoom: Math.min(maxZoom, 15),
      duration: animate ? 600 : 0,
    });
  const b = points.reduce(
    (bounds, p) => bounds.extend(p),
    new maplibregl.LngLatBounds(points[0], points[0]),
  );
  map.fitBounds(b, { padding, maxZoom, duration: animate ? 700 : 0 });
}

export { maplibregl };
