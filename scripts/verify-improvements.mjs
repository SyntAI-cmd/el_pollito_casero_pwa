import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const out = process.env.REVIEW_OUTPUT || "test-results/improvements";
await mkdir(out, { recursive: true });
const base = "http://localhost:5193";
const child = spawn(process.execPath, ["server.mjs", "--dev"], {
  env: {
    ...process.env,
    PORT: "5193",
    SITE_URL: base,
    DB_PATH: ":memory:",
    DATA_DIR: "test-results/improvements-data",
    GEOCODING: "off",
    ROUTING: "off",
    PUSH: "off",
    ADMIN_PASSWORD: "test-only-password-2026",
    APP_MODE: "equipo",
    LOGIN_LIMIT: "100",
  },
  stdio: "pipe",
  windowsHide: true,
});
child.stderr.on("data", (d) => process.stderr.write(d));
let browser;
let cookie = "";
async function call(path, data, method = data ? "POST" : "GET", status = 200) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const b = await r.json();
  assert.equal(r.status, status, `${path}: ${JSON.stringify(b)}`);
  return b;
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
    password: "test-only-password-2026",
  });
  const date = new Date().toLocaleDateString("sv-SE");
  const c = await call(
    "/customers",
    {
      name: "Almacén Centro",
      alias: "Almacén Centro",
      legalName: "Comercial Mendoza",
      branch: "Centro",
      zone: "San Martín",
      truck: "Maxi",
      credit: true,
    },
    "POST",
    201,
  );
  const c2 = await call(
    "/customers",
    { name: "Mercado Norte", zone: "Junín", truck: "Franco" },
    "POST",
    201,
  );
  await call(
    `/customers/${c.phone}/saldos`,
    { boxesDelta: 10, delta: 20000, opId: "initial" },
    "PATCH",
  );
  const saldo = await call(
    `/customers/${c.phone}/saldos`,
    { boxesDelta: 2, delta: 500, opId: "once" },
    "PATCH",
  );
  const retry = await call(
    `/customers/${c.phone}/saldos`,
    { boxesDelta: 2, delta: 500, opId: "once" },
    "PATCH",
  );
  assert.equal(retry.summary.boxes, saldo.summary.boxes);
  assert.equal(retry.summary.balance, saldo.summary.balance);
  await call(
    `/customers/${c.phone}/saldos`,
    { boxesDelta: 3, delta: 500, opId: "once" },
    "PATCH",
    409,
  );
  await call(
    `/customers/${c.phone}/saldos`,
    { boxesDelta: -999, delta: 1000, opId: "invalid" },
    "PATCH",
    400,
  );
  const unchanged = (await call("/customers")).find((x) => x.phone === c.phone);
  assert.equal(
    unchanged.summary.balance,
    saldo.summary.balance,
    "invalid boxes must not partially save money",
  );
  const make = async (customer, key, boxes) =>
    call(
      "/orders",
      {
        customer: customer.phone,
        key,
        deliveryDate: date,
        shift: "manana",
        items: [{ id: "entero", boxes }],
      },
      "POST",
      201,
    );
  const o = await make(c, "route-a", 30),
    o2 = await make(c2, "route-b", 10);
  await call(`/orders/${o.id}`, { status: "preparando" }, "PATCH");
  await call(`/orders/${o.id}`, { status: "en_camino" }, "PATCH");
  const delivered = await call(
    `/orders/${o.id}`,
    { status: "entregado", boxes: 30, returnBoxes: 5 },
    "PATCH",
  );
  assert.equal(delivered.boxBalanceBefore, 12);
  const state = (await call("/customers")).find((x) => x.phone === c.phone);
  assert.equal(state.summary.boxes, 37);
  await call(`/orders/${o.id}`, { returnBoxes: 99 }, "PATCH", 400);
  await call(`/orders/${o2.id}`, { status: "preparando" }, "PATCH");
  await call(`/orders/${o2.id}`, { status: "en_camino" }, "PATCH");
  await call(
    `/orders/${o2.id}`,
    { status: "entregado", boxes: 10, returnBoxes: 10 },
    "PATCH",
  );
  assert.equal(
    (await call("/customers")).find((x) => x.phone === c2.phone).summary.boxes,
    0,
  );
  const open = await make(c, "route-c", 8);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const [name, value] = cookie.split("=");
  await ctx.addCookies([{ name, value, url: base }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  console.log("Browser checks started");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [360, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [tag, path] of [
      ["pedidos", "/operacion"],
      ["clientes", "/operacion/clientes"],
      ["nuevo", "/operacion/nuevo"],
    ]) {
      await page.goto(base + path);
      await page
        .getByRole("heading", {
          name:
            tag === "clientes"
              ? "Clientes"
              : tag === "pedidos"
                ? "Pedidos"
                : "Cargar pedido",
          exact: false,
        })
        .first()
        .waitFor();
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      );
      assert.equal(overflow, false, `${tag} overflow ${width}`);
      await page.screenshot({
        path: `${out}/${width}-${tag}.png`,
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/operacion/clientes");
  await page.getByRole("button", { name: "Filtros", exact: true }).click();
  await page
    .getByLabel("Saldo monetario", { exact: true })
    .selectOption("zero");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.locator(".customer-card")).toHaveCount(1);
  await expect(page.locator(".customer-card")).toContainText("Mercado Norte");
  await page.getByRole("button", { name: "Quitar Dinero" }).click();
  await page
    .locator(".customer-card")
    .filter({ hasText: "Almacén Centro" })
    .getByRole("button", { name: "Saldos", exact: true })
    .click();
  await page.getByLabel("Importe", { exact: true }).fill("800");
  await page.getByRole("button", { name: "Suma deuda", exact: true }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.getByRole("tab", { name: "Cajas", exact: true }).click();
  await page.getByLabel("Cantidad de cajas", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Suma cajas", exact: true }).click();
  await page.getByRole("button", { name: "Guardar estado" }).click();
  await expect(
    page.getByText("Guardado. Podés seguir corrigiendo."),
  ).toBeVisible();
  await expect(page.locator("dialog")).toBeVisible();
  await page.locator("dialog").evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({ path: `${out}/390-saldos.png` });
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.goto(base + "/operacion");
  await page
    .locator(".delivery-card")
    .filter({ hasText: "Almacén Centro" })
    .getByRole("button", { name: /Ver pedido/ })
    .last()
    .click();
  await page
    .getByLabel("Preventista del pedido", { exact: true })
    .selectOption("Franco");
  await expect(
    page.getByLabel("Preventista del pedido", { exact: true }),
  ).toHaveValue("Franco");
  await page.screenshot({ path: `${out}/390-pedido.png`, fullPage: true });
  await page.goto(base + "/operacion/documentos");
  const pdf = await page.evaluate(async () => {
    const { hojaPdfBlob } = await import("/src/lib/pdf.js");
    const orders = await (await fetch("/api/orders")).json();
    const customers = await (await fetch("/api/customers")).json();
    const blob = await hojaPdfBlob({
      date: new Date().toLocaleDateString("sv-SE"),
      drivers: ["Maxi"],
      vehicle: "Camión de prueba",
      orders,
      customers,
    });
    return await new Promise((r) => {
      const f = new FileReader();
      f.onload = () => r(f.result.split(",")[1]);
      f.readAsDataURL(blob);
    });
  });
  await writeFile(`${out}/hoja-ruta-ejemplo.pdf`, Buffer.from(pdf, "base64"));
  await expect
    .poll(async () => (await call("/documents")).documents.length)
    .toBeGreaterThan(0);
  assert.equal(errors.length, 0, errors.join("\n"));
  await writeFile(
    `${out}/verificacion.json`,
    JSON.stringify(
      {
        widths: [360, 390, 768, 1280, 1440],
        checks: [
          "no horizontal overflow",
          "combined balances stay open",
          "idempotent retries",
          "invalid box changes rollback money",
          "10 delivered 10 returned = 0",
          "excess returns blocked",
          "mobile driver assignment",
          "PDF generation",
          "document persisted without Drive credentials",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: API, saldos, cajas, filtros, preventista, PDF y capturas responsive",
  );
} finally {
  await browser?.close();
  child.kill();
}
