import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Navigation, MapPin, Check, Search, AlertTriangle } from "lucide-react";
import { api } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";

const LocationPicker = lazy(() => import("./LocationPicker.jsx"));

/**
 * Dirección y punto exacto de entrega, como en las apps de reparto:
 * buscás la calle con sugerencias, o usás el GPS del dispositivo, y ajustás el pin.
 * En una PC sin GPS el navegador ubica por IP (impreciso): se avisa y se pide ajustar.
 */
export default function DeliveryPoint({ known }) {
  const { localities, notify, config } = useStore();
  const [address, setAddress] = useState(known.address || "");
  const [localityId, setLocalityId] = useState(known.localityId || "");
  const [location, setLocation] = useState(known.location || null);
  const [showMap, setShowMap] = useState(!!known.location);
  const [status, setStatus] = useState("");
  const [warning, setWarning] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const timer = useRef();
  const skipSearch = useRef(false);
  const origin = config?.origin || { lat: -33.0806, lng: -68.4686 };

  // Sugerencias mientras se escribe (acotadas a la zona de reparto).
  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    clearTimeout(timer.current);
    const q = address.trim();
    if (q.length < 4) return setSuggestions([]);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const local = localities.find((l) => l.id === localityId);
        const r = await api(
          `/geo/search?q=${encodeURIComponent(local && !/[a-z]{3,}\s*,/i.test(q) ? `${q}, ${local.name}` : q)}`,
        );
        setSuggestions(r);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(timer.current);
  }, [address]);

  function choose(s) {
    skipSearch.current = true;
    setAddress(s.address || s.label);
    if (s.localityId) setLocalityId(s.localityId);
    setLocation({ lat: s.lat, lng: s.lng });
    setShowMap(true);
    setSuggestions([]);
    setWarning(
      s.precise
        ? ""
        : "Encontramos la calle pero no la altura: arrastrá el pin hasta tu puerta.",
    );
    setStatus(`Punto marcado en ${s.label}.`);
  }

  async function place(point, { fill = true } = {}) {
    setLocation(point);
    setShowMap(true);
    setStatus("Buscando la dirección…");
    try {
      const r = await api(`/geo/reverse?lat=${point.lat}&lng=${point.lng}`);
      if (r) {
        if (fill && r.address) {
          skipSearch.current = true;
          setAddress((a) => (a.trim().length < 8 ? r.address : a));
        }
        if (r.localityId) setLocalityId(r.localityId);
        setStatus(
          r.address
            ? `Cerca de ${r.address}${r.town ? ", " + r.town : ""}`
            : "Punto marcado en el mapa.",
        );
      } else setStatus("Punto marcado en el mapa.");
    } catch (e) {
      setStatus(e.message);
      if (e.status === 400) setLocation(null);
    }
  }

  function locate() {
    if (!navigator.geolocation)
      return notify("Tu dispositivo no admite ubicación.");
    setLocating(true);
    setWarning("");
    setStatus("Obteniendo tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const accuracy = pos.coords.accuracy || 0;
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (accuracy > 300) {
          // Sin GPS (PC o red): el navegador estima por IP y cae en el centro de la ciudad.
          setWarning(
            `Tu dispositivo ubicó con ±${Math.round(accuracy / 100) / 10} km de margen (sin GPS). Escribí tu calle arriba o arrastrá el pin hasta tu casa.`,
          );
          setLocation(point);
          setShowMap(true);
          setStatus("Ubicación aproximada, ajustala en el mapa.");
          return;
        }
        place(point);
      },
      (err) => {
        setLocating(false);
        setStatus(
          err.code === 1
            ? "No diste permiso de ubicación. Escribí tu dirección o marcá el punto en el mapa."
            : "No pudimos obtener tu ubicación. Escribí tu dirección o marcá el punto en el mapa.",
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  return (
    <>
      <label className="address-search">
        Dirección completa
        <div className="search-field">
          <Search size={16} />
          <input
            name="address"
            autoComplete="off"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Calle y número, ej. Pergamino 120"
            required
            minLength="8"
            maxLength="250"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
          />
          {searching && <span className="search-spin" aria-hidden="true" />}
        </div>
        {suggestions.length > 0 && (
          <ul className="suggestions" role="listbox">
            {suggestions.map((s) => (
              <li key={s.lat + "," + s.lng}>
                <button type="button" role="option" onClick={() => choose(s)}>
                  <MapPin size={14} />
                  <span>
                    <strong>{s.label}</strong>
                    <small>{s.detail}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </label>
      <label>
        Localidad de entrega
        <select
          name="localityId"
          value={localityId}
          onChange={(e) => setLocalityId(e.target.value)}
          required
        >
          <option value="" disabled>
            Elegí una localidad…
          </option>
          {localities.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} · CP {l.postalCode}
            </option>
          ))}
        </select>
      </label>
      <div className="delivery-point">
        <div className="delivery-point-actions">
          <button
            type="button"
            className="secondary"
            onClick={locate}
            disabled={locating}
          >
            <Navigation size={15} />{" "}
            {locating ? "Ubicando…" : "Usar mi ubicación actual"}
          </button>
          {!showMap && (
            <button
              type="button"
              className="link-button"
              onClick={() => setShowMap(true)}
            >
              <MapPin size={14} /> Marcar en el mapa
            </button>
          )}
          {location && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setLocation(null);
                setStatus("");
                setWarning("");
              }}
            >
              Quitar punto
            </button>
          )}
        </div>
        {warning && (
          <p className="delivery-point-warning">
            <AlertTriangle size={14} /> {warning}
          </p>
        )}
        {showMap && (
          <Suspense
            fallback={
              <div className="location-picker loading">Cargando mapa…</div>
            }
          >
            <LocationPicker
              value={location}
              center={location || known.location || origin}
              onChange={(p) => {
                setWarning("");
                place(p, { fill: address.trim().length < 8 });
              }}
            />
          </Suspense>
        )}
        <p
          className={
            "delivery-point-status " + (location && !warning ? "ok" : "")
          }
        >
          {location && !warning ? <Check size={14} /> : <MapPin size={14} />}
          {status ||
            (location
              ? "Punto de entrega marcado."
              : "Escribí tu calle y elegí la sugerencia, o marcá el punto en el mapa.")}
        </p>
        <input type="hidden" name="lat" value={location?.lat ?? ""} />
        <input type="hidden" name="lng" value={location?.lng ?? ""} />
      </div>
    </>
  );
}
