import test from "node:test";
import assert from "node:assert/strict";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
const { scale, factorText, percentText } =
  await import("../server/precios.mjs");

/** Actualización masiva de precios: el porcentaje sale una vez de la referencia y se aplica a cada fuente. */
async function entorno() {
  const store = await openStore(":memory:");
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
  const ownCount = () =>
    store.db.prepare("SELECT COUNT(*) AS n FROM customer_prices").get().n;
  const lists = () => store.settings.get("priceLists", null);
  const ref = () => store.settings.get("priceReference", null)?.cents;
  let n = 0;
  const preview = (body) =>
    as("POST", "/api/precios/actualizacion/vista-previa", body);
  const aplicar = async (body) => {
    const p = (await preview(body)).body;
    const r = await as("POST", "/api/precios/actualizacion", {
      ...body,
      token: p.token,
      opId: `op-prueba-${++n}`,
    });
    return { p, r };
  };
  return {
    store,
    call,
    as,
    cliente,
    own,
    ownCount,
    lists,
    ref,
    preview,
    aplicar,
  };
}
const sube = (amount, rounding) => ({
  direction: "aumentar",
  amount,
  rounding,
});
const rejectsWith = (status) => (e) => e.status === status;

test("cálculo exacto: 3.900 + 300 → 7,69 % y pata muslo 2.900 → 3.123,08", () => {
  assert.equal(percentText(390000, 30000), "7,69");
  assert.equal(factorText(390000, 420000), "1,0769230769");
  assert.deepEqual(scale(290000, 390000, 420000), {
    calc: 312308,
    final: 312308,
  });
  assert.equal(
    scale(350000, 390000, 420000).calc,
    376923,
    "otro cliente: 3.769,23",
  );
  // Con el porcentaje redondeado (7,69 %) daría 3.123,01: se usa el factor exacto.
  assert.notEqual(
    scale(290000, 390000, 420000).calc,
    Math.round(290000 * 1.0769),
  );
  // Redondeo comercial sobre el cálculo, con dirección explícita.
  assert.equal(
    scale(290000, 390000, 420000, { step: 50, mode: "arriba" }).final,
    315000,
  );
  assert.equal(
    scale(290000, 390000, 420000, { step: 50, mode: "cercano" }).final,
    310000,
  );
  assert.equal(
    scale(290000, 390000, 420000, { step: 10, mode: "cercano" }).final,
    312000,
  );
  assert.equal(
    scale(290000, 390000, 420000, { step: 100, mode: "arriba" }).final,
    320000,
  );
  assert.equal(percentText(420000, -30000), "-7,14");
});

