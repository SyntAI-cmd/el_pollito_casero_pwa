import test from "node:test";
import assert from "node:assert/strict";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
const { products } = await import("../domain.mjs");

test("producto nuevo: 'Otro' con nombre queda en el catálogo y el pedido lo usa como tal", async () => {
  const store = await openStore(":memory:");
  const avisos = [];
  const events = createEvents();
  events.productsChanged = () => avisos.push("config");
  try {
    const api = createApi({ store, events, dataDir: process.env.DATA_DIR });
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
      await call("POST", "/api/customers", { name: "Cliente productos" })
    ).body.phone;

    // Con el botón Agregar: solo el nombre, sin descripción.
    const creado = await call("POST", "/api/products", {
      name: "pata de muslo",
    });
    assert.equal(creado.status, 201);
    assert.equal(creado.body.name, "Pata de muslo");
    assert.deepEqual(avisos, ["config"], "avisa a las pantallas");
    const config = (await call("GET", "/api/config")).body;
    const ids = config.products.map((p) => p.id);
    assert.ok(ids.includes(creado.body.id), "aparece en /api/config");
    assert.equal(ids.at(-1), "otro", "el renglón libre sigue último");
    // Mismo nombre con otras mayúsculas/tildes: no se duplica.
    const repetido = await call("POST", "/api/products", {
      name: "PATA DE MUSLO",
    });
    assert.equal(repetido.status, 200);
    assert.equal(repetido.body.id, creado.body.id);

    // Sin tocar Agregar: el pedido con "otro" + nombre lo crea y lo guarda como producto.
    await call("PUT", `/api/customers/${phone}/prices`, {
      prices: { otro: 3500 },
    });
    const pedido = await call("POST", "/api/orders", {
      customer: phone,
      key: "p1",
      driver: "Ensayo",
      deliveryDate: "2026-09-29",
      items: [{ id: "otro", boxes: 3, label: "Alitas adobadas" }],
    });
    const item = pedido.body.items[0];
    assert.notEqual(item.id, "otro");
    assert.equal(item.name, "Alitas adobadas");
    assert.equal(item.price, 3500, "el precio de 'otro' pasa al producto");
    const precios = Object.fromEntries(
      store.prices.forCustomer(phone).map((p) => [p.productId, p.price]),
    );
    assert.equal(precios[item.id], 3500);
    assert.equal(precios.otro, undefined, "'otro' queda libre otra vez");
    assert.equal(pedido.body.driver, "Ensayo", "preventista asignado");

    // Pedido viejo con "otro" (cargado antes de este cambio): asignarle el preventista no falla
    // y el renglón pasa al producto con ese nombre.
    const viejo = (
      await call("POST", "/api/orders", {
        customer: phone,
        key: "p2",
        deliveryDate: "2026-09-29",
        items: [{ id: "entero", boxes: 1 }],
      })
    ).body;
    const guardado = store.orders.get(viejo.id);
    guardado.items.push({
      id: "otro",
      name: "Pata de muslo",
      kg: 0,
      boxes: 2,
      price: 3200,
      lineTotal: 0,
    });
    store.orders.save(guardado);
    const asignado = await call("PUT", `/api/orders/${viejo.id}/editar`, {
      driver: "Ensayo",
    });
    assert.equal(asignado.status, 200);
    assert.equal(store.orders.get(viejo.id).driver, "Ensayo");
    const renglon = store.orders
      .get(viejo.id)
      .items.find((i) => i.name === "Pata de muslo");
    assert.equal(renglon.id, creado.body.id, "usa el producto existente");
    assert.equal(renglon.boxes, 2);
    assert.equal(renglon.price, 3200, "conserva el precio que tenía");

    // Queda guardado: al reabrir la app (otro createApi) sigue en el catálogo.
    const guardados = store.settings.get("customProducts", []);
    assert.deepEqual(
      guardados.map((p) => p.name),
      ["Pata de muslo", "Alitas adobadas"],
    );
  } finally {
    // El catálogo es un módulo compartido: se sacan los productos de prueba.
    for (let i = products.length - 1; i >= 0; i--)
      if (products[i].created) products.splice(i, 1);
    store.close?.();
  }
});
