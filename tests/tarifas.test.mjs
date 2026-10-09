import test from "node:test";
import assert from "node:assert/strict";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
const { nivelPorKg } = await import("../server/tarifas.mjs");

/** Listas por cliente (10/2026): pollo según la lista, trozado por mayor o por menor según lo que llevó. */
async function entorno(store) {
  store ||= await openStore(":memory:");
  const api = createApi({
    store,
    events: createEvents(),
    dataDir: process.env.DATA_DIR,
  });
  store.drivers.save({ name: "Ensayo", active: true, zones: [] });
  const admin = { role: "admin", staffId: 1, name: "Mauro" };
  const call = (session, method, path, body = {}) =>
    api({
      method,
      path,
      body,
      session,
      query: new URLSearchParams(),
      ip: "127.0.0.1",
    });
  const as = (method, path, body) => call(admin, method, path, body);
  const cliente = async (name, prices) => {
    const phone = (await as("POST", "/api/customers", { name })).body.phone;
    if (prices) await as("PUT", `/api/customers/${phone}/prices`, { prices });
    return phone;
  };
  const own = (phone, pid) =>
    store.db
      .prepare(
        "SELECT price FROM customer_prices WHERE customer = ? AND product_id = ?",
      )
      .get(phone, pid)?.price;
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Mendoza",
  }).format(new Date());
  let n = 0;
  const pedido = (customer, items, deliveryDate = hoy) =>
    as("POST", "/api/orders", {
      customer,
      key: `k${++n}`,
      driver: "Ensayo",
      deliveryDate,
      items,
    });
  return { store, call, as, cliente, own, pedido, hoy };
}
const fila = (tablero, phone, pid) =>
  tablero.clientes
    .find((c) => c.phone === phone)
    .filas.find((f) => f.productId === pid);

test("regla del trozado: 20 kg o más en el período va por mayor", () => {
  assert.equal(nivelPorKg(20, 20), "mayor");
  assert.equal(nivelPorKg(19.9, 20), "menor");
  assert.equal(nivelPorKg(0, 20), "menor");
});

