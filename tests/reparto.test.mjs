import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.mjs";
import { createApi, createEvents } from "../server/api.mjs";
import { testEnv } from "../scripts/test-env.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * PC-001 — Iniciar el reparto es una transición única que no depende del servicio de rutas.
 * Se simula un servicio de rutas lento que además falla: la salida tiene que guardarse igual.
 */
async function entorno() {
  Object.assign(process.env, await testEnv({ ROUTING: "on" }));
  const dataDir = await mkdtemp(join(tmpdir(), "pollito-reparto-"));
  const store = await openStore(":memory:");
  const api = createApi({ store, events: createEvents(), dataDir });
  const admin = { role: "admin", staffId: "admin-1", name: "Ensayo" };
  const call = (method, path, body = {}, session = admin) =>
    api({
      method,
      path,
      body,
      session,
      query: new URLSearchParams(),
      ip: "127.0.0.1",
    });
  store.drivers.save({ name: "Ensayo", active: true, zones: [] });
  store.customers.save({
    phone: "cliente-1",
    name: "Cliente de ensayo",
    plan: "mayorista",
    credit: true,
    created: new Date().toISOString(),
    location: { lat: -33.08, lng: -68.47 },
  });
  const creado = await call("POST", "/api/orders", {
    customer: "cliente-1",
    key: "ensayo-1",
    driver: "Ensayo",
    deliveryDate: "2026-09-23",
    items: [{ id: "entero", kg: 40 }],
    payment: "cuenta",
  });
  return {
    store,
    call,
    id: creado.body.id,
    cerrar: async () => {
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("iniciar reparto no espera al servicio de rutas y se guarda igual si falla", async () => {
  const { call, id, cerrar } = await entorno();
  const originalFetch = globalThis.fetch;
  let consultasDeRuta = 0;
  globalThis.fetch = async () => {
    consultasDeRuta++;
    await new Promise((r) => setTimeout(r, 120));
    throw Error("servicio de rutas caído (ensayo)");
  };
  try {
    await call("PATCH", `/api/orders/${id}`, { status: "preparando" });
    const inicio = performance.now();
    const r = await call("PATCH", `/api/orders/${id}`, { status: "en_camino" });
    const tardo = performance.now() - inicio;
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "en_camino");
    assert.ok(r.body.departedAt, "quedó registrada la hora de salida");
    assert.ok(
      tardo < 100,
      `la salida no debe esperar al servicio de rutas (tardó ${tardo.toFixed(1)} ms)`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await cerrar();
  }
});

test("repetir el inicio no duplica la salida ni el historial", async () => {
  const { store, call, id, cerrar } = await entorno();
  try {
    await call("PATCH", `/api/orders/${id}`, { status: "preparando" });
    const primera = await call("PATCH", `/api/orders/${id}`, {
      status: "en_camino",
    });
    const salida = primera.body.departedAt;
    // Reintento por respuesta perdida: mismo resultado, sin efectos nuevos.
    const segunda = await call("PATCH", `/api/orders/${id}`, {
      status: "en_camino",
    });
    assert.equal(segunda.status, 200);
    assert.equal(segunda.body.status, "en_camino");
    assert.equal(
      segunda.body.departedAt,
      salida,
      "la hora de salida no se pisa al reintentar",
    );
    const guardado = store.orders.get(id);
    const salidas = guardado.history.filter((h) => h.status === "en_camino");
    assert.equal(salidas.length, 1, "una sola salida en el historial");
  } finally {
    await cerrar();
  }
});

test("un pedido ya entregado no vuelve a salir por un reintento tardío", async () => {
  const { store, call, id, cerrar } = await entorno();
  try {
    await call("PATCH", `/api/orders/${id}`, { status: "preparando" });
    await call("PATCH", `/api/orders/${id}`, { status: "en_camino" });
    await call("PATCH", `/api/orders/${id}`, { status: "entregado", boxes: 0 });
    const tardia = await call("PATCH", `/api/orders/${id}`, {
      status: "en_camino",
    });
    assert.equal(tardia.status, 200);
    assert.equal(
      store.orders.get(id).status,
      "entregado",
      "el reintento no retrocede el estado",
    );
  } finally {
    await cerrar();
  }
});

test("se puede leer un pedido suelto para reconciliar una respuesta perdida", async () => {
  const { call, id, cerrar } = await entorno();
  try {
    const r = await call("GET", `/api/orders/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, id);
  } finally {
    await cerrar();
  }
});
