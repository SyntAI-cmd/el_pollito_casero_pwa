import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const out = process.argv[2] || "test-results";
for (const [name, w, h] of [
  ["d", 1440, 1000],
  ["m", 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  for (const p of [
    "/planes",
    "/seguimiento",
    "/cuenta",
    "/operacion",
    "/ayuda",
    "/pedidos",
    "/no-existe",
  ]) {
    await page.goto("http://localhost:5173" + p);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `${out}/${name}${p.replace("/", "-")}.png`,
      fullPage: true,
    });
  }
  await page.close();
}
await browser.close();
