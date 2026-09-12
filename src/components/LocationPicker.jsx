import React, { useEffect, useRef } from "react";
import { createMap, marker } from "../lib/mapkit.js";

/**
 * Mapa para marcar el punto exacto de entrega: tocar el mapa o arrastrar el pin.
 * `value` es {lat, lng} o null; `center` se usa cuando todavía no hay punto.
 */
export default function LocationPicker({ value, center, onChange }) {
  const ref = useRef();
  const map = useRef();
  const pin = useRef();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const start = value || center;
    const m = createMap(ref.current, {
      center: [start.lng, start.lat],
      zoom: value ? 17 : 14,
    });
    map.current = m;
    m.on("click", (e) =>
      onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }),
    );
    // Dentro de un <dialog> el mapa se monta antes de tener su tamaño final.
    const fix = setTimeout(() => map.current?.resize(), 80);
    return () => {
      clearTimeout(fix);
      pin.current?.remove();
      pin.current = null;
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (value) {
      const ll = [value.lng, value.lat];
      if (!pin.current) {
        pin.current = marker("dest", "●", ll, { draggable: true }).addTo(m);
        pin.current.on("dragend", () => {
          const p = pin.current.getLngLat();
          onChangeRef.current({ lat: p.lat, lng: p.lng });
        });
        m.easeTo({
          center: ll,
          zoom: Math.max(m.getZoom(), 16),
          duration: 500,
        });
      } else {
        pin.current.setLngLat(ll);
        if (!m.getBounds().contains(ll))
          m.easeTo({ center: ll, duration: 400 });
      }
    } else if (pin.current) {
      pin.current.remove();
      pin.current = null;
    }
  }, [value?.lat, value?.lng]);

  return (
    <div
      className="location-picker"
      ref={ref}
      role="application"
      aria-label="Mapa para marcar el punto de entrega. Tocá el mapa o arrastrá el pin."
    />
  );
}
