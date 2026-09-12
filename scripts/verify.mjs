/**
 * Verificación end-to-end: API con roles, SSE y navegador (cliente, administración y repartidor).
 * Levanta un servidor aislado en el puerto 5181 con SQLite en memoria y geocodificación apagada.
 */
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

await mkdir("test-results", { recursive: true });
const server = spawn(process.execPath, ["server.mjs"], {
  env: {
    ...process.env,
    PORT: "5181",
    DB_PATH: ":memory:",
    GEOCODING: "off",
    ROUTING: "off",
    PUSH: "off",
    STAFF_PIN: "1234",
    TRANSFER_ALIAS: "pollito.casero.mp",
    TRANSFER_HOLDER: "El Pollito Casero",
  },
  stdio: "pipe",
  windowsHide: true,
});
server.stderr.on("data", (d) => process.stderr.write(d));
const base = "http://localhost:5181";
let browser;
const step = (name) => console.log("· " + name);

// Cliente HTTP mínimo con cookies por "usuario".
function client() {
  let cookie = "";
  return async (path, data, method = data ? "POST" : "GET", headers = {}) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: r.status, data: await r.json() };
  };
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base + "/api/config")).ok) break;
    } catch {}
    await pause(250);
  }
  // ---------- API ----------
  const ana = client();
  const admin = client();
  const franco = client();
  const anon = client();
  const sample = {
    key: "test-wholesale",
    plan: "mayorista",
    payment: "cuenta",
    name: "Almacén de prueba",
    address: "Belgrano 1200",
    localityId: "san-martin",
    phone: "263 500-0000",
    items: [{ id: "entero", kg: 10 }],
    total: 1,
  };
  assert.deepEqual(
    (await anon("/orders")).data,
    [],
    "sin sesión no se ven pedidos",
  );
  const created = await ana("/orders", sample);
  assert.equal(created.status, 201);
  assert.equal(created.data.total, 35000, "precio calculado por el servidor");
  assert.equal(created.data.customer, "5492635000000");
  assert.equal(
    (await ana("/orders", sample)).data.id,
    created.data.id,
    "idempotencia por clave",
  );
  assert.equal(
    (await ana("/session")).data.role,
    "cliente",
    "el pedido crea la sesión del cliente",
  );
  assert.equal((await ana("/orders")).data.length, 1);
  const id = created.data.id;
  assert.equal(
    (await ana("/orders/" + id, { status: "preparando" }, "PATCH")).status,
    403,
    "el cliente no cambia estados",
  );
  assert.equal(
    (await anon("/orders/" + id, { status: "preparando" }, "PATCH")).status,
    401,
  );
  assert.equal((await admin("/session/staff", { pin: "0000" })).status, 401);
  assert.equal(
    (await admin("/session/staff", { pin: "1234" })).data.role,
    "admin",
  );
  assert.equal(
    (
      await franco("/session/staff", {
        pin: "1234",
        role: "repartidor",
        driver: "Franco",
      })
    ).data.driver,
    "Franco",
  );
  assert.equal(
    (await franco("/orders")).data.length,
    0,
    "el repartidor no ve pedidos sin asignar",
  );
  assert.equal((await admin("/orders")).data.length, 1);
  assert.equal(
    (await admin("/orders/" + id, { status: "en_camino" }, "PATCH")).status,
    400,
    "un estado por vez",
  );
  assert.equal(
    (await admin("/orders/" + id, { status: "preparando" }, "PATCH")).status,
    200,
  );
  assert.equal(
    (await admin("/orders/" + id, { status: "en_camino" }, "PATCH")).status,
    400,
    "requiere repartidor",
  );
  assert.equal(
    (await franco("/orders/" + id, { status: "en_camino" }, "PATCH")).status,
    404,
    "no asignado: invisible",
  );
  assert.equal(
    (await admin("/orders/" + id, { driver: "Franco" }, "PATCH")).status,
    200,
  );
  assert.equal(
    (await franco("/orders")).data.length,
    1,
    "asignado: visible para Franco",
  );
  assert.equal(
    (await franco("/orders/" + id, { driver: "Maxi" }, "PATCH")).status,
    403,
    "el repartidor no reasigna",
  );
  assert.equal(
    (await franco("/orders/" + id, { status: "en_camino" }, "PATCH")).status,
    200,
    "el repartidor sale a entregar",
  );
  assert.equal(
    (
      await franco(
        "/orders/" + id,
        { location: { lat: -33.08, lng: -68.47 } },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (await franco("/orders/" + id, { location: { lat: 999, lng: 0 } }, "PATCH"))
      .status,
    400,
  );
  assert.equal(
    (await ana("/orders/" + id, { cancel: true }, "PATCH")).status,
    400,
    "no se cancela en camino",
  );
  assert.equal(
    (await franco("/orders/" + id, { status: "entregado", boxes: 3 }, "PATCH"))
      .status,
    200,
  );
  assert.equal(
    (await franco("/orders/" + id, { returnBoxes: 4 }, "PATCH")).status,
    400,
  );
  assert.equal(
    (await franco("/orders/" + id, { returnBoxes: 2 }, "PATCH")).data.returned,
    2,
  );
  const me = (await ana("/me")).data;
  assert.equal(me.summary.balance, 35000, "saldo a cuenta");
  assert.equal(me.summary.boxes, 1, "envases pendientes");
  assert.equal(
    (await admin("/orders/" + id, { paid: true }, "PATCH")).data.paid,
    true,
  );
  assert.equal((await ana("/me")).data.summary.balance, 0);

  assert.equal(
    (await anon("/orders", { ...sample, key: "bad", plan: "minorista" }))
      .status,
    400,
    "minorista sin cuenta",
  );
  const retail = await anon("/orders", {
    ...sample,
    key: "test-retail",
    plan: "minorista",
    payment: "entrega",
    phone: "263 455-1234",
    name: "Ana Prueba",
  });
  assert.equal(retail.data.total, 46500);
  assert.equal(
    (await anon("/orders/" + retail.data.id, { cancel: true }, "PATCH")).data
      .status,
    "cancelado",
    "el cliente cancela un pedido recibido",
  );
  assert.equal(
    (
      await admin(
        "/orders/" + retail.data.id,
        { status: "preparando" },
        "PATCH",
      )
    ).status,
    400,
  );
  const retail2 = await anon("/orders", {
    ...sample,
    key: "test-retail-2",
    plan: "minorista",
    payment: "entrega",
    phone: "263 455-1234",
    name: "Ana Prueba",
  });
  await admin("/orders/" + retail2.data.id, { status: "preparando" }, "PATCH");
  await admin(
    "/orders/" + retail2.data.id,
    { driver: "Maxi", status: "en_camino" },
    "PATCH",
  );
  assert.equal(
    (
      await admin(
        "/orders/" + retail2.data.id,
        { status: "entregado", boxes: 2 },
        "PATCH",
      )
    ).status,
    400,
    "cobro antes de entregar",
  );
  await admin("/orders/" + retail2.data.id, { paid: true }, "PATCH");
  assert.equal(
    (
      await admin(
        "/orders/" + retail2.data.id,
        { status: "entregado", boxes: 2 },
        "PATCH",
      )
    ).data.boxes,
    0,
    "minorista sin envases",
  );
  const customers = (await admin("/customers")).data;
  assert.equal(customers.length, 2);
  assert.equal((await ana("/customers")).status, 403);
  const phone = customers.find((c) => c.name === "Ana Prueba").phone;
  assert.equal(
    (
      await admin(
        "/customers/" + phone,
        { credit: false, plan: "mayorista" },
        "PATCH",
      )
    ).data.credit,
    false,
  );
  assert.equal(
    (
      await anon("/orders", {
        ...sample,
        key: "no-credit",
        phone: "263 455-1234",
        name: "Ana Prueba",
      })
    ).status,
    400,
    "sin crédito habilitado no compra a cuenta",
  );
  assert.equal(
    (await anon("/orders", sample, "POST", { Origin: "https://example.com" }))
      .status,
    403,
    "origen ajeno rechazado",
  );

  // Ubicación marcada por el cliente, repartidor habitual, ETA al salir y datos de reparto.
  const cfg = (await anon("/config")).data;
  assert.ok(
    cfg.pushKey && cfg.pushKey.length > 40,
    "clave pública de push publicada",
  );
  assert.equal(
    (await anon("/geo/reverse?lat=-34.6&lng=-58.4")).status,
    400,
    "ubicación fuera de Mendoza rechazada",
  );
  assert.equal(
    (await anon("/geo/reverse?lat=-33.08&lng=-68.47")).status,
    200,
    "reverse dentro de Mendoza (sin geocodificador: null)",
  );
  const cust = (await admin("/customers")).data.find(
    (c) => c.name === "Almacén de prueba",
  );
  assert.equal(
    (await admin("/customers/" + cust.phone, { driver: "Franco" }, "PATCH"))
      .data.driver,
    "Franco",
    "repartidor habitual",
  );
  const located = await ana("/orders", {
    ...sample,
    key: "located",
    location: { lat: -33.0812, lng: -68.4698 },
  });
  assert.equal(located.status, 201);
  assert.equal(
    located.data.driver,
    "Franco",
    "pedido nuevo preasignado al repartidor habitual",
  );
  assert.equal(
    located.data.destination?.source,
    "cliente",
    "destino tomado del punto marcado",
  );
  assert.equal(
    (await ana("/me")).data.location?.lat,
    -33.0812,
    "ubicación guardada en el cliente",
  );
  const outside = await ana("/orders", {
    ...sample,
    key: "outside",
    location: { lat: 10, lng: 10 },
  });
  assert.equal(outside.data.destination, null, "ubicación inválida ignorada");
  await admin("/orders/" + located.data.id, { status: "preparando" }, "PATCH");
  const departed = (
    await franco("/orders/" + located.data.id, { status: "en_camino" }, "PATCH")
  ).data;
  assert.ok(departed.departedAt, "hora de salida registrada");
  assert.ok(
    departed.eta?.arrival && departed.eta.minutes >= 1,
    "ETA estimada al salir",
  );
  await franco("/orders/" + located.data.id, { paid: true }, "PATCH");
  const done = (
    await franco(
      "/orders/" + located.data.id,
      { status: "entregado", boxes: 2 },
      "PATCH",
    )
  ).data;
  assert.ok(
    done.deliveredAt && done.deliveredBy === "Franco",
    "entrega registrada con hora y repartidor",
  );
  assert.equal(
    (await franco("/orders/" + located.data.id, { returnBoxes: 1 }, "PATCH"))
      .data.returns?.length,
    1,
    "devolución registrada con fecha",
  );
  assert.equal(
    (
      await client()("/push/subscribe", {
        subscription: {
          endpoint: "https://x",
          keys: { p256dh: "a", auth: "b" },
        },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await ana("/push/subscribe", {
        subscription: {
          endpoint: "http://insecure",
          keys: { p256dh: "a", auth: "b" },
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await ana("/push/subscribe", {
        subscription: {
          endpoint: "https://push.example/abc",
          keys: { p256dh: "a", auth: "b" },
        },
      })
    ).status,
    200,
  );

  // Pesaje en balanza y pagos de cuenta corriente.
  const w = await ana("/orders", {
    ...sample,
    key: "weigh",
    items: [
      { id: "entero", kg: 10 },
      { id: "suprema", kg: 2 },
    ],
  });
  assert.equal(w.data.total, 35000 + 14880);
  assert.equal(
    (await ana("/orders/" + w.data.id, { weights: { entero: 9.5 } }, "PATCH"))
      .status,
    403,
    "el cliente no pesa",
  );
  assert.equal(
    (
      await franco(
        "/orders/" + w.data.id,
        { weights: { entero: 9.5 } },
        "PATCH",
      )
    ).status,
    403,
    "recibido: solo administración pesa",
  );
  const weighed = (
    await admin(
      "/orders/" + w.data.id,
      { weights: { entero: 9.52, suprema: 2.1 } },
      "PATCH",
    )
  ).data;
  assert.equal(weighed.items[0].kg, 9.52);
  assert.equal(weighed.items[0].ordered, 10);
  assert.equal(
    weighed.total,
    Math.round((9.52 * 3500 + 2.1 * 7440) * 100) / 100,
    "total recalculado con peso real",
  );
  assert.ok(weighed.weighed && weighed.weighedBy === "admin");
  assert.equal(
    (await admin("/orders/" + w.data.id, { weights: { entero: 0 } }, "PATCH"))
      .status,
    400,
  );
  const almacen = (await admin("/customers")).data.find(
    (c) => c.name === "Almacén de prueba",
  );
  const owedBefore = almacen.summary.balance;
  assert.ok(owedBefore > 0, "el almacén debe pedidos a cuenta");
  assert.equal(
    (await ana("/customers/" + almacen.phone + "/payments", { amount: 1000 }))
      .status,
    403,
    "el cliente no registra pagos",
  );
  const pay = await admin("/customers/" + almacen.phone + "/payments", {
    amount: owedBefore + 5000,
    method: "efectivo",
    note: "prueba",
  });
  assert.equal(pay.status, 201);
  assert.equal(
    pay.data.customer.summary.owed,
    0,
    "todos los pedidos a cuenta quedaron pagos",
  );
  assert.equal(
    pay.data.customer.summary.creditBalance,
    5000,
    "sobrante como saldo a favor",
  );
  assert.equal(pay.data.customer.summary.balance, -5000);
  assert.ok(pay.data.payment.applied.length >= 2, "aplicado a varios pedidos");
  const small = await ana("/orders", {
    ...sample,
    key: "credit-use",
    items: [{ id: "rancho", kg: 5 }],
  });
  assert.equal(small.status, 201, JSON.stringify(small.data));
  assert.equal(small.data.total, 2400);
  assert.equal(
    small.data.paid,
    true,
    "pedido chico a cuenta pagado con saldo a favor",
  );
  assert.equal(small.data.paidBy, "saldo a favor");
  assert.equal((await ana("/me")).data.creditBalance, 2600);
  const maxi = client();
  await maxi("/session/staff", {
    pin: "1234",
    role: "repartidor",
    driver: "Maxi",
  });
  assert.equal(
    (await maxi("/customers/" + almacen.phone + "/payments", { amount: 100 }))
      .status,
    404,
    "Maxi no reparte al almacén (ni sabe que existe)",
  );
  assert.equal(
    (
      await franco("/customers/" + almacen.phone + "/payments", {
        amount: 100,
        method: "efectivo",
      })
    ).status,
    201,
    "Franco sí",
  );
  assert.equal(
    (await franco("/customers")).data.some((c) => c.phone === almacen.phone),
    true,
    "el repartidor ve a sus clientes",
  );
  assert.equal(
    (await maxi("/customers")).data.some((c) => c.phone === almacen.phone),
    false,
  );

  // Pagos: transferencia informada por el cliente, Mercado Pago online deshabilitado, envases por cliente.
  assert.equal(
    cfg.transfer?.alias,
    "pollito.casero.mp",
    "alias de transferencia publicado",
  );
  assert.equal(cfg.mercadopago, false);
  assert.equal(
    cfg.staffAccess,
    undefined,
    "el cliente no recibe pistas del acceso del equipo",
  );
  const tr = await ana("/orders", {
    ...sample,
    key: "transfer-1",
    payment: "transferencia",
    items: [{ id: "alas", kg: 2 }],
  });
  assert.equal(tr.status, 201);
  assert.equal(
    (
      await ana(
        "/orders/" + tr.data.id,
        { transfer: { reference: "MP-778899" } },
        "PATCH",
      )
    ).data.transfer?.reference,
    "MP-778899",
  );
  assert.equal(
    (await admin("/orders")).data.find((o) => o.id === tr.data.id).transfer
      .reference,
    "MP-778899",
    "administración ve la transferencia informada",
  );
  const confirmed = (
    await admin(
      "/orders/" + tr.data.id,
      { paid: true, paidMethod: "transferencia" },
      "PATCH",
    )
  ).data;
  assert.equal(confirmed.paid, true);
  assert.equal(confirmed.paidMethod, "transferencia");
  assert.equal(
    (await ana("/orders", { ...sample, key: "mp-1", payment: "mercadopago" }))
      .status,
    400,
    "MP online deshabilitado sin token",
  );
  assert.equal((await ana("/orders/" + tr.data.id + "/mp", {})).status, 400);
  assert.equal(
    (await franco("/customers/" + cust.phone + "/boxes", { boxes: 1 })).status,
    200,
    "el repartidor recibe envases del cliente",
  );
  assert.equal(
    (await franco("/customers/" + cust.phone + "/boxes", { boxes: 99 })).status,
    400,
    "no más de los pendientes",
  );
  assert.equal(
    (await ana("/customers/" + cust.phone + "/boxes", { boxes: 1 })).status,
    403,
  );
  assert.equal(
    (await anon("/messages")).status,
    403,
    "el chat interno no es para clientes",
  );
  assert.equal((await anon("/health")).data.ok, true);

  // SSE: el cliente recibe la novedad cuando administración cambia el estado.
  const sseCookie = (
    await fetch(base + "/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Almacén de prueba",
        phone: "263 500-0000",
      }),
    })
  ).headers
    .get("set-cookie")
    .split(";")[0];
  const sse = await fetch(base + "/api/events", {
    headers: { Cookie: sseCookie },
  });
  const reader = sse.body.getReader();
  const decoder = new TextDecoder();
  const readUntil = async (needle) => {
    let text = "";
    const deadline = Date.now() + 5000;
    while (!text.includes(needle) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    return text;
  };
  assert.match(await readUntil("event: hello"), /event: hello/);
  const fresh = await ana("/orders", { ...sample, key: "sse-order" });
  assert.match(await readUntil("event: orders"), new RegExp(fresh.data.id));
  await admin("/orders/" + fresh.data.id, { status: "preparando" }, "PATCH");
  assert.match(await readUntil("preparando"), /"status":"preparando"/);
  await reader.cancel();
  assert.equal((await fetch(base + "/api/events")).status, 401);

  const html = await (await fetch(base + "/planes")).text();
  assert.match(html, /<title>Precios mayoristas/);
  assert.match(html, /rel="canonical" href="http:\/\/localhost:5181\/planes"/);
  assert.match(html, /name="robots" content="index,follow"/);
  assert.match(
    await (await fetch(base + "/operacion")).text(),
    /noindex,nofollow/,
  );
  assert.equal((await fetch(base + "/no-existe")).status, 404);
  for (const p of [
    "/robots.txt",
    "/llm.txt",
    "/llms.txt",
    "/sitemap.xml",
    "/og.png",
    "/manifest.webmanifest",
    "/icon-192.png",
    "/icon-512.png",
    "/images/pollo.webp",
    "/images/alas.webp",
  ])
    assert.equal((await fetch(base + p)).status, 200, p);
  step(
    "API: roles, sesiones, precios, idempotencia, estados, GPS, cobro, envases, cancelación, clientes, SSE, SEO y 404 correctos.",
  );

  // ---------- Navegador ----------
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const errors = [];
  const newPage = async (viewport = { width: 1440, height: 1000 }) => {
    const context = await browser.newContext({ viewport, locale: "es-AR" });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    return page;
  };

  // Cliente: catálogo, carrito, checkout.
  const page = await newPage();
  await page.context().grantPermissions(["geolocation"]);
  await page
    .context()
    .setGeolocation({ latitude: -33.0812, longitude: -68.4698 });
  await page.goto(base);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (url) => window.__opened.push(url);
  });
  await page.getByRole("button", { name: "Hablemos" }).click();
  assert.match(
    await page.evaluate(() => window.__opened[0]),
    /wa\.me\/5492635037286/,
  );
  await expect(page.locator(".product")).toHaveCount(10);
  await page.getByLabel("Buscar un producto").fill("pechu");
  await expect(page.locator(".product")).toHaveCount(2);
  await page.getByLabel("Buscar un producto").fill("zzz");
  await expect(page.locator(".empty-state.compact")).toBeVisible();
  await page.getByLabel("Buscar un producto").fill("");
  await page.getByRole("button", { name: "Trozado" }).click();
  await expect(page.locator(".product")).toHaveCount(9);
  await expect(page.locator(".product-tag")).toHaveCount(
    0,
    "sin carteles en las tarjetas",
  );
  await page.getByRole("button", { name: "Todos" }).click();
  await page.getByRole("button", { name: "Mayorista Para tu negocio" }).click();
  await expect(
    page.locator(".product").first().locator(".price"),
  ).toContainText("3.500");
  await page.getByRole("button", { name: "Minorista Para tu casa" }).click();
  await expect(
    page.locator(".product").first().locator(".price"),
  ).toContainText("4.500");
  await page.getByLabel("Kilogramos de Pollo entero").fill("1.5");
  await page
    .getByRole("button", { name: "Agregar", exact: true })
    .first()
    .click();
  await expect(page.locator("#carrito .cart-quantity")).toContainText("1,5 kg");
  await page
    .getByRole("button", { name: "Sumar medio kilo de Pollo entero" })
    .click();
  await expect(page.locator("#carrito .total")).toContainText("10.500");
  await page.getByRole("button", { name: "Eliminar Pollo entero" }).click();
  await page.getByLabel("Kilogramos de Pollo entero").fill("999.5");
  await page
    .getByRole("button", { name: "Aumentar kg de Pollo entero" })
    .click();
  await expect(page.getByLabel("Kilogramos de Pollo entero")).toHaveValue(
    "1000",
  );
  await page.getByLabel("Kilogramos de Pollo entero").fill("2");
  await page
    .getByRole("button", { name: "Agregar", exact: true })
    .first()
    .click();
  await page.getByLabel("Kilogramos de Suprema").fill("1");
  await page
    .locator(".product", { hasText: "Suprema" })
    .getByRole("button", { name: "Agregar" })
    .click();
  await expect(page.locator("#carrito .total")).toContainText("19.800");
  await page.getByRole("button", { name: "Continuar pedido" }).click();
  await page.getByLabel("Nombre y apellido").fill("Cliente Navegador");
  await page.getByLabel("WhatsApp de contacto").fill("263 466-7788");
  await page.getByLabel("Dirección completa").fill("Calle de pruebas 456");
  await page.getByLabel("Localidad de entrega").selectOption("junin");
  await expect(
    page.getByLabel("Forma de pago").locator('option[value="cuenta"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Usar mi ubicación actual" }).click();
  await expect(page.locator(".delivery-point-status")).toContainText(
    "Punto marcado",
    { timeout: 10000 },
  );
  await expect(page.locator(".location-picker .map-pin-dest")).toHaveCount(
    1,
    "pin arrastrable en el mapa del checkout",
  );
  await page.getByLabel("Indicaciones para el reparto").fill("Timbre azul");
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page).toHaveURL(/\/seguimiento\?pedido=PC-/);
  const orderId = new URL(page.url()).searchParams.get("pedido");
  await expect(page.locator(".tracking-title")).toContainText(
    "Pedido recibido",
  );
  await expect(page.locator(".order-detail")).toContainText("Ciudad de Junín");
  await expect(page.locator(".order-detail")).toContainText("Timbre azul");
  await expect(page.locator(".live-indicator")).toContainText("en vivo", {
    ignoreCase: true,
    timeout: 8000,
  });
  await expect(page.locator(".map-pin-origin")).toHaveCount(1);
  await expect(page.locator(".live-map-wrap .map-pin-dest")).toHaveCount(
    1,
    "el destino marcado por el cliente aparece en el mapa",
  );

  await expect(page.locator(".sidebar .profile")).toContainText(
    "Cliente Navegador",
  );
  await page.screenshot({
    path: "test-results/cliente-seguimiento.png",
    fullPage: true,
  });
  step(
    "Navegador cliente: catálogo, filtros, carrito persistente, checkout y seguimiento.",
  );

  // Administración en otra pestaña: preparar, asignar y ver la novedad llegar al cliente por SSE.
  const ops = await newPage();
  await ops.context().grantPermissions(["notifications"]);
  await ops.goto(base + "/operacion");
  await expect(ops, "anónimo en /operacion → ingreso del equipo").toHaveURL(
    /[\/]admin/,
  );
  await expect(ops.locator(".staff-login")).toBeVisible();
  await expect(ops.locator(".sidebar")).toHaveCount(
    0,
    "el ingreso del equipo no muestra la interfaz de clientes",
  );
  await ops.getByLabel(/PIN de administración/).fill("1234");
  await ops
    .locator(".access-form")
    .getByRole("button", { name: "Ingresar" })
    .click();
  await expect(ops).toHaveURL(/\/operacion/);
  const card = ops.locator(".operation-order", { hasText: orderId });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Timbre azul");
  await card.getByRole("button", { name: "Preparar pedido" }).click();
  await expect(card).toContainText("En preparación");
  await card.getByRole("button", { name: "Pesar" }).click();
  await ops.getByLabel("Kilos pesados de Pollo entero").fill("1.9");
  await expect(ops.locator("dialog .checkout-total")).toContainText("19.350");
  await ops
    .locator("dialog")
    .getByRole("button", { name: "Guardar pesaje" })
    .click();
  await expect(card).toContainText("Pesado en balanza");
  await expect(card).toContainText("$ 19.350");
  await expect(
    page.locator(".order-detail"),
    "el cliente ve el peso real",
  ).toContainText("pediste 2 kg", { timeout: 8000 });
  await expect(page.locator(".tracking-title"), "SSE al cliente").toContainText(
    "En preparación",
    { timeout: 8000 },
  );
  await card.getByLabel(/Repartidor/).selectOption("Maxi");
  await expect(
    card.getByRole("button", { name: "Iniciar reparto" }),
  ).toBeEnabled();
  await ops.getByRole("tab", { name: "Clientes" }).click();
  await expect(ops.locator("table.customers")).toContainText(
    "Cliente Navegador",
  );
  await ops.screenshot({
    path: "test-results/operacion-clientes.png",
    fullPage: true,
  });
  await expect(
    ops.locator(".push-chip.on"),
    "avisos push registrados para administración",
  ).toBeVisible({ timeout: 8000 });
  await ops.getByRole("tab", { name: "Reparto y rendición" }).click();
  await expect(ops.locator(".sheet")).toContainText("Saldo a rendir");
  await ops.locator(".route-controls select").selectOption("Maxi");
  await expect(ops.locator(".sheet")).toContainText("Maxi");
  await ops.screenshot({
    path: "test-results/operacion-reparto.png",
    fullPage: true,
  });
  await ops.goto(base + "/imprimir?tipo=ruta&repartidor=Maxi");
  await expect(ops.locator(".sheet")).toContainText("HOJA DE RUTA Y RENDICIÓN");
  await ops.goto(base + "/imprimir?tipo=pedidos");
  await expect(ops.locator(".sheet")).toContainText("HOJA DE PEDIDOS");
  await expect(ops.locator(".sheet")).toContainText("Cliente Navegador");
  await ops.emulateMedia({ media: "print" });
  await expect(ops.locator(".sidebar")).toBeHidden();
  await ops.screenshot({
    path: "test-results/impresion-pedidos.png",
    fullPage: true,
  });
  await ops.emulateMedia({ media: "screen" });
  await ops.goto(base + "/operacion");
  await ops.getByRole("tab", { name: "Pedidos" }).click();
  await ops.screenshot({ path: "test-results/operacion.png", fullPage: true });
  step(
    "Navegador administración: acceso con PIN, tablero, preparación, asignación y clientes.",
  );

  // Repartidor en móvil: ve solo lo suyo, sale a entregar, comparte GPS (simulado), cobra y entrega.
  const driver = await newPage({ width: 390, height: 844 });
  await driver.context().grantPermissions(["geolocation"]);
  await driver
    .context()
    .setGeolocation({ latitude: -33.0785, longitude: -68.476 });
  await driver.goto(base + "/acceso");
  await driver.getByLabel("¿Quién sos?").selectOption("Maxi");
  await driver.getByLabel(/PIN personal/).fill("1234");
  await driver
    .locator(".access-form")
    .getByRole("button", { name: "Ingresar" })
    .click();
  await expect(driver).toHaveURL(/[\/]reparto/);
  const dcard = driver.locator(".operation-order", { hasText: orderId });
  await expect(dcard).toBeVisible();
  await expect(
    driver.locator("[aria-labelledby=para-salir] .operation-order"),
  ).toHaveCount(1, "solo lo asignado a Maxi");
  await expect(
    driver.getByRole("link", { name: "Ruta completa en Google Maps" }),
  ).toHaveAttribute("href", /google\.com\/maps\/dir/);
  await expect(
    driver.locator(".operation-order", { hasText: "Almacén de prueba" }),
  ).toHaveCount(0, "lo de Franco no se ve");
  await dcard.getByRole("button", { name: "Iniciar reparto" }).click();
  await expect(dcard).toContainText("En camino");
  await dcard.getByRole("button", { name: "Compartir mi GPS" }).click();
  await expect(dcard).toContainText("Compartiendo GPS", { timeout: 8000 });
  await expect(
    page.locator(".map-pin-driver"),
    "el cliente ve al repartidor",
  ).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator(".eta-banner")).toContainText("Maxi salió");
  await expect(page.locator(".map-caption")).toContainText("Llega aprox.");
  await driver.screenshot({
    path: "test-results/reparto-movil.png",
    fullPage: true,
  });
  await dcard.getByRole("button", { name: "Completar entrega" }).click();
  await expect(driver.locator("dialog")).toContainText(
    "Falta registrar el cobro",
  );
  await driver
    .locator("dialog")
    .getByRole("button", { name: "Confirmar" })
    .click();
  await expect(driver.locator("dialog .form-error")).toContainText("cobro");
  await driver.locator("dialog .modal-close").click();
  await dcard.getByRole("button", { name: "Registrar cobro" }).click();
  await driver
    .locator("dialog")
    .getByRole("button", { name: "Ya recibí el pago" })
    .click();
  await expect(dcard).toContainText("Cobrado");
  await dcard.getByRole("button", { name: "Completar entrega" }).click();
  await driver
    .locator("dialog")
    .getByRole("button", { name: "Confirmar" })
    .click();
  await expect(dcard).toContainText("Entregado");
  await expect(page.locator(".tracking-title")).toContainText("Entregado", {
    timeout: 8000,
  });
  await expect(
    page.getByRole("button", { name: "Repetir este pedido" }),
  ).toBeVisible();
  step(
    "Navegador repartidor (móvil): acceso, entregas propias, GPS compartido visible para el cliente, cobro y entrega.",
  );

  // Separación por rol: cada uno solo llega a sus pantallas.
  await ops.goto(base + "/");
  await expect(ops, "admin en el catálogo público → Operación").toHaveURL(
    /[\/]operacion$/,
  );
  await ops.goto(base + "/seguimiento");
  await expect(ops, "admin no ve el seguimiento del cliente").toHaveURL(
    /[\/]operacion$/,
  );
  await expect(ops.locator(".staff-bar")).toBeVisible();
  await expect(ops.locator(".sidebar")).toHaveCount(0);
  await driver.goto(base + "/operacion");
  await expect(driver, "repartidor no entra a Operación").toHaveURL(
    /[\/]reparto$/,
  );
  await driver.goto(base + "/");
  await expect(driver, "repartidor no ve el catálogo").toHaveURL(
    /[\/]reparto$/,
  );
  await page.goto(base + "/operacion");
  await expect(page, "cliente no entra a Operación").toHaveURL(base + "/");
  await expect(page.locator("text=Soy de Pollito Casero")).toHaveCount(
    0,
    "sin enlaces al panel en la app del cliente",
  );
  await expect(page.locator('a[href="/admin"], a[href="/acceso"]')).toHaveCount(
    0,
  );
  await page.goto(base + "/reparto");
  await expect(page).toHaveURL(base + "/");
  step(
    "Separación por rol: administración, repartidor y cliente no acceden a las pantallas de los otros.",
  );

  // Chat interno administración ↔ repartidor.
  await ops.goto(base + "/operacion");
  await ops.getByRole("button", { name: "Chat interno" }).click();
  await ops.getByRole("tab", { name: /Maxi/ }).click();
  await ops
    .getByLabel("Mensaje")
    .fill("Maxi, ¿llegás bien al pedido " + orderId + "?");
  await ops.getByRole("button", { name: "Enviar" }).click();
  await expect(ops.locator(".chat-msg.mine")).toContainText("llegás bien");
  await driver.goto(base + "/reparto");
  await expect(
    driver.locator(".chat-fab.has-unread"),
    "el repartidor ve el mensaje sin leer",
  ).toBeVisible({ timeout: 8000 });
  await driver.getByRole("button", { name: "Chat interno" }).click();
  await expect(driver.locator(".chat-msg")).toContainText("llegás bien");
  await driver.getByLabel("Mensaje").fill("Sí, en 5 minutos estoy.");
  await driver.getByRole("button", { name: "Enviar" }).click();
  await expect(
    ops.locator(".chat-msg").last(),
    "administración recibe la respuesta en vivo",
  ).toContainText("5 minutos", { timeout: 8000 });
  step("Chat interno en tiempo real entre administración y repartidor.");

  // Cliente: historial, repetir, cuenta, cancelación y sesión en otro dispositivo.
  await page.goto(base + "/pedidos");
  await expect(page.locator(".order-row")).toHaveCount(1);
  await page.getByRole("button", { name: /Repetir pedido/ }).click();
  await expect(page.locator("#carrito")).toContainText("2 kg");
  await page.reload();
  await expect(page.locator("#carrito")).toContainText("2 kg");
  await page.getByRole("button", { name: "Continuar pedido" }).click();
  await expect(page.getByLabel("Nombre y apellido")).toHaveValue(
    "Cliente Navegador",
  );
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page).toHaveURL(/\/seguimiento\?pedido=PC-/);
  await page.getByRole("button", { name: "Cancelar este pedido" }).click();
  await page
    .locator("dialog")
    .getByRole("button", { name: "Sí, cancelar" })
    .click();
  await expect(page.locator(".tracking-title")).toContainText("Cancelado");
  await page.goto(base + "/cuenta");
  await expect(page.locator(".profile-card")).toContainText(
    "Cliente Navegador",
  );
  const other = await newPage();
  await other.goto(base + "/pedidos");
  await expect(other, "anónimo en /pedidos → página de ingreso").toHaveURL(
    /[\/]ingresar[?]volver=%2Fpedidos/,
  );
  await other.getByLabel("Nombre y apellido").fill("Cliente Navegador");
  await other.getByLabel("WhatsApp").fill("+54 9 263 466 7788");
  await other.getByRole("button", { name: "Continuar con mi celular" }).click();
  await expect(other).toHaveURL(/[\/]pedidos$/);
  await expect(other.locator(".order-row")).toHaveCount(
    2,
    "mismo teléfono, mismos pedidos",
  );
  step(
    "Navegador cliente: historial, repetición, cancelación y recuperación de pedidos desde otro dispositivo.",
  );

  // Responsive y móvil: barra de carrito fija, sin desbordamiento horizontal.
  const mobile = await newPage({ width: 390, height: 844 });
  await mobile.goto(base);
  await mobile
    .getByRole("button", { name: "Agregar", exact: true })
    .first()
    .click();
  await expect(mobile.locator(".mobile-cart-bar")).toBeVisible();
  await mobile.locator(".mobile-cart-bar button").click();
  await expect(mobile.locator("dialog.sheet")).toContainText("Total estimado");
  await mobile.locator("dialog .modal-close").click();
  await mobile.screenshot({
    path: "test-results/cliente-movil.png",
    fullPage: false,
  });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await mobile.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/planes", "/seguimiento", "/ayuda"]) {
      await mobile.goto(base + path);
      await mobile.waitForLoadState("networkidle");
      assert.equal(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `desborde en ${width}px ${path}`,
      );
    }
  }
  step(
    "Responsive: 320–1440 px sin desbordamiento; barra de carrito y hoja inferior en móvil.",
  );

  // Offline: el catálogo cargado sigue; el pedido se bloquea.
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base);
  await mobile.waitForLoadState("networkidle");
  await mobile
    .waitForFunction(
      () =>
        navigator.serviceWorker.controller || !("serviceWorker" in navigator),
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  await mobile.context().setOffline(true);
  await mobile.reload().catch(() => {});
  await expect(mobile.locator(".product").first()).toBeVisible({
    timeout: 8000,
  });
  // Sin red: aviso de "sin conexión" (navigator.onLine=false) o de servidor inalcanzable (emulación de Playwright).
  await expect(
    mobile.locator(".notice.offline, .notice.error").first(),
  ).toBeVisible({ timeout: 8000 });
  await mobile.context().setOffline(false);
  step("PWA: catálogo disponible sin conexión y pedido bloqueado.");

  assert.deepEqual(errors, [], "sin errores de JavaScript en las páginas");
  console.log("\nVerificación completa: correcta.");
} catch (e) {
  console.error("\nVerificación fallida:", e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
