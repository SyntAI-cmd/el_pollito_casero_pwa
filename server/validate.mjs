/** Validación mínima y explícita de cuerpos de solicitud (sin dependencias). */
import { ApiError } from "./errors.mjs";

const fail = (message) => {
  throw new ApiError(400, message);
};

export const str = (
  value,
  { min = 0, max = 500, name = "campo", pattern, optional = false } = {},
) => {
  if (value === undefined || value === null || value === "") {
    if (optional) return "";
    fail(`Falta ${name}.`);
  }
  if (typeof value !== "string") fail(`${name} inválido.`);
  const v = value.trim();
  if (v.length < min) fail(`${name} demasiado corto.`);
  if (v.length > max) fail(`${name} demasiado largo.`);
  if (pattern && !pattern.test(v)) fail(`${name} inválido.`);
  return v;
};
export const num = (
  value,
  {
    min = -Infinity,
    max = Infinity,
    name = "importe",
    integer = false,
    optional = false,
  } = {},
) => {
  if (value === undefined || value === null || value === "") {
    if (optional) return undefined;
    fail(`Falta ${name}.`);
  }
  const n =
    typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (
    !Number.isFinite(n) ||
    n < min ||
    n > max ||
    (integer && !Number.isInteger(n))
  )
    fail(`${name} inválido.`);
  return n;
};
export const oneOf = (value, options, name = "valor") => {
  if (!options.includes(value)) fail(`${name} inválido.`);
  return value;
};
export const bool = (value, name = "valor") => {
  if (typeof value !== "boolean") fail(`${name} inválido.`);
  return value;
};
export const latLng = (value, name = "ubicación") => {
  if (!value || typeof value !== "object") fail(`${name} inválida.`);
  const lat = num(value.lat, { min: -90, max: 90, name });
  const lng = num(value.lng, { min: -180, max: 180, name });
  return { lat, lng };
};

/** Límite simple de intentos por clave (IP o teléfono) en memoria. */
export function rateLimiter({ limit, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, windowMs).unref();
  const recent = (key) =>
    (hits.get(key) || []).filter((t) => t > Date.now() - windowMs);
  const fail429 = () => {
    throw new ApiError(
      429,
      "Demasiados intentos. Esperá un minuto y probá de nuevo.",
    );
  };
  // Uso simple: `limiter(key)` cuenta y corta. Uso en dos pasos (ingresos): `limiter.check(key)`
  // antes de verificar y `limiter.hit(key)` solo si falló, así los ingresos correctos no cuentan.
  const limiter = (key) => {
    const list = recent(key);
    list.push(Date.now());
    hits.set(key, list);
    if (list.length > limit) fail429();
  };
  limiter.check = (key) => {
    if (recent(key).length >= limit) fail429();
  };
  limiter.hit = (key) => {
    const list = recent(key);
    list.push(Date.now());
    hits.set(key, list);
  };
  return limiter;
}
