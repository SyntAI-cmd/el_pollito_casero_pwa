/**
 * Geocodificación con Nominatim (OpenStreetMap): dirección → coordenadas (al crear un
 * pedido), coordenadas → dirección ("usar mi ubicación") y búsqueda con sugerencias.
 * Desactivable con GEOCODING=off. Política de uso: 1 consulta por segundo e identificación.
 */
export const enabled = process.env.GEOCODING !== "off";
// Geocodificador configurable (Nominatim propio, Photon, LocationIQ compatible con la API de Nominatim).
const endpoint = (
  process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org"
).replace(/\/$/, "");
const userAgent =
  "PollitoCasero/0.3 (pedidos de pollo en San Martín, Mendoza; contacto por WhatsApp del negocio)";
// Este de Mendoza y Gran Mendoza: acota búsquedas y descarta homónimos de otras provincias.
const viewbox = "-69.2,-32.6,-67.6,-33.6";
let queue = Promise.resolve();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enqueue = (run) => {
  const result = queue.then(run, run);
  queue = result.then(
    () => wait(1100),
    () => wait(1100),
  );
  return result;
};
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/**
 * Localidad del negocio que corresponde a una dirección de Nominatim.
 * Se prioriza el nombre (villa, barrio, ciudad, distrito) sobre el código postal:
 * Nominatim asigna códigos de la cabecera a distritos vecinos (p. ej. 5584 a Los Barriales).
 */
export function matchLocality(a, localities) {
  const candidates = [
    a.village,
    a.town,
    a.city,
    a.suburb,
    a.hamlet,
    a.neighbourhood,
    a.municipality,
    a.city_district,
    a.county,
  ]
    .filter(Boolean)
    .map(norm);
  for (const c of candidates) {
    const hit = localities.find(
      (l) =>
        c === norm(l.name) ||
        c.includes(norm(l.name)) ||
        (norm(l.name).length > 5 && norm(l.name).includes(c)),
    );
    if (hit) return hit;
  }
  const cp = String(a.postcode || "").slice(0, 4);
  return localities.find((l) => l.postalCode === cp) || null;
}
const townOf = (a) =>
  a.village || a.town || a.city || a.suburb || a.hamlet || a.county || "";
const streetOf = (a) =>
  [a.road || a.pedestrian || a.footway || a.residential, a.house_number]
    .filter(Boolean)
    .join(" ");

async function nominatim(path, params) {
  const url = `${endpoint}${path}?${new URLSearchParams({ format: "jsonv2", "accept-language": "es", ...params })}`;
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error("Geocodificador no disponible.");
  return response.json();
}

export function geocode(store, address, locality) {
  if (!enabled) return Promise.resolve(null);
  const query = `${address.trim()}, ${locality.name}, ${locality.province}, ${locality.country}`;
  const cached = store.geocache.get(query);
  if (cached !== undefined) return Promise.resolve(cached);
  return enqueue(async () => {
    const [hit] = await nominatim("/search", {
      q: query,
      limit: "1",
      countrycodes: "ar",
      viewbox,
      bounded: "1",
    });
    const value = hit
      ? {
          lat: Number(hit.lat),
          lng: Number(hit.lon),
          label: hit.display_name,
          precise: hit.category !== "boundary",
        }
      : null;
    store.geocache.save(query, value);
    return value;
  });
}

/** Dirección aproximada a partir de coordenadas (para "usar mi ubicación" o arrastrar el pin). */
export function reverse(store, lat, lng, localities) {
  const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = store.geocache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return enqueue(async () => {
    if (!enabled) return null;
    const hit = await nominatim("/reverse", { lat, lon: lng, zoom: "18" });
    const a = hit.address || {};
    const locality = matchLocality(a, localities);
    const value = {
      address: streetOf(a),
      town: townOf(a),
      localityId: locality?.id || null,
      label: hit.display_name || "",
    };
    store.geocache.save(key, value);
    return value;
  });
}

/** Sugerencias de dirección mientras el cliente escribe (acotadas a la zona de reparto). */
export function search(store, q, localities) {
  const key = `q:${norm(q)}`;
  const cached = store.geocache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return enqueue(async () => {
    if (!enabled) return [];
    const hits = await nominatim("/search", {
      q: /mendoza/i.test(q) ? q : `${q}, Mendoza`,
      limit: "6",
      countrycodes: "ar",
      viewbox,
      bounded: "1",
      addressdetails: "1",
    });
    const value = hits
      .filter((h) => h.address)
      .map((h) => {
        const locality = matchLocality(h.address, localities);
        const street = streetOf(h.address) || h.name || "";
        return {
          label: [street, townOf(h.address)].filter(Boolean).join(", "),
          detail: h.display_name,
          address: street,
          town: townOf(h.address),
          localityId: locality?.id || null,
          lat: Number(h.lat),
          lng: Number(h.lon),
          precise: !!h.address.house_number,
        };
      })
      .filter((v, i, arr) => arr.findIndex((x) => x.label === v.label) === i)
      .slice(0, 5);
    store.geocache.save(key, value);
    return value;
  });
}
