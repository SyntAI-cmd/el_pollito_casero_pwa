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

// FIX: Bloquear mutaciones concurrentes destructivas y llamadas duplicadas en vuelo
const inFlight = new Set();

const generateId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const isSameEntry = (a, b) => {
  if (a === b) return true;
  if (a._outboxId && b._outboxId) return a._outboxId === b._outboxId;
  if (a.id && b.id && a.path === b.path) return a.id === b.id;
  return (
    a.path === b.path &&
    a.method === b.method &&
    a.at === b.at &&
    a.owner === b.owner &&
    JSON.stringify(a.body) === JSON.stringify(b.body)
  );
};

// FIX: Tratar 503, 502, 504, errores de red y respuestas HTML de proxies (SyntaxError en JSON) como fallos transitorios
export function isTransientError(e) {
  if (!e) return false;
  if (e.network) return true;
  if (e.status === 503 || e.status === 502 || e.status === 504) return true;
  if (e instanceof SyntaxError || e.name === "SyntaxError") return true;
  if (
    typeof e.message === "string" &&
    (e.message.includes("JSON") ||
      e.message.includes("Unexpected token") ||
      e.message.includes("Failed to fetch") ||
      e.message.includes("NetworkError") ||
      e.message.includes("timeout"))
  ) {
    return true;
  }
  return false;
}

// FIX: Exponential backoff para reintentos automáticos periódicos sin perder pendientes
let backoffDelay = 2000;
let retryTimer = null;

function resetBackoff() {
  backoffDelay = 2000;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleBackoff() {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = backoffDelay;
  backoffDelay = Math.min(backoffDelay * 2, 60000);
  if (typeof setTimeout !== "undefined") {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      flush().catch(() => {});
    }, delay);
  }
}

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
  // FIX: Asegurar de forma estricta que la pesada se escriba en el almacenamiento local atómicamente ANTES de iniciar el fetch
  const entry = {
    _outboxId: generateId(),
    path,
    body,
    method,
    at: new Date().toISOString(),
    owner: dueño,
    version: VERSION_DATOS,
  };

  const current = pending();
  persist(KEY, [...current, entry]);
  notify();

  const entryKey = entry._outboxId;
  inFlight.add(entryKey);

  try {
    const result = await api(path, { method, body: JSON.stringify(body) });
    inFlight.delete(entryKey);
    // FIX: Eliminación atómica basada en filtro que no borra pesadas agregadas concurrentemente
    const latest = pending();
    persist(
      KEY,
      latest.filter((x) => !isSameEntry(x, entry)),
    );
    notify();
    resetBackoff();
    return result;
  } catch (e) {
    inFlight.delete(entryKey);
    if (isTransientError(e)) {
      // FIX: Fallo transitorio (red, 503, proxy): mantener en la cola persistida y aplicar exponential backoff
      scheduleBackoff();
      return { queued: true };
    }
    // Error permanente (validación 400, permisos): descartar de cola y registrar motivo
    const latest = pending();
    persist(
      KEY,
      latest.filter((x) => !isSameEntry(x, entry)),
    );
    notify();
    entry.rechazo = e.message || "rechazado por el servidor";
    entry.rechazadoEn = new Date().toISOString();
    rechazadas.push(entry);
    throw e;
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
    // FIX: Reescritura de flush() para bloquear mutaciones concurrentes destructivas y no depender de un snapshot viejo
    while (true) {
      const list = pending();
      const next = list.find(
        (x) =>
          x.owner === dueño &&
          x.version === VERSION_DATOS &&
          !inFlight.has(x._outboxId || x.id || x),
      );
      if (!next) break;

      const itemKey = next._outboxId || next.id || next;
      inFlight.add(itemKey);

      let success = false;
      let permanentError = null;

      try {
        await api(next.path, {
          method: next.method,
          body: JSON.stringify(next.body),
        });
        success = true;
      } catch (e) {
        if (isTransientError(e)) {
          // FIX: Código 503 y fallos de red se tratan como transitorios (mantener en cola persistida y aplicar backoff)
          inFlight.delete(itemKey);
          scheduleBackoff();
          break;
        }
        permanentError = e;
      }

      inFlight.delete(itemKey);

      if (success) {
        resetBackoff();
        // FIX: Se remueve atómicamente el elemento procesado conservando los nuevos pendientes ingresados durante la espera
        const current = pending();
        persist(
          KEY,
          current.filter((x) => !isSameEntry(x, next)),
        );
        notify();
      } else if (permanentError) {
        // Rechazado definitivo por el servidor (p. ej. pedido cancelado): se registra y saca de la cola
        next.rechazo = permanentError.message || "rechazado por el servidor";
        next.rechazadoEn = new Date().toISOString();
        rechazadas.push(next);
        const current = pending();
        persist(
          KEY,
          current.filter((x) => !isSameEntry(x, next)),
        );
        notify();
      }
    }
  } finally {
    flushing = false;
  }
}

/** Operaciones que el servidor rechazó en este rato: se muestran con su motivo. */
export const rechazadas = [];

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    resetBackoff();
    flush().catch(() => {});
  });
  setTimeout(() => flush().catch(() => {}), 2000);
}
