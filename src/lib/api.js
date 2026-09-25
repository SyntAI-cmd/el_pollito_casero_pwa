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
  const data = r.status === 204 ? null : await r.json();
  if (!r.ok) {
    const e = Error(data?.error || "No se pudo completar la solicitud.");
    e.status = r.status;
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

/** Suscripción a novedades del servidor. Devuelve una función para cerrar. */
export function subscribe(onEvent, onState) {
  let source;
  let closed = false;
  let retry = 2000;
  const open = () => {
    if (closed) return;
    source = new EventSource("/api/events");
    source.addEventListener("hello", () => {
      retry = 2000;
      onState?.(true);
    });
    source.addEventListener("orders", (e) =>
      onEvent("orders", JSON.parse(e.data)),
    );
    source.addEventListener("customer", (e) =>
      onEvent("customer", JSON.parse(e.data)),
    );
    source.addEventListener("news", (e) => onEvent("news", JSON.parse(e.data)));
    source.addEventListener("fleet", (e) =>
      onEvent("fleet", JSON.parse(e.data)),
    );
    source.onerror = () => {
      onState?.(false);
      source.close();
      if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 30000)));
    };
  };
  open();
  return () => {
    closed = true;
    source?.close();
  };
}

export function stored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