test("aplica una vez a listas y precios propios, conserva condiciones y documentos", async () => {
  const t = await entorno();
  const a = await t.cliente("Almacén A", {
    "cuarto-trasero": 2900,
    entero: 3900,
  });
  const b = await t.cliente("Rotisería B", { "cuarto-trasero": 3500 });
  const bene = await t.cliente("Benedetti", { muslo: 10540, otro: 1000 });
  const sinPropio = await t.cliente("Sin precio propio");
  // Pedido cargado antes: su precio no se toca.
  const previo = (
    await t.as("POST", "/api/orders", {
      customer: a,
      key: "antes",
      driver: "Ensayo",
      deliveryDate: "2026-10-08",
      items: [{ id: "cuarto-trasero", boxes: 2 }],
    })
  ).body;

  // Sin referencia configurada no se calcula nada.
  await assert.rejects(t.preview(sube(300)), rejectsWith(409));
  await t.as("PUT", "/api/precios/referencia", { value: 3900 });
  const filas = t.ownCount();

  const { p, r } = await t.aplicar(sube(300));
  assert.equal(p.percent, "7,69");
  assert.equal(p.refBefore, 3900);
  assert.equal(p.refAfter, 4200);
  assert.equal(r.status, 201);
  assert.equal(
    t.ref(),
    420000,
    "la referencia queda en 4.200 en la misma operación",
  );
  assert.equal(t.own(a, "cuarto-trasero"), 3123.08);
  assert.equal(t.own(b, "cuarto-trasero"), 3769.23);
  assert.equal(t.own(a, "entero"), 4200);
  assert.equal(
    t.own(bene, "muslo"),
    11350.77,
    "Benedetti conserva su precio particular, con el mismo factor",
  );
  assert.equal(t.own(bene, "otro"), 1000, "el renglón libre queda afuera");
  assert.ok(
    p.exclusions.some((e) => e.productId === "otro"),
    "la exclusión se informa",
  );
  assert.equal(
    t.ownCount(),
    filas,
    "no se crean combinaciones cliente-producto",
  );
  assert.equal(t.own(sinPropio, "entero"), undefined);

  // Cada lista compartida, una sola vez por producto y modalidad.
  const listas = p.items.filter((i) => i.source === "lista");
  assert.equal(
    new Set(listas.map((i) => `${i.productId}/${i.plan}`)).size,
    listas.length,
  );
  assert.equal(
    t.lists().entero.mayorista,
    5923.08,
    "lista mayorista 5.500 × 4.200 / 3.900",
  );
  assert.equal(t.lists()["cuarto-trasero"].minorista, 6558.46);

  // Documentos ya registrados: mismo precio. Los nuevos usan el precio nuevo.
  const guardado = (await t.as("GET", `/api/orders/${previo.id}`)).body;
  assert.equal(guardado.items[0].price, 2900);
  const nuevo = (
    await t.as("POST", "/api/orders", {
      customer: a,
      key: "despues",
      driver: "Ensayo",
      deliveryDate: "2026-10-08",
      items: [{ id: "cuarto-trasero", boxes: 1 }],
    })
  ).body;
  assert.equal(nuevo.items[0].price, 3123.08);

  // Cliente sin precio propio: toma la lista actualizada.
  const config = (await t.as("GET", "/api/config")).body;
  assert.equal(
    config.products.find((x) => x.id === "entero").wholesale,
    5923.08,
  );

  // Historial con todo lo necesario.
  const hist = (await t.as("GET", "/api/precios/actualizacion")).body.history;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].kind, "aumento");
  assert.equal(hist[0].actor, "Mauro");
  assert.equal(hist[0].factor, "1,0769230769");
  assert.equal(hist[0].revertible, true);
  const detalle = (
    await t.as("GET", `/api/precios/actualizaciones/${hist[0].id}`)
  ).body;
  const fila = detalle.items.find(
    (i) => i.customer === a && i.productId === "cuarto-trasero",
  );
  assert.deepEqual(
    [fila.before, fila.calc, fila.final],
    [2900, 3123.08, 3123.08],
  );
  const mov = t.store.audit.query({ categoria: "Precios" });
  assert.ok(
    JSON.stringify(mov).includes("prices.bulk"),
    "queda en Movimientos",
  );
});

test("aumentos sucesivos usan la referencia nueva; redondeo; disminución y validaciones", async () => {
  const t = await entorno();
  const a = await t.cliente("Almacén A", { "cuarto-trasero": 2900 });
  await t.as("PUT", "/api/precios/referencia", { value: 3900 });
  await t.aplicar(sube(300));
  const { p } = await t.aplicar(sube(300, { step: 50, mode: "arriba" }));
  assert.equal(p.refBefore, 4200);
  assert.equal(p.percent, "7,14");
  const fila = p.items.find((i) => i.customer === a);
  assert.equal(fila.calc, 3346.16, "3.123,08 × 4.500 / 4.200");
  assert.equal(fila.final, 3350);
  assert.equal(t.own(a, "cuarto-trasero"), 3350);
  assert.equal(t.ref(), 450000, "la referencia no se redondea: 4.200 + 300");

  const { p: baja } = await t.aplicar({
    direction: "disminuir",
    amount: "150",
  });
  assert.equal(baja.kind, "disminucion");
  assert.equal(baja.refAfter, 4350);
  assert.equal(t.own(a, "cuarto-trasero"), 3238.33, "3.350 × 4.350 / 4.500");

  for (const amount of ["0", "-5", "abc", "", "Infinity", "10.555", "NaN"])
    await assert.rejects(
      t.preview(sube(amount)),
      rejectsWith(400),
      `importe ${amount}`,
    );
  await assert.rejects(
    t.preview({ direction: "disminuir", amount: 4350 }),
    rejectsWith(400),
  );
  await assert.rejects(
    t.preview({ direction: "subir", amount: 10 }),
    rejectsWith(400),
  );
  await assert.rejects(t.preview(sube(10, { step: 25 })), rejectsWith(400));
  await assert.rejects(
    t.preview(sube(10, { step: 50 })),
    rejectsWith(400),
    "redondeo sin dirección",
  );
  await assert.rejects(
    t.as("PUT", "/api/precios/referencia", { value: 0 }),
    rejectsWith(400),
  );

  // Un precio final en cero bloquea toda la operación.
  const chico = await t.cliente("Precio chico", { garras: 1 });
  const p0 = (
    await t.preview({
      direction: "disminuir",
      amount: 4000,
      rounding: { step: 100, mode: "cercano" },
    })
  ).body;
  assert.ok(p0.errors.some((e) => e.customer === chico));
  await assert.rejects(
    t.as("POST", "/api/precios/actualizacion", {
      direction: "disminuir",
      amount: 4000,
      rounding: { step: 100, mode: "cercano" },
      token: p0.token,
      opId: "op-con-error",
    }),
    rejectsWith(400),
  );
  assert.equal(t.own(a, "cuarto-trasero"), 3238.33);
});

