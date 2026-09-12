/**
 * Geocodificación del domicilio de entrega con Nominatim (OpenStreetMap).
 * Se ejecuta en segundo plano al crear un pedido; si falla, el mapa muestra
 * solo el local y la posición del repartidor. Desactivable con GEOCODING=off.
 * Política de uso de Nominatim: máximo una consulta por segundo e identificación.
 */
export const enabled = process.env.GEOCODING !== "off";
const endpoint = "https://nominatim.openstreetmap.org/search";
const userAgent =
  "PollitoCasero/0.2 (demo local de pedidos; contacto por WhatsApp del negocio)";
let queue = Promise.resolve();

export function geocode(store, address, locality) {
  if (!enabled) return Promise.resolve(null);
  const query = `${address.trim()}, ${locality.name}, ${locality.province}, ${locality.country}`;
  const cached = store.geocache.get(query);
  if (cached !== undefined) return Promise.resolve(cached);
  const run = async () => {
    const url = `${endpoint}?format=jsonv2&limit=1&countrycodes=ar&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent, "Accept-Language": "es" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("Geocodificador no disponible.");
    const [hit] = await response.json();
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
  };
  // Serializa las consultas y respeta 1 req/s.
  const result = queue.then(run, run);
  queue = result.then(
    () => wait(1100),
    () => wait(1100),
  );
  return result;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dirección aproximada a partir de coordenadas (para "usar mi ubicación"). */
export function reverse(store, lat, lng, localities) {
  const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = store.geocache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const run = async () => {
    if (!enabled) return null;
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`;
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent, "Accept-Language": "es" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("Geocodificador no disponible.");
    const hit = await response.json();
    const a = hit.address || {};
    const street = [a.road || a.pedestrian || a.footway, a.house_number]
      .filter(Boolean)
      .join(" ");
    const town =
      a.city || a.town || a.village || a.suburb || a.hamlet || a.county || "";
    const norm = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase();
    const locality =
      localities.find(
        (l) =>
          l.postalCode && String(a.postcode || "").startsWith(l.postalCode),
      ) ||
      localities.find(
        (l) =>
          norm(town).includes(norm(l.name)) ||
          norm(l.name).includes(norm(town)),
      ) ||
      null;
    const value = {
      address: street,
      town,
      localityId: locality?.id || null,
      label: hit.display_name || "",
    };
    store.geocache.save(key, value);
    return value;
  };
  const result = queue.then(run, run);
  queue = result.then(
    () => wait(1100),
    () => wait(1100),
  );
  return result;
}
