import test from "node:test";
import assert from "node:assert/strict";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
const { accountSummary } = await import("../domain.mjs");

test("entrega: devuelve cajas previas + salientes, sin saldo de cajas a favor", async () => {
  const store = await openStore(":memory:");
  try {
    const api = createApi({
      store,
      events: createEvents(),
      dataDir: process.env.DATA_DIR,
    });
    store.drivers.save({ name: "Ensayo", active: true, zones: [] });
    const call = (method, path, body = {}) =>
      api({
        method,
        path,
        body,
        session: { role: "admin", staffId: 1, name: "Prueba" },
        query: new URLSearchParams(),
        ip: "127.0.0.1",
      });
    const phone = (
      await call("POST", "/api/customers", {
        name: "Cliente cajas",
        plan: "mayorista",
      })
    ).body.phone;
    const cajas = () =>
      accountSummary(
        store.orders.forCustomer(phone),
        store.customers.get(phone),
      ).boxes;
    const entregar = async (key, body) => {
      const id = (
        await call("POST", "/api/orders", {
          customer: phone,
          key,
          driver: "Ensayo",
          payment: "cuenta",
          deliveryDate: "2026-09-28",
          items: [{ id: "entero", boxes: 1 }],
        })
      ).body.id;
      assert.equal(store.orders.get(id).plan, "mayorista");
      await call("PATCH", `/api/orders/${id}`, { status: "preparando" });
      await call("PATCH", `/api/orders/${id}`, { status: "en_camino" });
      return { id, res: () => call("PATCH", `/api/orders/${id}`, body) };
    };

    const a = await entregar("a", { status: "entregado", boxes: 18 });
    await a.res();
    assert.equal(cajas(), 18, "18 cajas previas");

    // 18 previas + 50 salientes − 69 devueltas: quedaría 1 a favor → se rechaza y no cambia nada.
    const b = await entregar("b", {
      status: "entregado",
      boxes: 50,
      returnBoxes: 69,
    });
    await assert.rejects(b.res, (e) => e.status === 400);
    assert.equal(store.orders.get(b.id).status, "en_camino");
    assert.equal(cajas(), 18);

    // El caso real: 18 previas + 50 salientes − 54 devueltas = 14.
    const c = await entregar("c", {
      status: "entregado",
      boxes: 50,
      returnBoxes: 54,
    });
    const r = await c.res();
    assert.equal(r.body.boxBalanceBefore, 18);
    assert.equal(cajas(), 14);
    assert.equal(store.orders.get(a.id).returned, 18, "primero las viejas");
    assert.equal(store.orders.get(c.id).returned, 36);

    // Devolver todo deja saldo 0, nunca negativo.
    const d = await entregar("d", {
      status: "entregado",
      boxes: 0,
      returnBoxes: 14,
    });
    await d.res();
    assert.equal(cajas(), 0);

    // Devolución suelta en un pedido ya entregado: puede superar lo que se dejó en ese pedido.
    await (await entregar("e", { status: "entregado", boxes: 5 })).res();
    const f = await entregar("f", { status: "entregado", boxes: 3 });
    await f.res();
    assert.equal(cajas(), 8);
    await call("PATCH", `/api/orders/${f.id}`, { returnBoxes: 7 });
    assert.equal(cajas(), 1);
    assert.equal(store.orders.get(f.id).returned, 3, "primero este pedido");
    await assert.rejects(
      () => call("PATCH", `/api/orders/${f.id}`, { returnBoxes: 2 }),
      (e) => e.status === 400,
    );
    assert.equal(cajas(), 1, "sin saldo a favor");
  } finally {
    store.close();
  }
});
