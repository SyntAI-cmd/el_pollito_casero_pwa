import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5173/");
await page.waitForLoadState("networkidle");
await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
console.log(await page.locator("button").allTextContents());
console.log(
  "Images",
  await page.locator("img").evaluateAll((images) =>
    images.map((i) => ({
      src: i.src,
      loaded: i.complete && i.naturalWidth > 0,
    })),
  ),
);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
console.log(
  "Overflow",
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
);
console.log("Errors", errors);
await browser.close();
