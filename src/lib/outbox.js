import { api, stored, persist } from "./api.js";
import { dueñoDe, VERSION_DATOS } from "./sesion.js";

/**
 * Cola de envíos para el piso (pesadas, cargas): si no hay señal, la operación se guarda en el
 * dispositivo y se reintenta al volver la conexión. Cada envío lleva una id propia, así el
 * servidor ignora los duplicados si el reintento llega dos veces.
 *
 * Cada operación queda **a nombre de quien la cargó** (PC-019). Si después entra otra persona en
 * el mismo teléfono, lo pendiente NO se envía con su sesión: queda esperando a que vuelva su
 * dueño. Lo que quedó de una versión anterior de la app tampoco se manda a ciegas: se avisa para
 * revisarlo, en vez de atribuírselo a quien esté conectado.
 */
const KEY = "pc-outbox";
const listeners = new Set();
let flushing = false;
/** Quién está usando la app ahora. Lo fija la app al entrar, salir y al arrancar. */
let dueño = "";

export const pending = () => stored(KEY, []);
/** Lo que se puede enviar con la sesión actual. */
export const propias = () =>
  pending().filter((x) => x.owner === dueño && x.version === VERSION_DATOS);
/** Lo que quedó de otra persona o de una versión anterior: se avisa, no se envía. */
export const ajenas = () =>
  pending().filter((x) => x.owner !== dueño || x.version !== VERSION_DATOS);

export const onOutbox = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => {
  const list = propias();
  for (const fn of listeners) fn(list, ajenas());
};

/** La app avisa quién entró o salió. Al cambiar de persona, se reintenta lo que sea suyo. */
export function setDueño(session) {
  const nuevo = dueñoDe(session);
  if (nuevo === dueño) return;
  dueño = nuevo;
  notify();
  if (dueño) flush().catch(() => {});
}

export async function send(path, body, { method = "POST" } = {}) {
  try {
    return await api(path, { method, body: JSON.stringify(body) });
  } catch (e) {
    if (!e.network) throw e; // error de validación o permiso: no se reintenta
    persist(KEY, [
      ...pending(),
      {
        path,
        body,
        method,
        at: new Date().toISOString(),
        owner: dueño,
        version: VERSION_DATOS,
      },
    ]);
    notify();
    return { queued: true };
  }
}

/**
 * Reintenta en orden lo que es de la sesión actual; se detiene en el primer fallo de red para
 * conservar el orden. Lo de otra persona se saltea sin tocarlo.
 */
export async function flush() {
  if (flushing || !dueño) return;
  flushing = true;
  try {
    let list = pending();
    let i = 0;
    while (i < list.length) {
      const next = list[i];
      if (next.owner !== dueño || next.version !== VERSION_DATOS) {
        i++; // de otra persona o de otra versión: no se envía
        continue;
      }
      try {
        await api(next.path, {
          method: next.method,
          body: JSON.stringify(next.body),
        });
      } catch (e) {
        if (e.network) break;
        // Rechazado por el servidor (p. ej. pedido cancelado): queda registrado el motivo y se
        // saca de la cola para no trabar el resto.
        next.rechazo = e.message || "rechazado por el servidor";
        next.rechazadoEn = new Date().toISOString();
        rechazadas.push(next);
      }
      list = [...list.slice(0, i), ...list.slice(i + 1)];
      persist(KEY, list);
      notify();
    }
  } finally {
    flushing = false;
  }
}

/** Operaciones que el servidor rechazó en este rato: se muestran con su motivo. */
export const rechazadas = [];

if (typeof window !== "undefined") {
  window.addEventListener("online", () => flush().catch(() => {}));
  setTimeout(() => flush().catch(() => {}), 2000);
}
