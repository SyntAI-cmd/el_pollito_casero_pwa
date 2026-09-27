import { api, persistStrict } from "./api.js";
import { dueñoDe, VERSION_DATOS } from "./sesion.js";

/**
 * Cola de envíos del piso (pesadas, anulaciones, carga del camión).
 *
 * Una operación se guarda en el dispositivo ANTES de enviarse y sale de la cola sólo cuando el
 * servidor la confirmó o cuando pasó, también guardada, a "requiere revisión". Cada operación
 * conserva su id en todos los reintentos: el servidor ignora los duplicados (una respuesta
 * perdida después de guardar no genera una segunda pesada).
 *
 * Estados: pendiente (en `pc-outbox`), enviando (en vuelo en esta pestaña), confirmada (sale de
 * la cola; se avisa con el resultado del servidor) y requiere revisión (en `pc-outbox-revision`,
 * con el motivo). Nada se descarta sin que una persona lo decida.
 *
 * Qué se reintenta solo: sin red, cortes, respuestas que no son JSON (proxy, corte a mitad), 408,
 * 425, 429 (respetando Retry-After), 502, 503 y 504. Un 500 se reintenta unas veces y después
 * pasa a revisión. 401 (o 403 con la sesión vencida) deja todo en espera hasta que su dueño
 * vuelva a entrar. El resto (400, 403 de negocio, 404, 409…) pasa a revisión con su motivo.
 *
 * Cada operación queda a nombre de quien la cargó (PC-019): con otra persona en el teléfono no se
 * envía con su sesión. Lo de una versión anterior de la app tampoco se manda a ciegas.
 *
 * Formato compatible con la versión anterior: `pc-outbox` sigue siendo el mismo arreglo, así una
 * vuelta atrás de la app sigue enviando lo pendiente.
 */
const KEY = "pc-outbox";
const REVIEW_KEY = "pc-outbox-revision";
/** 500 seguidos antes de pasar a revisión (un error de datos no bloquea la cola para siempre). */
const MAX_SERVER_ERRORS = 5;
const BASE_DELAY = 2000;
const MAX_DELAY = 60000;

const listeners = new Set();
const resultListeners = new Set();
let dueño = "";
/** Ids en envío en esta pestaña. */
const inFlight = new Set();
/** Quien espera el primer resultado de una operación: id → { resolve }. */
const waiters = new Map();
/** Operaciones que el teléfono no pudo guardar (almacenamiento lleno o bloqueado). */
let volatile = [];
let volatileReview = [];
let storageError = "";
let authPaused = false;
let retryTimer = null;
let retryAt = 0;
let flushing = null;
let flushAgain = false;
let forceNext = false;

const generateId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
const idOf = (x) => x?._outboxId || null;
const same = (a, b) => {
  if (a === b) return true;
  if (a._outboxId && b._outboxId) return a._outboxId === b._outboxId;
  return (
    a.path === b.path &&
    a.method === b.method &&
    a.at === b.at &&
    a.owner === b.owner &&
    JSON.stringify(a.body) === JSON.stringify(b.body)
  );
};

// ---- Almacenamiento ----
const hasStorage = () => typeof localStorage !== "undefined";
/** Lectura estricta: un contenido ilegible NO se trata como vacío (no se pisa ni se pierde). */
function readStrict(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw Error(`${key} no es una lista.`);
  return value;
}
function readSafe(key) {
  try {
    return hasStorage() ? readStrict(key) : [];
  } catch {
    return [];
  }
}
const locks =
  typeof navigator !== "undefined" && navigator.locks?.request
    ? navigator.locks
    : null;
/** Leer-modificar-escribir sin que otra pestaña se meta en el medio. */
const withLock = (fn) =>
  locks ? locks.request("pc-outbox", async () => fn()) : Promise.resolve(fn());
async function mutate(key, change) {
  return withLock(() => {
    const next = change(readStrict(key));
    if (next) persistStrict(key, next);
  });
}

