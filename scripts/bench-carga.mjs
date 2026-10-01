/**
 * Banco de carga de la PWA (PC-020): caché fría (primera visita), instalación del service worker
 * y caché caliente (reapertura). Separa bytes por la red de JavaScript ejecutado: no son lo mismo.
 *
 *   node scripts/bench-carga.mjs [carpeta de la app] [salida.json]
 *
 * La carpeta de la app permite medir otra versión (p. ej. un worktree del commit anterior) con la
 * MISMA base sintética y el mismo teléfono emulado (4G regular, CPU ×4). Entorno aislado.
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";
import { testEnv } from "./test-env.mjs";

const appDir = resolve(process.argv.find((a, i) => i >= 2 && !a.endsWith(".json")) || ".");
const out = process.argv.find((a) => a.endsWith(".json")) || "test-results/bench-carga.json";
const REPS = 5;
const port = 5000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const dir = await mkdtemp(join(tmpdir(), "pollito-carga-"));
const env = await testEnv({
  PORT: String(port),
  SITE_URL: base,
  APP_MODE: "equipo",
  DEMO: "",
  DATA_DIR: dir,
  DB_PATH: join(dir, "pollito.sqlite"),
});
const today = new Date().toISOString().slice(0, 10);

// Base sintética (misma para las dos versiones: el esquema no cambió).
let target;
{
  Object.assign(process.env, env);
  const { openStore } = await import("../server/store.mjs");
  const { createApi, createEvents } = await import("../server/api.mjs");
  const store = await openStore(env.DB_PATH, { log: { info() {}, warn() {}, error() {} } });
  const api = createApi({ store, events: createEvents(), dataDir: dir });
  const session = { role: "admin", staffId: "bench", name: "Ensayo" };
  const call = (method, path, body = {}) => api({ method, path, body, session, query: new URLSearchParams(), ip: "x" });
  for (const name of ["Franco", "Maxi"]) store.drivers.save({ name, active: true, zones: [] });
  for (let i = 0; i < 1000; i++)
    store.customers.save({ phone: `anon-${i}`, name: `Cliente ${i}`, plan: "mayorista", credit: true, created: new Date().toISOString() });
  for (let i = 0; i < 1500; i++)
    await call("POST", "/api/orders", {
      customer: `anon-${i % 1000}`, key: `h-${i}`, driver: i % 2 ? "Franco" : "Maxi",
      deliveryDate: new Date(Date.now() - (1 + (i % 60)) * 86400000).toISOString().slice(0, 10),
      items: [{ id: "entero", boxes: 10 }], payment: "cuenta",
    });
  for (let i = 0; i < 100; i++) {
    const r = await call("POST", "/api/orders", {
      customer: `anon-${i}`, key: `t-${i}`, driver: i % 2 ? "Franco" : "Maxi", deliveryDate: today,
      items: [{ id: "entero", boxes: 20 }], payment: "cuenta",
    });
    if (i === 1) target = r.body.id;
  }
  store.close();
}

const server = spawn(process.execPath, [join(appDir, "server.mjs")], { env, cwd: appDir, stdio: "ignore", windowsHide: true });
const result = { app: appDir, node: process.version, telefono: "4G emulada 80 ms / 4 Mbps / 1,5 Mbps; CPU ×4", repeticiones: REPS };
let browser;
try {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const login = await fetch(base + "/api/session/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: "admin", password: env.ADMIN_PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const url = `${base}/operacion/pesada?fecha=${today}&pedido=${target}`;

  async function open(ctx, page) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Performance.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const bytes = { estaticos: 0, api: 0 };
    const kinds = new Map();
    cdp.on("Network.responseReceived", (e) => kinds.set(e.requestId, new URL(e.response.url).pathname.startsWith("/api/") ? "api" : "estaticos"));
    cdp.on("Network.loadingFinished", (e) => {
      const k = kinds.get(e.requestId);
      if (k) bytes[k] += e.encodedDataLength;
    });
    const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const t = Date.now();
    await page.goto(url);
    await page.waitForSelector(".weigh-confirm", { timeout: 90000 });
    const ms = Date.now() - t;
    await page.waitForLoadState("networkidle").catch(() => {});
    const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    await cdp.detach();
    return {
      listoMs: ms,
      kbEstaticos: +(bytes.estaticos / 1024).toFixed(1),
      kbApi: +(bytes.api / 1024).toFixed(1),
      scriptMs: Math.round((after.ScriptDuration - (before.ScriptDuration || 0)) * 1000),
      tareasMs: Math.round((after.TaskDuration - (before.TaskDuration || 0)) * 1000),
      heapMb: +(after.JSHeapUsedSize / 1048576).toFixed(1),
    };
  }
  const frias = [];
  const calientes = [];
  for (let i = 0; i < REPS; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: cookie.split("=")[0], value: cookie.split("=").slice(1).join("="), url: base }]);
    const page = await ctx.newPage();
    frias.push(await open(ctx, page));
    // Espera a que el service worker termine de instalar y tome el control.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    });
    const page2 = await ctx.newPage();
    calientes.push(await open(ctx, page2));
    await ctx.close();
  }
  const med = (arr, k) => {
    const s = arr.map((x) => x[k]).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const resumen = (arr) => Object.fromEntries(Object.keys(arr[0]).map((k) => [k, med(arr, k)]));
  result.cacheFria = resumen(frias);
  result.cacheCaliente = resumen(calientes);

  // Descarga del service worker al instalar/actualizar: lista de precache, pedida como la pide
  // el navegador (acepta gzip). Es lo que baja además de lo que la pantalla usa.
  const sw = await readFile(join(appDir, "dist/sw.js"), "utf8");
  const list = JSON.parse(sw.match(/const ASSETS = (\[.*?\]);/s)[1]);
  let wire = 0;
  let disk = 0;
  for (const p of list) {
    disk += (await stat(join(appDir, "dist", p))).size;
    wire += await new Promise((ok, ko) =>
      http.get(base + p, { headers: { "Accept-Encoding": "gzip" } }, (res) => {
        let n = 0;
        res.on("data", (c) => (n += c.length));
        res.on("end", () => ok(n));
      }).on("error", ko),
    );
  }
  result.precache = { archivos: list.length, kbEnDisco: +(disk / 1024).toFixed(0), kbPorRed: +(wire / 1024).toFixed(0), incluyeWorkerPdf: list.some((p) => /pdf\.worker/.test(p)) };
  result.muestras = { frias, calientes };
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
await mkdir("test-results", { recursive: true });
await writeFile(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, muestras: undefined }, null, 2));
