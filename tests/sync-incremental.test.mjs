import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/store.mjs";
import { createApi, createEvents } from "../server/api.mjs";
import { testEnv } from "../scripts/test-env.mjs";

/**
 * Lote B — Consultas por entidad (PC-017): lo que un evento necesita traer, con los mismos
 * filtros y permisos que las listas completas.
 */
async function entorno() {
  Object.assign(process.env, await testEnv());
  const dataDir = await mkdtemp(join(tmpdir(), "pollito-inc-"));
  const store = await openStore(":memory:");
  const sent = [];
  const closers = [];
  const events = createEvents();
  // Un suscriptor falso de cada rol, para ver qué viaja por el canal en vivo.
  const fake = (session) => {
    const res = {
      write: (t) => sent.push({ role: session.role, driver: session.driver, text: t }),
      on: (ev, fn) => ev === "close" && closers.push(fn),
    };
    events.subscribe(res, session);
  };
  const api = createApi({ store, events, dataDir });
  const admin = { role: "admin", staffId: 1, name: "Ensayo" };
  const maxi = { role: "repartidor", staffId: 2, driver: "Maxi", name: "Maxi" };
  const call = (session, method, path, body = {}, query = {}) =>
    api({ method, path, body, session, query: new URLSearchParams(query), ip: "x" }).catch((e) => ({ status: e.status, body: { error: e.message } }));
  for (const name of ["Franco", "Maxi"]) store.drivers.save({ name, active: true, zones: [] });
  for (const phone of ["c1", "c2", "c3"])
    store.customers.save({ phone, name: "Cliente " + phone, plan: "mayorista", credit: true, created: new Date().toISOString() });
  const nuevo = async (customer, driver, driver2, deliveryDate = "2026-09-27") =>
    (await call(admin, "POST", "/api/orders", {
      customer, key: customer + driver + (driver2 || "") + deliveryDate, driver, driver2, deliveryDate,
      items: [{ id: "entero", boxes: 4 }], payment: "cuenta",
    })).body;
  return {
    store, call, admin, maxi, nuevo, sent, fake,
    cerrar: async () => { closers.forEach((fn) => fn()); store.close(); await rm(dataDir, { recursive: true, force: true }); },
  };
}

test("/orders?ids trae sólo esos pedidos y omite los que la sesión no ve", async () => {
  const e = await entorno();
  const a = await e.nuevo("c1", "Franco");
  const b = await e.nuevo("c2", "Maxi");
  const c = await e.nuevo("c3", "Franco", "Maxi");
  const r = await e.call(e.admin, "GET", "/api/orders", {}, { ids: `${a.id},${b.id},NO-EXISTE` });
  assert.deepEqual(r.body.map((o) => o.id).sort(), [a.id, b.id].sort());
  // Maxi ve el suyo y aquel en que va de segundo preventista, no el de Franco solo.
  const m = await e.call(e.maxi, "GET", "/api/orders", {}, { ids: `${a.id},${b.id},${c.id}` });
  assert.deepEqual(m.body.map((o) => o.id).sort(), [b.id, c.id].sort());
  // Consulta suelta del segundo preventista (antes daba 404 y la app lo sacaba de su lista).
  assert.equal((await e.call(e.maxi, "GET", `/api/orders/${c.id}`)).status, 200);
  assert.equal((await e.call(e.maxi, "GET", `/api/orders/${a.id}`)).status, 404);
  await e.cerrar();
});

test("/customers?phones trae esas fichas con saldo, precios y el mismo formato que la lista", async () => {
  const e = await entorno();
  const o = await e.nuevo("c1", "Maxi");
  await e.call(e.admin, "POST", `/api/orders/${o.id}/crates`, { id: "z", productId: "entero", boxes: 2, gross: 43.4 });
  const full = (await e.call(e.admin, "GET", "/api/customers")).body;
  const some = (await e.call(e.admin, "GET", "/api/customers", {}, { phones: "c1,c2,zz" })).body;
  assert.deepEqual(some.map((c) => c.phone).sort(), ["c1", "c2"]);
  assert.deepEqual(some.find((c) => c.phone === "c1"), full.find((c) => c.phone === "c1"), "misma ficha, mismo saldo");
  // Repartidor: marca "mine" igual que en la lista completa.
  const fullM = (await e.call(e.maxi, "GET", "/api/customers")).body;
  const someM = (await e.call(e.maxi, "GET", "/api/customers", {}, { phones: "c1,c2" })).body;
  for (const c of someM) assert.deepEqual(c, fullM.find((x) => x.phone === c.phone));
  assert.equal(someM.find((c) => c.phone === "c1").mine, true);
  assert.equal(someM.find((c) => c.phone === "c2").mine, false);
  await e.cerrar();
});

