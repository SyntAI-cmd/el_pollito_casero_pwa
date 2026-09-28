import test from "node:test";
import assert from "node:assert/strict";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
const { accountSummary } = await import("../domain.mjs");

test("entrega en lote: cierra pedidos, no toca la deuda y respeta los cobros", async () => {
  const store = await openStore(":memory:");
  try {
    const api = createApi({
      store,
      events: createEvents(),
      dataDir: process.env.DATA_DIR,
    });
    store.drivers.save({ name: "Ensayo", active: true, zones: [] });
    const call = (method, path, body = {}, role = "admin") =>
      api({
        method,
        path,
        body,
        session: { role, staffId: 1, name: "Prueba", driver: "Ensayo" },
        query: new URLSearchParams(),
        ip: "127.0.0.1",
      });
    const phone = (
      await call("POST", "/api/customers", { name: "Cliente lote" })
    ).body.phone;
    await call("PUT", `/api/customers/${phone}/prices`, {
      prices: { entero: 1000 },
    });
    const pedido = async (key, payment) =>
      (
        await call("POST", "/api/orders", {
          customer: phone,
          key,
          driver: "Ensayo",
          payment,
          deliveryDate: "2026-09-28",
          items: [{ id: "entero", boxes: 2 }],
        })
      ).body.id;
    const cuenta = await pedido("a", "cuenta");
    const efectivo = await pedido("b", "entrega");
    const saldo = () =>
      accountSummary(
        store.orders.forCustomer(phone),
        store.customers.get(phone),
      );
    const antes = saldo().balance;

    await assert.rejects(
      () =>
        call("POST", "/api/orders/entregar", { ids: [cuenta] }, "repartidor"),
      (e) => e.status === 403,
    );
    const r1 = await call("POST", "/api/orders/entregar", {
      ids: [cuenta, efectivo],
    });
    assert.equal(r1.body.entregados, 1, "el de cuenta se cierra");
    assert.deepEqual(
      r1.body.salteados.map((x) => x.id),
      [efectivo],
      "sin cobro, se saltea",
    );
    assert.equal(store.orders.get(cuenta).status, "entregado");
    assert.equal(store.orders.get(cuenta).boxes, 2, "cajas pedidas");
    assert.equal(saldo().boxes, 2);
    assert.equal(saldo().balance, antes, "la deuda no cambia");

    const r2 = await call("POST", "/api/orders/entregar", {
      ids: [cuenta, efectivo],
      cobrados: true,
    });
    assert.equal(r2.body.entregados, 1, "el ya entregado no se repite");
    assert.equal(store.orders.get(efectivo).paid, true);
    assert.equal(store.orders.get(efectivo).status, "entregado");
    assert.equal(saldo().boxes, 4);
  } finally {
    store.close();
  }
});
