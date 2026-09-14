import { api, stored, persist } from "./api.js";

/**
 * Cola de envíos para el piso (pesadas, cargas): si no hay señal, la operación se guarda en el
 * dispositivo y se reintenta al volver la conexión. Cada envío lleva una id propia, así el
 * servidor ignora los duplicados si el reintento llega dos veces.
 */
const KEY = "pc-outbox";
const listeners = new Set();
let flushing = false;

export const pending = () => stored(KEY, []);
export const onOutbox = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => {
  const list = pending();
  for (const fn of listeners) fn(list);
};

export async function send(path, body, { method = "POST" } = {}) {
  try {
    return await api(path, { method, body: JSON.stringify(body) });
  } catch (e) {
    if (!e.network) throw e; // error de validación o permiso: no se reintenta
    persist(KEY, [
      ...pending(),
      { path, body, method, at: new Date().toISOString() },
    ]);
    notify();
    return { queued: true };
  }
}

/** Reintenta en orden; se detiene en el primer fallo de red para conservar el orden. */
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    let list = pending();
    while (list.length) {
      const [next, ...rest] = list;
      try {
        await api(next.path, {
          method: next.method,
          body: JSON.stringify(next.body),
        });
      } catch (e) {
        if (e.network) break;
        // Rechazado por el servidor (p. ej. pedido cancelado): se descarta para no bloquear la cola.
      }
      list = rest;
      persist(KEY, list);
      notify();
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flush().catch(() => {}));
  setTimeout(() => flush().catch(() => {}), 2000);
}
