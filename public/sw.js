function clearRetiredDocuments() {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(false);
    const request = indexedDB.open("pollito-documents", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("pending"))
        request.result.createObjectStore("pending", { keyPath: "id" });
    };
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains("pending")) {
        db.close();
        return resolve(true);
      }
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").clear();
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        resolve(false);
      };
    };
  });
}

const CACHE = "pollito-shell-__BUILD_ID__";
const ASSETS = /* PRECACHE */ [];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(["/", "/icon.svg", "/manifest.webmanifest", ...ASSETS]),
      ),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => ![CACHE, API_CACHE, SESION_CACHE].includes(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => clearRetiredDocuments())
      .then(() => self.clients.claim()),
  ),
);
// Datos que se consultan a diario: se responde con la red y se guarda una copia; si no hay señal,
// la app abre con lo último que se vio (pedidos, clientes, configuración y la nota del día).
//
// La copia es PRIVADA de quien inició sesión: un preventista no puede ver, ni estando sin señal,
// los datos que quedaron de administración en el mismo teléfono. La app avisa quién entró y,
// ante cualquier cambio de persona, la copia se borra entera (PC-019).
const API_CACHE = "pollito-datos";
const SESION_CACHE = "pollito-sesion";
const SESION_URL = "/__sesion";
const OFFLINE_API = /^\/api\/(config|orders|customers|dia|salidas)(\?|$)/;

/** Quién tiene guardada la copia actual ("" si no hay). */
async function dueñoDeLaCopia() {
  const cache = await caches.open(SESION_CACHE);
  const hit = await cache.match(SESION_URL);
  return hit ? await hit.text() : "";
}
async function guardarDueño(id) {
  const cache = await caches.open(SESION_CACHE);
  await cache.put(SESION_URL, new Response(id));
}
/** Cambió la persona: se tira la copia para que nadie vea datos de otro. */
async function cambiarSesion(id) {
  const actual = await dueñoDeLaCopia();
  if (actual === id) return;
  await caches.delete(API_CACHE);
  await guardarDueño(id || "");
}
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "sesion") event.waitUntil(cambiarSesion(String(d.id || "")));
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  // Las pestañas de versiones anteriores pueden conservar su temporizador de subidas.
  // Acusar recibo del retiro sin leer el cuerpo base64 ni enviarlo al servidor.
  if (event.request.method === "POST" && url.pathname === "/api/documents") {
    event.respondWith(
      Promise.resolve(
        new Response(JSON.stringify({ retired: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    return;
  }
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) {
    if (!OFFLINE_API.test(url.pathname + url.search)) return;
    event.respondWith(
      (async () => {
        // Sin saber de quién es la sesión no se guarda ni se sirve copia privada.
        const dueño = await dueñoDeLaCopia();
        try {
          const response = await fetch(event.request);
          if (response.ok && dueño) {
            const copy = response.clone();
            const cache = await caches.open(API_CACHE);
            await cache.put(event.request, copy);
          }
          return response;
        } catch {
          const hit = dueño
            ? await caches.open(API_CACHE).then((c) => c.match(event.request))
            : null;
          return (
            hit ||
            new Response(JSON.stringify({ error: "Sin conexión." }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
      })(),
    );
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }
  if (/\.(js|css|png|webp|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches
                .open(CACHE)
                .then((cache) => cache.put(event.request, copy));
            }
            return response;
          }),
      ),
    );
  }
});

// Avisos push: pedido nuevo (administración), repartidor asignado, salida y llegada (cliente).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Pollito Casero", body: event.data?.text() || "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Pollito Casero", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "pollito",
      renotify: true,
      data: { url: data.url || "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", location.origin)
    .href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        const open = list.find((c) => c.url.startsWith(location.origin));
        if (open) return open.navigate(url).then((c) => c?.focus());
        return self.clients.openWindow(url);
      }),
  );
});