// ---- Consultas ----
export const pending = () => [...readSafe(KEY), ...volatile];
const mine = (x) => x.owner === dueño && x.version === VERSION_DATOS;
/** Lo que se puede enviar con la sesión actual. */
export const propias = () => (dueño ? pending().filter(mine) : []);
/** Lo que quedó de otra persona o de una versión anterior: se avisa, no se envía. */
export const ajenas = () => pending().filter((x) => !dueño || !mine(x));
/** Rechazadas por el servidor, guardadas para revisar (sólo las de quien está usando la app). */
export const revision = () =>
  [...readSafe(REVIEW_KEY), ...volatileReview].filter(
    (x) => x.owner === dueño,
  );
export const estado = () => ({
  enviando: [...inFlight],
  errorAlmacenamiento: storageError,
  esperandoSesion: authPaused,
  proximoIntento: retryAt || null,
});

export const onOutbox = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
/** Resultado de cada operación: ({ entry, result }) al confirmarse, ({ entry, error }) al rechazarse. */
export const onResult = (fn) => {
  resultListeners.add(fn);
  return () => resultListeners.delete(fn);
};
const notify = () => {
  const list = propias();
  const others = ajenas();
  const meta = { ...estado(), revision: revision() };
  for (const fn of listeners) fn(list, others, meta);
};
const emit = (payload) => {
  for (const fn of resultListeners) {
    try {
      fn(payload);
    } catch {}
  }
};
const settle = (id, outcome) => {
  const w = waiters.get(id);
  if (!w) return;
  waiters.delete(id);
  w.resolve(outcome);
};

// ---- Clasificación de errores ----
/**
 * "retry": se reintenta solo · "server": 500, se reintenta unas veces · "auth": esperar a que
 * vuelva a entrar su dueño · "auth?": ver si la sesión sigue viva · "review": rechazo de negocio.
 */
export function classify(e) {
  if (!e) return "retry";
  if (e.network || e.nonJson || e.name === "AbortError" || e.name === "TimeoutError")
    return "retry";
  const s = e.status;
  if (s === undefined || s === null) return "retry";
  if (s === 401) return "auth";
  if (s === 403) return "auth?";
  if ([408, 425, 429, 502, 503, 504].includes(s)) return "retry";
  if (s >= 500) return "server";
  return "review";
}
export const isTransientError = (e) =>
  ["retry", "server"].includes(classify(e));
/** 403: si la sesión ya no es de quien cargó la operación, se espera; si sigue, es de negocio. */
async function resolveForbidden() {
  try {
    const s = await api("/session");
    return s && dueñoDe(s) === dueño ? "review" : "auth";
  } catch (e) {
    return e.status === 401 || e.status === 403 ? "auth" : "retry";
  }
}
const backoff = (attempts, retryAfter) => {
  if (retryAfter) return Math.min(retryAfter, 5 * 60000);
  const base = Math.min(BASE_DELAY * 2 ** Math.max(0, attempts - 1), MAX_DELAY);
  // Jitter: varios teléfonos que vuelven a tener señal no reintentan todos a la vez.
  return Math.round(base * (0.7 + Math.random() * 0.6));
};
function schedule(delay) {
  clearTimeout(retryTimer);
  retryAt = Date.now() + delay;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryAt = 0;
    flush().catch(() => {});
  }, delay);
  retryTimer?.unref?.();
}
function resetBackoff() {
  clearTimeout(retryTimer);
  retryTimer = null;
  retryAt = 0;
}

