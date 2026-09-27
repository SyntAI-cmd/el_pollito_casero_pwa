import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/store.mjs";
import { createApi, createEvents } from "../server/api.mjs";
import { testEnv } from "../scripts/test-env.mjs";
import { VERSION_DATOS } from "../src/lib/sesion.js";

/**
 * Lote A — Confiabilidad de la cola de pesadas (PC-018).
 *
 * Se usa el módulo real de la cola con un almacenamiento y una red simulados. Cada caso importa
 * una instancia nueva del módulo (como abrir la app de nuevo) sobre el mismo almacenamiento.
 */
const guardado = new Map();
let fallaEscritura = null;
globalThis.localStorage = {
  getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
  setItem: (k, v) => {
    if (fallaEscritura?.(k)) {
      const e = Error("QuotaExceededError");
      e.name = "QuotaExceededError";
      throw e;
    }
    guardado.set(k, String(v));
  },
  removeItem: (k) => guardado.delete(k),
};
const eventos = {};
globalThis.window = {
  addEventListener: (type, fn) => {
    (eventos[type] ||= []).push(fn);
  },
};
/** "Volvió la señal": dispara el reintento inmediato de la instancia más reciente. */
const volvioLaSeñal = async (cola) => {
  eventos.online?.at(-1)?.();
  await cola.flush();
};

let red = async () => {
  throw TypeError("Failed to fetch");
};
const pedidos = [];
globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace(/^\/api/, "");
  const body = init.body ? JSON.parse(init.body) : undefined;
  pedidos.push({ path, method: init.method || "GET", body });
  return red(path, init.method || "GET", body);
};
const responder = (status, body, headers = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":
        typeof body === "string" ? "text/html" : "application/json",
      ...headers,
    },
  });

let instancia = 0;
async function abrirApp(sesion = FRANCO) {
  const cola = await import(`../src/lib/outbox.js?app=${++instancia}`);
  cola.setDueño(sesion);
  await cola.flush();
  return cola;
}
const FRANCO = { role: "repartidor", staffId: 7, name: "Franco" };
const cola = () => JSON.parse(guardado.get("pc-outbox") || "[]");
const enRevision = () => JSON.parse(guardado.get("pc-outbox-revision") || "[]");
const pesada = (id, extra = {}) => ({
  id,
  productId: "entero",
  boxes: 2,
  gross: 43.4,
  ...extra,
});
function limpiar() {
  guardado.clear();
  pedidos.length = 0;
  fallaEscritura = null;
}

test("429: la pesada queda guardada, respeta Retry-After y se envía después con el mismo id", async () => {
  limpiar();
  red = async () => responder(429, { error: "Demasiados intentos." }, { "Retry-After": "30" });
  const app = await abrirApp();
  const r = await app.send("/orders/PC-1/crates", pesada("p-429"));
  assert.equal(r.queued, true);
  assert.equal(r.durable, true);
  const [fila] = cola();
  assert.equal(fila.body.id, "p-429");
  assert.equal(fila.lastStatus, 429);
  const espera = fila.nextAt - Date.now();
  assert.ok(espera > 25000 && espera <= 30000, `espera ${espera} ms`);
  assert.equal(enRevision().length, 0, "no es un rechazo");

  const resultados = [];
  app.onResult((x) => resultados.push(x));
  red = async () => responder(201, { id: "PC-1", crates: [] });
  await volvioLaSeñal(app);
  assert.equal(cola().length, 0);
  const envios = pedidos.filter((p) => p.method === "POST");
  assert.equal(envios.length, 2);
  assert.deepEqual(
    envios.map((p) => p.body.id),
    ["p-429", "p-429"],
    "el mismo id en todos los reintentos",
  );
  assert.equal(resultados[0].result.id, "PC-1", "se entrega la respuesta del servidor");
  app.setDueño(null);
});

test("500: se reintenta y, si persiste, pasa a revisión guardada (no desaparece al reiniciar)", async () => {
  limpiar();
  red = async () => responder(500, { error: "Error interno. Intentá de nuevo." });
  const app = await abrirApp();
  assert.equal((await app.send("/orders/PC-1/crates", pesada("p-500"))).queued, true);
  for (let i = 0; i < 3; i++) await volvioLaSeñal(app);
  assert.equal(cola().length, 1, "todavía se reintenta");
  assert.equal(cola()[0].attempts, 4);
  await volvioLaSeñal(app);
  assert.equal(cola().length, 0);
  assert.equal(enRevision().length, 1);
  assert.equal(enRevision()[0].rechazoEstado, 500);
  app.setDueño(null);

  // Cerrar y abrir la app: el rechazo sigue ahí, con su motivo.
  red = async () => responder(201, { id: "PC-1", crates: [] });
  const otra = await abrirApp();
  const [r] = otra.revision();
  assert.equal(r.body.id, "p-500");
  assert.match(r.rechazo, /Error interno/);
  // La persona decide reintentar: vuelve a la cola con el mismo id y se envía.
  assert.equal(await otra.reintentar(r._outboxId), true);
  await otra.flush();
  assert.equal(enRevision().length, 0);
  assert.equal(cola().length, 0);
  assert.equal(pedidos.at(-1).body.id, "p-500");
  otra.setDueño(null);
});

