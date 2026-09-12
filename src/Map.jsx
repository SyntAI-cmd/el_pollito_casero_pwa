import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const pin = (kind, text) =>
  L.divIcon({
    className: `map-pin map-pin-${kind}`,
    html: `<span>${text}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

/**
 * Mapa de seguimiento: local de origen, domicilio de entrega (si se pudo geocodificar)
 * y posición del repartidor cuando comparte su GPS. La ruta por calles se pide al
 * servidor público de OSRM; si no responde, se dibuja el recorrido registrado.
 */
export default function LiveMap({ order, origin, onRoute }) {
  const ref = useRef();
  const map = useRef();
  const layer = useRef();
  const [routeState, setRouteState] = useState({ key: "", coords: null });
  const driver = order.location
    ? [order.location.lat, order.location.lng]
    : null;
  const dest = order.destination
    ? [order.destination.lat, order.destination.lng]
    : null;
  const from = driver || (origin ? [origin.lat, origin.lng] : null);
  const routeKey =
    from && dest && order.status !== "entregado"
      ? `${from.map((n) => n.toFixed(4))}>${dest}`
      : "";

  useEffect(() => {
    map.current = L.map(ref.current, {
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current.remove();
      map.current = null;
    };
  }, []);

  // Ruta por calles (OSRM público). Se recalcula cuando cambia la posición del repartidor.
  useEffect(() => {
    if (!routeKey) return;
    const controller = new AbortController();
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson`;
    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        const route = data.routes?.[0];
        if (!route) throw Error();
        setRouteState({
          key: routeKey,
          coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        });
        onRoute?.({
          minutes: Math.round(route.duration / 60),
          km: route.distance / 1000,
        });
      })
      .catch(() => setRouteState({ key: routeKey, coords: null }));
    return () => controller.abort();
  }, [routeKey]);

  useEffect(() => {
    if (!map.current) return;
    layer.current.clearLayers();
    const points = [];
    if (origin) {
      L.marker([origin.lat, origin.lng], { icon: pin("origin", "PC") })
        .addTo(layer.current)
        .bindPopup(origin.name || "Pollito Casero");
      points.push([origin.lat, origin.lng]);
    }
    if (dest) {
      L.marker(dest, { icon: pin("dest", "●") })
        .addTo(layer.current)
        .bindPopup("Tu domicilio de entrega");
      points.push(dest);
    }
    if (order.track?.length > 1)
      L.polyline(order.track, {
        color: "#20201e",
        weight: 3,
        opacity: 0.35,
      }).addTo(layer.current);
    const routeCoords = routeState.key === routeKey ? routeState.coords : null;
    if (routeCoords)
      L.polyline(routeCoords, {
        color: "#cc242a",
        weight: 5,
        opacity: 0.9,
      }).addTo(layer.current);
    else if (from && dest)
      L.polyline([from, dest], {
        color: "#cc242a",
        weight: 4,
        dashArray: "8 8",
      }).addTo(layer.current);
    if (driver) {
      L.marker(driver, {
        icon: pin("driver", order.driver?.[0] || "R"),
        zIndexOffset: 1000,
      })
        .addTo(layer.current)
        .bindPopup(`${order.driver || "Repartidor"} · ubicación compartida`);
      points.push(driver);
    }
    if (points.length > 1)
      map.current.fitBounds(L.latLngBounds(points).pad(0.25), {
        animate: false,
        maxZoom: 16,
      });
    else if (points.length === 1)
      map.current.setView(points[0], 15, { animate: false });
    else map.current.setView([-33.0806, -68.4686], 13, { animate: false });
  }, [
    order.id,
    order.location?.at,
    order.destination?.lat,
    order.status,
    routeState,
    origin,
  ]);

  return (
    <div
      className="live-map"
      ref={ref}
      role="region"
      aria-label="Mapa con el local, tu domicilio y la posición del repartidor cuando comparte su ubicación."
    />
  );
}
