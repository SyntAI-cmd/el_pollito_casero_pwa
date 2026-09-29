export const serverDownMessage = navigator.onLine
  ? `No se pudo conectar con el servidor de Pollito Casero en ${location.host}. Si estás en la PC del negocio, abrí «Iniciar Pollito Casero» (o corré npm start) y volvé a intentar.`
  : "Estás sin conexión a internet. Reintentá cuando vuelva la señal.";

/** Aviso global cuando el servidor rechaza la sesión (vencida, desactivada o degradada). */
let authErrorHandler = null;
export const onAuthError = (fn) => {
  authErrorHandler = fn;
};

export async function api(path, options = {}) {
  let r;
  try {
    r = await fetch("/api" + path, {
      signal: AbortSignal.timeout(12000),
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch (cause) {
    // Una cancelación pedida por la app no es un problema de red.
    if (cause?.name === "AbortError" && options.signal?.aborted) throw cause;
    // Failed to fetch / timeout: el servidor no responde o no hay red.
    const e = Error(
      navigator.onLine
        ? "No se pudo conectar con el servidor de Pollito Casero. Comprobá que esté iniciado."
        : "Estás sin conexión a internet.",
    );
    e.network = true;
    e.cause = cause;
    throw e;
  }
  // El estado HTTP se conserva siempre: una página HTML de un proxy (502, 503) o un corte a mitad
  // de la respuesta no debe esconder qué pasó ni convertirse en un rechazo definitivo.
  let data = null;
  let nonJson = false;
  if (r.status !== 204) {
    let text = "";
    try {
      text = await r.text();
    } catch (cause) {
      const e = Error("La respuesta del servidor llegó incompleta.");
      e.network = true;
      e.status = r.status;
      e.cause = cause;
      throw e;
    }
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        nonJson = true;
      }
    }
  }
  if (!r.ok || nonJson) {
    const e = Error(
      data?.error ||
        (nonJson
          ? `El servidor respondió algo inesperado (${r.status}).`
          : "No se pudo completar la solicitud."),
    );
    e.status = r.status;
    e.nonJson = nonJson;
    const retryAfter = Number(r.headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0)
      e.retryAfter = retryAfter * 1000;
    if ((r.status === 401 || r.status === 403) && path !== "/session")
      authErrorHandler?.(e);
    throw e;
  }
  return data;
}
export const post = (path, data, method = "POST") =>
  api(path, { method, body: JSON.stringify(data) });
export const patch = (path, data) => post(path, data, "PATCH");
export const del = (path, body) =>
  api(path, {
    method: "DELETE",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
export const put = (path, body) =>
  api(path, { method: "PUT", body: JSON.stringify(body) });

/**
 * Novedades del servidor: UNA conexión SSE por pestaña, compartida por todas las pantallas
 * (antes cada una abría la suya). `onEvent(type, data)`; `onState(live, { reconnected })`, donde
 * `reconnected` avisa que hubo un corte: los eventos de ese rato se perdieron y hay que conciliar.
 * Devuelve una función para desuscribirse; la conexión se cierra cuando no queda nadie.
 */
const hub = { source: null, retry: 2000, timer: null, listeners: new Set() };
const EVENT_TYPES = ["orders", "customer", "news", "fleet", "config"];
let hubLive = false;
let hubDropped = false;
function hubOpen() {
  if (hub.source || !hub.listeners.size) return;
  const source = new EventSource("/api/events");
  hub.source = source;
  source.addEventListener("hello", () => {
    hub.retry = 2000;
    const reconnected = hubDropped;
    hubDropped = false;
    hubLive = true;
    for (const l of hub.listeners) l.onState?.(true, { reconnected });
  });
  for (const type of EVENT_TYPES)
    source.addEventListener(type, (e) => {
      let data = null;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      for (const l of hub.listeners) l.onEvent?.(type, data);
    });
  source.onerror = () => {
    source.close();
    if (hub.source === source) hub.source = null;
    hubDropped = true;
    hubLive = false;
    for (const l of hub.listeners) l.onState?.(false, {});
    clearTimeout(hub.timer);
    if (hub.listeners.size)
      hub.timer = setTimeout(
        hubOpen,
        (hub.retry = Math.min(hub.retry * 2, 30000)),
      );
  };
}
export function subscribe(onEvent, onState) {
  const listener = { onEvent, onState };
  hub.listeners.add(listener);
  if (hub.source) {
    if (hubLive) queueMicrotask(() => onState?.(true, { reconnected: false }));
  } else if (!hub.timer) hubOpen();
  return () => {
    hub.listeners.delete(listener);
    if (!hub.listeners.size) {
      clearTimeout(hub.timer);
      hub.timer = null;
      hub.source?.close();
      hub.source = null;
      hubLive = false;
      hubDropped = false;
    }
  };
}
export const isLive = () => hubLive;

export function stored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
/** Preferencias y datos que se pueden volver a pedir: si no se guardan, no pasa nada. */
// No devuelve nada a propósito: se usa como cuerpo de efectos de React, que sólo aceptan una
// función de limpieza o nada (devolver true rompía al entrar y salir de la sesión).
export function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
/** Datos que no se pueden perder (cola de pesadas): la falla se informa a quien llama. */
export function persistStrict(key, value) {
  const text = JSON.stringify(value);
  localStorage.setItem(key, text);
  if (localStorage.getItem(key) !== text)
    throw Error("El teléfono no confirmó la escritura.");
}
