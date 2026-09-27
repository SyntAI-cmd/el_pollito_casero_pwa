/**
 * Banco de pesaje de extremo a extremo (PC-017 / PC-018). Entorno aislado:
 *  - base SQLite en archivo (WAL, como producción) dentro de un directorio temporal,
 *  - datos sintéticos anonimizados ("Cliente N"), sin credenciales ni integraciones,
 *  - servidor real por HTTP, un teléfono (repartidor, red 4G emulada) y una PC (administración).
 *
 * Mientras el teléfono confirma pesadas a ritmo de operador, administración carga pedidos nuevos.
 * Mide por separado: escritura (POST de la pesada), lecturas disparadas, entrega del evento a la
 * PC, bytes por la red, feedback visual en el teléfono y duración de las interacciones.
 * `/api/events` (SSE) queda fuera de los percentiles: es una conexión abierta, no una consulta.
 *
 *   node scripts/bench-pesaje.mjs [salida.json] [--pesadas=20] [--historico=3000] [--clientes=1000]
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEnv } from "./test-env.mjs";

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : def;
};
const out = process.argv.find((a) => a.endsWith(".json")) || "test-results/bench-pesaje.json";
const PESADAS = arg("pesadas", 20);
const HISTORICO = arg("historico", 3000);
const CLIENTES = arg("clientes", 1000);
const HOY_PEDIDOS = arg("hoy", 200);
const port = 5000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const dir = await mkdtemp(join(tmpdir(), "pollito-bench-"));
const env = await testEnv({
  PORT: String(port),
  SITE_URL: base,
  APP_MODE: "equipo",
  DEMO: "",
  DATA_DIR: dir,
  DB_PATH: join(dir, "pollito.sqlite"),
});

// ---- Datos representativos (anonimizados) directo sobre la base del ensayo ----
const today = new Date().toISOString().slice(0, 10);
const dayOffset = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
{
  Object.assign(process.env, { ...env });
  const { openStore } = await import("../server/store.mjs");
  const { createApi, createEvents } = await import("../server/api.mjs");
  const store = await openStore(env.DB_PATH, { log: { info() {}, warn() {}, error() {} } });
  const api = createApi({ store, events: createEvents(), dataDir: dir });
  const session = { role: "admin", staffId: "bench", name: "Ensayo" };
  const call = (method, path, body = {}) =>
    api({ method, path, body, session, query: new URLSearchParams(), ip: "127.0.0.1" });
  for (const name of ["Franco", "Maxi", "Nahuel Castro", "Andrés Reyes"])
    if (!store.drivers.get(name)) store.drivers.save({ name, active: true, zones: [] });
  const drivers = ["Franco", "Maxi", "Nahuel Castro", "Andrés Reyes"];
  for (let i = 0; i < CLIENTES; i++)
    store.customers.save({
      phone: `anon-${i}`,
      name: `Cliente ${i}`,
      alias: `Cliente ${i}`,
      plan: "mayorista",
      credit: true,
      zone: `Zona ${i % 12}`,
      created: new Date().toISOString(),
    });
  const productos = ["entero", "pechuga", "alas", "muslo"];
  let n = 0;
  for (let i = 0; i < HISTORICO; i++, n++)
    await call("POST", "/api/orders", {
      customer: `anon-${(i * 7) % CLIENTES}`,
      key: `hist-${i}`,
      driver: drivers[i % drivers.length],
      deliveryDate: dayOffset(1 + (i % 60)),
      items: [{ id: productos[i % 4], boxes: 5 + (i % 10) }],
      payment: "cuenta",
    });
  const todayIds = [];
  for (let i = 0; i < HOY_PEDIDOS; i++) {
    const r = await call("POST", "/api/orders", {
      customer: `anon-${(i * 13) % CLIENTES}`,
      key: `hoy-${i}`,
      driver: drivers[i % drivers.length],
      deliveryDate: today,
      items: [
        { id: "entero", boxes: 30 },
        { id: productos[1 + (i % 3)], boxes: 4 },
      ],
      payment: "cuenta",
    });
    todayIds.push(r.body.id);
  }
  // Servidor: costo de cada lectura sin red ni navegador (misma base en archivo).
  const measure = async (name, fn, reps = 15) => {
    const ms = [];
    let bytes = 0;
    for (let i = 0; i < reps; i++) {
      const t = performance.now();
      const r = await fn(i);
      ms.push(performance.now() - t);
      bytes = Buffer.byteLength(JSON.stringify(r.body));
    }
    ms.sort((a, b) => a - b);
    return { name, n: reps, p50: +ms[Math.floor(reps / 2)].toFixed(2), max: +ms[reps - 1].toFixed(2), bytes };
  };
  globalThis.__server = [
    await measure("GET /api/orders (todo el histórico)", () => call("GET", "/api/orders")),
    await measure("GET /api/customers (todos, con resumen)", () => call("GET", "/api/customers")),
    await measure(`GET /api/dia?fecha=hoy (${HOY_PEDIDOS} pedidos)`, () =>
      api({ method: "GET", path: "/api/dia", body: {}, session, query: new URLSearchParams({ fecha: today }), ip: "x" }),
    ),
    await measure("GET /api/orders/:id", (i) => call("GET", `/api/orders/${todayIds[i]}`)),
    await measure("POST /api/orders/:id/crates", (i) =>
      call("POST", `/api/orders/${todayIds[(todayIds.length - 1 - i) % todayIds.length]}/crates`, { id: `srv-${i}`, productId: "entero", boxes: 3, gross: 60.3 }),
    ),
  ];
  // Rutas opcionales (existen sólo después de los cambios): se miden si responden.
  const extra = [
    ["GET /api/orders?ids= (1 pedido)", (i) =>
      api({ method: "GET", path: "/api/orders", body: {}, session, query: new URLSearchParams({ ids: todayIds[i] }), ip: "x" })],
    ["GET /api/customers?phones= (1 ficha)", (i) =>
      api({ method: "GET", path: "/api/customers", body: {}, session, query: new URLSearchParams({ phones: `anon-${i}` }), ip: "x" })],
    ["GET /api/dia?fecha=hoy&ids= (1 pedido)", (i) =>
      api({ method: "GET", path: "/api/dia", body: {}, session, query: new URLSearchParams({ fecha: today, ids: todayIds[i] }), ip: "x" })],
  ];
  for (const [name, fn] of extra) {
    try {
      const r = await fn(0);
      if (r && r.status === 200) globalThis.__server.push(await measure(name, fn));
    } catch {}
  }
  globalThis.__todayIds = todayIds;
  store.close();
}

// ---- Servidor real por HTTP ----
const server = spawn(process.execPath, ["server.mjs"], { env, stdio: "pipe", windowsHide: true });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const login = async (username) => {
  const r = await fetch(base + "/api/session/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username, password: env.ADMIN_PASSWORD }),
  });
  if (!r.ok) throw Error(`login ${username}: ${r.status} ${await r.text()}`);
  return r.headers.get("set-cookie").split(";")[0];
};
let browser;
const result = { node: process.version, fecha: new Date().toISOString(), escenario: {}, servidor: globalThis.__server };
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const adminCookie = await login("admin");
  const phoneCookie = await login("franco");
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const cookieFor = (c) => [{ name: c.split("=")[0], value: c.split("=").slice(1).join("="), url: base }];

  const track = (page, label) => {
    const reqs = [];
    page.on("requestfinished", async (req) => {
      const url = new URL(req.url());
      if (!url.pathname.startsWith("/api/") || url.pathname === "/api/events") return;
      // size: bytes por la red (Content-Length, comprimido si corresponde); decoded: JSON a procesar.
      let size = 0;
      let decoded = 0;
      try {
        const res = await req.response();
        decoded = (await res.body()).length;
        size = Number(res?.headers()["content-length"]) || decoded;
      } catch {}
      const t = req.timing();
      reqs.push({ who: label, method: req.method(), path: url.pathname + url.search, at: Date.now(), ms: t.responseEnd, size, decoded });
    });
    return reqs;
  };

  // PC de administración: lista de pedidos (vista por defecto).
  const pcCtx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await pcCtx.addCookies(cookieFor(adminCookie));
  const pc = await pcCtx.newPage();
  const pcReqs = track(pc, "pc");
  const pcSse = [];
  await pc.exposeFunction("__sse", (type, data) => pcSse.push({ type, data, at: Date.now() }));
  await pc.addInitScript(() => {
    const Orig = window.EventSource;
    window.EventSource = function (...a) {
      const es = new Orig(...a);
      for (const t of ["orders", "customer", "orders-batch"])
        es.addEventListener(t, (e) => window.__sse(t, e.data));
      return es;
    };
    window.EventSource.prototype = Orig.prototype;
  });
  await pc.goto(base + "/operacion");
  await pc.waitForLoadState("networkidle").catch(() => {});

  // Teléfono del repartidor: Android de gama media emulado (CPU ×4 más lenta) y 4G regular.
  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await phoneCtx.addCookies(cookieFor(phoneCookie));
  await phoneCtx.addInitScript(() => {
    localStorage.setItem("teclado-pesaje", "app");
    window.__events = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        window.__events.push({ name: e.name, duration: e.duration, start: e.startTime, kind: e.entryType });
    }).observe({ type: "event", durationThreshold: 16, buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__events.push({ name: "longtask", duration: e.duration, start: e.startTime, kind: "longtask" });
    }).observe({ type: "longtask", buffered: true });
  });
  const phone = await phoneCtx.newPage();
  const pageErrors = [];
  phone.on("pageerror", (e) => pageErrors.push(e.message));
  phone.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  phone.on("response", (r) => r.status() >= 400 && pageErrors.push(`${r.status()} ${new URL(r.url()).pathname}`));
  pc.on("pageerror", (e) => pageErrors.push("pc: " + e.message));
  const cdp = await phoneCtx.newCDPSession(phone);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 80,
    downloadThroughput: (4 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const phoneReqs = track(phone, "telefono");

  // Pedido de Franco con 30 cajas de entero: se pesa de a lotes de 1 caja.
  const dia = await (await fetch(`${base}/api/dia?fecha=${today}`, { headers: { Cookie: phoneCookie } })).json();
  const target = dia.orders.find((o) => o.driver === "Franco" && !(o.crates || []).length);
  const loadStart = Date.now();
  await phone.goto(`${base}/reparto/pesada?fecha=${today}&pedido=${target.id}`);
  await phone.waitForSelector(".weigh-confirm", { timeout: 60000 }).catch(async (e) => {
    console.error("Errores de la página:", pageErrors, (await phone.content()).slice(0, 1500));
    throw e;
  });
  result.escenario.aperturaPesajeMs = Date.now() - loadStart;
  await phone.waitForLoadState("networkidle").catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const startCount = { pc: pcReqs.length, telefono: phoneReqs.length };
  const t0 = Date.now();

  // Administración carga un pedido nuevo cada 5 s mientras se pesa (desde la API, como otra PC).
  let adminOrders = 0;
  const adminTimer = setInterval(() => {
    adminOrders++;
    fetch(base + "/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie, Origin: base },
      body: JSON.stringify({
        customer: `anon-${900 + adminOrders}`,
        key: `pc-${adminOrders}-${t0}`,
        driver: "Maxi",
        deliveryDate: today,
        items: [{ id: "entero", boxes: 10 }],
        payment: "cuenta",
      }),
    }).catch(() => {});
  }, 5000);

  const pesadas = [];
  for (let i = 0; i < PESADAS; i++) {
    await phone.locator('.keypad button[aria-label="Limpiar el peso"]').isEnabled().then(async (on) => {
      if (on) await phone.locator('.keypad button[aria-label="Limpiar el peso"]').click();
    });
    // 1 caja: bruto 21,7 → neto 20,00 (tara 1,7).
    await phone.locator(".weigh-boxes input").fill("1");
    for (const k of ["2", "1", ",", "7"])
      await phone.locator(`.keypad button[aria-label="${k === "," ? "coma decimal" : k}"]`).click();
    const before = await phone.locator(".weigh-log li:not(.muted)").count();
    const tap = Date.now();
    await phone.locator(".weigh-confirm").click();
    await phone.waitForFunction((n) => document.querySelectorAll(".weigh-log li:not(.muted)").length > n, before, { timeout: 15000 });
    const feedback = Date.now() - tap;
    // Confirmado por el servidor: la fila deja de figurar como pendiente.
    let confirmado = null;
    try {
      await phone.waitForFunction(() => !document.querySelector(".weigh-log li.pending"), null, { timeout: 30000 });
      confirmado = Date.now() - tap;
    } catch {}
    const sse = pcSse.find((e) => e.at >= tap && e.type.startsWith("orders") && e.data.includes(target.id));
    pesadas.push({ feedback, confirmado, eventoPc: sse ? sse.at - tap : null });
    await new Promise((r) => setTimeout(r, Math.max(0, 4000 - (Date.now() - tap))));
  }
  clearInterval(adminTimer);
  await new Promise((r) => setTimeout(r, 2500));
  const elapsed = (Date.now() - t0) / 1000;

  const windowReqs = (list, from) => list.slice(from);
  const summary = (list) => {
    const by = {};
    for (const r of list) {
      const key = `${r.method} ${r.path.replace(/PC-[0-9A-F]{8}/g, ":id").replace(/fecha=[\d-]+/, "fecha=…").replace(/anon-\d+/, ":phone").replace(/[0-9a-f-]{36}(:\d+)?/g, ":uuid")}`;
      by[key] ??= { n: 0, bytes: 0, ms: [] };
      by[key].n++;
      by[key].bytes += r.size;
      by[key].ms.push(r.ms);
    }
    return Object.fromEntries(
      Object.entries(by)
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .map(([k, v]) => {
          v.ms.sort((a, b) => a - b);
          return [k, { n: v.n, kb: +(v.bytes / 1024).toFixed(1), p50ms: +v.ms[Math.floor(v.ms.length / 2)].toFixed(0), maxMs: +v.ms[v.ms.length - 1].toFixed(0) }];
        }),
    );
  };
  const pct = (arr, p) => {
    const s = arr.filter((x) => x !== null).sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
  };
  const phoneWin = windowReqs(phoneReqs, startCount.telefono);
  const pcWin = windowReqs(pcReqs, startCount.pc);
  const events = await phone.evaluate(() => window.__events);
  const clicks = events.filter((e) => e.kind === "event" && ["click", "pointerup", "pointerdown"].includes(e.name));
  const longtasks = events.filter((e) => e.kind === "longtask");
  result.escenario = {
    ...result.escenario,
    pesadas: PESADAS,
    pedidosCargadosPorPc: adminOrders,
    segundos: +elapsed.toFixed(1),
    historico: HISTORICO,
    clientes: CLIENTES,
    pedidosHoy: HOY_PEDIDOS,
    redTelefono: "4G emulada: 80 ms, 4 Mbps bajada, 1,5 Mbps subida; CPU ×4",
  };
  result.telefono = {
    feedbackMs: { p50: pct(pesadas.map((p) => p.feedback), 50), p95: pct(pesadas.map((p) => p.feedback), 95), n: pesadas.length },
    confirmadoMs: { p50: pct(pesadas.map((p) => p.confirmado), 50), p95: pct(pesadas.map((p) => p.confirmado), 95), n: pesadas.filter((p) => p.confirmado !== null).length },
    solicitudes: phoneWin.length,
    solicitudesPorPesada: +(phoneWin.length / PESADAS).toFixed(2),
    kbTotales: +(phoneWin.reduce((s, r) => s + r.size, 0) / 1024).toFixed(1),
    kbPorPesada: +(phoneWin.reduce((s, r) => s + r.size, 0) / 1024 / PESADAS).toFixed(1),
    kbJsonProcesados: +(phoneWin.reduce((s, r) => s + r.decoded, 0) / 1024).toFixed(1),
    interaccionesLentas: { n: clicks.length, p95ms: pct(clicks.map((e) => e.duration), 95), maxMs: Math.max(0, ...clicks.map((e) => e.duration)) },
    tareasLargas: { n: longtasks.length, totalMs: Math.round(longtasks.reduce((s, e) => s + e.duration, 0)) },
    detalle: summary(phoneWin),
  };
  result.pc = {
    eventoPesadaMs: { p50: pct(pesadas.map((p) => p.eventoPc), 50), p95: pct(pesadas.map((p) => p.eventoPc), 95), n: pesadas.filter((p) => p.eventoPc !== null).length },
    solicitudes: pcWin.length,
    kbTotales: +(pcWin.reduce((s, r) => s + r.size, 0) / 1024).toFixed(1),
    kbJsonProcesados: +(pcWin.reduce((s, r) => s + r.decoded, 0) / 1024).toFixed(1),
    detalle: summary(pcWin),
  };
  result.pesadas = pesadas;
  result.erroresPagina = pageErrors;
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
await mkdir("test-results", { recursive: true });
await writeFile(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, pesadas: undefined }, null, 2));
if (/error/i.test(serverLog) && process.env.BENCH_VERBOSE) console.error(serverLog);