// ---- Cambios en la cola ----
async function enqueue(entry) {
  try {
    await mutate(KEY, (q) => [...q, entry]);
    return true;
  } catch (e) {
    storageError =
      "El teléfono no pudo guardar la pesada (almacenamiento lleno o bloqueado). No cierres la app hasta que diga «Todo guardado en el servidor».";
    volatile.push(entry);
    return false;
  }
}
/** Lo que quedó sólo en memoria se vuelve a intentar guardar en cuanto se pueda. */
async function rescueVolatile() {
  if (!volatile.length && !volatileReview.length) return;
  try {
    const moving = volatile;
    await mutate(KEY, (q) => [
      ...q,
      ...moving.filter((m) => !q.some((x) => same(x, m))),
    ]);
    volatile = volatile.filter((v) => !moving.includes(v));
    const review = volatileReview;
    await mutate(REVIEW_KEY, (q) => [
      ...q,
      ...review.filter((m) => !q.some((x) => same(x, m))),
    ]);
    volatileReview = volatileReview.filter((v) => !review.includes(v));
    storageError = "";
  } catch {}
}
async function removeEntry(entry) {
  volatile = volatile.filter((x) => !same(x, entry));
  try {
    await mutate(KEY, (q) =>
      q.some((x) => same(x, entry)) ? q.filter((x) => !same(x, entry)) : null,
    );
  } catch {
    // Ya está confirmada: si no se pudo sacar, un reintento futuro es inofensivo (mismo id).
  }
}
async function updateEntry(entry, fields) {
  const v = volatile.find((x) => same(x, entry));
  if (v) Object.assign(v, fields);
  try {
    await mutate(KEY, (q) =>
      q.some((x) => same(x, entry))
        ? q.map((x) => (same(x, entry) ? { ...x, ...fields } : x))
        : null,
    );
  } catch {}
}
async function toReview(entry, error) {
  const record = {
    ...entry,
    rechazo: error?.message || "rechazado por el servidor",
    rechazoEstado: error?.status || null,
    rechazadoEn: new Date().toISOString(),
  };
  // Primero se guarda en revisión y recién después sale de la cola: si algo falla en el medio,
  // queda repetida (se deduplica por id), nunca perdida.
  try {
    await mutate(REVIEW_KEY, (q) => [
      ...q.filter((x) => !same(x, entry)),
      record,
    ]);
  } catch {
    volatileReview = [
      ...volatileReview.filter((x) => !same(x, entry)),
      record,
    ];
    storageError =
      "El teléfono no pudo guardar una pesada rechazada. Anotala antes de cerrar la app.";
  }
  await removeEntry(entry);
}

// ---- Envío ----
/** La app avisa quién entró o salió. Al cambiar de persona, se reintenta lo que sea suyo. */
export function setDueño(session) {
  const nuevo = dueñoDe(session);
  if (nuevo === dueño && !authPaused) return;
  dueño = nuevo;
  authPaused = false;
  notify();
  if (dueño) {
    forceNext = true;
    flush().catch(() => {});
  }
}

/**
 * Guarda la operación en el dispositivo y la envía. Resuelve con la respuesta del servidor, o con
 * `{ queued: true, id, durable }` si quedó para reintentar; rechaza (con `error.review = true`)
 * si el servidor la rechazó y quedó en revisión. `durable: false` significa que el teléfono no la
 * pudo guardar: hay que avisarle a la persona.
 */
export async function send(path, body, { method = "POST" } = {}) {
  const entry = {
    _outboxId: generateId(),
    path,
    body,
    method,
    at: new Date().toISOString(),
    owner: dueño,
    version: VERSION_DATOS,
  };
  const id = entry._outboxId;
  const durable = await enqueue(entry);
  const done = new Promise((resolve) => waiters.set(id, { resolve }));
  notify();
  // Sin sesión, esperando a su dueño o con un reintento programado para algo anterior: queda en
  // cola sin esperar la red (el orden se respeta).
  if (!dueño || authPaused || retryTimer) settle(id, { queued: true });
  flush().catch(() => {});
  const outcome = await done;
  if (outcome.error) {
    outcome.error.review = true;
    throw outcome.error;
  }
  if (outcome.queued) return { queued: true, id, durable };
  return outcome.result;
}

