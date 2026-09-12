import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const pinIcon = L.divIcon({
  className: "map-pin map-pin-dest",
  html: "<span>●</span>",
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

/**
 * Mapa para marcar el punto exacto de entrega: se puede arrastrar el pin o tocar el mapa.
 * `value` es {lat, lng} o null; `center` se usa cuando todavía no hay punto.
 */
export default function LocationPicker({ value, center, onChange }) {
  const ref = useRef();
  const map = useRef();
  const marker = useRef();
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
    map.current.on("click", (e) =>
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng }),
    );
    // Dentro de un <dialog> el mapa se monta antes de tener tamaño final.
    const fix = setTimeout(() => map.current?.invalidateSize(), 50);
    return () => {
      clearTimeout(fix);
      map.current.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (value) {
      if (!marker.current) {
        marker.current = L.marker([value.lat, value.lng], {
          icon: pinIcon,
          draggable: true,
          keyboard: true,
        })
          .addTo(m)
          .on("dragend", (e) => {
            const p = e.target.getLatLng();
            onChange({ lat: p.lat, lng: p.lng });
          });
        m.setView([value.lat, value.lng], 17, { animate: false });
      } else {
        marker.current.setLatLng([value.lat, value.lng]);
        if (!m.getBounds().contains([value.lat, value.lng]))
          m.panTo([value.lat, value.lng], { animate: false });
      }
    } else {
      marker.current?.remove();
      marker.current = null;
      m.setView([center.lat, center.lng], 14, { animate: false });
    }
  }, [value?.lat, value?.lng, center?.lat, center?.lng]);
  return (
    <div
      className="location-picker"
      ref={ref}
      role="application"
      aria-label="Mapa para marcar el punto de entrega. Tocá el mapa o arrastrá el pin."
    />
  );
}