test("propuesta, aplicación, precio sugerido al cargar y reversión", async () => {
  const t = await entorno();
  const ariel = await t.cliente("Ariel Salvador", {
    entero: 4400,
    alas: 3350,
    menudos: 1500,
    "suprema-muslo": 5100,
  });
  const gallego = await t.cliente("Gallego", {
    entero: 4600,
    "cuarto-trasero": 4000,
    pechuga: 6980,
  });
  const alsina = await t.cliente("Alsina", { entero: 3500 });
  const nova = await t.cliente("Nova Market");
  const pirovano = await t.cliente("Alfredo Pirovano", { entero: 3500 });
  const valentina = await t.cliente("Valentina", { suprema: 10000 });
  const hugo = await t.cliente("Hugo Gonzales", { entero: 3900 });
  const mauro = await t.cliente("Mauro Godoy Cruz", { entero: 3600 });
  const suelto = await t.cliente("Cliente sin lista", { entero: 5000 });
  // Esta semana: Ariel llevó 25 kg de trozado; Gallego, 8 kg; Valentina, 30 kg de suprema (pero va fija por menor).
  await t.pedido(ariel, [
    { id: "alas", kg: 15 },
    { id: "rancho", kg: 10 },
  ]);
  await t.pedido(gallego, [{ id: "pechuga", kg: 8 }]);
  await t.pedido(valentina, [{ id: "suprema", kg: 30 }]);
  await t.pedido(mauro, [{ id: "entero", boxes: 10 }]);
  // Un pedido viejo no cuenta.
  await t.pedido(gallego, [{ id: "pechuga", kg: 100 }], "2026-01-05");

  const tab = (await t.as("GET", "/api/tarifas")).body;
  const c = (phone) => tab.clientes.find((x) => x.phone === phone);
  assert.equal(c(ariel).tarifa, "comercial");
  assert.equal(c(ariel).kg, 25);
  assert.equal(c(ariel).nivel, "mayor");
  assert.equal(c(gallego).nivel, "menor");
  assert.equal(c(valentina).nivel, "menor", "Valentina va fija por menor");
  assert.equal(
    c(suelto).tarifa,
    null,
    "un nombre que no está en la planilla queda sin asignar",
  );
  assert.deepEqual(
    [fila(tab, ariel, "entero").antes, fila(tab, ariel, "entero").despues],
    [4400, 4300],
  );
  assert.equal(fila(tab, ariel, "alas").despues, 3350);
  assert.equal(fila(tab, ariel, "menudos").despues, 1700);
  assert.equal(fila(tab, ariel, "suprema-muslo").despues, 10840);
  assert.equal(fila(tab, gallego, "entero").despues, 4650);
  assert.equal(
    fila(tab, gallego, "cuarto-trasero").despues,
    3700,
    "el cuarto va en oferta para todos",
  );
  assert.equal(fila(tab, gallego, "pechuga").despues, 7180);
  assert.equal(fila(tab, alsina, "entero").despues, 3750);
  assert.equal(
    fila(tab, nova, "entero").nueva,
    true,
    "la sucursal recibe su pollo a 3750",
  );
  assert.equal(fila(tab, pirovano, "entero").despues, 3750);
  assert.equal(fila(tab, valentina, "suprema").despues, 10000);
  assert.equal(fila(tab, suelto, "entero").despues, 5000);
  assert.ok(tab.fichas.eliminar.some((e) => e.phone === hugo && !e.dudoso));
  assert.ok(
    tab.fichas.eliminar.some((e) => e.phone === mauro && e.dudoso),
    "Mauro compró: se avisa",
  );
  assert.deepEqual(
    tab.fichas.sinPrecio.map((x) => x.phone).sort(),
    [alsina, nova].sort(),
  );
  assert.ok(tab.fichas.noEncontrados.includes("Pepe"));

  // Un dato que cambia entre el tablero y la confirmación obliga a recargar.
  await t.as("PUT", `/api/customers/${gallego}/prices`, {
    prices: { pechuga: 7000 },
  });
  await assert.rejects(
    t.as("POST", "/api/tarifas/aplicar", {
      token: tab.token,
      opId: "tarifas-vencida",
    }),
    (e) => e.status === 409,
  );
  const tab2 = (await t.as("GET", "/api/tarifas")).body;
  const r = await t.as("POST", "/api/tarifas/aplicar", {
    token: tab2.token,
    opId: "tarifas-1",
  });
  assert.equal(r.status, 201);
  const again = await t.as("POST", "/api/tarifas/aplicar", {
    token: tab2.token,
    opId: "tarifas-1",
  });
  assert.equal(again.body.repeated, true, "doble clic sin duplicar");
  assert.equal(t.own(ariel, "entero"), 4300);
  assert.equal(t.own(ariel, "suprema-muslo"), 10840);
  assert.equal(t.own(gallego, "pechuga"), 7180);
  assert.equal(t.own(nova, "entero"), 3750);
  assert.equal(t.own(alsina, "entero"), 3750);
  assert.equal(t.own(nova, "alas"), undefined, "no se crean otros productos");
  assert.equal(
    t.store.customers.get(ariel).tarifa,
    "comercial",
    "la asignación queda en la ficha",
  );
  assert.equal(
    t.store.settings.get("priceReference").cents,
    390000,
    "la referencia queda en la lista Mayorista",
  );

  // Al cargar un pedido, lo que no tiene precio propio trae el de su lista.
  const fichas = (await t.as("GET", "/api/customers")).body;
  const g = fichas.find((x) => x.phone === gallego);
  assert.equal(g.lista.tarifa, "minorista");
  assert.equal(g.lista.precios.alas, 3650);
  assert.equal(g.prices.alas, undefined);

  // Historial: la operación de listas se ve y se revierte exacta (la fila creada se borra).
  const hist = (await t.as("GET", "/api/precios/actualizacion")).body.history;
  assert.equal(hist[0].kind, "tarifas");
  assert.equal(hist[0].revertible, true);
  const prev = (
    await t.as(
      "POST",
      `/api/precios/actualizaciones/${hist[0].id}/reversion/vista-previa`,
    )
  ).body;
  assert.equal(prev.conflicts.length, 0);
  await t.as("POST", `/api/precios/actualizaciones/${hist[0].id}/reversion`, {
    token: prev.token,
    opId: "rev-tarifas-1",
  });
  assert.equal(t.own(ariel, "entero"), 4400);
  assert.equal(t.own(gallego, "pechuga"), 7000);
  assert.equal(t.own(nova, "entero"), undefined);
  assert.equal(t.store.settings.get("priceReference").cents, 0);

  // Fichas: eliminar (o archivar si tiene pedidos) y marcar sin precio.
  const f = await t.as("POST", "/api/tarifas/fichas", {
    eliminar: [hugo, mauro],
    sinPrecio: [alsina, nova],
  });
  assert.deepEqual(
    [f.body.eliminadas, f.body.archivadas, f.body.sinPrecio],
    [1, 1, 2],
  );
  assert.equal(t.store.customers.get(hugo), null);
  assert.equal(
    t.store.customers.get(mauro).archived,
    true,
    "con pedidos queda archivado",
  );
  assert.equal(t.store.customers.get(alsina).noPricing, true);
});

