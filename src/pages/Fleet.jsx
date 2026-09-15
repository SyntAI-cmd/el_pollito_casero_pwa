import React, { useCallback, useEffect, useRef, useState } from "react";
import { Truck, Clock, MapPin, RefreshCw, Trash2 } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute } from "../lib/router.jsx";
import { api, del, subscribe } from "../lib/api.js";
import { PageHead } from "../components/ui.jsx";
import { vehicleLabel } from "../components/Vehicles.jsx";
import { todayKey, dmy } from "../lib/day.js";
import { timeText } from "../lib/format.js";

const mapkit = () => import("../lib/mapkit.js");

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
};

/**
 * Flota en vivo (administración): cada vehículo que salió hoy con su última posición en el mapa,
 * quiénes van, hora de salida, velocidad y el recorrido del elegido. Se refresca con el canal en
 * vivo (evento `fleet`) cada vez que un camión manda su ubicación.
 */
export default function Fleet() {
  const { session, notify } = useStore();
  const { query } = useRoute();
  const [date, setDate] = useState(query.get("fecha") || todayKey());
  const [trips, setTrips] = useState([]);
  const [selected, setSelected] = useState(null);
  const [track, setTrack] = useState([]);
  const mapRef = useRef();
  const map = useRef();
  const markers = useRef({});
  const kit = useRef(null);
  const [ready, setReady] = useState(false); // mapa creado (marcadores)
  const [styled, setStyled] = useState(false); // estilo cargado (capas del recorrido)

  const load = useCallback(
    () =>
      api("/salidas?fecha=" + date)
        .then(setTrips)
        .catch((e) => notify(e.message)),
    [date, notify],
  );
  useEffect(() => {
    load();
    return subscribe((type) => type === "fleet" && load());
  }, [load]);
  useEffect(() => {
    if (!selected) return setTrack([]);
    api(`/salidas/${selected}/recorrido`)
      .then((t) => setTrack(t.track || []))
      .catch(() => setTrack([]));
  }, [selected, trips]);

  // Mapa: se carga MapLibre bajo demanda (pesa 1 MB) solo al entrar a esta pantalla.
  useEffect(() => {
    let cancelled = false;
    mapkit().then((k) => {
      if (cancelled || !mapRef.current) return;
      kit.current = k;
      const m = k.createMap(mapRef.current, { zoom: 11 });
      map.current = m;
      setReady(true);
      m.on("load", () => {
        k.ensureRouteLayers(m);
        setStyled(true);
      });
      m.on("styledata", () => {
        if (m.isStyleLoaded() && !m.getSource("route")) {
          k.ensureRouteLayers(m);
          setStyled(true);
        }
      });
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  // Marcadores: uno por vehículo con posición; se deslizan al moverse.
  useEffect(() => {
    const m = map.current,
      k = kit.current;
    if (!ready || !m || !k) return;
    const seen = new Set();
    for (const t of trips) {
      if (!t.last) continue;
      seen.add(t.id);
      const ll = [t.last.lng, t.last.lat];
      const label = (t.vehicle?.plate || t.vehicle?.name || "?").slice(0, 8);
      if (markers.current[t.id]) k.glide(markers.current[t.id], ll);
      else {
        const mk = k.marker("driver", label, ll).addTo(m);
        mk.getElement().addEventListener("click", () => setSelected(t.id));
        markers.current[t.id] = mk;
      }
    }
    for (const id of Object.keys(markers.current))
      if (!seen.has(id)) {
        markers.current[id].remove();
        delete markers.current[id];
      }
    const points = trips
      .filter((t) => t.last)
      .map((t) => [t.last.lng, t.last.lat]);
    if (points.length && !m._fitted) {
      k.fitTo(m, points, { maxZoom: 14 });
      m._fitted = true;
    }
  }, [trips, ready]);
  // Recorrido del vehículo elegido.
  useEffect(() => {
    const m = map.current,
      k = kit.current;
    if (!styled || !m || !k || !m.getSource("track")) return;
    m.getSource("track").setData(
      k.lineFeature(track.map((p) => [p.lng, p.lat])),
    );
    if (track.length > 1)
      k.fitTo(
        m,
        track.map((p) => [p.lng, p.lat]),
        { maxZoom: 15 },
      );
  }, [track, styled]);

  if (session?.role !== "admin") return null;
  const live = trips.filter((t) => t.last);
  return (
    <div className="floor fleet-page">
      <PageHead
        eyebrow="PISO · FLOTA"
        title={`Flota del ${dmy(date)}.`}
        description={
          trips.length
            ? `${trips.length} ${trips.length === 1 ? "salida" : "salidas"} · ${live.length} con ubicación en vivo`
            : "Las salidas se arman desde Carga (vehículo, preventistas y hora)."
        }
      >
        <div className="head-actions">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha"
          />
          <button className="secondary" onClick={load}>
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
      </PageHead>
      <div className="fleet-layout">
        <div className="fleet-map" ref={mapRef} aria-label="Mapa de la flota" />
        <ul className="fleet-list">
          {trips.map((t) => (
            <li
              key={t.id}
              className={
                (selected === t.id ? "active " : "") + (t.last ? "live" : "")
              }
            >
              <button type="button" onClick={() => setSelected(t.id)}>
                <strong>
                  <Truck size={15} /> {vehicleLabel(t.vehicle) || "Vehículo"}
                </strong>
                <small>
                  {t.drivers.length ? t.drivers.join(", ") : "sin preventistas"}
                </small>
                <small>
                  <Clock size={12} />{" "}
                  {t.departure ? `sale ${t.departure}` : "sin hora"}
                  {t.departedAt ? ` · salió ${timeText(t.departedAt)}` : ""}
                </small>
                <small>
                  <MapPin size={12} />{" "}
                  {t.last
                    ? `${ago(t.last.at)}${t.last.speed != null ? ` · ${Math.round(t.last.speed * 3.6)} km/h` : ""}`
                    : "sin ubicación todavía"}
                </small>
              </button>
              <button
                type="button"
                className="link-button danger"
                title="Borrar la salida"
                onClick={() => {
                  if (window.confirm("¿Borrar esta salida y su recorrido?"))
                    del("/salidas/" + t.id)
                      .then(load)
                      .catch((e) => notify(e.message));
                }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {!trips.length && (
            <li className="muted">No hay salidas armadas para esta fecha.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
