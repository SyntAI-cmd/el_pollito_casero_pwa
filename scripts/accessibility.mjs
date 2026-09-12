import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
try {
  for (const path of [
    "/",
    "/planes",
    "/cuenta",
    "/seguimiento",
    "/ayuda",
    "/acceso",
    "/pedidos",
    "/admin",
    "/ingresar",
    "/no-existe",
  ]) {
    await page.goto("http://localhost:5173" + path);
    await page.waitForLoadState("networkidle");
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    console.log(
      JSON.stringify({
        path,
        violations: result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      }),
    );
  }
  // Páginas privadas: administración y reparto (PIN de demostración).
  for (const [role, path] of [
    ["Administración", "/operacion"],
    ["Repartidor", "/reparto"],
  ]) {
    await page.goto("http://localhost:5173/acceso");
    await page.waitForLoadState("networkidle");
    const change = page.getByRole("button", { name: "Cambiar de usuario" });
    if (await change.isVisible().catch(() => false)) {
      await change.click();
      await page.waitForURL("http://localhost:5173/");
      await page.goto("http://localhost:5173/acceso");
    }
    await page
      .getByLabel("Usuario")
      .fill(role === "Repartidor" ? "franco" : "admin");
    await page
      .getByLabel("Contraseña")
      .fill(process.env.ADMIN_PASSWORD || "pollito2026");
    await page
      .locator(".access-form")
      .getByRole("button", { name: "Ingresar" })
      .click();
    await page.waitForURL("**" + path);
    await page.waitForLoadState("networkidle");
    // El aviso de ingreso se desvanece a los 5 s; se analiza sin él.
    await page.waitForTimeout(5500);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    console.log(
      JSON.stringify({
        path,
        violations: result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      }),
    );
  }
} finally {
  await browser.close();
}
