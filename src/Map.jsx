import React, { useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import {
  createMap,
  marker,
  glide,
  ensureRouteLayers,
  lineFeature,
  osrmRoute,
  fitTo,
  toLngLat,
  distanceKm,
} from "./lib/mapkit.js";

/**
 * Mapa de seguimiento del cliente (estilo Uber/Rappi):
 * local, domicilio, camioneta que se desliza entre lecturas GPS con su rumbo,
 * ruta por calles recalculada mientras avanza y cámara que sigue a la camioneta
 * hasta que el usuario toca el mapa ("Centrar" la vuelve a seguir).
 */
export default function LiveMap({ order, origin, onRoute }) {
  const ref = useRef();
  const map = useRef();
  const markers = useRef({});
  const fitted = useRef(false);
  const routeState = useRef({ from: null, at: 0 });
  const [following, setFollowing] = useState(true);
  const [ready, setReady] = useState(false);
  const followingRef = useRef(true);
  followingRef.current = following;

  const originLL = origin ? [origin.lng, origin.lat] : null;
  const destLL = order.destination
    ? [order.destination.lng, order.destination.lat]
    : null;
  const driverLL = order.location
    ? [order.location.lng, order.location.lat]
    : null;
  const active = order.status === "en_camino";

  useEffect(() => {
    const m = createMap(ref.current, {
      center: destLL || originLL || undefined,
      zoom: 14,
    });
    map.current = m;
    setReady(false);
    const stopFollowing = () => {
      followingRef.current = false;
      setFollowing(false);
    };
    m.on("dragstart", stopFollowing);
    m.on("wheel", stopFollowing);
    m.on("load", () => {
      ensureRouteLayers(m);
      setReady(true);
    });
    m.on("styledata", () => {
      if (m.isStyleLoaded() && !m.getSource("route")) ensureRouteLayers(m);
    });
    return () => {
      for (const mk of Object.values(markers.current)) mk.remove();
      markers.current = {};
      fitted.current = false;
      routeState.current = { from: null, at: 0 };
      m.remove();
      map.current = null;
    };
  }, []);

  // Marcadores y encuadre.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const mk = markers.current;
    if (originLL && !mk.origin)
      mk.origin = marker("origin", "PC", originLL).addTo(m);
    if (destLL) {
      if (!mk.dest) mk.dest = marker("dest", "●", destLL).addTo(m);
      else mk.dest.setLngLat(destLL);
    }
    if (driverLL && active) {
      if (!mk.driver)
        mk.driver = marker("driver", (order.driver || "R")[0], driverLL).addTo(
          m,
        );
      else glide(mk.driver, driverLL, 1500);
    } else if (mk.driver) {
      mk.driver.remove();
      delete mk.driver;
    }
    if (m.getSource("track"))
      m.getSource("track").setData(
        lineFeature((order.track || []).map(toLngLat)),
      );
    const points = [
      driverLL && active ? driverLL : null,
      destLL,
      !driverLL || !active ? originLL : null,
    ].filter(Boolean);
    if (followingRef.current)
      fitTo(m, points, { padding: 70, animate: fitted.current });
    fitted.current = true;
  }, [
    ready,
    order.id,
    order.location?.at,
    order.destination?.lat,
    order.status,
  ]);

  // Ruta por calles: se recalcula si la camioneta se movió más de 60 m o pasaron 45 s.
  useEffect(() => {
    const m = map.current;
    if (
      !m ||
      !ready ||
      !destLL ||
      order.status === "entregado" ||
      order.status === "cancelado"
    ) {
      if (m?.getSource("route")) m.getSource("route").setData(lineFeature([]));
      return;
    }
    const from = active && driverLL ? driverLL : originLL;
    if (!from) return;
    const prev = routeState.current;
    const moved = !prev.from || distanceKm(prev.from, from) > 0.06;
    if (!moved && Date.now() - prev.at < 45000) return;
    routeState.current = { from, at: Date.now() };
    const controller = new AbortController();
    osrmRoute(from, destLL, controller.signal)
      .then(({ coords, minutes, km }) => {
        if (!map.current) return;
        m.getSource("route")?.setData(
          lineFeature(coords, { estimated: false }),
        );
        onRoute?.({ minutes, km });
      })
      .catch(() => {
        if (!map.current) return;
        m.getSource("route")?.setData(
          lineFeature([from, destLL], { estimated: true }),
        );
      });
    return () => controller.abort();
  }, [
    ready,
    order.id,
    order.location?.at,
    order.destination?.lat,
    order.status,
  ]);

  const recenter = () => {
    setFollowing(true);
    followingRef.current = true;
    const points = [
      driverLL && active ? driverLL : null,
      destLL,
      !driverLL || !active ? originLL : null,
    ].filter(Boolean);
    if (map.current) fitTo(map.current, points, { padding: 70 });
  };

  return (
    <div className="live-map-wrap">
      <div
        className="live-map"
        ref={ref}
        role="region"
        aria-label="Mapa con el local, tu domicilio y la camioneta en tiempo real."
      />
      {!following && (
        <button className="map-recenter" onClick={recenter}>
          <LocateFixed size={15} /> Centrar
        </button>
      )}
      {active && driverLL && (
        <div className="map-legend">
          <span className="legend-driver">{(order.driver || "R")[0]}</span>{" "}
          {order.driver} en camino
        </div>
      )}
    </div>
  );
}