test("reintentos, vista previa vencida y errores no dejan cambios a medias", async () => {
  const t = await entorno();
  const a = await t.cliente("Almacén A", { "cuarto-trasero": 2900 });
  const b = await t.cliente("Rotisería B", { muslo: 5000 });
  await t.as("PUT", "/api/precios/referencia", { value: 3900 });

  // Doble clic / reintento con el mismo identificador: se aplica una sola vez.
  const p = (await t.preview(sube(300))).body;
  const body = { ...sube(300), token: p.token, opId: "op-doble-clic" };
  const uno = await t.as("POST", "/api/precios/actualizacion", body);
  const dos = await t.as("POST", "/api/precios/actualizacion", body);
  assert.equal(uno.status, 201);
  assert.equal(dos.status, 200);
  assert.equal(dos.body.repeated, true);
  assert.equal(t.own(a, "cuarto-trasero"), 3123.08);
  // Otro identificador con la misma vista previa: ya no coincide con los datos.
  await assert.rejects(
    t.as("POST", "/api/precios/actualizacion", {
      ...body,
      opId: "op-otra-pestana",
    }),
    rejectsWith(409),
  );
  assert.equal(t.own(a, "cuarto-trasero"), 3123.08, "sin doble aumento");

  // Un precio cambia entre la vista previa y la confirmación (otro administrativo).
  const p2 = (await t.preview(sube(100))).body;
  await t.as("PUT", `/api/customers/${b}/prices`, { prices: { muslo: 5600 } });
  await assert.rejects(
    t.as("POST", "/api/precios/actualizacion", {
      ...sube(100),
      token: p2.token,
      opId: "op-vencida",
    }),
    rejectsWith(409),
  );
  assert.equal(t.own(a, "cuarto-trasero"), 3123.08);
  assert.equal(t.ref(), 420000);

  // Falla a mitad de la escritura: no queda nada aplicado.
  const antes = {
    a: t.own(a, "cuarto-trasero"),
    b: t.own(b, "muslo"),
    lists: JSON.stringify(t.lists()),
    ref: t.ref(),
  };
  t.store.db.exec(
    "CREATE TRIGGER falla BEFORE INSERT ON price_update_items WHEN NEW.product_id = 'muslo' AND NEW.source = 'cliente' BEGIN SELECT RAISE(ABORT, 'falla simulada'); END",
  );
  const p3 = (await t.preview(sube(100))).body;
  await assert.rejects(
    t.as("POST", "/api/precios/actualizacion", {
      ...sube(100),
      token: p3.token,
      opId: "op-falla",
    }),
  );
  assert.deepEqual(
    {
      a: t.own(a, "cuarto-trasero"),
      b: t.own(b, "muslo"),
      lists: JSON.stringify(t.lists()),
      ref: t.ref(),
    },
    antes,
  );
  assert.equal(
    t.store.db
      .prepare("SELECT COUNT(*) AS n FROM price_updates WHERE id = 'op-falla'")
      .get().n,
    0,
  );
});

