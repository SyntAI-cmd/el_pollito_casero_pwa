import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
const { accountSummary } = await import("../domain.mjs");
const { deshacerEntregas } = await import("../scripts/deshacer-entregas.mjs");

test("deshacer entregas en lote: vuelven a pedido normal con saldo y cajas como antes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deshacer-"));
  const store = await openStore(join(dir, "pollito.sqlite"));
  try {
    const api = createApi({ store, events: createEvents(), dataDir: process.env.DATA_DIR });
    store.drivers.save({ name: "Ensayo", active: true, zones: [] });
    const call = (method, path, body = {}) =>
      api({ method, path, body, session: { role: "admin", staffId: 1, name: "Prueba", driver: "Ensayo" },
        query: new URLSearchParams(), ip: "127.0.0.1" });
    const phone = (await call("POST", "/api/customers", { name: "Cliente lote" })).body.phone;
    await call("PUT", `/api/customers/${phone}/prices`, { prices: { entero: 1000 } });
    const pedido = async (key, payment) => (await call("POST", "/api/orders", {
      customer: phone, key, driver: "Ensayo", payment, deliveryDate: "2026-09-28",
      items: [{ id: "entero", boxes: 2 }] })).body.id;
    const cuenta = await pedido("a", "cuenta");
    const efectivo = await pedido("b", "entrega");
    const saldo = () => accountSummary(store.orders.forCustomer(phone), store.customers.get(phone));
    const antes = saldo();
    const estadoAntes = store.orders.get(cuenta).status;
    await call("POST", "/api/orders/entregar", { ids: [cuenta, efectivo], cobrados: true });
    assert.equal(store.orders.get(efectivo).paid, true);
    assert.equal(saldo().boxes, 4);

    const sim = deshacerEntregas(store.db, "lotes", { dir, log: () => {} });
    assert.equal(sim.aplicado, false);
    assert.equal(store.orders.get(cuenta).status, "entregado", "la simulación no toca nada");

    const r = deshacerEntregas(store.db, "lotes", { aplicar: true, dir, log: () => {} });
    assert.deepEqual(r.pedidos.sort(), [cuenta, efectivo].sort());
    for (const id of [cuenta, efectivo]) {
      const o = store.orders.get(id);
      assert.equal(o.status, estadoAntes);
      assert.equal(o.deliveredAt, undefined);
      assert.equal(o.deliveredInBatch, undefined);
      assert.equal(o.boxes, 0);
      assert.equal(o.history.at(-1).status, estadoAntes);
    }
    assert.equal(store.orders.get(efectivo).paid, false, "cobro automático quitado");
    assert.equal(saldo().boxes, antes.boxes);
    assert.equal(saldo().balance, antes.balance);
    // Se puede volver a entregar normalmente.
    const again = await call("POST", "/api/orders/entregar", { ids: [cuenta] });
    assert.equal(again.body.entregados, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
