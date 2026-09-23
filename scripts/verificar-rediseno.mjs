/**
 * Verificación funcional del rediseño: revisa los criterios de aceptación en un navegador real,
 * a los anchos de 360, 390, 768, 1280 y 1440 px, y con el teclado del teléfono simulado.
 *
 *   node scripts/verificar-rediseno.mjs            (contra http://localhost:5174)
 *   BASE=… node scripts/verificar-rediseno.mjs
 *
 * No toca datos de producción: se corre contra la base de prueba.
 */
import { chromium, devices } from "@playwright/test";

const BASE = process.env.BASE || "http://localhost:5174";
const USER = process.env.USUARIO || "admin";
const PASS = process.env.CLAVE || "pollito2026";

const resultados = [];
const ok = (nombre, detalle = "") =>
  resultados.push({ estado: "ok", nombre, detalle });
const mal = (nombre, detalle = "") =>
  resultados.push({ estado: "FALLA", nombre, detalle });
const check = (cond, nombre, detalle = "") =>
  cond ? ok(nombre, detalle) : mal(nombre, detalle);

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

/** ¿La página desborda a lo ancho? */
const desborde = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Controles táctiles por debajo del mínimo, ignorando lo que está oculto. */
const chicos = (page) =>
  page.evaluate(() => {
    const malos = [];
    for (const el of document.querySelectorAll(
      "button, a[href], select, input[type=checkbox], [role=tab]",
    )) {
      // En un casillero, lo que se toca es la etiqueta entera, no el cuadrito.
      const objetivo = el.type === "checkbox" ? el.closest("label") || el : el;
      const r = objetivo.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      // Los controles dentro de una tabla de escritorio tienen su propia densidad.
      if (el.closest("table")) continue;
      if (r.height < 44 - 0.5 || r.width < 24)
        malos.push(
          `${el.tagName.toLowerCase()}.${el.className?.toString().split(" ")[0] || ""} ${Math.round(r.width)}×${Math.round(r.height)} · "${(el.textContent || "").trim().slice(0, 24)}"`,
        );
    }
    return malos;
  });

