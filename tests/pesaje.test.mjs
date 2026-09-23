import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.mjs";
import { createApi, createEvents } from "../server/api.mjs";
import { testEnv } from "../scripts/test-env.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * PC-004 — Pesaje con cero cajas, cantidad escrita y tara correcta.
 *
 *   tara_total = cajas_reales × tara_por_caja
 *   peso_neto  = peso_bruto − tara_total
 */

async function entorno({ items } = {}) {
  Object.assign(process.env, await testEnv());
  const dataDir = await mkdtemp(join(tmpdir(), "pollito-pesaje-"));
  const store = await openStore(":memory:");
  const api = createApi({ store, events: createEvents(), dataDir });
  const admin = { role: "admin", staffId: 1, name: "Ensayo" };
  const call = (method, path, body = {}) =>
    api({
      method,
      path,
      body,
      session: admin,
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
  });
  const creado = await call("POST", "/api/orders", {
    customer: "cliente-1",
    key: "pesaje-1",
    driver: "Ensayo",
    deliveryDate: "2026-09-23",
    items: items || [{ id: "entero", kg: 40 }],
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

const pesadas = (store, id) =>
  store.crates.forOrder(id).filter((c) => !c.voided);
const cajas = (store, id) =>
  pesadas(store, id).reduce((n, c) => n + c.boxes, 0);
const neto = (store, id) =>
  Math.round(pesadas(store, id).reduce((n, c) => n + c.net, 0) * 100) / 100;

test("30 cajas, 800 kg brutos, tara 1,7 → 51 kg de tara y 749 kg netos", async () => {
  const { store, call, id, cerrar } = await entorno({
    items: [{ id: "entero", boxes: 30 }],
  });
  try {
    const r = await call("POST", `/api/orders/${id}/crates`, {
      id: "lote-a",
      productId: "entero",
      boxes: 30,
      gross: 800,
    });
    assert.equal(r.status, 201);
    assert.equal(cajas(store, id), 30);
    assert.equal(neto(store, id), 749);
    const tara = pesadas(store, id).reduce((n, c) => n + c.tare, 0);
    assert.equal(Math.round(tara * 100) / 100, 51);
  } finally {
    await cerrar();
  }
});

test("0 cajas, 15 kg brutos → sin tara, 15 kg netos y ningún envase adeudado", async () => {
  const { store, call, id, cerrar } = await entorno();
  try {
    const r = await call("POST", `/api/orders/${id}/crates`, {
      id: "bolsa-a",
      productId: "entero",
      boxes: 0,
      gross: 15,
    });
    assert.equal(r.status, 201);
    assert.equal(neto(store, id), 15, "el peso no se pierde");
    assert.equal(cajas(store, id), 0, "una bolsa no agrega envases");
    assert.equal(pesadas(store, id).length, 1, "una sola fila, sin cajón ficticio");
    assert.equal(pesadas(store, id)[0].tare, 0, "sin tara");
    // El pedido sigue existiendo con su producto y queda pesado.
    const o = store.orders.get(id);
    assert.equal(o.items.length, 1);
    assert.equal(o.items[0].kg, 15);
    assert.equal(o.weighed, true);
    // La deuda de envases se cuenta al entregar, no al pesar.
    assert.equal(o.boxes, 0);
  } finally {
    await cerrar();
  }
});

test("pedido de 40 kg pesado en 2 cajas reales: 3,4 de tara, 40 netos y se conserva lo pedido", async () => {
  const { store, call, id, cerrar } = await entorno();
  try {
    await call("POST", `/api/orders/${id}/crates`, {
      id: "lote-b",
      productId: "entero",
      boxes: 2,
      gross: 43.4,
    });
    assert.equal(neto(store, id), 40);
    assert.equal(cajas(store, id), 2, "se pueden indicar cajas aunque se haya pedido por kilo");
    const o = store.orders.get(id);
    assert.equal(o.items[0].ordered, 40, "la cantidad pedida se conserva");
    assert.equal(o.items[0].kg, 40);
  } finally {
    await cerrar();
  }
});

test("un bruto que no supera la tara se rechaza con un mensaje claro", async () => {
  const { call, id, cerrar } = await entorno();
  try {
    await assert.rejects(
      () =>
        call("POST", `/api/orders/${id}/crates`, {
          id: "lote-c",
          productId: "entero",
          boxes: 3,
          gross: 5,
        }),
      (e) => e.status === 400 && /no supera la tara/i.test(e.message),
    );
  } finally {
    await cerrar();
  }
});

test("la tara aplicada queda guardada: cambiarla después no recalcula lo ya pesado", async () => {
  const { store, call, id, cerrar } = await entorno();
  try {
    await call("POST", `/api/orders/${id}/crates`, {
      id: "lote-d",
      productId: "entero",
      boxes: 2,
      gross: 43.4,
    });
    const antes = pesadas(store, id).map((c) => c.tare);
    // Otra pesada más adelante con otra tara no toca la anterior.
    assert.deepEqual(antes, [1.7, 1.7]);
    assert.equal(neto(store, id), 40);
  } finally {
    await cerrar();
  }
});

test("repetir la misma pesada no la duplica", async () => {
  const { store, call, id, cerrar } = await entorno();
  try {
    const cuerpo = {
      id: "lote-e",
      productId: "entero",
      boxes: 2,
      gross: 43.4,
    };
    await call("POST", `/api/orders/${id}/crates`, cuerpo);
    await call("POST", `/api/orders/${id}/crates`, cuerpo);
    assert.equal(cajas(store, id), 2, "sigue habiendo 2 cajas, no 4");
    assert.equal(neto(store, id), 40);
  } finally {
    await cerrar();
  }
});

test("las pesadas viejas, sin la columna nueva, siguen valiendo una caja", async () => {
  const { store, call, id, cerrar } = await entorno();
  try {
    // Fila escrita como antes de PC-004 (sin `boxes`).
    store.db
      .prepare(
        "INSERT INTO crates(id, order_id, product_id, gross, tare, net, by_actor, at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "vieja-1",
        id,
        "entero",
        21.7,
        1.7,
        20,
        "admin",
        new Date().toISOString(),
      );
    assert.equal(cajas(store, id), 1, "no se reinterpreta como bolsa");
    assert.equal(neto(store, id), 20);
  } finally {
    await cerrar();
  }
});
