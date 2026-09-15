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
    ADMIN_PASSWORD: "clave-de-prueba-1",
    LOGIN_LIMIT: "100",
    TRANSFER_ALIAS: "pollito.casero.mp",
    TRANSFER_HOLDER: "El Pollito Casero",
    APP_MODE: "completo", // la E2E cubre el portal de clientes y el módulo del equipo
    DEMO: "1", // códigos y enlaces de prueba visibles
  },
  stdio: "pipe",
  windowsHide: true,
});
server.stderr.on("data", (d) => process.stderr.write(d));
const base = "http://localhost:5181";
let browser;
const step = (name) => console.log("· " + name);

// Cliente HTTP mínimo con cookies por "usuario".
let lastAdminCookie = "";
const adminCookie = () => lastAdminCookie;
function client() {
  let cookie = "";
  return async (path, data, method = data ? "POST" : "GET", headers = {}) => {
    if (path === "__cookie") return cookie;
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
    if (path === "/session/staff" && data?.username === "admin" && r.ok)
      lastAdminCookie = cookie;
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
  /** Verifica un celular con el código de demostración y devuelve la sesión. */
  const verifyPhone = async (c, phone, name) => {
    const sent = await c("/auth/phone", { phone, name });
    assert.equal(sent.status, 200, "código solicitado");
    assert.ok(
      sent.data.demoCode,
      "en demo el código se devuelve para probarlo",
    );
    assert.equal(
      (await c("/auth/phone/verify", { phone, code: "000000" })).status,
      sent.data.demoCode === "000000" ? 200 : 401,
      "código incorrecto rechazado",
    );
    const ok = await c("/auth/phone/verify", {
      phone,
      code: sent.data.demoCode,
    });
    assert.equal(ok.status, 200, "código correcto");
    assert.equal(ok.data.verified, true);
    return ok.data;
  };
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
  assert.equal(created.data.total, 55000, "precio calculado por el servidor");
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
  assert.equal(
    (await ana("/session")).data.verified,
    false,
    "el teléfono del pedido todavía no está verificado",
  );
  assert.equal(
    (await ana("/orders")).data.length,
    1,
    "sin verificar ve el pedido que creó en esta sesión",
  );
  assert.equal(
    (await ana("/me")).data.summary.pendingOrders,
    0,
    "sin verificar no ve la cuenta corriente del teléfono",
  );
  assert.equal(
    (await anon("/orders", sample)).status,
    409,
    "otra sesión con la misma clave de idempotencia no recibe el pedido",
  );
  const impostor = client();
  assert.equal(
    (await impostor("/session", { name: "X", phone: "263 500-0000" })).status,
    410,
    "ya no se entra solo con el número",
  );
  assert.equal(
    (
      await impostor("/orders", {
        ...sample,
        key: "impostor-1",
        name: "Otro nombre",
        address: "Otra dirección 999",
      })
    ).status,
    201,
  );
  assert.equal(
    (await impostor("/orders")).data.length,
    1,
    "un teléfono conocido no da acceso al historial ajeno",
  );
  const impostorId = (await impostor("/orders")).data[0].id;
  assert.equal(
    (await impostor("/orders/" + impostorId, { cancel: true }, "PATCH")).data
      .status,
    "cancelado",
    "la sesión que creó el pedido puede cancelarlo",
  );
  assert.equal(
    (
      await admin("/session/staff", {
        username: "admin",
        password: "clave-de-prueba-1",
      })
    ).status,
    200,
  );
  const almacenFicha = (await admin("/customers")).data.find(
    (c) => c.phone === "5492635000000",
  );
  assert.equal(
    almacenFicha.address,
    "Belgrano 1200",
    "un pedido sin verificar no pisa la ficha del cliente",
  );
  assert.equal(almacenFicha.name, "Almacén de prueba");
  await verifyPhone(ana, "263 500-0000", "Almacén de prueba");
  assert.equal(
    (await ana("/orders")).data.length,
    2,
    "verificado ve todos los pedidos del teléfono",
  );
  assert.equal((await ana("/orders")).data.length, 2);
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
  assert.equal(
    (
      await admin("/session/staff", {
        username: "admin",
        password: "incorrecta",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await admin("/session/staff", {
        username: "admin",
        password: "clave-de-prueba-1",
      })
    ).data.role,
    "admin",
  );
  assert.equal(
    (
      await franco("/session/staff", {
        username: "franco",
        password: "clave-de-prueba-1",
      })
    ).data.driver,
    "Franco",
  );
  assert.equal(
    (await franco("/orders")).data.length,
    0,
    "el repartidor no ve pedidos sin asignar",
  );
  assert.equal(
    (await admin("/orders")).data.filter((o) => o.status !== "cancelado")
      .length,
    1,
  );
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
  assert.equal(me.summary.balance, 55000, "saldo a cuenta");
  assert.equal(me.summary.boxes, 1, "envases pendientes");
  assert.equal(
    (await admin("/orders/" + id, { paid: true }, "PATCH")).status,
    400,
    "un pedido a cuenta no se marca pagado a mano: se registra el pago",
  );
  assert.equal(
    (
      await admin("/customers/5492635000000/payments", {
        amount: 55000,
        method: "efectivo",
      })
    ).status,
    201,
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
  assert.equal(retail.data.total, 66500);
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
  assert.equal(w.data.total, 55000 + 23380);
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
    Math.round((9.52 * 5500 + 2.1 * 11690) * 100) / 100,
    "total recalculado con peso real",
  );
  assert.ok(
    weighed.weighed && weighed.weighedBy,
    "queda registrado quién pesó",
  );
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
    amount: owedBefore + 8000,
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
    8000,
    "sobrante como saldo a favor",
  );
  assert.equal(pay.data.customer.summary.balance, -8000);
  assert.ok(pay.data.payment.applied.length >= 2, "aplicado a varios pedidos");
  const small = await ana("/orders", {
    ...sample,
    key: "credit-use",
    items: [{ id: "rancho", kg: 10 }],
  });
  assert.equal(small.status, 201, JSON.stringify(small.data));
  assert.equal(small.data.total, 7500);
  assert.equal(
    small.data.paid,
    true,
    "pedido chico a cuenta pagado con saldo a favor",
  );
  assert.equal(small.data.paidBy, "saldo a favor");
  assert.equal((await ana("/me")).data.creditBalance, 500);
  // Pesar un pedido a cuenta ya saldado: la diferencia se descuenta del saldo a favor, no se pierde.
  const reweigh = await admin(
    "/orders/" + small.data.id,
    { weights: { rancho: 10.5 } },
    "PATCH",
  );
  assert.equal(reweigh.status, 200);
  assert.equal(reweigh.data.total, 7875);
  assert.equal(reweigh.data.paid, true);
  assert.equal(
    (await ana("/me")).data.creditBalance,
    125,
    "la diferencia de peso de un pedido pagado ajusta el saldo",
  );
  // Cancelar un pedido pagado con saldo a favor lo repone, una sola vez.
  assert.equal(
    (await ana("/orders/" + small.data.id, { cancel: true }, "PATCH")).data
      .status,
    "cancelado",
  );
  assert.equal(
    (await ana("/me")).data.creditBalance,
    8000,
    "al cancelar vuelve lo pagado",
  );
  assert.equal(
    (await ana("/orders/" + small.data.id, { cancel: true }, "PATCH")).status,
    400,
    "no se repone dos veces",
  );
  // Mínimo de kilos por modalidad y modalidad ligada a la ficha del cliente.
  assert.equal(
    (
      await ana("/orders", {
        ...sample,
        key: "chico-mayorista",
        items: [{ id: "entero", kg: 2 }],
      })
    ).status,
    400,
    "mayorista con menos de 10 kg se rechaza",
  );
  assert.equal(
    (
      await ana("/orders", {
        ...sample,
        key: "cambio-plan",
        plan: "minorista",
        payment: "entrega",
        items: [{ id: "entero", kg: 2 }],
      })
    ).status,
    201,
    "bajar de modalidad (precio más alto) siempre se permite",
  );
  assert.equal(
    (
      await admin("/orders", {
        ...sample,
        key: "admin-chico",
        phone: "263 455-1234",
        name: "Ana Prueba",
        plan: "mayorista",
        payment: "entrega",
        items: [{ id: "entero", kg: 3 }],
      })
    ).status,
    201,
    "administración carga pedidos chicos con cualquier modalidad",
  );
  // Dos cambios simultáneos sobre el mismo pedido no se pisan.
  const race = await ana("/orders", {
    ...sample,
    key: "race-1",
    payment: "entrega",
    items: [{ id: "entero", kg: 10 }],
  });
  assert.equal(race.status, 201);
  const [r1, r2] = await Promise.all([
    admin("/orders/" + race.data.id, { status: "preparando" }, "PATCH"),
    admin(
      "/orders/" + race.data.id,
      { paid: true, paidMethod: "transferencia" },
      "PATCH",
    ),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const raced = (await admin("/orders")).data.find(
    (o) => o.id === race.data.id,
  );
  assert.equal(raced.status, "preparando", "se conservó el cambio de estado");
  assert.equal(raced.paid, true, "y también el cobro");
  assert.equal(
    raced.history.filter((h) => h.status === "preparando").length,
    1,
    "sin historial duplicado",
  );
  // El recorrido GPS sigue creciendo pasados los 200 puntos (ventana deslizante).
  await admin("/orders/" + race.data.id, { driver: "Franco" }, "PATCH");
  await admin("/orders/" + race.data.id, { status: "en_camino" }, "PATCH");
  for (let i = 0; i < 205; i++)
    await franco(
      "/orders/" + race.data.id,
      { location: { lat: -33.07 - i * 0.0001, lng: -68.49 } },
      "PATCH",
    );
  const tracked = (await franco("/orders")).data.find(
    (o) => o.id === race.data.id,
  );
  assert.equal(tracked.track.length, 200, "se conservan los últimos 200");
  assert.equal(
    tracked.track.at(-1)[0],
    tracked.location.lat,
    "el último punto del recorrido es la última ubicación",
  );
  const maxi = client();
  await maxi("/session/staff", {
    username: "maxi",
    password: "clave-de-prueba-1",
  });
  const temp = (
    await admin("/staff", {
      username: "temporal",
      name: "Temporal",
      role: "admin",
      password: "clave-temporal-1",
    })
  ).data;
  const tempClient = client();
  assert.equal(
    (
      await tempClient("/session/staff", {
        username: "temporal",
        password: "clave-temporal-1",
      })
    ).data.role,
    "admin",
  );
  assert.equal((await tempClient("/staff")).status, 200);
  assert.equal(
    (
      await admin(
        "/staff/" + temp.id,
        { role: "repartidor", driver: "Maxi" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (await tempClient("/session")).data,
    null,
    "degradar a repartidor cierra la sesión de administrador",
  );
  assert.equal(
    (await tempClient("/staff")).status,
    403,
    "la sesión vieja ya no tiene permisos",
  );
  // ---- Módulo de piso: fichas GC, precios propios, pedidos por cajas, pesada con tara ----
  const ficha = await admin("/customers", {
    name: "Almacén La Paz",
    alias: "Chacho",
    zone: "La Paz",
    shift: "tarde",
    truck: "Maxi",
    cuit: "",
  });
  assert.equal(ficha.status, 201, JSON.stringify(ficha.data));
  assert.equal(ficha.data.status, "incompleto", "sin CUIT queda incompleta");
  const key = ficha.data.phone;
  assert.equal(
    (
      await admin(
        "/customers/" + key + "/ficha",
        { cuit: "20123456789" },
        "PATCH",
      )
    ).data.status,
    "ok",
    "con CUIT pasa a completa",
  );
  assert.equal(
    (await franco("/customers/" + key + "/ficha", { cuit: "1" }, "PATCH"))
      .status,
    403,
    "la ficha la edita administración",
  );
  assert.deepEqual(
    (
      await admin(
        "/customers/" + key + "/prices",
        { prices: { entero: 4400, suprema: 9980 } },
        "PUT",
      )
    ).data,
    { entero: 4400, suprema: 9980 },
    "precios propios por producto",
  );
  const team = await admin("/orders", {
    customer: key,
    key: "piso-1",
    deliveryDate: "2030-01-02",
    shift: "tarde",
    items: [
      { id: "entero", boxes: 3 },
      { id: "suprema", kg: 2 },
    ],
  });
  assert.equal(team.status, 201, JSON.stringify(team.data));
  assert.equal(team.data.driver, "Maxi", "camión del cliente preasignado");
  assert.equal(team.data.payment, "cuenta");
  assert.equal(team.data.items[0].boxes, 3);
  assert.equal(team.data.items[0].kg, 0, "las cajas se pesan después");
  assert.equal(team.data.items[1].price, 9980, "precio propio de suprema");
  assert.equal(team.data.total, 2 * 9980);
  assert.equal(
    (
      await admin("/orders", {
        customer: key,
        key: "piso-1",
        deliveryDate: "2030-01-02",
        items: [{ id: "entero", boxes: 9 }],
      })
    ).data.id,
    team.data.id,
    "idempotente por cliente + clave",
  );
  // Pesada: bruto − tara = neto; reintentar con la misma id no duplica.
  const t1 = await maxi("/orders/" + team.data.id + "/crates", {
    id: "cajon-a",
    productId: "entero",
    gross: 21.7,
  });
  assert.equal(t1.status, 201, JSON.stringify(t1.data));
  assert.equal(t1.data.crates[0].net, 20, "resta la tara de 1,7 kg");
  assert.equal(t1.data.items[0].kg, 20);
  assert.equal(
    t1.data.total,
    20 * 4400 + 2 * 9980,
    "el total usa el precio propio del cliente",
  );
  assert.equal(
    (
      await maxi("/orders/" + team.data.id + "/crates", {
        id: "cajon-a",
        productId: "entero",
        gross: 21.7,
      })
    ).status,
    200,
  );
  await maxi("/orders/" + team.data.id + "/crates", {
    id: "cajon-b",
    productId: "entero",
    gross: 19.2,
  });
  const afterTwo = (await admin("/orders")).data.find(
    (o) => o.id === team.data.id,
  );
  assert.equal(
    afterTwo.crates.filter((c) => !c.voided).length,
    2,
    "dos cajones, uno por reintento ignorado",
  );
  assert.equal(afterTwo.items[0].kg, 37.5);
  assert.equal(
    (
      await maxi("/orders/" + team.data.id + "/crates", {
        productId: "entero",
        gross: 1.2,
      })
    ).status,
    400,
    "bruto menor que la tara",
  );
  assert.equal(
    (
      await franco("/orders/" + team.data.id + "/crates", {
        productId: "entero",
        gross: 20,
      })
    ).status,
    403,
    "otro camión no pesa este pedido",
  );
  assert.equal(
    (await maxi("/crates/cajon-b", { reason: "se cayó" }, "DELETE")).data
      .items[0].kg,
    20,
    "anular un cajón descuenta",
  );
  assert.equal(
    (await maxi("/crates/cajon-a/load", {})).data.crates[0].loadedAt !== null,
    true,
    "cajón cargado al camión",
  );
  assert.equal(
    (await maxi("/crates/cajon-a", {}, "DELETE")).status,
    400,
    "cargado no se anula",
  );
  const dia = await admin("/dia?fecha=2030-01-02");
  assert.equal(dia.data.orders.length, 1);
  assert.equal(dia.data.tare, 1.7);
  assert.equal(
    (await admin("/settings", { tare: 1.8 }, "PATCH")).data.tare,
    1.8,
    "tara configurable",
  );
  await admin("/settings", { tare: 1.7 }, "PATCH");
  // Noticias y repartidores.
  assert.equal(
    (await maxi("/news", { text: "Mañana no hay reparto a La Paz" })).status,
    201,
  );
  assert.equal(
    (await admin("/news")).data[0].text,
    "Mañana no hay reparto a La Paz",
  );
  assert.equal((await ana("/news")).status, 403, "las noticias son del equipo");
  assert.equal(
    (await admin("/drivers")).data.some((d) => d.name === "Maxi"),
    true,
  );
  assert.equal(
    (
      await admin(
        "/drivers/Maxi",
        { zones: ["La Paz", "Catitas"], shift: "tarde" },
        "PATCH",
      )
    ).data.zones.length,
    2,
  );
  assert.equal(
    (await maxi("/customers")).data.some((c) => c.phone === key),
    true,
    "el preventista ve los clientes de sus zonas",
  );
  const xlsx = await fetch(base + "/api/export/consolidado?fecha=2030-01-02", {
    headers: { Cookie: adminCookie() },
  });
  assert.equal(xlsx.status, 200);
  assert.match(
    xlsx.headers.get("content-type"),
    /spreadsheetml/,
    "consolidado en Excel",
  );
  assert.ok((await xlsx.arrayBuffer()).byteLength > 2000);
  // Cerrar camión: si faltan cajones por pesar/cargar pide motivo; con motivo sale igual.
  const close1 = await maxi("/dia/cerrar-camion", {
    date: "2030-01-02",
    driver: "Maxi",
  });
  assert.equal(close1.status, 409, JSON.stringify(close1.data));
  assert.equal(close1.data.missing[0].id, team.data.id);
  assert.equal(close1.data.missing[0].expected, 3);
  assert.equal(
    (
      await franco("/dia/cerrar-camion", {
        date: "2030-01-02",
        driver: "Maxi",
        reason: "x",
      })
    ).status,
    403,
    "solo el dueño del camión o administración",
  );
  const close2 = await maxi("/dia/cerrar-camion", {
    date: "2030-01-02",
    driver: "Maxi",
    reason: "salió con 1 cajón, el resto va a la tarde",
  });
  assert.equal(close2.status, 200, JSON.stringify(close2.data));
  assert.deepEqual(close2.data.departed, [team.data.id]);
  const closedOrder = (await admin("/orders")).data.find(
    (o) => o.id === team.data.id,
  );
  assert.equal(closedOrder.status, "en_camino");
  assert.equal(
    closedOrder.loadNote,
    "salió con 1 cajón, el resto va a la tarde",
  );
  assert.equal(
    (await maxi("/dia/cerrar-camion", { date: "2030-01-02", driver: "Maxi" }))
      .status,
    400,
    "ya no queda nada por salir",
  );

  // Listas de precios: el equipo las lee, administración las edita; rigen para pedidos nuevos.
  assert.equal((await ana("/precios/listas")).status, 403);
  assert.equal(
    (await maxi("/precios/listas")).data.products.find((p) => p.id === "entero")
      .wholesale,
    5500,
    "precio base de lista",
  );
  assert.equal(
    (
      await maxi(
        "/precios/listas",
        { lists: { entero: { mayorista: 5600 } } },
        "PUT",
      )
    ).status,
    403,
  );
  const listsRes = await admin(
    "/precios/listas",
    { lists: { entero: { mayorista: 5600, intermedio: 6100 } } },
    "PUT",
  );
  assert.equal(listsRes.status, 200, JSON.stringify(listsRes.data));
  assert.equal(
    listsRes.data.products.find((p) => p.id === "entero").wholesale,
    5600,
  );
  assert.equal(
    (await fetch(base + "/api/config").then((r) => r.json())).products.find(
      (p) => p.id === "entero",
    ).intermediate,
    6100,
    "la configuración pública refleja la lista editada",
  );
  const listOrder = await admin("/orders", {
    customer: "5492635000000",
    key: "lista-1",
    deliveryDate: "2030-01-03",
    items: [{ id: "entero", kg: 10 }],
  });
  assert.equal(listOrder.status, 201, JSON.stringify(listOrder.data));
  assert.equal(
    listOrder.data.total,
    56000,
    "pedido nuevo con la lista editada",
  );
  assert.equal(
    (
      await admin(
        "/precios/listas",
        { lists: { entero: { mayorista: -3 } } },
        "PUT",
      )
    ).status,
    400,
  );
  await admin("/precios/listas", { lists: {} }, "PUT");
  // Precio corregido desde el pedido (administración): recalcula y puede quedar como precio del cliente.
  assert.ok(
    [403, 404].includes(
      (
        await maxi(
          "/orders/" + listOrder.data.id,
          { prices: { entero: 5000 } },
          "PATCH",
        )
      ).status,
    ),
    "el repartidor no cambia precios",
  );
  const repriced = await admin(
    "/orders/" + listOrder.data.id,
    { prices: { entero: 5000 }, savePrices: true },
    "PATCH",
  );
  assert.equal(repriced.status, 200, JSON.stringify(repriced.data));
  assert.equal(repriced.data.total, 50000);
  assert.equal(repriced.data.items[0].ownPrice, true);
  assert.equal(
    (await admin("/customers/5492635000000/prices")).data.entero,
    5000,
    "quedó como precio propio",
  );
  // Borrar pedido: solo administración; desaparece con sus cajones y queda en auditoría.
  assert.equal(
    (await maxi("/orders/" + listOrder.data.id, {}, "DELETE")).status,
    403,
  );
  assert.equal(
    (
      await admin(
        "/orders/" + listOrder.data.id,
        { reason: "cargado dos veces" },
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await admin("/orders")).data.some((o) => o.id === listOrder.data.id),
    false,
    "el pedido ya no está",
  );
  assert.equal(
    (await admin("/orders/" + listOrder.data.id, {}, "DELETE")).status,
    404,
  );
  await admin(
    "/customers/5492635000000/prices",
    { prices: { entero: null } },
    "PUT",
  );

  // Cierre de caja: solo administración, queda guardado con diferencia y se puede corregir.
  const todayKey = new Date().toLocaleDateString("sv-SE");
  assert.equal((await franco("/closures?date=" + todayKey)).status, 403);
  const closing = await admin("/closures", {
    date: todayKey,
    driver: "Franco",
    expected: 1500,
    received: 1400,
    note: "faltó vuelto",
  });
  assert.equal(closing.status, 201, JSON.stringify(closing.data));
  assert.equal(closing.data.received, 1400);
  assert.equal(closing.data.by, "Mauro");
  assert.equal(
    (await admin("/closures", { ...closing.data, received: 1500 })).data
      .received,
    1500,
    "volver a cerrar corrige el cierre",
  );
  assert.equal(
    (await admin("/closures?date=" + todayKey)).data.filter(
      (c) => c.driver === "Franco",
    ).length,
    1,
    "un cierre por repartidor y día",
  );
  assert.equal(
    (await admin("/closures", { date: "ayer", driver: "Franco" })).status,
    400,
  );
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
    items: [{ id: "alas", kg: 10 }],
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

  // Cuentas de cliente: email + contraseña, enlace mágico, passkeys, y vinculación del WhatsApp en el primer pedido.
  const eva = client();
  assert.equal(
    (
      await eva("/auth/register", {
        name: "Eva Email",
        email: "eva@example.com",
        password: "corta",
      })
    ).status,
    400,
    "contraseña corta",
  );
  const reg = await eva("/auth/register", {
    name: "Eva Email",
    email: "Eva@Example.com",
    password: "secreto-eva-1",
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.account, true);
  assert.equal(reg.data.phone, null, "todavía sin WhatsApp");
  assert.deepEqual(
    (await eva("/orders")).data,
    [],
    "sin teléfono no hay pedidos",
  );
  assert.equal(
    (
      await eva("/auth/register", {
        name: "Eva",
        email: "eva@example.com",
        password: "otra-clave-9",
      })
    ).status,
    409,
    "email repetido",
  );
  const evaOrder = await eva("/orders", {
    ...sample,
    key: "eva-1",
    plan: "minorista",
    payment: "entrega",
    name: "Eva Email",
    phone: "263 477-8899",
    items: [{ id: "alas", kg: 1 }],
  });
  assert.equal(evaOrder.status, 201);
  assert.equal(
    (await eva("/session")).data.phone,
    null,
    "el WhatsApp del pedido no se asocia a la cuenta sin verificarlo",
  );
  assert.equal(
    (await eva("/orders")).data.length,
    1,
    "la cuenta ve el pedido que creó",
  );
  const mallory = client();
  assert.equal(
    (
      await mallory("/auth/register", {
        name: "Mallory",
        email: "mallory@example.com",
        password: "clave-mallory-1",
      })
    ).status,
    201,
  );
  const claim = await mallory(
    "/me",
    { name: "Mallory", phone: "263 477-8899" },
    "PATCH",
  );
  assert.equal(claim.data.phone, null, "no se vincula un teléfono sin código");
  assert.deepEqual(
    (await mallory("/orders")).data,
    [],
    "declarar un teléfono ajeno no trae su historial",
  );
  assert.equal(
    (await mallory("/auth/passkey/register/options", {})).status,
    200,
    "la cuenta autenticada sí puede registrar una llave",
  );
  await verifyPhone(eva, "263 477-8899");
  assert.equal(
    (await eva("/session")).data.phone,
    "5492634778899",
    "verificado el código, la cuenta queda asociada al WhatsApp",
  );
  assert.match(
    (
      await eva("/orders", {
        ...sample,
        key: "eva-sube",
        plan: "mayorista",
        payment: "entrega",
        name: "Eva Email",
        phone: "263 477-8899",
        items: [{ id: "entero", kg: 10 }],
      })
    ).data.error || "",
    /Tu modalidad es minorista/,
    "subir de modalidad requiere que administración cambie la ficha",
  );
  const eva2 = client();
  assert.equal(
    (await eva2("/auth/login", { email: "eva@example.com", password: "mala" }))
      .status,
    401,
  );
  assert.equal(
    (
      await eva2("/auth/login", {
        email: "eva@example.com",
        password: "secreto-eva-1",
      })
    ).data.phone,
    "5492634778899",
  );
  assert.equal(
    (await eva2("/orders")).data.length,
    1,
    "desde otro dispositivo ve su pedido",
  );
  assert.equal((await eva2("/session")).data.verified, true);
  assert.equal((await eva2("/me")).data.account.email, "eva@example.com");
  const magic = await anon("/auth/magic", {
    email: "link@example.com",
    name: "Link",
  });
  assert.equal(magic.status, 200);
  assert.ok(magic.data.demoLink, "en demo el enlace se devuelve para probarlo");
  // Abrir el enlace (como haría un escáner de correo) no consume el token: solo lleva a confirmar.
  const magicRes = await fetch(magic.data.demoLink, { redirect: "manual" });
  assert.equal(magicRes.status, 302);
  assert.match(magicRes.headers.get("location"), /[\/]ingresar[?]enlace=/);
  assert.equal(
    magicRes.headers.get("set-cookie"),
    null,
    "el GET no abre sesión",
  );
  const magicToken = new URL(
    magicRes.headers.get("location"),
    base,
  ).searchParams.get("enlace");
  const magicConsume = await fetch(base + "/api/auth/magic/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: magicToken }),
  });
  assert.equal(magicConsume.status, 200, "confirmar el enlace abre sesión");
  const magicCookie = magicConsume.headers.get("set-cookie").split(";")[0];
  const magicSession = await (
    await fetch(base + "/api/session", { headers: { Cookie: magicCookie } })
  ).json();
  assert.equal(magicSession.role, "cliente");
  assert.equal(magicSession.account, true);
  assert.match(
    (await fetch(magic.data.demoLink, { redirect: "manual" })).headers.get(
      "location",
    ),
    /vencido/,
    "el enlace es de un solo uso",
  );
  assert.equal(
    (
      await fetch(base + "/api/auth/magic/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: magicToken }),
      })
    ).status,
    400,
    "confirmarlo dos veces no abre otra sesión",
  );
  assert.equal(
    (
      await anon("/auth/register", {
        name: "Ladrón",
        email: "link@example.com",
        password: "clave-robada-1",
      })
    ).status,
    409,
    "registrarse con el email de una cuenta sin contraseña no la toma",
  );
  const linkPw = await fetch(base + "/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: magicCookie },
    body: JSON.stringify({ password: "clave-de-link-1" }),
  });
  assert.equal(linkPw.status, 200, "con sesión se puede crear la contraseña");
  assert.equal(
    (
      await anon("/auth/login", {
        email: "link@example.com",
        password: "clave-de-link-1",
      })
    ).status,
    200,
  );
  const pk = await eva2("/auth/passkey/register/options", {});
  assert.equal(pk.status, 200);
  assert.equal(pk.data.options.rp.id, "localhost");
  assert.ok(pk.data.token);
  assert.equal(
    (await client()("/auth/passkey/register/options", {})).status,
    401,
    "passkey solo con cuenta",
  );
  assert.equal((await client()("/auth/passkey/login/options", {})).status, 200);
  assert.equal(
    (await anon("/auth/google", { credential: "x".repeat(30) })).status,
    400,
    "Google sin configurar",
  );

  // Usuarios del equipo: solo administración los gestiona; un usuario desactivado pierde el acceso.
  assert.equal((await franco("/staff")).status, 403);
  const staffList = (await admin("/staff")).data;
  assert.equal(
    staffList.filter((u) => u.username !== "temporal").length,
    1 + (await admin("/drivers")).data.length,
    "admin y un usuario por repartidor creados al inicio",
  );
  const newUser = await admin("/staff", {
    username: "lucas",
    name: "Lucas Prueba",
    role: "repartidor",
    driver: "Maxi",
    password: "clave-lucas-1",
  });
  assert.equal(newUser.status, 201);
  const lucas = client();
  assert.equal(
    (
      await lucas("/session/staff", {
        username: "LUCAS",
        password: "clave-lucas-1",
      })
    ).data.driver,
    "Maxi",
  );
  const deact = await admin(
    "/staff/" + newUser.data.id,
    { active: false },
    "PATCH",
  );
  assert.equal(deact.status, 200, JSON.stringify(deact.data));
  assert.equal(deact.data.active, false);
  assert.equal(
    (await lucas("/session")).data,
    null,
    "sesión cerrada al desactivar",
  );
  assert.equal(
    (
      await client()("/session/staff", {
        username: "lucas",
        password: "clave-lucas-1",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await admin(
        "/staff/" + staffList.find((u) => u.username === "admin").id,
        { active: false },
        "PATCH",
      )
    ).status,
    400,
    "no se desactiva a sí mismo",
  );
  assert.equal((await anon("/geo/search?q=Pergamino")).status, 200);

  // SSE: el cliente recibe la novedad cuando administración cambia el estado.
  const sseCode = await (
    await fetch(base + "/api/auth/phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "263 500-0000" }),
    })
  ).json();
  const sseCookie = (
    await fetch(base + "/api/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "263 500-0000", code: sseCode.demoCode }),
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
  ).toContainText("5.500");
  await page.getByRole("button", { name: "Minorista Para tu casa" }).click();
  await expect(
    page.locator(".product").first().locator(".price"),
  ).toContainText("6.500");
  await page.getByLabel("Kilogramos de Pollo entero").fill("1.5");
  await page
    .getByRole("button", { name: "Agregar", exact: true })
    .first()
    .click();
  await expect(page.locator("#carrito .cart-quantity")).toContainText("1,5 kg");
  await page
    .getByRole("button", { name: "Sumar medio kilo de Pollo entero" })
    .click();
  await expect(page.locator("#carrito .total")).toContainText("14.500");
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
  await expect(page.locator("#carrito .total")).toContainText("28.320");
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
  await ops.getByLabel("Usuario").fill("admin");
  await ops.getByLabel("Contraseña").fill("clave-de-prueba-1");
  await ops
    .locator(".access-form")
    .getByRole("button", { name: "Ingresar" })
    .click();
  await expect(ops).toHaveURL(/\/operacion\/dia/);
  await expect(ops.locator(".day-sheet h1")).toContainText("Reparto del");
  // Noticias del equipo desde la nota del día.
  await expect(ops.locator(".news-list")).toContainText(
    "Mañana no hay reparto a La Paz",
    { timeout: 8000 },
  );
  await ops.getByLabel("Nueva noticia").fill("Hoy sale primero La Paz");
  await ops.getByRole("button", { name: "Publicar" }).click();
  await expect(ops.locator(".news-list")).toContainText(
    "Hoy sale primero La Paz",
    { timeout: 8000 },
  );
  await ops.screenshot({
    path: "test-results/nota-del-dia.png",
    fullPage: true,
  });
  await ops
    .locator(".staff-bar nav")
    .getByRole("link", { name: /^Pedidos/ })
    .click();
  await expect(ops).toHaveURL(/\/operacion$/);
  const card = ops.locator(".operation-order", { hasText: orderId });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Timbre azul");
  await card.getByRole("button", { name: "Preparar pedido" }).click();
  await expect(card).toContainText("En preparación");
  // Precio corregido desde el pedido: recalcula el total y queda como precio propio del cliente.
  await card.getByRole("button", { name: "Precios" }).click();
  await ops.getByLabel("Precio por kilo de Pollo entero").fill("6000");
  await expect(ops.locator("dialog .weights-total")).toContainText("27.320");
  await ops
    .locator("dialog")
    .getByRole("button", { name: "Aplicar precios" })
    .click();
  await expect(card).toContainText("$ 27.320", { timeout: 8000 });
  await card.getByRole("button", { name: "Pesar" }).click();
  await ops.getByLabel("Kilos pesados de Pollo entero").fill("1.9");
  await expect(ops.locator("dialog .checkout-total")).toContainText("26.720");
  await ops
    .locator("dialog")
    .getByRole("button", { name: "Guardar pesaje" })
    .click();
  await expect(card).toContainText("Pesado en balanza");
  await expect(card).toContainText("$ 26.720");
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
  // Cargar pedido: pantalla rápida en un solo paso, con cliente buscado y kilos en la tabla.
  await ops.getByLabel("Buscar pedidos").fill("no-existe-nadie");
  await expect(ops.locator(".operation-order")).toHaveCount(0);
  await ops.getByLabel("Buscar pedidos").fill("navegador");
  await expect(ops.locator(".operation-order").first()).toContainText(
    "Cliente Navegador",
  );
  await ops.getByLabel("Buscar pedidos").fill("");
  await ops
    .locator(".staff-bar nav")
    .getByRole("link", { name: "Cargar pedido" })
    .click();
  await expect(ops).toHaveURL(/[\/]operacion[\/]nuevo$/);
  await ops.getByLabel("Buscar cliente por nombre, zona o CUIT").fill("naveg");
  await ops.locator(".qo-search .suggestions button").first().click();
  await expect(ops.locator(".qo-picked-card")).toContainText(
    "Cliente Navegador",
  );
  await ops.getByLabel("Kilos de Pollo entero").fill("3");
  await ops.getByLabel("Cajas de Pollo entero").fill("2");
  await expect(
    ops.getByLabel("Kilos de Pollo entero"),
    "cajas o kilos, no los dos",
  ).toHaveValue("");
  await ops.getByLabel("Kilos de Suprema").fill("1.5");
  await expect(ops.locator(".qo-summary .total dd")).not.toHaveText("$ 0");
  await ops.getByLabel(/Cami/).selectOption("Franco");
  const quickDate = await ops.getByLabel("Fecha de reparto").inputValue();
  await ops.screenshot({
    path: "test-results/operacion-cargar.png",
    fullPage: true,
  });
  await ops.getByRole("button", { name: "Cargar pedido" }).click();
  await ops.waitForTimeout(1500);
  if (!(await ops.locator(".qo-created").count()))
    console.log(
      "Cargar pedido no creó:",
      await ops.locator(".form-error, .toast").allTextContents(),
    );
  await expect(ops.locator(".qo-created")).toContainText(
    "de Cliente Navegador",
    {
      timeout: 8000,
    },
  );
  await expect(ops.locator(".qo-created")).toContainText("· Franco");
  const quickId = (await ops.locator(".qo-created").textContent()).match(
    /PC-[A-Z0-9-]+/,
  )[0];
  await ops.getByRole("button", { name: "Otro pedido" }).click();
  await expect(ops.locator(".qo-created")).toHaveCount(0);
  // Pesada: primero el pedido, después el cajón; la app resta la tara y muestra el neto.
  await ops
    .locator(".staff-bar nav")
    .getByRole("link", { name: "Pesada" })
    .click();
  await expect(ops).toHaveURL(/[\/]operacion[\/]pesada/);
  await ops.getByLabel("Fecha de reparto").fill(quickDate);
  await ops
    .locator(".floor-card", { hasText: "Cliente Navegador" })
    .first()
    .click();
  await expect(ops.locator(".weigh-counter")).toContainText("Cajón 1 de 2");
  await ops.getByLabel("Peso bruto en kilos").fill("21,7");
  await expect(ops.locator(".weigh-net strong")).toHaveText("20,0 kg");
  await ops.getByRole("button", { name: "Confirmar cajón" }).click();
  await expect(ops.locator(".weigh-log li").first()).toContainText("20,0 kg", {
    timeout: 8000,
  });
  await expect(ops.locator(".weigh-counter")).toContainText("Cajón 2 de 2");
  await ops.screenshot({ path: "test-results/pesada.png", fullPage: true });
  // Remito 10 × 15 del pedido.
  await ops.goto(base + "/imprimir?tipo=remito&pedido=" + quickId);
  await expect(ops.locator(".remito")).toHaveCount(1);
  await expect(ops.locator(".remito")).toContainText("REMITO INTERNO");
  await expect(ops.locator(".remito")).toContainText("Cliente Navegador");
  await expect(ops.locator(".remito-table")).toContainText("20,0");
  await ops.screenshot({ path: "test-results/remito.png" });
  await ops.goto(base + "/operacion/nuevo");
  await ops
    .locator(".staff-bar nav")
    .getByRole("link", { name: "Clientes" })
    .click();
  await expect(ops.locator("table.customers")).toContainText(
    "Cliente Navegador",
  );
  await ops
    .locator("table.customers tr", { hasText: "Almacén de prueba" })
    .getByRole("button", { name: "Extracto" })
    .click();
  await expect(ops.locator("dialog .statement")).toBeVisible();
  await expect(ops.locator("dialog .statement")).toContainText("Pago PG-");
  await ops
    .locator("dialog")
    .getByRole("button", { name: "Cerrar ventana" })
    .click();
  // Equipo: editar nombre desde la tabla.
  await ops
    .locator(".staff-bar nav")
    .getByRole("link", { name: "Equipo" })
    .click();
  await ops
    .locator(".team-table")
    .getByRole("button", { name: "Maxi" })
    .click();
  await ops.locator(".edit-user").getByLabel("Nombre").fill("Maxi Reparto");
  await ops.locator(".edit-user button.primary").click();
  await expect(ops.locator(".team-table")).toContainText("Maxi Reparto", {
    timeout: 8000,
  });
  await ops.screenshot({
    path: "test-results/operacion-clientes.png",
    fullPage: true,
  });
  await expect(
    ops.locator(".push-chip.on"),
    "avisos push registrados para administración",
  ).toBeVisible({ timeout: 8000 });
  await ops
    .locator(".staff-bar nav")
    .getByRole("link", { name: "Rendición" })
    .click();
  await expect(ops.locator(".sheet")).toContainText("Efectivo a rendir");
  await expect(ops.locator(".sheet")).toContainText("al inicio del día");
  await ops.locator(".route-controls select").selectOption("Maxi");
  await expect(ops.locator(".sheet")).toContainText("Maxi");
  // Cierre de caja desde la pantalla: efectivo recibido, diferencia y registro de quién cerró.
  await ops.getByLabel("Efectivo recibido de Maxi").fill("0");
  await ops
    .getByRole("button", { name: /Cerrar caja|Corregir cierre/ })
    .click();
  await expect(ops.locator(".closure-state")).toContainText(
    "Cerrada por Mauro",
    {
      timeout: 8000,
    },
  );
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
  await ops
    .locator(".staff-bar nav")
    .getByRole("link", { name: "Pedidos" })
    .click();
  await ops.screenshot({ path: "test-results/operacion.png", fullPage: true });
  step(
    "Navegador administración: acceso con usuario y contraseña, tablero, preparación, asignación y clientes.",
  );

  // Repartidor en móvil: ve solo lo suyo, sale a entregar, comparte GPS (simulado), cobra y entrega.
  const driver = await newPage({ width: 390, height: 844 });
  await driver.context().grantPermissions(["geolocation"]);
  await driver
    .context()
    .setGeolocation({ latitude: -33.0785, longitude: -68.476 });
  await driver.goto(base + "/acceso");
  await driver.getByLabel("Usuario").fill("maxi");
  await driver.getByLabel("Contraseña").fill("clave-de-prueba-1");
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
    /[\/]operacion[\/]dia$/,
  );
  await ops.goto(base + "/seguimiento");
  await expect(ops, "admin no ve el seguimiento del cliente").toHaveURL(
    /[\/]operacion[\/]dia$/,
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
  await expect(page.locator('.topbar a[href="/admin"]')).toHaveCount(
    1,
    "el acceso del equipo se ve en la cabecera sin conocer la URL",
  );
  await expect(page.locator('footer a[href="/admin"]')).toHaveCount(1);
  await expect(page.locator(".staff-bar, .board")).toHaveCount(
    0,
    "sin controles de gestión antes de autenticar",
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

  // Ingreso del cliente con email + contraseña y con enlace de acceso, desde el navegador.
  const mail = await newPage();
  await mail.goto(base + "/ingresar");
  await mail.getByRole("button", { name: "Continuar con email" }).click();
  await mail.getByRole("tab", { name: "Crear cuenta" }).click();
  await mail.getByLabel("Nombre y apellido").fill("Marta Correo");
  await mail.getByLabel("Email").fill("marta@example.com");
  await mail.getByLabel("Contraseña").fill("clave-marta-1");
  await mail.getByRole("button", { name: "Crear mi cuenta" }).click();
  await expect(mail).toHaveURL(/[/]pedidos$/);
  await expect(mail.locator(".sidebar .profile")).toContainText("Marta Correo");
  await mail.locator(".top-avatar").click();
  await expect(mail.locator(".account-box")).toContainText("marta@example.com");
  await mail.locator("dialog .modal-close").click();
  const magicPage = await newPage();
  await magicPage.goto(base + "/ingresar");
  await magicPage.getByRole("button", { name: "Continuar con email" }).click();
  await magicPage.getByRole("tab", { name: "Enlace de acceso" }).click();
  await magicPage.getByLabel("Email").fill("marta@example.com");
  await magicPage.getByRole("button", { name: "Enviarme el enlace" }).click();
  await magicPage
    .getByRole("link", { name: /Abrir el enlace de demostración/ })
    .click();
  await expect(magicPage).toHaveURL(/[/]ingresar[?]enlace=/);
  await magicPage.getByRole("button", { name: "Entrar a mi cuenta" }).click();
  await expect(magicPage).toHaveURL(/[/]pedidos$/);
  await expect(
    magicPage.locator(".sidebar .profile"),
    "el enlace abre la misma cuenta",
  ).toContainText("Marta Correo");
  step(
    "Navegador cliente: cuenta con email y contraseña, y enlace de acceso de un solo uso.",
  );

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
  await expect(
    page.locator("h2", { hasText: "Extracto de cuenta corriente" }),
  ).toBeVisible();
  const other = await newPage();
  await other.goto(base + "/pedidos");
  await expect(other, "anónimo en /pedidos → página de ingreso").toHaveURL(
    /[\/]ingresar[?]volver=%2Fpedidos/,
  );
  await other.getByRole("button", { name: "Continuar con celular" }).click();
  await other.getByLabel("Nombre y apellido").fill("Cliente Navegador");
  await other.getByLabel("WhatsApp").fill("+54 9 263 466 7788");
  await other
    .getByRole("button", { name: "Recibir código por WhatsApp" })
    .click();
  await expect(other.locator(".demo-code")).toBeVisible();
  await other.getByRole("button", { name: "Confirmar código" }).click();
  await expect(other).toHaveURL(/[\/]pedidos$/);
  await expect(other.locator(".order-row")).toHaveCount(
    3,
    "mismo teléfono verificado: sus pedidos y el que cargó administración",
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
