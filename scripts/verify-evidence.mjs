import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { testEnv } from "./test-env.mjs";
const env = await testEnv({ PORT: "5182" });
const server = spawn(process.execPath, ["server.mjs"], {
  env,
  stdio: ["ignore", "ignore", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));
const base = "http://127.0.0.1:5182";
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await pause(200);
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const admin = await browser.newContext();
  const driver = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const call = async (context, path, data, method = data ? "POST" : "GET") => {
    const r = await context.request.fetch(base + "/api" + path, {
      method,
      ...(data ? { data } : {}),
    });
    const json = await r.json();
    assert.ok(r.ok(), `${path}: ${JSON.stringify(json)}`);
    return json;
  };
  await call(admin, "/session/staff", {
    username: "admin",
    password: "clave-de-prueba-1",
  });
  await call(driver, "/session/staff", {
    username: "franco",
    password: "clave-de-prueba-1",
  });
  const c = await call(admin, "/customers", {
    name: "Cliente de verificación",
    zone: "San Martín",
    truck: "Franco",
    credit: true,
    plan: "mayorista",
  });
  const o = await call(admin, "/orders", {
    customer: c.phone,
    key: "ui-evidence",
    driver: "Franco",
    noPricing: true,
    payment: "cuenta",
    deliveryDate: "2026-09-24",
    items: [{ id: "entero", boxes: 3 }],
  });
  const page = await driver.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/reparto");
  await page
    .getByRole("button", { name: "Cajas, deuda y comprobantes", exact: true })
    .click();
  await page.getByRole("tab", { name: "Saldo monetario" }).click();
  await page
    .getByRole("textbox", { name: "Importe", exact: true })
    .fill("12000");
  await page
    .getByRole("button", { name: "Dejar deuda en este importe", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Guardar estado", exact: true })
    .click();
  await page.getByText("Guardado. Podés seguir corrigiendo.").waitFor();
  await page.getByRole("tab", { name: "Comprobantes", exact: true }).click();
  const image = await sharp({
    create: { width: 200, height: 150, channels: 3, background: "#ddd" },
  })
    .jpeg()
    .toBuffer();
  await page
    .locator("label.receipt-button")
    .filter({ hasText: "Transferencia" })
    .locator('input[type="file"]')
    .setInputFiles({
      name: "transferencia.jpg",
      mimeType: "image/jpeg",
      buffer: image,
    });
  await page.getByRole("link", { name: "Descargar constancia PDF" }).waitFor();
  const receipts = await call(driver, `/orders/${o.id}/comprobantes`);
  assert.equal(receipts[0].evidence.payload.customerBalance, 12000);
  assert.ok(receipts[0].evidence.payload.actor.id.startsWith("staff:"));
  await page.getByRole("tab", { name: "Saldo monetario" }).click();
  await page.getByRole("button", { name: "Quitar deuda", exact: true }).click();
  await page
    .getByRole("button", { name: "Guardar estado", exact: true })
    .click();
  await page.getByText("Guardado. Podés seguir corrigiendo.").waitFor();
  const updated = (await call(admin, "/customers")).find(
    (x) => x.phone === c.phone,
  );
  assert.equal(updated.summary.balance, 0);
  for (const status of ["preparando", "en_camino"])
    await call(admin, `/orders/${o.id}`, { status }, "PATCH");
  const ap = await admin.newPage();
  ap.on("pageerror", (e) => errors.push(e.message));
  await ap.goto(base + "/operacion/entregas");
  await ap.getByRole("button", { name: /Ver pedido/ }).click();
  await ap.getByRole("button", { name: /Confirmar entrega/ }).click();
  await ap.getByRole("link", { name: "Descargar constancia PDF" }).waitFor();
  const download = await admin.request.get(
    base + `/api/comprobantes/${receipts[0].id}/constancia.pdf`,
  );
  assert.equal(download.status(), 200);
  assert.equal((await download.body()).subarray(0, 4).toString(), "%PDF");
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/constancia.pdf", await download.body());
  await ap.screenshot({
    path: "test-results/evidence-admin.png",
    fullPage: true,
  });
  await ap.getByRole("spinbutton", { name: "Envases que dejás al cliente" }).fill("3");
  await ap.getByRole("button", { name: "Confirmar", exact: true }).click();
  await ap.getByRole("heading", { name: "Completar entrega" }).waitFor({ state: "hidden" });
  const delivered = await call(admin, `/orders/${o.id}`);
  assert.equal(delivered.status, "entregado");
  assert.equal(delivered.boxes, 3);
  assert.deepEqual(errors, []);
  console.log(
    "OK: repartidor corrige y elimina deuda, sube transferencia identificada; administrador revisa, descarga constancia y confirma la entrega con sus cajas.",
  );
} finally {
  await browser?.close();
  server.kill();
}
