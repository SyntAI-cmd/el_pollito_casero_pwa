import React, { useCallback, useEffect, useRef, useState } from "react";
import { Radio, RadioTower } from "lucide-react";
import { api, post, subscribe } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { todayKey } from "../lib/day.js";
import { vehicleLabel } from "./Vehicles.jsx";

const MIN_INTERVAL_MS = 15000; // no más de una lectura cada 15 s
const MIN_MOVE_M = 25; // ni si el camión no se movió

/**
 * "Compartir ubicación del camión": el preventista manda su GPS a la salida del día en la que va
 * (vehículo + compañeros); administración lo ve en Flota. Independiente del GPS por pedido que ve
 * el cliente. Se detiene al apagarlo o al cerrar la app.
 */
export default function TruckLocation() {
  const { session, notify } = useStore();
  const [trip, setTrip] = useState(null);
  const [on, setOn] = useState(false);
  const [lastAt, setLastAt] = useState(null);
  const watch = useRef(null);
  const last = useRef({ t: 0, lat: 0, lng: 0 });

  const load = useCallback(() => {
    if (session?.role !== "repartidor") return;
    api("/salidas?fecha=" + todayKey())
      .then((list) =>
        setTrip(list.find((t) => t.drivers.includes(session.driver)) || null),
      )
      .catch(() => {});
  }, [session]);
  useEffect(() => {
    load();
    return subscribe((type) => type === "fleet" && load());
  }, [load]);

  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setOn(false);
  }, []);
  useEffect(() => stop, [stop]);

  function start() {
    if (!trip)
      return notify("Hoy no estás en ninguna salida: armala desde Carga.");
    if (!navigator.geolocation)
      return notify("Tu dispositivo no admite ubicación.");
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, speed, heading } = pos.coords;
        const t = Date.now();
        const moved =
          Math.hypot(
            (lat - last.current.lat) * 111000,
            (lng - last.current.lng) * 111000 * Math.cos((lat * Math.PI) / 180),
          ) > MIN_MOVE_M;
        if (t - last.current.t < MIN_INTERVAL_MS && !moved) return;
        if (t - last.current.t < 5000) return;
        last.current = { t, lat, lng };
        post(`/salidas/${trip.id}/ubicacion`, {
          lat,
          lng,
          ...(Number.isFinite(speed) && speed >= 0 ? { speed } : {}),
          ...(Number.isFinite(heading) && heading >= 0 ? { heading } : {}),
        })
          .then((r) => setLastAt(r.at))
          .catch((e) => {
            notify(e.message);
            stop();
          });
      },
      () => {
        notify(
          "No pudimos acceder a tu ubicación. Revisá los permisos del navegador.",
        );
        stop();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    setOn(true);
    notify("Compartiendo la ubicación del camión con administración.");
  }

  if (session?.role !== "repartidor") return null;
  return (
    <button
      type="button"
      className={"secondary truck-location " + (on ? "on" : "")}
      onClick={on ? stop : start}
      title={
        trip
          ? `Salida de hoy: ${vehicleLabel(trip.vehicle)} · ${trip.drivers.join(", ")}`
          : "Hoy no estás en ninguna salida"
      }
    >
      {on ? <RadioTower size={15} /> : <Radio size={15} />}{" "}
      {on
        ? `Camión en vivo${lastAt ? " · enviado" : ""} · detener`
        : trip
          ? `Compartir ubicación de ${vehicleLabel(trip.vehicle) || "mi camión"}`
          : "Ubicación del camión"}
    </button>
  );
}
