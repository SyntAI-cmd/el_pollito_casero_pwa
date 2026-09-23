import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { testEnv } from "./test-env.mjs";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:5197";
const env = await testEnv({ PORT: "5197", SITE_URL: base, APP_MODE: "equipo" });
const server = spawn(process.execPath, ["server.mjs", "--dev"], {
  env,
  stdio: "pipe",
  windowsHide: true,
});
server.stderr.on("data", (d) => process.stderr.write(d));
let browser,
  cookie = "";
async function call(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const data = await r.json();
  assert.ok(r.ok, JSON.stringify(data));
  return data;
}
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  await call("/session/staff", {
    username: "admin",
    password: env.ADMIN_PASSWORD,
  });
  const c = await call("/customers", {
    name: "Cliente Revision Uno",
    branch: "Centro",
    zone: "San Martín",
    credit: true,
    shift: "tarde",
  });
  const c2 = await call("/customers", {
    name: "Cliente Revision Dos",
    zone: "Junín",
    credit: true,
  });
  await call(
    `/customers/${c.phone}/prices`,
    { prices: { entero: 5500 } },
    "PUT",
  );
  await call(
    `/customers/${c2.phone}/prices`,
    { prices: { entero: 6200 } },
    "PUT",
  );
  await call(
    `/customers/${c.phone}/saldos`,
    { balance: 100000, boxes: 10, note: "Prueba sintética", opId: "preview-1" },
    "PATCH",
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Pacific/Auckland",
  });
  await context.addCookies([
    {
      name: cookie.split("=")[0],
      value: cookie.split("=").slice(1).join("="),
      url: base,
    },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-09-23T15:30:00Z"));
  await page.goto(base + "/operacion/nuevo");
  const search = page.getByRole("textbox", {
    name: "Buscar cliente por nombre, zona o CUIT",
  });
  await search.fill("Revision Uno");
  await page.locator(".suggestions button").click();
  await expect(page.locator("input[type=date]")).toHaveValue("2026-09-23");
  const boxes = page.getByRole("textbox", {
    name: "Cajas de Pollo entero",
    exact: true,
  });
  await boxes.fill("2");
  await page.locator(".quick-order button[type=submit]").click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(
    dlg.getByRole("button", { name: "Confirmar y cargar con precio y saldo" }),
  ).toBeEnabled();
  await expect(dlg).toContainText("100.000");
  await expect(dlg).toContainText("5.500");
  await expect(dlg).toContainText("Saldo actual de cajas: 10");
  assert.equal(
    (await call("/orders")).length,
    0,
    "abrir resumen no crea pedido",
  );
  await mkdir("test-results/urgentes", { recursive: true });
  await page.screenshot({
    path: "test-results/urgentes/resumen-390.png",
    fullPage: false,
  });
  await dlg.getByRole("button", { name: "Volver a editar" }).click();
  await expect(boxes).toHaveValue("2");
  await page.locator(".quick-order button[type=submit]").click();
  await expect(
    dlg.getByRole("button", { name: "Confirmar y cargar con precio y saldo" }),
  ).toBeEnabled();
  await call(
    `/customers/${c.phone}/saldos`,
    { balance: 90000, note: "Cambio simultáneo", opId: "preview-2" },
    "PATCH",
  );
  await dlg
    .getByRole("button", { name: "Confirmar y cargar con precio y saldo" })
    .click();
  await expect(dlg).toContainText("Cambió el saldo");
  assert.equal((await call("/orders")).length, 0);
  await dlg.getByRole("button", { name: "Volver a editar" }).click();
  await page.locator(".quick-order button[type=submit]").click();
  await expect(
    dlg.getByRole("button", { name: "Confirmar y cargar con precio y saldo" }),
  ).toBeEnabled();
  await expect(dlg).toContainText("90.000");
  await dlg
    .getByRole("button", { name: "Confirmar y cargar con precio y saldo" })
    .click();
  await expect(dlg).not.toBeVisible();
  const saved = await call("/orders");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].deliveryDate, "2026-09-23");
  assert.equal(saved[0].items[0].price, 5500);
  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await search.fill("Revision Dos");
  await page.locator(".suggestions button").click();
  await boxes.fill("1");
  await page.locator(".quick-order button[type=submit]").click();
  await expect(
    dlg.getByRole("button", { name: "Confirmar y cargar con precio y saldo" }),
  ).toBeEnabled();
  await expect(dlg).toContainText("6.200");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: "test-results/urgentes/resumen-1280.png",
    fullPage: false,
  });
  const pdf = await page.evaluate(async () => {
    const { hojaPdfBlob } = await import("/src/lib/pdf.js");
    const orders = await (await fetch("/api/orders")).json();
    const customers = await (await fetch("/api/customers")).json();
    const blob = await hojaPdfBlob({
      date: "2026-09-23",
      drivers: ["Preventista de prueba"],
      orders,
      customers,
    });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await writeFile(
    "test-results/urgentes/hoja-ruta-control.pdf",
    Buffer.from(pdf),
  );
  assert.deepEqual(errors, []);
  console.log(
    "OK: fecha Mendoza desde dispositivo Auckland; resumen precio/saldos; volver conserva borrador; conflicto bloquea; confirmación crea 1 pedido con fecha y precio correctos; segundo cliente usa su precio; PDF generado; sin errores JS.",
  );
} finally {
  await browser?.close();
  server.kill();
}
