import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { testEnv } from "./test-env.mjs";
const base = "http://127.0.0.1:5198";
const env = await testEnv({ PORT: "5198", SITE_URL: base, APP_MODE: "equipo" });
const server = spawn(process.execPath, ["server.mjs"], {
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
    name: "Cliente PDF Ensayo",
    zone: "San Martín",
    credit: true,
    shift: "tarde",
  });
  const date = "2026-09-26";
  const orders = [];
  for (let i = 0; i < 25; i++)
    orders.push(
      await call("/orders", {
        customer: c.phone,
        key: "pdf-" + i,
        driver: "Franco",
        deliveryDate: date,
        items: [{ id: "entero", kg: 40 }],
        payment: "cuenta",
      }),
    );
  browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
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
  let uploads = 0;
  let openedWorkers = 0,
    closedWorkers = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("worker", (w) => {
    openedWorkers++;
    w.on("close", () => closedWorkers++);
  });
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/documents")) uploads++;
  });
  await page.goto(base + "/manifest.webmanifest");
  await page.evaluate(async () => {
    localStorage.setItem(
      "pc-outbox",
      JSON.stringify([
        { owner: "otro", version: -1, body: { id: "pesada-preservada" } },
      ]),
    );
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("pollito-documents", 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore("pending", { keyPath: "id" });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("pending", "readwrite");
        tx.objectStore("pending").put({
          id: "atascado",
          owner: "admin:admin",
          blob: new Blob([new Uint8Array(5_000_000)]),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = reject;
      };
    });
  });
  await page.goto(base + "/imprimir?tipo=remitos&fecha=" + date);
  await expect(
    page.getByRole("button", { name: "Descargar", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await expect.poll(() => closedWorkers).toBe(openedWorkers);
  const queue = await page.evaluate(async () => {
    const docs = await new Promise((resolve) => {
      const r = indexedDB.open("pollito-documents", 1);
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction("pending");
        const count = tx.objectStore("pending").count();
        tx.oncomplete = () => {
          db.close();
          resolve(count.result);
        };
      };
    });
    return { docs, outbox: JSON.parse(localStorage.getItem("pc-outbox")) };
  });
  assert.equal(queue.docs, 0);
  assert.equal(queue.outbox[0].body.id, "pesada-preservada");
  await page.getByLabel("Ocultar precios").check();
  await expect(
    page.getByRole("button", { name: "Descargar", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await expect.poll(() => closedWorkers).toBe(openedWorkers);
  await page.goto(base + "/imprimir?tipo=pedidos&fecha=" + date);
  await expect(
    page.getByRole("button", { name: "Descargar", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await expect.poll(() => closedWorkers).toBe(openedWorkers);
  const workerFile = (await readdir("dist/assets")).find((f) =>
    f.startsWith("pdf.worker-"),
  );
  const sizes = {};
  for (const kind of ["hoja", "remito", "pedidos"]) {
    sizes[kind] = await page.evaluate(
      async ({ kind, orders, url, date }) => {
        const worker = new Worker(url);
        try {
          return await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(Error("PDF timeout")), 45000);
            worker.onerror = (e) => {
              clearTimeout(t);
              reject(Error(e.message));
            };
            worker.onmessage = ({ data }) => {
              clearTimeout(t);
              data.error ? reject(Error(data.error)) : resolve(data.blob.size);
            };
            worker.postMessage({
              kind,
              props: {
                orders,
                date,
                customers: [],
                drivers: ["Franco"],
                vehicle: "Ensayo",
              },
            });
          });
        } finally {
          worker.terminate();
        }
      },
      { kind, orders, url: "/assets/" + workerFile, date },
    );
    assert.ok(sizes[kind] > 1000);
  }
  // El pedido pesado en otra sesión actualiza el saldo visible sin recargar la página.
  await page.goto(base + "/operacion/clientes");
  const row = page.getByRole("row").filter({ hasText: "Cliente PDF Ensayo" });
  await expect(row).toBeVisible();
  await call("/orders/" + orders[0].id + "/crates", { id: "peso-sync", productId: "entero", boxes: 2, gross: 43.4 });
  const fresh = (await call("/customers")).find(x => x.phone === c.phone);
  const formatted = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(fresh.summary.balance);
  assert.ok(fresh.summary.balance > 0);
  await expect(row).toContainText(formatted, { timeout: 5000 });
  assert.ok(sizes.remito < 1_000_000, "25 remitos no deben volver a superar 1 MB");
  assert.equal(uploads, 0);
  assert.deepEqual(errors, []);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/sync-pdf.png", fullPage: true });
  const result = {
    orders: orders.length,
    sizes,
    queueCleared: true,
    weighingPreserved: true,
    uploads,
    errors,
  };
  await writeFile(
    "test-results/sync-pdf.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
