import test from "node:test";
import assert from "node:assert/strict";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
test("el servidor rechaza crear con saldo revisado obsoleto y conserva reintentos", async () => {
  const store = await openStore(":memory:");
  try {
    const api = createApi({
      store,
      events: createEvents(),
      dataDir: process.env.DATA_DIR,
    });
    store.customers.save({
      phone: "preview",
      name: "Ensayo",
      plan: "mayorista",
      credit: true,
      created: new Date().toISOString(),
    });
    const call = (method, path, body) =>
      api({
        method,
        path,
        body,
        session: { role: "admin", staffId: 1, name: "Prueba" },
        query: new URLSearchParams(),
        ip: "127.0.0.1",
      });
    await call("PATCH", "/api/customers/preview/saldos", {
      balance: 90000,
      boxes: 8,
      opId: "balance",
      note: "Ensayo",
    });
    const body = {
      customer: "preview",
      key: "review-test",
      deliveryDate: "2026-09-23",
      items: [{ id: "entero", kg: 40 }],
      expectedSummary: { balance: 100000, boxes: 10 },
    };
    await assert.rejects(
      () => call("POST", "/api/orders", body),
      (e) => e.status === 409,
    );
    assert.equal(store.orders.count(), 0);
    body.expectedSummary = { balance: 90000, boxes: 8 };
    const result = await call("POST", "/api/orders", body);
    assert.equal(result.status, 201);
    await call("PATCH", "/api/customers/preview/saldos", {
      balance: 80000,
      opId: "balance2",
      note: "Pago posterior",
    });
    const retry = await call("POST", "/api/orders", body);
    assert.equal(retry.status, 200);
    assert.equal(store.orders.count(), 1);
  } finally {
    store.close();
  }
});
