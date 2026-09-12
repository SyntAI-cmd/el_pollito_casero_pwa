import React, { useState, lazy, Suspense } from "react";
import { Navigation, MapPin, Check } from "lucide-react";
import { api } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";

const LocationPicker = lazy(() => import("./LocationPicker.jsx"));

/** Dirección + punto en el mapa, con "usar mi ubicación actual" y pin arrastrable. */
export default function DeliveryPoint({ known }) {
  const { localities, notify, config } = useStore();
  const [address, setAddress] = useState(known.address || "");
  const [localityId, setLocalityId] = useState(known.localityId || "");
  const [location, setLocation] = useState(known.location || null);
  const [showMap, setShowMap] = useState(!!known.location);
  const [status, setStatus] = useState("");
  const origin = config?.origin || { lat: -33.0806, lng: -68.4686 };

  async function place(point, { fill = true } = {}) {
    setLocation(point);
    setShowMap(true);
    setStatus("Buscando la dirección…");
    try {
      const r = await api(`/geo/reverse?lat=${point.lat}&lng=${point.lng}`);
      if (r) {
        if (fill && r.address)
          setAddress((a) => (a.trim().length < 8 ? r.address : a));
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
    setStatus("Obteniendo tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (pos) => place({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () =>
        setStatus(
          "No pudimos acceder a tu ubicación. Marcá el punto en el mapa o escribí la dirección.",
        ),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }
  return (
    <>
      <label>
        Dirección completa
        <input
          name="address"
          autoComplete="street-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Calle, número y referencia"
          required
          minLength="8"
          maxLength="250"
        />
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
          <button type="button" className="secondary" onClick={locate}>
            <Navigation size={15} /> Usar mi ubicación actual
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
              }}
            >
              Quitar punto
            </button>
          )}
        </div>
        {showMap && (
          <Suspense
            fallback={
              <div className="location-picker loading">Cargando mapa…</div>
            }
          >
            <LocationPicker
              value={location}
              center={location || known.location || origin}
              onChange={(p) => place(p, { fill: address.trim().length < 8 })}
            />
          </Suspense>
        )}
        <p className={"delivery-point-status " + (location ? "ok" : "")}>
          {location ? <Check size={14} /> : <MapPin size={14} />}
          {status ||
            (location
              ? "Punto de entrega marcado."
              : "Marcá el punto exacto para que el repartidor llegue sin vueltas.")}
        </p>
        <input type="hidden" name="lat" value={location?.lat ?? ""} />
        <input type="hidden" name="lng" value={location?.lng ?? ""} />
      </div>
    </>
  );
}
