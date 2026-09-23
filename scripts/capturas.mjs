/**
 * Capturas comparativas de El Pollito Casero.
 * Uso: node shots2.mjs <carpeta> [usuario] [clave]
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:5174";
const out = process.argv[2] || "shots";
const user = process.argv[3] || "admin";
const pass = process.argv[4] || "pollito2026";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});

const sizes = [
  ["1440", 1440, 900],
  ["1280", 1280, 800],
  ["768", 768, 1024],
  ["390", 390, 844],
  ["360", 360, 780],
];

const pages = {
  admin: [
    ["pedidos", "/operacion"],
    ["clientes", "/operacion/clientes"],
    ["pesaje", "/operacion/pesada"],
    ["equipo", "/operacion/equipo"],
    ["nuevo", "/operacion/nuevo"],
  ],
  repartidor: [
    ["entregas", "/reparto"],
    ["clientes", "/reparto/clientes"],
    ["pesaje", "/reparto/pesada"],
  ],
};

const role = user === "admin" ? "admin" : "repartidor";

for (const [tag, w, h] of sizes) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/admin");
  await page.fill('input[name="user"], input[autocomplete="username"]', user);
  await page.fill('input[type="password"]', pass);
  await page.click('button:has-text("Ingresar")');
  await page.waitForTimeout(2500);
  for (const [name, path] of pages[role]) {
    await page.goto(BASE + path);
    await page.waitForTimeout(1600);
    // ¿La página desborda a lo ancho?
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (over > 1) console.log(`  ⚠ ${name} ${tag}px desborda ${over}px`);
    await page.screenshot({
      path: `${out}/${tag}-${name}.png`,
      fullPage: tag !== "390" && tag !== "360",
    });
  }
  await ctx.close();
  console.log(`${tag}px listo`);
}
await browser.close();
