import test from "node:test";
import assert from "node:assert/strict";
import { overlayPending, pendingRows, rejectedFor } from "../src/lib/pending.js";
import { mergeFull, mergePartial, upsertList, tick } from "../src/lib/sync.js";
import { openStore } from "../server/store.mjs";
import { createApi, createEvents } from "../server/api.mjs";
import { testEnv } from "../scripts/test-env.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Lote C — Pendientes visibles hasta resolverse por id (PC-018) y conciliación sin pisar
 * respuestas nuevas con viejas (PC-017).
 */
const entrada = (orderId, body, extra = {}) => ({
  _outboxId: "op-" + body.id,
  path: `/orders/${orderId}/crates`,
  method: "POST",
  body,
  at: "2026-09-27T10:00:00.000Z",
  ...extra,
});

test("las filas pendientes calculan tara y neto igual que el servidor", async () => {
  Object.assign(process.env, await testEnv());
  const dataDir = await mkdtemp(join(tmpdir(), "pollito-pend-"));
  const store = await openStore(":memory:");
  const api = createApi({ store, events: createEvents(), dataDir });
  const session = { role: "admin", staffId: 1, name: "Ensayo" };
  const call = (method, path, body = {}) =>
    api({ method, path, body, session, query: new URLSearchParams(), ip: "x" });
  store.drivers.save({ name: "Ensayo", active: true, zones: [] });
  store.customers.save({ phone: "c", name: "Cliente de ensayo", plan: "mayorista", credit: true, created: new Date().toISOString() });
  const { body: o } = await call("POST", "/api/orders", {
    customer: "c", key: "k", driver: "Ensayo", deliveryDate: "2026-09-27",
    items: [{ id: "entero", boxes: 10 }], payment: "cuenta",
  });
  const casos = [
    { id: "a", productId: "entero", boxes: 3, gross: 65.1 },
    { id: "b", productId: "entero", boxes: 0, gross: 12.5 },
    { id: "c", productId: "entero", boxes: 7, gross: 100 },
    { id: "d", productId: "entero", gross: 21.7 },
    { id: "e", productId: "entero", boxes: 2, net: 40 },
  ];
  for (const body of casos) {
    await call("POST", `/api/orders/${o.id}/crates`, body);
    const servidor = store.crates
      .forOrder(o.id)
      .filter((c) => c.id === body.id || c.id.startsWith(body.id + ":"))
      .map(({ id, net, tare, gross, boxes }) => ({ id, net, tare, gross, boxes }));
    const local = pendingRows(body, 1.7).map(({ id, net, tare, gross, boxes }) => ({ id, net, tare, gross, boxes }));
    assert.deepEqual(local, servidor, `caso ${body.id}`);
  }
  store.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("un refresco del servidor sin la pesada no la hace desaparecer", () => {
  const servidor = [{ id: "PC-1", crates: [] }, { id: "PC-2", crates: [] }];
  const cola = [entrada("PC-1", { id: "p1", productId: "entero", boxes: 2, gross: 43.4 })];
  const vista = overlayPending(servidor, cola, { tare: 1.7, sending: ["op-p1"] });
  const cajones = vista[0].crates;
  assert.equal(cajones.length, 2);
  assert.ok(cajones.every((c) => c.pending && c.sending));
  assert.equal(Math.round(cajones.reduce((s, c) => s + c.net, 0) * 100) / 100, 40);
  assert.equal(vista[1], servidor[1], "los demás pedidos no se tocan (mismo objeto)");
});

test("cuando el servidor ya tiene el cajón, no se cuenta dos veces", () => {
  const servidor = [
    { id: "PC-1", crates: [{ id: "p1:1", net: 20, boxes: 1 }, { id: "p1:2", net: 20, boxes: 1 }] },
  ];
  const cola = [entrada("PC-1", { id: "p1", productId: "entero", boxes: 2, gross: 43.4 })];
  const vista = overlayPending(servidor, cola);
  assert.equal(vista[0], servidor[0]);
  assert.equal(vista[0].crates.length, 2);
});

test("una anulación pendiente oculta el cajón hasta confirmarse; rechazadas visibles aparte", () => {
  const servidor = [{ id: "PC-1", crates: [{ id: "x", net: 20, boxes: 1 }] }];
  const vista = overlayPending(servidor, [
    { _outboxId: "v", path: "/crates/x", method: "DELETE", body: { reason: "r" } },
  ]);
  assert.equal(vista[0].crates[0].voided, true);
  assert.equal(vista[0].crates[0].pending, true);
  const rechazadas = rejectedFor("PC-1", [
    { ...entrada("PC-1", { id: "p9", productId: "entero", boxes: 1, gross: 21.7 }), rechazo: "El pedido ya no admite pesadas." },
    { ...entrada("PC-2", { id: "p8", productId: "entero", boxes: 1, gross: 21.7 }), rechazo: "otro" },
  ]);
  assert.equal(rechazadas.length, 1);
  assert.equal(rechazadas[0].motivo, "El pedido ya no admite pesadas.");
});

test("una lista vieja no pisa un pedido actualizado después de que salió", () => {
  const versions = new Map();
  let lista = [];
  const seqLista = tick(); // la lista completa sale…
  const seqEscritura = tick(); // …y mientras tanto vuelve la respuesta de una pesada
  lista = upsertList(lista, { id: "A", kg: 40 }, seqEscritura, versions);
  lista = mergeFull(lista, [{ id: "A", kg: 0 }, { id: "B", kg: 0 }], seqLista, versions);
  assert.deepEqual(lista.find((o) => o.id === "A"), { id: "A", kg: 40 });
  assert.ok(lista.some((o) => o.id === "B"));
  // Un pedido borrado después de que salió la lista no revive.
  const seq2 = tick();
  const seqBorrado = tick();
  lista = mergePartial(lista, ["B"], [], seqBorrado, versions);
  lista = mergeFull(lista, [{ id: "A", kg: 40 }, { id: "B", kg: 0 }], seq2, versions);
  assert.equal(lista.some((o) => o.id === "B"), false);
});
