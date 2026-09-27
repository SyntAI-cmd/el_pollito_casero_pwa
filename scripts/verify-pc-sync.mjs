/**
 * Verificación en navegador del lado administración (PC-017): sin recargar la página,
 *  1. un pedido cargado desde otro equipo aparece en la lista;
 *  2. una pesada hecha en el teléfono actualiza los kilos del pedido y el saldo de la ficha;
 *  3. todo eso sin volver a bajar las listas completas de pedidos ni de clientes.
 *
 *   node scripts/verify-pc-sync.mjs
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { testEnv } from "./test-env.mjs";

const port = 5000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const env = await testEnv({ PORT: String(port), SITE_URL: base, APP_MODE: "equipo", DEMO: "" });
const server = spawn(process.execPath, ["server.mjs"], { env, stdio: "ignore", windowsHide: true });
const today = new Date().toISOString().slice(0, 10);
async function call(cookie, path, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const admin = (await call("", "/session/staff", { username: "admin", password: env.ADMIN_PASSWORD })).cookie;
  const otraPc = (await call("", "/session/staff", { username: "admin", password: env.ADMIN_PASSWORD })).cookie;
  const franco = (await call("", "/session/staff", { username: "franco", password: env.ADMIN_PASSWORD })).cookie;
  const c = (await call(admin, "/customers", { name: "Almacén Verificación", zone: "Centro", credit: true })).data;
  await call(admin, `/customers/${encodeURIComponent(c.phone)}/prices`, { prices: { entero: 5000 } }, "PUT");

  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addCookies([{ name: admin.split("=")[0], value: admin.split("=").slice(1).join("="), url: base }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const full = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/orders" && !u.search) full.push("orders");
    if (u.pathname === "/api/customers" && !u.search) full.push("customers");
  });
  await page.goto(base + "/operacion");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  full.length = 0;
  const saldo = () =>
    page.evaluate(async (phone) => {
      // Lee el saldo que muestra la app a través de su propio estado de clientes.
      const r = await fetch("/api/customers?phones=" + phone);
      return (await r.json())[0]?.summary?.balance;
    }, c.phone);

  // 1. Otra PC carga un pedido.
  const o = (await call(otraPc, "/orders", {
    customer: c.phone, key: "pc-sync-1", driver: "Franco", deliveryDate: today,
    items: [{ id: "entero", boxes: 2 }], payment: "cuenta",
  })).data;
  await page.getByText("Almacén Verificación").first().waitFor({ timeout: 5000 });
  console.log("1 ✓ el pedido de otra PC aparece sin recargar");

  // 2. El teléfono pesa: 2 cajas, 43,4 bruto → 40 kg × $5.000 = $200.000.
  await call(franco, `/orders/${o.id}/crates`, { id: "v-1", productId: "entero", boxes: 2, gross: 43.4 });
  await page.getByText(/40(,0)? ?kg/).first().waitFor({ timeout: 5000 });
  console.log("2 ✓ los kilos pesados en el teléfono se ven en la PC");
  // La ficha en memoria tiene el saldo nuevo: se abre Clientes dentro de la app (sin recargar).
  await page.locator('a[href="/operacion/clientes"]').first().click();
  await page.getByText("Almacén Verificación").first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  assert.equal(await saldo(), 200000);
  const texto = await page.locator("body").innerText();
  assert.match(texto, /200\.000/, "la ficha muestra el saldo actualizado");
  console.log("2 ✓ saldo del cliente actualizado ($ 200.000)");

  assert.deepEqual(full, [], "sin descargas completas de pedidos ni clientes");
  console.log("3 ✓ ninguna descarga completa de pedidos ni clientes durante la prueba");
  assert.deepEqual(errors, []);
  console.log("OK");
} finally {
  await browser?.close();
  server.kill();
}
