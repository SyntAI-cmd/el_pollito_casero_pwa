import React, { useCallback, useEffect, useState } from "react";
import {
  Truck,
  Clock,
  MapPin,
  RefreshCw,
  Trash2,
  ExternalLink,
  Route,
  Copy,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute } from "../lib/router.jsx";
import { api, del, subscribe } from "../lib/api.js";
import { PageHead } from "../components/ui.jsx";
import { vehicleLabel } from "../components/Vehicles.jsx";
import { todayKey, dmy } from "../lib/day.js";
import { timeText } from "../lib/format.js";
import { mapsPoint, mapsTrackUrl, copyText } from "../lib/maps.js";

const ago = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
};

/**
 * Flota (administración): cada vehículo que salió con quiénes van, hora de salida, última
 * ubicación y velocidad. La ubicación y el recorrido se abren en Google Maps (sin mapa propio).
 * Se refresca con el canal en vivo (evento `fleet`) cada vez que un camión manda su ubicación.
 */
export default function Fleet() {
  const { session, notify } = useStore();
  const { query } = useRoute();
  const [date, setDate] = useState(query.get("fecha") || todayKey());
  const [trips, setTrips] = useState([]);
  const [tracks, setTracks] = useState({});
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
  async function track(t) {
    try {
      const r = await api(`/salidas/${t.id}/recorrido`);
      const url = mapsTrackUrl(r.track);
      if (!url) return notify("Ese vehículo todavía no mandó ubicaciones.");
      setTracks((x) => ({ ...x, [t.id]: url }));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      notify(e.message);
    }
  }
  if (session?.role !== "admin") return null;
  const live = trips.filter((t) => t.last);
  return (
    <div className="floor fleet-page">
      <PageHead
        eyebrow="PISO · FLOTA"
        title={`Flota del ${dmy(date)}.`}
        description={
          trips.length
            ? `${trips.length} ${trips.length === 1 ? "salida" : "salidas"} · ${live.length} con ubicación`
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
      <ul className="fleet-list">
        {trips.map((t) => (
          <li key={t.id} className={t.last ? "live" : ""}>
            <div className="fleet-info">
              <strong>
                <Truck size={15} /> {vehicleLabel(t.vehicle) || "Vehículo"}
              </strong>
              <small>
                {t.drivers.length ? t.drivers.join(" y ") : "sin preventistas"}
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
            </div>
            <div className="fleet-actions">
              {t.last && (
                <a
                  className="secondary small"
                  href={mapsPoint(t.last.lat, t.last.lng)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={13} /> Ver en Google Maps
                </a>
              )}
              {t.last && (
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => track(t)}
                >
                  <Route size={13} /> Recorrido
                </button>
              )}
              {tracks[t.id] && (
                <button
                  type="button"
                  className="link-button"
                  onClick={async () =>
                    notify(
                      (await copyText(tracks[t.id]))
                        ? "Enlace del recorrido copiado."
                        : "No se pudo copiar: abrilo y copiá la dirección.",
                    )
                  }
                >
                  <Copy size={13} /> copiar enlace
                </button>
              )}
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
                <Trash2 size={13} /> borrar
              </button>
            </div>
          </li>
        ))}
        {!trips.length && (
          <li className="muted">No hay salidas armadas para esta fecha.</li>
        )}
      </ul>
    </div>
  );
}