/** Reintenta en orden lo que es de la sesión actual; frena ante el primer fallo recuperable. */
export function flush() {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      do {
        flushAgain = false;
        await flushOnce();
      } while (flushAgain);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
async function flushOnce() {
  if (!dueño || authPaused || !hasStorage()) return;
  await rescueVolatile();
  for (;;) {
    const next = propias().find((x) => !inFlight.has(idOf(x)));
    if (!next) {
      resetBackoff();
      return;
    }
    const id = idOf(next);
    const force = forceNext;
    forceNext = false;
    if (!force && next.nextAt && next.nextAt > Date.now()) {
      if (!retryTimer) schedule(next.nextAt - Date.now());
      for (const w of [...waiters.keys()]) settle(w, { queued: true });
      notify();
      return;
    }
    inFlight.add(id);
    notify();
    let result;
    let error = null;
    try {
      result = await api(next.path, {
        method: next.method,
        body: JSON.stringify(next.body),
      });
    } catch (e) {
      error = e;
    }
    inFlight.delete(id);
    if (!error) {
      await removeEntry(next);
      resetBackoff();
      settle(id, { result });
      emit({ entry: next, result });
      notify();
      continue;
    }
    let kind = classify(error);
    if (kind === "auth?") kind = await resolveForbidden();
    if (kind === "server" && (next.attempts || 0) + 1 >= MAX_SERVER_ERRORS)
      kind = "review";
    if (kind === "review") {
      await toReview(next, error);
      settle(id, { error });
      emit({ entry: next, error });
      notify();
      continue;
    }
    const attempts = (next.attempts || 0) + 1;
    const delay = backoff(attempts, error.retryAfter);
    await updateEntry(next, {
      attempts,
      nextAt: Date.now() + delay,
      lastError: String(error.message || "").slice(0, 200),
      lastStatus: error.status || null,
    });
    if (kind === "auth") authPaused = true;
    else schedule(delay);
    // Lo que esperaba respuesta queda guardado para después: el operador sigue trabajando.
    for (const w of [...waiters.keys()]) settle(w, { queued: true });
    notify();
    return;
  }
}

/** Vuelve a poner en la cola una operación rechazada (después de corregir el motivo). */
export async function reintentar(id) {
  const record = revision().find((x) => idOf(x) === id);
  if (!record) return false;
  const { rechazo, rechazoEstado, rechazadoEn, attempts, nextAt, ...entry } =
    record;
  if (!(await enqueue({ ...entry, attempts: 0 }))) return false;
  volatileReview = volatileReview.filter((x) => idOf(x) !== id);
  try {
    await mutate(REVIEW_KEY, (q) => q.filter((x) => idOf(x) !== id));
  } catch {}
  forceNext = true;
  notify();
  flush().catch(() => {});
  return true;
}
/** Descarta una operación rechazada: sólo por decisión de la persona, nunca automático. */
export async function descartar(id) {
  volatileReview = volatileReview.filter((x) => idOf(x) !== id);
  await mutate(REVIEW_KEY, (q) => q.filter((x) => idOf(x) !== id));
  notify();
}

if (typeof window !== "undefined") {
  // Volver la señal o la pantalla: se intenta ya (si la sesión sigue vencida, vuelve a esperar
  // después de una sola consulta).
  const retryNow = () => {
    resetBackoff();
    authPaused = false;
    forceNext = true;
    flush().catch(() => {});
  };
  window.addEventListener("online", retryNow);
  // Otra pestaña cambió la cola: se refresca la vista y se resuelve lo que ya salió por allá.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY && e.key !== REVIEW_KEY) return;
    const queue = readSafe(KEY);
    const review = readSafe(REVIEW_KEY);
    for (const id of [...waiters.keys()]) {
      if (queue.some((x) => idOf(x) === id) || inFlight.has(id)) continue;
      const rejected = review.find((x) => idOf(x) === id);
      if (rejected) {
        const error = Error(rejected.rechazo);
        error.status = rejected.rechazoEstado;
        settle(id, { error });
      } else settle(id, { result: null });
    }
    notify();
  });
  if (typeof document !== "undefined")
    document.addEventListener?.("visibilitychange", () => {
      if (document.visibilityState === "visible" && propias().length) retryNow();
    });
  const t = setTimeout(() => {
    forceNext = true;
    flush().catch(() => {});
  }, 2000);
  t?.unref?.();
}
