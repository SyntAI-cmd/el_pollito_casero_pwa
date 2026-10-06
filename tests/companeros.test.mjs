import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.mjs";
import { createApi, createEvents } from "../server/api.mjs";
import { testEnv } from "../scripts/test-env.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Compañeros: si un pedido lleva dos preventistas, ese día quedan juntos y cada uno ve los
 * pedidos del otro. Lo que uno completa le aparece completado al compañero y a administración.
 */
async function entorno() {
  Object.assign(process.env, await testEnv());
  const dataDir = await mkdtemp(join(tmpdir(), "pollito-companeros-"));
  const store = await openStore(":memory:");
  const writes = [];
  const closers = [];
  const events = createEvents({ store });
  const api = createApi({ store, events, dataDir });
  const admin = { role: "admin", staffId: "admin-1", name: "Ensayo" };
  const preventista = (driver) => ({
    role: "repartidor",
    staffId: driver,
    driver,
  });
  const call = (method, path, body = {}, session = admin) =>
    api({
      method,
      path,
      body,
      session,
      query: new URLSearchParams(),
      ip: "127.0.0.1",
    });
  for (const name of ["Ana", "Beto", "Ajeno"])
    store.drivers.save({ name, active: true, zones: [] });
  for (const phone of ["c1", "c2", "c3"])
    store.customers.save({
      phone,
      name: "Cliente " + phone,
      plan: "mayorista",
      credit: true,
      created: new Date().toISOString(),
    });
  const pedido = async (key, customer, extra) =>
    (
      await call("POST", "/api/orders", {
        customer,
        key,
        deliveryDate: "2026-10-06",
        items: [{ id: "entero", kg: 10 }],
        payment: "cuenta",
        ...extra,
      })
    ).body.id;
  const compartido = await pedido("k1", "c1", { driver: "Ana" });
  const o = store.orders.get(compartido);
  o.driver2 = "Beto";
  store.orders.save(o);
  const soloAna = await pedido("k2", "c2", { driver: "Ana" });
  const otroDia = await pedido("k3", "c3", {
    driver: "Ana",
    deliveryDate: "2026-10-07",
  });
  const escuchar = (session) =>
    events.subscribe(
      {
        write: (t) => writes.push({ who: session.driver, t }),
        on: (_, fn) => closers.push(fn),
      },
      session,
    );
  return {
    store,
    call,
    events,
    writes,
    escuchar,
    preventista,
    compartido,
    soloAna,
    otroDia,
    cerrar: async () => {
      for (const fn of closers) fn();
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("el compañero ve los pedidos del otro ese día y los ve completados", async () => {
  const e = await entorno();
  try {
    const ids = async (driver) =>
      (await e.call("GET", "/api/orders", {}, e.preventista(driver))).body.map(
        (o) => o.id,
      );
    const beto = await ids("Beto");
    assert.ok(beto.includes(e.compartido));
    assert.ok(beto.includes(e.soloAna), "ve el pedido que Ana lleva sola");
    assert.ok(!beto.includes(e.otroDia), "otro día no son compañeros");
    assert.ok(!(await ids("Ajeno")).includes(e.soloAna));

    // Ana completa su pedido: a Beto le aparece completado.
    await e.call("PATCH", `/api/orders/${e.soloAna}`, { status: "preparando" });
    await e.call("PATCH", `/api/orders/${e.soloAna}`, { status: "en_camino" });
    await e.call("PATCH", `/api/orders/${e.soloAna}`, {
      status: "entregado",
      boxes: 0,
    });
    const visto = (
      await e.call("GET", `/api/orders/${e.soloAna}`, {}, e.preventista("Beto"))
    ).body;
    assert.equal(visto.status, "entregado");
    assert.ok(e.store.orders.isFor("Beto", e.store.orders.get(e.soloAna)));
    assert.ok(!e.store.orders.isFor("Ajeno", e.store.orders.get(e.soloAna)));
  } finally {
    await e.cerrar();
  }
});

test("el aviso en vivo de un pedido de Ana le llega también a Beto", async () => {
  const e = await entorno();
  try {
    e.escuchar(e.preventista("Beto"));
    e.escuchar(e.preventista("Ajeno"));
    e.writes.length = 0;
    e.events.orderChanged(e.store.orders.get(e.soloAna));
    assert.ok(
      e.writes.some((w) => w.who === "Beto" && w.t.includes(e.soloAna)),
    );
    assert.ok(!e.writes.some((w) => w.who === "Ajeno"));
  } finally {
    await e.cerrar();
  }
});

test("armar o desarmar la pareja hace recargar la lista de los dos", async () => {
  const e = await entorno();
  try {
    e.escuchar(e.preventista("Beto"));
    e.events.orderChanged(e.store.orders.get(e.compartido));
    e.writes.length = 0;
    const o = e.store.orders.get(e.compartido);
    o.driver2 = "";
    e.store.orders.save(o);
    e.events.orderChanged(o);
    assert.ok(
      e.writes.some((w) => w.who === "Beto" && w.t.includes('"crew":true')),
    );
    assert.ok(!e.store.orders.isFor("Beto", e.store.orders.get(e.soloAna)));
  } finally {
    await e.cerrar();
  }
});
