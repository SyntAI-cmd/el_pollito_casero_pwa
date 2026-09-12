/**
 * Ruta y tiempo estimado de llegada con el servidor público de OSRM.
 * Se usa al salir a reparto y, con moderación, con cada posición GPS nueva.
 * Si OSRM no responde, se estima con distancia en línea recta a 25 km/h.
 */
const endpoint = "https://router.project-osrm.org/route/v1/driving";
const enabled = process.env.ROUTING !== "off";

export async function estimate(from, to) {
  if (!from || !to) return null;
  const straight = () => {
    const km = haversine(from, to) * 1.3;
    return {
      minutes: Math.max(1, Math.round((km / 25) * 60)),
      km: Math.round(km * 10) / 10,
      source: "estimado",
    };
  };
  if (!enabled) return finish(straight());
  try {
    const url = `${endpoint}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await r.json();
    const route = data.routes?.[0];
    if (!route) return finish(straight());
    return finish({
      minutes: Math.max(1, Math.round(route.duration / 60)),
      km: Math.round(route.distance / 100) / 10,
      source: "osrm",
    });
  } catch {
    return finish(straight());
  }
}

const finish = (eta) => ({
  ...eta,
  at: new Date().toISOString(),
  arrival: new Date(Date.now() + eta.minutes * 60000).toISOString(),
});

export function haversine(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Provincia de Mendoza, con margen: para validar coordenadas elegidas por el cliente. */
export const inMendoza = ({ lat, lng }) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat > -37.7 &&
  lat < -31.9 &&
  lng > -70.7 &&
  lng < -66.3;