test("revertir restaura exacto la última; con cambios posteriores se bloquea", async () => {
  const t = await entorno();
  const a = await t.cliente("Almacén A", { "cuarto-trasero": 2900 });
  const bene = await t.cliente("Benedetti", { muslo: 10540 });
  await t.as("PUT", "/api/precios/referencia", { value: 3900 });
  const listasAntes = (await t.as("GET", "/api/config")).body.products;
  await t.aplicar(sube(300));
  const { r } = await t.aplicar(sube(300, { step: 50, mode: "arriba" }));
  const id = r.body.update.id;
  const primera = (await t.as("GET", "/api/precios/actualizacion")).body
    .history[1];
  assert.equal(primera.revertible, false, "solo la última es reversible");
  await assert.rejects(
    t.as(
      "POST",
      `/api/precios/actualizaciones/${primera.id}/reversion/vista-previa`,
    ),
    rejectsWith(409),
  );

  // Cambio posterior: conflicto, no se restaura nada.
  await t.as("PUT", `/api/customers/${bene}/prices`, {
    prices: { muslo: 12000 },
  });
  const conflicto = (
    await t.as(
      "POST",
      `/api/precios/actualizaciones/${id}/reversion/vista-previa`,
    )
  ).body;
  assert.equal(conflicto.conflicts.length, 1);
  assert.match(conflicto.conflicts[0].what, /Benedetti/);
  await assert.rejects(
    t.as("POST", `/api/precios/actualizaciones/${id}/reversion`, {
      token: conflicto.token,
      opId: "rev-bloqueada",
    }),
    rejectsWith(409),
  );
  assert.equal(t.own(a, "cuarto-trasero"), 3350, "nada restaurado a medias");
  assert.equal(t.own(bene, "muslo"), 12000, "no pisa el cambio posterior");

  // Sin conflicto: restaura exactamente los valores guardados (no aplica el porcentaje inverso).
  await t.as("PUT", `/api/customers/${bene}/prices`, {
    prices: { muslo: 11350.77 },
  });
  const prev = (
    await t.as(
      "POST",
      `/api/precios/actualizaciones/${id}/reversion/vista-previa`,
    )
  ).body;
  // 11.350,77 era el valor después de la 1.ª; la 2.ª lo llevó a 12.200 (12.161,54 redondeado hacia arriba a 50).
  assert.equal(
    prev.conflicts.length,
    1,
    "11.350,77 no es lo que dejó la 2.ª actualización",
  );
  await t.as("PUT", `/api/customers/${bene}/prices`, {
    prices: { muslo: 12200 },
  });
  const ok = (
    await t.as(
      "POST",
      `/api/precios/actualizaciones/${id}/reversion/vista-previa`,
    )
  ).body;
  assert.equal(ok.conflicts.length, 0);
  const rev = await t.as(
    "POST",
    `/api/precios/actualizaciones/${id}/reversion`,
    { token: ok.token, opId: "rev-ok-1" },
  );
  assert.equal(rev.status, 201);
  const again = await t.as(
    "POST",
    `/api/precios/actualizaciones/${id}/reversion`,
    { token: ok.token, opId: "rev-ok-1" },
  );
  assert.equal(
    again.body.repeated,
    true,
    "reintento de la reversión sin duplicar",
  );
  assert.equal(
    t.own(a, "cuarto-trasero"),
    3123.08,
    "vuelve exacto al valor anterior",
  );
  assert.equal(t.own(bene, "muslo"), 11350.77);
  assert.equal(t.ref(), 420000);
  const hist = (await t.as("GET", "/api/precios/actualizacion")).body.history;
  assert.equal(hist[0].kind, "reversion");
  assert.equal(hist[0].reverts, id);
  assert.equal(hist[1].revertedBy, "rev-ok-1");
  assert.equal(hist[0].revertible, false);

  // Revertir también la primera ya no corresponde: la última operación es una reversión.
  await assert.rejects(
    t.as(
      "POST",
      `/api/precios/actualizaciones/${hist[2].id}/reversion/vista-previa`,
    ),
    rejectsWith(409),
  );
  // Las listas vuelven a los valores de la primera actualización.
  const entero = (await t.as("GET", "/api/config")).body.products.find(
    (x) => x.id === "entero",
  );
  assert.equal(entero.wholesale, 5923.08);
  assert.equal(listasAntes.find((x) => x.id === "entero").wholesale, 5500);
});

test("solo administración, también por llamada directa", async () => {
  const t = await entorno();
  await t.as("PUT", "/api/precios/referencia", { value: 3900 });
  const p = (await t.preview(sube(300))).body;
  const sesiones = [
    null,
    { role: "cliente", phone: "5492630000000", name: "Cliente" },
    { role: "repartidor", staffId: 2, name: "Ensayo", driver: "Ensayo" },
  ];
  for (const s of sesiones) {
    for (const [method, path, body] of [
      ["GET", "/api/precios/actualizacion"],
      ["PUT", "/api/precios/referencia", { value: 1 }],
      ["POST", "/api/precios/actualizacion/vista-previa", sube(300)],
      [
        "POST",
        "/api/precios/actualizacion",
        { ...sube(300), token: p.token, opId: "op-intruso" },
      ],
      [
        "POST",
        "/api/precios/actualizaciones/x1234567/reversion",
        { token: "x", opId: "rev-intruso" },
      ],
    ])
      await assert.rejects(
        t.call(s, method, path, body),
        rejectsWith(403),
        `${s?.role} ${method} ${path}`,
      );
  }
  assert.equal(t.ref(), 390000);
});
