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
    await page.getByRole("button", { name: role }).click();
    if (role === "Repartidor")
      await page.getByLabel("¿Quién sos?").selectOption("Franco");
    await page
      .getByLabel("PIN del equipo")
      .fill(process.env.STAFF_PIN || "1234");
    await page
      .locator(".access-form")
      .getByRole("button", { name: "Ingresar" })
      .click();
    await page.waitForURL("**" + path);
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
} finally {
  await browser.close();
}
