/**
 * Verificación en navegador real de los tickets de producción.
 * Crece a medida que se cierran tickets; cada comprobación dice a cuál pertenece.
 *
 *   node scripts/verificar-tickets.mjs           (contra http://localhost:5174)
 *   BASE=… USUARIO=… CLAVE=… node scripts/verificar-tickets.mjs
 *
 * Se corre contra la base de prueba, nunca contra la operativa.
 */
import { chromium, devices } from "@playwright/test";

const BASE = process.env.BASE || "http://localhost:5174";
const USER = process.env.USUARIO || "admin";
const PASS = process.env.CLAVE || "pollito2026";

const resultados = [];
const check = (cond, nombre, detalle = "") =>
  resultados.push({ estado: cond ? "ok" : "FALLA", nombre, detalle });

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
});

async function entrar(page) {
  await page.goto(BASE + "/admin");
  await page.fill('input[autocomplete="username"], input[name="user"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.click('button:has-text("Ingresar")');
  await page.waitForTimeout(2200);
}

// Teléfono con el teclado abierto: se simula achicando el alto de la ventana.
const TELEFONO = { ...devices["Pixel 5"] };
const CON_TECLADO = { ...TELEFONO, viewport: { width: 393, height: 400 } };

// ============================================================
// PC-002 · Formularios móviles, teclado y desplazamiento
// ============================================================
{
  const ctx = await browser.newContext(CON_TECLADO);
  const page = await ctx.newPage();
  await entrar(page);
  await page.goto(BASE + "/operacion/clientes");
  await page.waitForTimeout(1600);

  // Se anota la posición de la lista antes de abrir la ventana.
  await page.evaluate(() => window.scrollTo(0, 400));
  const scrollAntes = await page.evaluate(() => window.scrollY);

  await page.locator(".customer-card .cc-actions button").first().click();
  await page.waitForTimeout(900);
  check(
    (await page.locator("dialog[open] .saldos-edit").count()) > 0,
    "PC-002 · se abre la ventana de saldos en el celular",
  );

  // Escribir en el importe: el campo tiene que quedar dentro del área visible.
  const importe = page.locator(".saldos-entry input").first();
  await importe.click();
  await importe.type("12345", { delay: 40 });
  await page.waitForTimeout(500);
  const estado = await page.evaluate(() => {
    const campo = document.querySelector(".saldos-entry input");
    const dlg = document.querySelector("dialog[open]");
    const r = campo.getBoundingClientRect();
    const d = dlg.getBoundingClientRect();
    const guardar = [...document.querySelectorAll("dialog[open] button")].find(
      (b) => b.textContent.includes("Guardar estado"),
    );
    const g = guardar?.getBoundingClientRect();
    return {
      valor: campo.value,
      enfocado: document.activeElement === campo,
      campoVisible: r.top >= d.top - 1 && r.bottom <= d.bottom + 1,
      guardarVisible: g
        ? g.top >= 0 && g.bottom <= window.innerHeight + 1
        : false,
      altoVentana: Math.round(d.height),
      altoPantalla: window.innerHeight,
      desborde: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  check(
    estado.valor === "12345",
    "PC-002 · el valor escrito no se pierde",
    estado.valor,
  );
  check(estado.enfocado, "PC-002 · el campo no pierde el foco al escribir");
  check(
    estado.campoVisible,
    "PC-002 · el campo activo queda dentro de la ventana",
  );
  check(
    estado.altoVentana <= estado.altoPantalla + 1,
    "PC-002 · la ventana no es más alta que la pantalla útil",
    `${estado.altoVentana}px de ventana en ${estado.altoPantalla}px`,
  );
  check(
    estado.guardarVisible,
    "PC-002 · el botón de guardar queda al alcance con el teclado abierto",
  );
  check(
    estado.desborde <= 1,
    "PC-002 · sin desplazamiento horizontal",
    `${estado.desborde}px`,
  );

  // Con algo escrito sin guardar, Escape tiene que preguntar antes de cerrar.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const conPendiente = await page.evaluate(() => ({
    abierta: !!document.querySelector("dialog[open]"),
    pregunta: !!document.querySelector('[role="alertdialog"]'),
  }));
  check(
    conPendiente.abierta && conPendiente.pregunta,
    "PC-005 · cerrar con algo escrito sin guardar pregunta antes",
  );

  // Se descarta y recién ahí cierra: vuelve el foco al origen y la posición de la lista.
  await page.locator('button:has-text("Descartar y cerrar")').click();
  await page.waitForTimeout(800);
  const cerrado = await page.evaluate(() => ({
    abierta: !!document.querySelector("dialog[open]"),
    foco: document.activeElement?.textContent?.trim().slice(0, 20) || "",
    etiquetaFoco: document.activeElement?.getAttribute("aria-label") || "",
    scroll: Math.round(window.scrollY),
  }));
  check(!cerrado.abierta, "PC-002 · la ventana se cierra al descartar");
  check(
    Math.abs(cerrado.scroll - scrollAntes) < 40,
    "PC-002 · al cerrar se conserva la posición de la lista",
    `${scrollAntes} → ${cerrado.scroll}`,
  );
  check(
    /Saldos/i.test(cerrado.foco + cerrado.etiquetaFoco),
    "PC-002 · el foco vuelve al botón que abrió la ventana",
    `foco en "${cerrado.foco || cerrado.etiquetaFoco}"`,
  );
  await ctx.close();
}

// ============================================================
// PC-002 · Pesaje: escribir el peso no remonta la pantalla
// ============================================================
{
  const ctx = await browser.newContext(CON_TECLADO);
  const page = await ctx.newPage();
  await entrar(page);
  await page.goto(BASE + "/operacion/pesada");
  await page.waitForTimeout(1600);
  await page.locator(".floor-card").first().click();
  await page.waitForTimeout(1200);
  for (const t of ["1", "2", ",", "5"])
    await page
      .locator(`.keypad button[aria-label="${t === "," ? "coma decimal" : t}"]`)
      .click();
  await page.waitForTimeout(400);
  const peso = await page.evaluate(() => {
    const campo = document.querySelector(".weigh-gross input");
    const confirmar = [...document.querySelectorAll("button")].find((b) =>
      /Confirmar/.test(b.textContent),
    );
    const c = confirmar?.getBoundingClientRect();
    return {
      valor: campo.value,
      confirmarVisible: c ? c.top < window.innerHeight : false,
      desborde: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  check(
    peso.valor === "12,5",
    "PC-002 · el peso escrito se conserva",
    peso.valor,
  );
  check(
    peso.confirmarVisible,
    "PC-002 · el botón de confirmar la pesada es alcanzable",
  );
  check(peso.desborde <= 1, "PC-002 · pesaje sin desplazamiento horizontal");
  await ctx.close();
}

// ============================================================
// PC-001 · Iniciar reparto: un toque, sin doble envío
// ============================================================
{
  const ctx = await browser.newContext(TELEFONO);
  const page = await ctx.newPage();
  await entrar(page);
  // Se prepara un pedido con preventista para poder iniciarlo.
  const id = await page.evaluate(async () => {
    const lista = await (
      await fetch("/api/orders", { credentials: "include" })
    ).json();
    const o =
      lista.find((x) => x.status === "preparando" && x.driver) ||
      lista.find((x) => x.status === "recibido" && x.driver);
    if (!o) return null;
    if (o.status === "recibido")
      await fetch(`/api/orders/${o.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "preparando" }),
      });
    return o.id;
  });
  if (!id) {
    check(
      false,
      "PC-001 · no se encontró un pedido con preventista para iniciar",
    );
  } else {
    let peticiones = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes(`/api/orders/${id}`))
        peticiones++;
    });
    // En local el servidor contesta en menos de 1 ms y el estado pendiente no llega a verse.
    // Se demora la petición a propósito para comprobar que la señal existe y bloquea el botón.
    await page.route(`**/api/orders/${id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      await new Promise((r) => setTimeout(r, 900));
      await route.fallback();
    });
    // Se filtra por el número del pedido preparado para abrir ese y no otro.
    const numero = await page.evaluate(
      async (orderId) =>
        String(
          (
            await (
              await fetch(`/api/orders/${orderId}`, { credentials: "include" })
            ).json()
          ).number || "",
        ).padStart(5, "0"),
      id,
    );
    await page.goto(BASE + "/operacion");
    await page.waitForTimeout(1800);
    await page.fill('input[aria-label="Buscar pedidos"]', numero);
    await page.waitForTimeout(1200);
    await page.locator(".dc-open").first().click();
    await page.waitForTimeout(1200);
    const boton = page.locator('button:has-text("Iniciar reparto")');
    if (await boton.count()) {
      const t0 = Date.now();
      // Doble toque rápido: solo puede salir una petición.
      await boton.click();
      await page.waitForTimeout(250);
      const feedback = Date.now() - t0;
      const textoPendiente = await page
        .locator('button:has-text("Iniciando reparto")')
        .count();
      const bloqueado = await page
        .locator('button:has-text("Iniciando reparto")[disabled]')
        .count();
      // Segundo toque mientras está pendiente: no puede salir otra petición.
      await boton.click({ force: true }).catch(() => {});
      await page.waitForTimeout(4000);
      check(
        bloqueado > 0,
        "PC-001 · el botón queda bloqueado mientras se confirma",
      );
      check(
        peticiones <= 1,
        "PC-001 · el doble toque no manda dos veces",
        `${peticiones} petición(es)`,
      );
      check(
        textoPendiente > 0,
        "PC-001 · se ve “Iniciando reparto…” apenas se toca",
        `a los ${feedback} ms`,
      );
      const estado = await page.evaluate(
        async (orderId) =>
          (
            await (
              await fetch(`/api/orders/${orderId}`, { credentials: "include" })
            ).json()
          ).status,
        id,
      );
      check(
        estado === "en_camino",
        "PC-001 · el pedido queda en camino",
        estado,
      );
    } else {
      check(
        false,
        "PC-001 · no apareció el botón de iniciar reparto en la ficha",
      );
    }
  }
  await ctx.close();
}

await browser.close();

const fallas = resultados.filter((r) => r.estado === "FALLA");
for (const r of resultados)
  console.log(
    `${r.estado === "ok" ? "✔" : "✘"} ${r.nombre}${r.detalle ? ` — ${r.detalle}` : ""}`,
  );
console.log(
  `\n${resultados.length - fallas.length} de ${resultados.length} comprobaciones en verde.`,
);
process.exit(fallas.length ? 1 : 0);