test("503 con página HTML del proxy y 200 no JSON: se conserva el estado y se reintenta", async () => {
  limpiar();
  red = async () => responder(503, "<html>Service Unavailable</html>");
  const app = await abrirApp();
  assert.equal((await app.send("/orders/PC-1/crates", pesada("p-503"))).queued, true);
  assert.equal(cola()[0].lastStatus, 503, "el estado HTTP no se pierde por no ser JSON");
  // Un 200 con HTML (portal cautivo, corte): no se sabe si se aplicó; se reintenta igual.
  red = async () => responder(200, "<html>Login Wi-Fi</html>");
  await volvioLaSeñal(app);
  assert.equal(cola().length, 1);
  assert.equal(cola()[0].attempts, 2);
  assert.equal(enRevision().length, 0);
  app.setDueño(null);
});

test("falla del almacenamiento: no se informa como guardada y no se pierde", async () => {
  limpiar();
  const app = await abrirApp();
  fallaEscritura = (k) => k === "pc-outbox";
  const r = await app.send("/orders/PC-1/crates", pesada("p-memoria"));
  assert.equal(r.queued, true);
  assert.equal(r.durable, false, "quien llama sabe que NO quedó guardada en el teléfono");
  assert.match(app.estado().errorAlmacenamiento, /no pudo guardar/);
  assert.equal(app.propias().length, 1, "sigue visible y pendiente");
  assert.equal(cola().length, 0);

  // Se libera espacio: al reintentar primero se guarda y después se envía.
  fallaEscritura = null;
  let vistoEnCola = false;
  red = async () => {
    vistoEnCola = cola().some((x) => x.body.id === "p-memoria");
    return responder(201, { id: "PC-1", crates: [] });
  };
  await volvioLaSeñal(app);
  assert.equal(vistoEnCola, true, "se guardó antes de enviarse");
  assert.equal(app.propias().length, 0);
  assert.equal(app.estado().errorAlmacenamiento, "");
  app.setDueño(null);
});

test("almacenamiento ilegible: no se pisa la cola existente", async () => {
  limpiar();
  guardado.set("pc-outbox", "{roto");
  const app = await abrirApp();
  const r = await app.send("/orders/PC-1/crates", pesada("p-roto"));
  assert.equal(r.durable, false);
  assert.equal(guardado.get("pc-outbox"), "{roto", "lo que había queda intacto para recuperarlo");
  app.setDueño(null);
});

test("sesión vencida (403 «Solo el equipo»): espera a su dueño en vez de descartarse", async () => {
  limpiar();
  red = async (path) =>
    path === "/session" ? responder(200, null) : responder(403, { error: "Solo el equipo." });
  const app = await abrirApp();
  const r = await app.send("/orders/PC-1/crates", pesada("p-sesion"));
  assert.equal(r.queued, true);
  assert.equal(cola().length, 1, "sigue en la cola");
  assert.equal(enRevision().length, 0, "no es un rechazo de negocio");
  assert.equal(app.estado().esperandoSesion, true);
  // Vuelve a entrar la misma persona: se envía.
  red = async () => responder(201, { id: "PC-1", crates: [] });
  app.setDueño({ ...FRANCO });
  await app.flush();
  assert.equal(cola().length, 0);
  app.setDueño(null);
});

test("rechazo de negocio (400, 403 con sesión válida): queda en revisión con su motivo", async () => {
  limpiar();
  red = async () => responder(400, { error: "El pedido ya no admite pesadas." });
  const app = await abrirApp();
  await assert.rejects(app.send("/orders/PC-1/crates", pesada("p-400")), (e) => e.review && e.status === 400);
  assert.equal(cola().length, 0);
  assert.equal(enRevision()[0].rechazo, "El pedido ya no admite pesadas.");

  red = async (path) =>
    path === "/session"
      ? responder(200, { role: "repartidor", staffId: 7 })
      : responder(403, { error: "Ese pedido es de otro camión." });
  await assert.rejects(app.send("/orders/PC-2/crates", pesada("p-403")), (e) => e.review);
  assert.equal(enRevision().length, 2);
  assert.equal(app.revision().length, 2, "visibles para su dueño");
  app.setDueño(null);
});

test("sin señal: varias pesadas quedan en orden y salen en orden, cada una con su id", async () => {
  limpiar();
  red = async () => {
    throw TypeError("Failed to fetch");
  };
  const app = await abrirApp();
  for (const id of ["a", "b", "c"])
    assert.equal((await app.send("/orders/PC-1/crates", pesada(id))).queued, true);
  assert.deepEqual(cola().map((x) => x.body.id), ["a", "b", "c"]);
  red = async () => responder(201, { id: "PC-1", crates: [] });
  pedidos.length = 0;
  await volvioLaSeñal(app);
  assert.deepEqual(pedidos.map((p) => p.body.id), ["a", "b", "c"]);
  assert.equal(cola().length, 0);
  app.setDueño(null);
});

