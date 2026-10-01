import test from "node:test";
import assert from "node:assert/strict";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");

/** PC-023: el repartidor solo gestiona sus pedidos; cargar, pesar por cajón y la carga del camión son de administración. */
async function entorno() {
  const store = await openStore(":memory:");
  const api = createApi({
    store,
    events: createEvents(),
    dataDir: process.env.DATA_DIR,
  });
  store.drivers.save({ name: "Ensayo", active: true, zones: [] });
  store.drivers.save({ name: "Otro", active: true, zones: [] });
  const admin = { role: "admin", staffId: 1, name: "Franco", driver: "Ensayo" };
  const repartidor = {
    role: "repartidor",
    staffId: 2,
    name: "Ensayo",
    driver: "Ensayo",
  };
  const call = (session, method, path, body = {}) =>
    api({
      method,
      path,
      body,
      session,
      query: new URLSearchParams(),
      ip: "127.0.0.1",
    });
  const phone = (
    await call(admin, "POST", "/api/customers", { name: "Almacén Sur" })
  ).body.phone;
  await call(admin, "PUT", `/api/customers/${phone}/prices`, {
    prices: { entero: 1000 },
  });
  const pedido = async (key, driver) =>
    (
      await call(admin, "POST", "/api/orders", {
        customer: phone,
        key,
        ...(driver ? { driver } : {}),
        payment: "cuenta",
        deliveryDate: "2026-10-01",
        items: [{ id: "entero", boxes: 5 }],
      })
    ).body.id;
  const rechaza = (p) => assert.rejects(p, (e) => e.status === 403);
  return { store, call, admin, repartidor, phone, pedido, rechaza };
}

test("el repartidor no carga pedidos; administración sí (también un admin que reparte)", async () => {
  const { store, call, repartidor, phone, pedido, rechaza } = await entorno();
  try {
    const propio = await pedido("a", "Ensayo");
    assert.ok(propio, "administración carga el pedido");
    const antes = store.orders.forCustomer(phone).length;
    await rechaza(
      call(repartidor, "POST", "/api/orders", {
        customer: phone,
        key: "b",
        payment: "cuenta",
        deliveryDate: "2026-10-01",
        items: [{ id: "entero", boxes: 3 }],
      }),
    );
    await rechaza(
      call(repartidor, "POST", "/api/orders", {
        name: "Sin ficha",
        items: [{ id: "entero", boxes: 3 }],
      }),
    );
    assert.equal(store.orders.forCustomer(phone).length, antes);
    const denegados = store.audit
      .query({ accion: "auth.denegado", limite: 10 })
      .movimientos.filter((m) => m.resultado === "rechazado");
    assert.ok(denegados.length >= 2, "el intento queda en la auditoría");
    assert.equal(denegados[0].rol, "repartidor");
    assert.equal(denegados[0].categoria, "Accesos");
  } finally {
    store.close?.();
  }
});

test("el repartidor no pesa por cajón ni arma o cierra el camión", async () => {
  const { store, call, admin, repartidor, pedido, rechaza } = await entorno();
  try {
    const id = await pedido("a", "Ensayo");
    await rechaza(
      call(repartidor, "POST", `/api/orders/${id}/crates`, {
        productId: "entero",
        gross: 20,
      }),
    );
    assert.equal(store.crates.forOrder(id).length, 0);
    await rechaza(
      call(repartidor, "POST", "/api/dia/cerrar-camion", {
        date: "2026-10-01",
        driver: "Ensayo",
      }),
    );
    await rechaza(
      call(repartidor, "PUT", "/api/salidas", {
        date: "2026-10-01",
        vehicleId: "x",
        drivers: ["Ensayo"],
      }),
    );
    // Administración sigue pesando por cajón.
    const r = await call(admin, "POST", `/api/orders/${id}/crates`, {
      productId: "entero",
      gross: 20,
    });
    assert.ok(r.status < 300);
  } finally {
    store.close?.();
  }
});

test("el repartidor corrige la boleta completa de su pedido: cajas y kilos", async () => {
  const { store, call, admin, repartidor, pedido } = await entorno();
  try {
    const id = await pedido("a", "Ensayo");
    const edit = await call(repartidor, "PUT", `/api/orders/${id}/editar`, {
      items: [{ id: "entero", boxes: 4 }],
      prices: { entero: 1000 },
    });
    assert.equal(edit.status, 200);
    assert.equal(
      store.orders.get(id).items.find((i) => i.id === "entero").boxes,
      4,
    );
    await call(admin, "PATCH", `/api/orders/${id}`, { status: "preparando" });
    const peso = await call(repartidor, "PATCH", `/api/orders/${id}`, {
      weights: { entero: 90 },
    });
    assert.equal(peso.status, 200);
    const o = store.orders.get(id);
    assert.equal(o.items.find((i) => i.id === "entero").kg, 90);
    assert.equal(o.total, 90000, "el total se recalcula con el precio por kilo");
  } finally {
    store.close?.();
  }
});

test("el repartidor no modifica pedidos de otro ni sin repartidor asignado", async () => {
  const { store, call, repartidor, pedido, rechaza } = await entorno();
  try {
    const ajeno = await pedido("a", "Otro");
    const libre = await pedido("b", null);
    assert.equal(store.orders.get(libre).driver || "", "");
    for (const id of [ajeno, libre])
      await rechaza(
        call(repartidor, "PUT", `/api/orders/${id}/editar`, {
          items: [{ id: "entero", boxes: 1 }],
          prices: { entero: 1000 },
        }),
      );
    assert.equal(
      store.orders.get(libre).items.find((i) => i.id === "entero").boxes,
      5,
    );
  } finally {
    store.close?.();
  }
});