test("/dia?ids aplica los filtros de la nota: trasladado, cancelado o de otro camión no vuelve", async () => {
  const e = await entorno();
  const a = await e.nuevo("c1", "Maxi");
  const b = await e.nuevo("c2", "Maxi");
  const c = await e.nuevo("c3", "Franco");
  const d = await e.nuevo("c1", "Maxi", "", "2026-09-28");
  const r = await e.call(e.maxi, "GET", "/api/dia", {}, { fecha: "2026-09-27", ids: [a.id, b.id, c.id, d.id].join(",") });
  assert.equal(r.body.partial, true);
  assert.deepEqual(r.body.orders.map((o) => o.id).sort(), [a.id, b.id].sort());
  assert.ok(r.body.orders.every((o) => Array.isArray(o.crates)), "con sus cajones");
  const full = await e.call(e.maxi, "GET", "/api/dia", {}, { fecha: "2026-09-27" });
  assert.equal(full.body.partial, undefined, "sin ids, la nota completa como antes");
  assert.equal(full.body.orders.length, 2);
  await e.cerrar();
});

test("el evento de un pedido dice de qué cliente y fecha es; el segundo preventista lo recibe", async () => {
  const e = await entorno();
  e.fake(e.admin);
  e.fake(e.maxi);
  e.fake({ role: "repartidor", staffId: 3, driver: "Franco" });
  const o = await e.nuevo("c2", "Franco", "Maxi");
  e.sent.length = 0;
  await e.call(e.admin, "POST", `/api/orders/${o.id}/crates`, { id: "y", productId: "entero", boxes: 1, gross: 21.7 });
  const orders = e.sent.filter((x) => x.text.startsWith("event: orders"));
  assert.equal(orders.length, 3, "admin, Franco y Maxi (segundo preventista)");
  const data = JSON.parse(orders[0].text.split("data: ")[1]);
  assert.equal(data.id, o.id);
  assert.equal(data.customer, "c2");
  assert.equal(data.date, "2026-09-27");
  await e.cerrar();
});

test("anular dos veces el mismo cajón (respuesta perdida) no recalcula ni duplica", async () => {
  const e = await entorno();
  const o = await e.nuevo("c1", "Maxi");
  await e.call(e.admin, "POST", `/api/orders/${o.id}/crates`, { id: "w", productId: "entero", boxes: 1, gross: 21.7 });
  const r1 = await e.call(e.admin, "DELETE", "/api/crates/w", { reason: "x" });
  const r2 = await e.call(e.admin, "DELETE", "/api/crates/w", { reason: "x" });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.body.crates, r1.body.crates);
  await e.cerrar();
});

test("más de 100 ids se rechaza (la app agrupa de a lotes chicos)", async () => {
  const e = await entorno();
  const ids = Array.from({ length: 101 }, (_, i) => "X" + i).join(",");
  assert.equal((await e.call(e.admin, "GET", "/api/orders", {}, { ids })).status, 400);
  await e.cerrar();
});

test("el segundo preventista puede consultar el pedido pero no modificarlo (sin cambio de permisos)", async () => {
  const e = await entorno();
  const o = await e.nuevo("c1", "Franco", "Maxi");
  assert.equal((await e.call(e.maxi, "GET", `/api/orders/${o.id}`)).status, 200);
  const r = await e.call(e.maxi, "PATCH", `/api/orders/${o.id}`, { notes: "x" });
  assert.equal(r.status, 404, "como antes: modificar sigue restringido al preventista principal");
  await e.cerrar();
});
