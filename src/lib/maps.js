/** Enlaces a Google Maps: punto, recorrido de paradas y copia al portapapeles. */
const point = (o) =>
  o.destination
    ? `${o.destination.lat},${o.destination.lng}`
    : `${o.address}, ${o.locality?.name || ""}, Mendoza, Argentina`;

export const mapsPoint = (lat, lng) =>
  `https://www.google.com/maps?q=${lat},${lng}`;

/**
 * Ruta con paradas en orden. Google Maps admite 10 puntos por enlace: se devuelven tramos
 * consecutivos [{ from, to, url }] (índices 1-based de las paradas).
 */
export function mapsRouteLegs(stops, origin) {
  const legs = [];
  for (let i = 0; i < stops.length; i += 10) {
    const chunk = stops.slice(i, i + 10);
    const from =
      i === 0
        ? origin
          ? origin.lat + "," + origin.lng
          : ""
        : point(stops[i - 1]);
    legs.push({
      from: i + 1,
      to: i + chunk.length,
      url: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(point(chunk.at(-1)))}${
        chunk.length > 1
          ? "&waypoints=" +
            encodeURIComponent(chunk.slice(0, -1).map(point).join("|"))
          : ""
      }&travelmode=driving`,
    });
  }
  return legs;
}

/** Recorrido registrado (puntos GPS) como enlace de Google Maps, muestreado a 10 puntos. */
export function mapsTrackUrl(track) {
  if (!track?.length) return null;
  const step = Math.max(1, Math.ceil(track.length / 10));
  const pts = track.filter((_, i) => i % step === 0 || i === track.length - 1);
  const fmt = (p) => `${p.lat},${p.lng}`;
  if (pts.length === 1) return mapsPoint(pts[0].lat, pts[0].lng);
  return `https://www.google.com/maps/dir/?api=1&origin=${fmt(pts[0])}&destination=${fmt(pts.at(-1))}${
    pts.length > 2
      ? "&waypoints=" + encodeURIComponent(pts.slice(1, -1).map(fmt).join("|"))
      : ""
  }&travelmode=driving`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