test("cambiar lista y nivel de un cliente, y el aumento por % mueve también las listas", async () => {
  const t = await entorno();
  const ariel = await t.cliente("Ariel Salvador", { entero: 4400, alas: 3000 });
  let tab = (await t.as("GET", "/api/tarifas")).body;
  await t.as("POST", "/api/tarifas/aplicar", {
    token: tab.token,
    opId: "tarifas-a",
  });
  assert.equal(
    t.own(ariel, "alas"),
    3650,
    "sin trozado esta semana: por menor",
  );
  tab = (
    await t.as("PUT", `/api/tarifas/clientes/${ariel}`, {
      tarifa: "preferencial",
      trozado: "mayor",
    })
  ).body;
  assert.equal(fila(tab, ariel, "entero").despues, 4100);
  assert.equal(fila(tab, ariel, "alas").despues, 3350);
  // La definición también se edita (y se aplica después).
  tab = (
    await t.as("PUT", "/api/tarifas/config", {
      listas: [{ id: "preferencial", pollo: 4150 }],
    })
  ).body;
  assert.equal(fila(tab, ariel, "entero").despues, 4150);
  await assert.rejects(
    t.as("PUT", "/api/tarifas/config", {
      listas: [{ id: "preferencial", pollo: 0 }],
    }),
    (e) => e.status === 400,
  );
  await t.as("POST", "/api/tarifas/aplicar", {
    token: tab.token,
    opId: "tarifas-b",
  });
  assert.equal(t.own(ariel, "entero"), 4150);

  // +300 sobre la referencia 3900: las listas escalan con el mismo factor que los precios propios.
  const p = (
    await t.as("POST", "/api/precios/actualizacion/vista-previa", {
      direction: "aumentar",
      amount: 300,
    })
  ).body;
  await t.as("POST", "/api/precios/actualizacion", {
    direction: "aumentar",
    amount: 300,
    token: p.token,
    opId: "aumento-1",
  });
  const tar = t.store.settings.get("tarifas");
  assert.equal(tar.listas.find((l) => l.id === "mayorista").pollo, 4200);
  assert.equal(tar.listas.find((l) => l.id === "preferencial").pollo, 4469.23);
  assert.equal(tar.trozado.alas.mayor, 3607.69);
  assert.equal(
    t.own(ariel, "entero"),
    4469.23,
    "el cliente y su lista quedan iguales",
  );
  const despues = (await t.as("GET", "/api/tarifas")).body;
  assert.equal(
    despues.resumen.precios,
    0,
    "no queda nada pendiente: lista y cliente se movieron juntos",
  );
});

test("solo administración", async () => {
  const t = await entorno();
  for (const s of [
    null,
    { role: "repartidor", staffId: 2, name: "Ensayo", driver: "Ensayo" },
  ])
    for (const [m, path] of [
      ["GET", "/api/tarifas"],
      ["POST", "/api/tarifas/aplicar"],
      ["POST", "/api/tarifas/fichas"],
      ["PUT", "/api/tarifas/config"],
    ])
      await assert.rejects(
        t.call(s, m, path, {}),
        (e) => e.status === 403,
        `${s?.role} ${path}`,
      );
});

test("migración: el historial del 08/10 pasa a admitir listas sin perder filas", async () => {
  const store = await openStore(":memory:");
  store.db.exec(`
CREATE TABLE price_updates(
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('aumento','disminucion','reversion')),
  at TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL,
  delta_cents INTEGER NOT NULL, ref_before INTEGER NOT NULL, ref_after INTEGER NOT NULL,
  factor TEXT NOT NULL, percent TEXT NOT NULL, rounding TEXT NOT NULL, scope TEXT NOT NULL,
  token TEXT NOT NULL, reverts TEXT REFERENCES price_updates(id), reverted_by TEXT, changes INTEGER NOT NULL);
CREATE TABLE price_update_items(
  update_id TEXT NOT NULL REFERENCES price_updates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('lista','cliente')), plan TEXT, customer TEXT, customer_name TEXT,
  product_id TEXT NOT NULL, before_cents INTEGER NOT NULL, calc_cents INTEGER NOT NULL, after_cents INTEGER NOT NULL);
INSERT INTO price_updates VALUES('viejo','aumento','2026-10-08T10:00:00Z',NULL,'Mauro',30000,390000,420000,'1,0769230769','7,69','{}','{}','tok',NULL,NULL,1);
INSERT INTO price_update_items VALUES('viejo','cliente',NULL,'549','A','entero',290000,312308,312308);`);
  const t = await entorno(store);
  const n = (sql) => store.db.prepare(sql).get().n;
  assert.equal(n("SELECT COUNT(*) AS n FROM price_updates"), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM price_update_items"), 1);
  assert.match(
    store.db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'price_updates'")
      .get().sql,
    /'tarifas'/,
  );
  assert.equal(n("SELECT COUNT(*) AS n FROM pragma_foreign_key_check"), 0);
  const hist = (await t.as("GET", "/api/precios/actualizacion")).body.history;
  assert.equal(hist[0].id, "viejo");
});
