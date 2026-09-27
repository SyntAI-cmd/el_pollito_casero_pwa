/**
 * Verificación en navegador de la pesada sin señal (PC-018), con el servidor real y datos de
 * ensayo en un directorio temporal:
 *  1. con red: confirmar deja la fila y el foco sigue en el peso, listo para la siguiente;
 *  2. sin red: la pesada queda "pendiente de envío", visible y sumada al pedido;
 *  3. recargar la página sin red: sigue ahí (guardada en el teléfono);
 *  4. un refresco de la nota (evento de otra PC) no la hace desaparecer;
 *  5. vuelve la red: se envía sola, una sola vez, con los kilos exactos.
 *
 *   node scripts/verify-pesaje-offline.mjs
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { testEnv } from "./test-env.mjs";

const port = 5000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const env = await testEnv({ PORT: String(port), SITE_URL: base, APP_MODE: "equipo", DEMO: "" });
const server = spawn(process.execPath, ["server.mjs"], { env, stdio: "pipe", windowsHide: true });
let browser;
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
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const admin = (await call("", "/session/staff", { username: "admin", password: env.ADMIN_PASSWORD })).cookie;
  const franco = (await call("", "/session/staff", { username: "franco", password: env.ADMIN_PASSWORD })).cookie;
  const c = (await call(admin, "/customers", { name: "Cliente Offline", zone: "Centro", credit: true })).data;
  const o = (await call(admin, "/orders", {
    customer: c.phone, key: "off-1", driver: "Franco", deliveryDate: today,
    items: [{ id: "entero", boxes: 10 }], payment: "cuenta",
  })).data;
  const otro = (await call(admin, "/orders", {
    customer: c.phone, key: "off-2", driver: "Franco", deliveryDate: today,
    items: [{ id: "entero", boxes: 5 }], payment: "cuenta",
  })).data;

  browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: franco.split("=")[0], value: franco.split("=").slice(1).join("="), url: base }]);
  await ctx.addInitScript(() => localStorage.setItem("teclado-pesaje", "sistema"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = `${base}/reparto/pesada?fecha=${today}&pedido=${o.id}`;
  await page.goto(url);
  // Que el service worker tome el control (para abrir sin red en el paso 3).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
  });
  await page.reload();
  const peso = page.locator('input[aria-label="Peso bruto en kilos"]');
  const cajas = page.locator(".weigh-boxes input");
  const filas = page.locator(".weigh-log li:not(.muted)");
  await peso.waitFor();

  // 1. Con red: 2 cajas, bruto 43,4 → 40,00 kg netos.
  await cajas.fill("2");
  await peso.fill("43,4");
  await peso.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".weigh-log li:not(.muted)").length === 1);
  await page.waitForFunction(() => !document.querySelector(".weigh-log li.pending"));
  assert.equal(await peso.inputValue(), "", "el campo queda vacío para la siguiente");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Peso bruto en kilos", "el foco sigue en el peso");
  console.log("1 ✓ con red: confirmada, foco en el peso");

  // 2. Sin red: bolsa (0 cajas), 12,5 kg.
  await ctx.setOffline(true);
  await cajas.fill("0");
  await peso.fill("12,5");
  await peso.press("Enter");
  await page
    .waitForFunction(() => document.querySelectorAll(".weigh-log li:not(.muted)").length === 2, null, { timeout: 10000 })
    .catch(async (e) => {
      console.error(
        await page.evaluate(() => ({
          log: document.querySelector(".weigh-log")?.innerText,
          sync: document.querySelector(".weigh-sync")?.innerText,
          cola: localStorage.getItem("pc-outbox"),
          toast: document.querySelector(".toast")?.innerText,
          net: document.querySelector(".weigh-net")?.innerText,
          peso: document.querySelector('input[aria-label="Peso bruto en kilos"]')?.value,
          activo: document.activeElement?.outerHTML?.slice(0, 120),
          boton: document.querySelector(".weigh-confirm")?.outerHTML?.slice(0, 160),
        })),
        errors,
      );
      await page.locator(".weigh-confirm").click();
      await page.waitForTimeout(1500);
      console.error("tras click:", await page.evaluate(() => ({
        log: document.querySelector(".weigh-log")?.innerText,
        cola: localStorage.getItem("pc-outbox"),
        peso: document.querySelector('input[aria-label="Peso bruto en kilos"]')?.value,
      })));
      throw e;
    });
  const pendiente = page.locator(".weigh-log li.pending");
  await pendiente.waitFor();
  assert.match(await pendiente.innerText(), /12,5 kg/);
  assert.match(await page.locator(".weigh-sync").innerText(), /1 pendiente de enviar/);
  assert.match(await page.locator(".weigh-total").innerText(), /52,5/, "suma lo pendiente al pedido");
  console.log("2 ✓ sin red: pendiente visible y sumada");

  // 3. Recargar sin red: la cola está guardada en el teléfono.
  await page.reload();
  await peso.waitFor();
  await pendiente.waitFor();
  assert.match(await pendiente.innerText(), /pendiente de envío/);
  const guardada = await page.evaluate(() => JSON.parse(localStorage.getItem("pc-outbox") || "[]"));
  assert.equal(guardada.length, 1);
  assert.equal(guardada[0].body.boxes, 0);
  console.log("3 ✓ recarga sin red: sigue pendiente (guardada en el teléfono)");

  // 4. Vuelve la red: se envía sola, una vez.
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => !document.querySelector(".weigh-log li.pending"), null, { timeout: 30000 });
  assert.match(await page.locator(".weigh-sync").innerText(), /Todo guardado en el servidor/);
  // Un cambio en otro pedido (como si la PC editara) dispara refrescos: nada desaparece.
  await call(admin, `/orders/${otro.id}/crates`, { id: "pc-1", productId: "entero", boxes: 1, gross: 21.7 });
  await page.waitForTimeout(1500);
  assert.equal(await filas.count(), 2);
  const dia = (await call(franco, `/dia?fecha=${today}`)).data;
  const cajones = dia.orders.find((x) => x.id === o.id).crates.filter((x) => !x.voided);
  assert.equal(cajones.length, 3, "2 cajas + 1 bolsa, sin duplicados");
  assert.equal(Math.round(cajones.reduce((s, x) => s + x.net, 0) * 100) / 100, 52.5);
  console.log("4 ✓ vuelve la red: enviada una vez, 52,5 kg netos exactos; un refresco no borra nada");
  assert.deepEqual(errors, [], "sin errores en la página");
  console.log("OK");
} finally {
  await browser?.close();
  server.kill();
}
