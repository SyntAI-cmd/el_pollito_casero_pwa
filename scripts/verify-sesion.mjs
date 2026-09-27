/**
 * Entrar y salir varias veces sin recargar (PC y teléfono): la app no debe mostrar "Algo salió mal".
 * Regresión del 27/09: un efecto de React devolvía `true` (persist) y rompía al cambiar de sesión.
 *
 *   node scripts/verify-sesion.mjs
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { testEnv } from "./test-env.mjs";

const port = 5000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const env = await testEnv({ PORT: String(port), SITE_URL: base, APP_MODE: "equipo", DEMO: "" });
const server = spawn(process.execPath, ["server.mjs"], { env, stdio: "ignore", windowsHide: true });
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(base + "/api/health")).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const casos = [
  ["pc", { viewport: { width: 1366, height: 900 } }, "admin", /\/operacion/],
  ["telefono", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, "franco", /\/reparto/],
];
try {
  for (const [label, opts, user, home] of casos) {
    const page = await (await browser.newContext(opts)).newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => m.type() === "error" && errs.push(m.text().split("\n")[0]));
    const login = async () => {
      if (!page.url().endsWith("/admin")) await page.goto(base + "/admin");
      await page.fill('input[name="username"]', user);
      await page.fill('input[name="password"]', env.ADMIN_PASSWORD);
      await page.keyboard.press("Enter");
      await page.waitForURL(home, { timeout: 10000 });
      await page.waitForTimeout(1000);
      if (/Algo salió mal/.test(await page.locator("body").innerText()))
        throw Error(`${label}: "Algo salió mal" después de entrar`);
    };
    const logout = async () => {
      const desk = page.locator('button:has-text("Salir")').first();
      if (await desk.isVisible().catch(() => false)) await desk.click();
      else {
        await page.locator('button[aria-haspopup=dialog]:has-text("Más")').first().click({ force: true });
        await page.locator(".more-sheet button.danger").click({ timeout: 5000 });
      }
      await page.waitForURL(/\/admin/, { timeout: 10000 });
      await page.waitForTimeout(500);
    };
    for (let i = 0; i < 3; i++) {
      await login();
      await logout();
    }
    await login();
    if (errs.length) throw Error(`${label}: ${errs.join(" · ")}`);
    console.log(`✓ ${label}: 4 ingresos y 3 salidas sin errores`);
  }
  console.log("OK");
} catch (e) {
  console.log("FALLO", e.message.split("\n")[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