test("lo pendiente de la versión anterior (mismo formato) se sigue enviando", async () => {
  limpiar();
  guardado.set(
    "pc-outbox",
    JSON.stringify([
      {
        _outboxId: "viejo-1",
        path: "/orders/PC-1/crates",
        body: pesada("p-vieja"),
        method: "POST",
        at: new Date().toISOString(),
        owner: "staff:7",
        version: VERSION_DATOS,
      },
    ]),
  );
  red = async () => responder(201, { id: "PC-1", crates: [] });
  const app = await abrirApp();
  await app.flush();
  assert.equal(cola().length, 0);
  assert.equal(pedidos[0].body.id, "p-vieja");
  app.setDueño(null);
});

test("respuesta perdida después de guardar en el servidor: el reintento no duplica la pesada", async () => {
  limpiar();
  Object.assign(process.env, await testEnv());
  const dataDir = await mkdtemp(join(tmpdir(), "pollito-cola-"));
  const store = await openStore(":memory:");
  const server = createApi({ store, events: createEvents(), dataDir });
  const admin = { role: "admin", staffId: 7, name: "Ensayo" };
  const llamar = async (method, path, body) => {
    try {
      const r = await server({ method, path: "/api" + path, body: body || {}, session: admin, query: new URLSearchParams(), ip: "x" });
      return responder(r.status, r.body);
    } catch (e) {
      return responder(e.status || 400, { error: e.message });
    }
  };
  store.drivers.save({ name: "Ensayo", active: true, zones: [] });
  store.customers.save({ phone: "c-1", name: "Cliente", plan: "mayorista", credit: true, created: new Date().toISOString() });
  const orden = await (await llamar("POST", "/orders", {
    customer: "c-1", key: "k-1", driver: "Ensayo", deliveryDate: "2026-09-27",
    items: [{ id: "entero", boxes: 5 }], payment: "cuenta",
  })).json();

  // El servidor guarda y la respuesta se corta en el camino.
  let perder = true;
  red = async (path, method, body) => {
    const r = await llamar(method, path, body);
    if (perder) {
      perder = false;
      throw TypeError("network error");
    }
    return r;
  };
  const app = await abrirApp({ role: "admin", staffId: 7 });
  const r = await app.send(`/orders/${orden.id}/crates`, { id: "lote-1", productId: "entero", boxes: 3, gross: 65.1 });
  assert.equal(r.queued, true, "para el teléfono quedó pendiente");
  assert.equal(store.crates.forOrder(orden.id).length, 3, "pero el servidor ya la tenía");
  await volvioLaSeñal(app);
  assert.equal(cola().length, 0);
  const cajones = store.crates.forOrder(orden.id).filter((c) => !c.voided);
  assert.equal(cajones.length, 3, "sin duplicados");
  // Tara 1,7 kg por caja: 65,1 − 3 × 1,7 = 60,0 kg netos, repartidos en 3 cajones.
  assert.equal(Math.round(cajones.reduce((s, c) => s + c.net, 0) * 100) / 100, 60);
  assert.ok(cajones.every((c) => c.tare === 1.7 && c.boxes === 1));

  // Pesada en bolsa (cero cajas): sin tara, sin envases, una sola fila; también idempotente.
  perder = true;
  await app.send(`/orders/${orden.id}/crates`, { id: "bolsa-1", productId: "entero", boxes: 0, gross: 12.5 });
  await volvioLaSeñal(app);
  const bolsa = store.crates.forOrder(orden.id).filter((c) => c.id === "bolsa-1");
  assert.equal(bolsa.length, 1);
  assert.equal(bolsa[0].net, 12.5);
  assert.equal(bolsa[0].tare, 0);
  assert.equal(bolsa[0].boxes, 0);

  // Anulación repetida (respuesta perdida): el mismo resultado y una sola entrada de auditoría.
  perder = true;
  await app.send("/crates/lote-1:1", { reason: "corrección en balanza" }, { method: "DELETE" });
  await volvioLaSeñal(app);
  const auditoria = (accion) =>
    store.audit.query({ entidad: "order", entidadId: orden.id, accion, limite: 50 })
      .movimientos;
  const anulaciones = auditoria("crate.void");
  assert.equal(anulaciones.length, 1, "la anulación no se registra dos veces");
  const adds = auditoria("crate.add");
  assert.equal(adds.length, 2, "una entrada de auditoría por operación (idempotente por opId)");
  assert.ok(adds.every((a) => a.resultado === "ok" || a.outcome === "ok" || !a.resultado));
  app.setDueño(null);
  store.close();
  await rm(dataDir, { recursive: true, force: true });
});