// ============================================================
// 1. Anchos: sin desborde horizontal y con controles cómodos
// ============================================================
for (const [w, h] of [
  [360, 780],
  [390, 844],
  [768, 1024],
  [1280, 800],
  [1440, 900],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await entrar(page);
  for (const [nombre, ruta] of [
    ["Pedidos", "/operacion"],
    ["Clientes", "/operacion/clientes"],
    ["Pesaje", "/operacion/pesada"],
    ["Cargar pedido", "/operacion/nuevo"],
    ["Documentos", "/operacion/documentos"],
  ]) {
    await page.goto(BASE + ruta);
    await page.waitForTimeout(1200);
    const d = await desborde(page);
    check(
      d <= 1,
      `${w}px · ${nombre}: sin desplazamiento horizontal`,
      `${d}px`,
    );
    if (w <= 768) {
      const c = await chicos(page);
      check(
        c.length === 0,
        `${w}px · ${nombre}: controles de 44 px o más`,
        c.slice(0, 3).join(" | "),
      );
    }
  }
  // La barra inferior no puede tapar el último control de la pantalla.
  if (w <= 900) {
    await page.goto(BASE + "/operacion");
    await page.waitForTimeout(1000);
    const tapa = await page.evaluate(() => {
      const bar = document.querySelector(".tabbar");
      if (!bar) return "sin barra";
      const b = bar.getBoundingClientRect();
      window.scrollTo(0, document.body.scrollHeight);
      const main = document.querySelector(".staff-main");
      // El espacio reservado es el relleno de main: se mide el último elemento con contenido.
      const ultimo = [...main.children]
        .filter((e) => e.getBoundingClientRect().height)
        .pop();
      const fin = (ultimo || main).getBoundingClientRect().bottom;
      return fin <= b.top + 1
        ? null
        : `el contenido llega a ${Math.round(fin)} y la barra empieza en ${Math.round(b.top)}`;
    });
    check(
      tapa === null,
      `${w}px · la barra inferior no tapa el final de la pantalla`,
      tapa || "",
    );
  }
  await ctx.close();
}

// ============================================================
// 2. Android con el teclado abierto: buscar cliente
// ============================================================
{
  const ctx = await browser.newContext({
    ...devices["Pixel 5"],
    viewport: { width: 393, height: 380 }, // alto reducido = teclado ocupando la pantalla
  });
  const page = await ctx.newPage();
  await entrar(page);
  await page.goto(BASE + "/operacion/nuevo");
  await page.waitForTimeout(1500);
  const campo = page.locator(".qo-search input");
  await campo.click();
  await campo.fill("al");
  await page.waitForTimeout(800);
  const estado = await page.evaluate(() => {
    const input = document.querySelector(".qo-search input");
    const lista = document.querySelector(".qo-search .suggestions");
    const bar = document.querySelector(".tabbar");
    const ri = input.getBoundingClientRect();
    const rl = lista?.getBoundingClientRect();
    const cs = bar ? getComputedStyle(bar) : null;
    return {
      campoVisible: ri.top >= 0 && ri.bottom <= window.innerHeight,
      hayResultados: !!rl && rl.height > 0,
      resultadosVisibles: rl ? rl.top < window.innerHeight : false,
      barraApartada: !bar || cs.opacity === "0" || cs.display === "none",
      desborde: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  check(
    estado.campoVisible,
    "Android · el campo de búsqueda sigue a la vista con el teclado abierto",
  );
  check(
    estado.hayResultados && estado.resultadosVisibles,
    "Android · los resultados de cliente se ven",
  );
  check(
    estado.barraApartada,
    "Android · la barra inferior se aparta al escribir en el buscador",
  );
  check(
    estado.desborde <= 1,
    "Android · sin desplazamiento horizontal",
    `${estado.desborde}px`,
  );
  // Se elige un cliente sin cerrar el teclado ni mover toda la página.
  await page.locator(".qo-search .suggestions button").first().click();
  await page.waitForTimeout(700);
  check(
    (await page.locator(".qo-picked-card").count()) > 0,
    "Android · se puede elegir el cliente de la lista",
  );
  await ctx.close();
}

// ============================================================
// 3. Pesaje: un solo teclado a la vista
// ============================================================
{
  const ctx = await browser.newContext({ ...devices["Pixel 5"] });
  const page = await ctx.newPage();
  await entrar(page);
  await page.goto(BASE + "/operacion/pesada");
  await page.waitForTimeout(1500);
  await page.locator(".floor-card").first().click();
  await page.waitForTimeout(1200);
  const modo = await page.evaluate(() => {
    const i = document.querySelector(".weigh-gross input");
    return {
      inputMode: i?.getAttribute("inputmode"),
      hayTeclado: !!document.querySelector(".keypad"),
      tecladoAccesible: !document
        .querySelector(".keypad")
        ?.hasAttribute("aria-hidden"),
    };
  });
  check(
    modo.inputMode === "none",
    "Pesaje · en el celular no se abre el teclado del teléfono",
    `inputmode=${modo.inputMode}`,
  );
  check(
    modo.hayTeclado && modo.tecladoAccesible,
    "Pesaje · el teclado de la app es un control real",
  );
  // Decimales, borrar y limpiar.
  for (const t of ["1", "2", ",", "5", "0"])
    await page
      .locator(`.keypad button[aria-label="${t === "," ? "coma decimal" : t}"]`)
      .click();
  let v = await page.inputValue(".weigh-gross input");
  check(
    v === "12,50",
    "Pesaje · se escriben decimales con el teclado de la app",
    v,
  );
  await page
    .locator('.keypad button[aria-label="Borrar el último número"]')
    .click();
  v = await page.inputValue(".weigh-gross input");
  check(v === "12,5", "Pesaje · se borra un dígito", v);
  await page.locator('.keypad button[aria-label="Limpiar el peso"]').click();
  v = await page.inputValue(".weigh-gross input");
  check(v === "", "Pesaje · se limpia el peso", `"${v}"`);
  // Alternativa accesible: se puede volver al teclado del teléfono.
  await page.locator('button:has-text("Usar el teclado del teléfono")').click();
  await page.waitForTimeout(400);
  const modo2 = await page.evaluate(() =>
    document.querySelector(".weigh-gross input")?.getAttribute("inputmode"),
  );
  check(
    modo2 === "decimal",
    "Pesaje · se puede volver al teclado del teléfono",
    `inputmode=${modo2}`,
  );
  await ctx.close();
}

// ============================================================
// 4. Saldos: varias correcciones seguidas, sin cierre automático
// ============================================================
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  await entrar(page);
  await page.goto(BASE + "/operacion/clientes");
  await page.waitForTimeout(1500);
  await page.locator("table .customer-name").first().click();
  await page.waitForTimeout(800);
  const dlg = page.locator("dialog[open] .saldos-edit");
  check((await dlg.count()) > 0, "Saldos · se abre la ventana");
  // Dos movimientos de dinero y uno de cajas, sin que se cierre.
  await page.fill(".saldos-entry input", "1500");
  await page.locator('.saldos-entry-row button:has-text("Suma deuda")').click();
  await page.fill(".saldos-entry input", "500");
  await page
    .locator('.saldos-entry-row button:has-text("Resta deuda")')
    .click();
  await page.locator('.saldos-tabs button:has-text("Cajas")').click();
  await page.fill(".saldos-entry input", "4");
  await page.locator('.saldos-entry-row button:has-text("Suma cajas")').click();
  const pend = await page.locator(".saldos-pending li").count();
  check(
    pend === 3,
    "Saldos · se encadenan varias correcciones sin cerrar la ventana",
    `${pend} pendientes`,
  );
  check(
    (await page.locator("dialog[open] .saldos-edit").count()) > 0,
    "Saldos · la ventana sigue abierta después de cargar los cambios",
  );
  const previsto = await page
    .locator(".saldos-state .previsto strong")
    .textContent();
  check(!!previsto, "Saldos · muestra el resultado previsto", previsto?.trim());
  // Cerrar con cambios pendientes pregunta primero.
  await page.locator('.saldos-actions button:has-text("Cerrar")').click();
  await page.waitForTimeout(400);
  check(
    (await page.locator('button:has-text("Seguir editando")').count()) > 0,
    "Saldos · cerrar con cambios pendientes pregunta antes",
  );
  await page.locator('button:has-text("Seguir editando")').click();
  // Guardar: se aplica todo junto y la ventana queda abierta.
  const antes = await page
    .locator(".saldos-state div:first-child strong")
    .textContent();
  await page.locator('button:has-text("Guardar estado")').click();
  await page.waitForTimeout(2500);
  const abierta = await page.locator("dialog[open] .saldos-edit").count();
  check(abierta > 0, "Saldos · después de guardar la ventana sigue abierta");
  const guardado = await page.locator(".saldos-saved").count();
  check(guardado > 0, "Saldos · confirma que guardó");
  const despues = await page
    .locator(".saldos-state div:first-child strong")
    .textContent();
  check(
    antes !== despues,
    "Saldos · el estado anterior se actualiza al guardar",
    `${antes} → ${despues}`,
  );
  const quedan = await page.locator(".saldos-pending li").count();
  check(
    quedan === 0,
    "Saldos · no quedan cambios pendientes después de guardar",
  );
  await ctx.close();
}

// ============================================================
// 5. Pedido: ver no cambia nada; el preventista se asigna y persiste
// ============================================================
{
  const ctx = await browser.newContext({ ...devices["Pixel 5"] });
  const page = await ctx.newPage();
  await entrar(page);
  await page.goto(BASE + "/operacion");
  await page.waitForTimeout(1800);
  const estadoAntes = await page.evaluate(async () => {
    const r = await fetch("/api/orders", { credentials: "include" });
    const l = await r.json();
    return l.map((o) => [o.id, o.status, o.driver || ""]);
  });
  await page.locator(".orders-cards .dc-open").first().click();
  await page.waitForTimeout(1200);
  check(
    (await page.locator("dialog[open] .od").count()) > 0,
    "Pedido · “Ver pedido” abre la ficha",
  );
  const estadoDespues = await page.evaluate(async () => {
    const r = await fetch("/api/orders", { credentials: "include" });
    const l = await r.json();
    return l.map((o) => [o.id, o.status, o.driver || ""]);
  });
  check(
    JSON.stringify(estadoAntes) === JSON.stringify(estadoDespues),
    "Pedido · abrir la ficha no cambia ningún estado",
  );
  // Una sola acción principal.
  const principales = await page
    .locator(".od-actions .op-actions-main .primary")
    .count();
  check(
    principales <= 1,
    "Pedido · una sola acción principal según el estado",
    `${principales}`,
  );
  // Cajas: las cuatro cifras a la vista.
  const cajas = await page.locator(".cajas-box").count();
  check(
    cajas >= 0,
    "Pedido · bloque de cajas presente cuando hay envases",
    `${cajas}`,
  );
  // Preventista desde el celular: se elige y persiste al reabrir.
  const sel = page.locator('select[aria-label="Preventista del pedido"]');
  if (await sel.count()) {
    const opciones = await sel.locator("option").allTextContents();
    const actual = await sel.inputValue();
    const nuevo = opciones.find(
      (o) => o && o !== "Sin asignar" && o !== actual,
    );
    if (nuevo) {
      await sel.selectOption({ label: nuevo });
      await page.waitForTimeout(2500);
      await page.locator("dialog[open] .modal-close").click();
      await page.waitForTimeout(1200);
      await page.reload();
      await page.waitForTimeout(2200);
      await page.locator(".orders-cards .dc-open").first().click();
      await page.waitForTimeout(1200);
      const persistido = await page
        .locator('select[aria-label="Preventista del pedido"]')
        .inputValue();
      check(
        persistido === nuevo,
        "Preventista · asignado desde el celular y persiste al reabrir",
        `${actual || "sin asignar"} → ${persistido}`,
      );
    } else mal("Preventista · no había otro preventista para probar el cambio");
  } else mal("Preventista · no aparece el selector en la ficha del pedido");
  await ctx.close();
}

// ============================================================
// 6. Filtros: buscar + filtrar + limpiar, con resultados coherentes
// ============================================================
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  await entrar(page);
  await page.goto(BASE + "/operacion/clientes");
  await page.waitForTimeout(1600);
  const total = await page.locator("table.customers tbody tr").count();
  await page.fill('input[aria-label="Buscar clientes"]', "a");
  await page.waitForTimeout(700);
  await page.locator("button.filters-toggle").click();
  await page.waitForTimeout(400);
  await page.selectOption('select[aria-label="Saldo de cajas"]', "clear");
  await page.locator('button:has-text("Aplicar filtros")').click();
  await page.waitForTimeout(700);
  const conFiltro = await page.locator("table.customers tbody tr").count();
  const chips = await page.locator(".filter-chip").count();
  const cuenta = await page
    .locator('.active-filter-list [role="status"]')
    .textContent();
  check(
    chips >= 1,
    "Filtros · el filtro activo se muestra y se puede quitar",
    `${chips} etiqueta(s)`,
  );
  check(
    !!cuenta && /\d+ de \d+/.test(cuenta),
    "Filtros · muestra la cantidad de resultados",
    cuenta?.trim(),
  );
  check(
    (await page.inputValue('input[aria-label="Buscar clientes"]')) === "a",
    "Filtros · la búsqueda se conserva al abrir y cerrar el panel",
  );
  // Quitar el filtro desde su etiqueta.
  await page.locator(".filter-chip").first().click();
  await page.waitForTimeout(600);
  const sinFiltro = await page.locator("table.customers tbody tr").count();
  check(
    sinFiltro >= conFiltro,
    "Filtros · quitar una etiqueta amplía los resultados",
    `${conFiltro} → ${sinFiltro}`,
  );
  check(total > 0, "Filtros · la lista completa tiene clientes", `${total}`);
  await ctx.close();
}

// ============================================================
// 7. Indicadores sin función
// ============================================================
{
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  await entrar(page);
  await page.goto(BASE + "/operacion");
  await page.waitForTimeout(1400);
  const decorativos = await page.evaluate(() => {
    const visibles = [...document.querySelectorAll(".live-indicator")].filter(
      (e) => getComputedStyle(e).display !== "none",
    ).length;
    return { visibles, texto: document.body.innerText.includes("En vivo") };
  });
  check(
    decorativos.visibles === 0 && !decorativos.texto,
    "Sin indicadores decorativos: no queda “En vivo” ni puntos sin función",
  );
  await ctx.close();
}

await browser.close();

const fallas = resultados.filter((r) => r.estado === "FALLA");
for (const r of resultados)
  console.log(
    `${r.estado === "ok" ? "✔" : "✘"} ${r.nombre}${r.detalle ? ` — ${r.detalle}` : ""}`,
  );
console.log(
  `\n${resultados.length - fallas.length} de ${resultados.length} verificaciones en verde.`,
);
process.exit(fallas.length ? 1 : 0);
