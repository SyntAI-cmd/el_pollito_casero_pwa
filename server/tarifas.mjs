import { createHash } from "node:crypto";
import {
  products,
  productByName,
  newProductFrom,
  registerProduct,
} from "../domain.mjs";
import { fail } from "./errors.mjs";
import * as INICIAL from "./tarifas-inicial.mjs";

/**
 * Listas de precios por cliente (10/2026).
 *
 * Dos ejes, como la planilla de administración:
 *   - Pollo entero: cada cliente está en una lista (Mayorista, Preferencial, Comercial, Minorista)
 *     o es especial (precio propio fijo, p. ej. Alfredo).
 *   - Trozado: precio por mayor o por menor según cuánto trozado llevó en los últimos días
 *     (regla configurable; se puede fijar a mano por cliente). Un corte "en oferta" va por mayor
 *     para todos.
 *
 * La definición vive en el setting `tarifas`; la asignación en la ficha (`tarifa`, `trozadoNivel`).
 * Los precios que usan los pedidos siguen siendo los precios propios (customer_prices): "aplicar"
 * los escribe en una sola operación auditada y reversible (mismo historial que la actualización por
 * porcentaje). Solo se tocan los productos que el cliente ya tiene con precio; la única fila nueva
 * es el pollo de un especial que todavía no lo tenía cargado.
 */

const LISTA = "lista:";
const TROZADO = "trozado:";
const nowIso = () => new Date().toISOString();
const toCents = (n) => Math.round(Number(n) * 100);
const pesos = (c) => c / 100;
const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
const fecha = (d) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Mendoza",
  }).format(d);

/** Claves de cada precio de la definición: [clave, producto]. Las usa también el aumento por %. */
export const tarifaKeys = (t) => [
  ...(t?.listas || []).map((l) => [LISTA + l.id, "entero"]),
  ...Object.keys(t?.trozado || {}).flatMap((pid) => [
    [TROZADO + "mayor", pid],
    [TROZADO + "menor", pid],
  ]),
];
export function tarifaGet(t, key, productId) {
  if (!t) return null;
  if (key.startsWith(LISTA))
    return Number(t.listas.find((l) => LISTA + l.id === key)?.pollo);
  const e = t.trozado?.[productId];
  return e ? Number(e[key.slice(TROZADO.length)]) : null;
}
export function tarifaSet(t, key, productId, value) {
  if (key.startsWith(LISTA)) {
    const l = t.listas.find((l) => LISTA + l.id === key);
    if (l) l.pollo = value;
  } else if (t.trozado?.[productId])
    t.trozado[productId][key.slice(TROZADO.length)] = value;
}
export const tarifaLabel = (t, key) =>
  key.startsWith(LISTA)
    ? `Lista ${t?.listas.find((l) => LISTA + l.id === key)?.nombre || key.slice(LISTA.length)}`
    : `Trozado por ${key.slice(TROZADO.length)}`;

const normalizar = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Nivel de trozado según los kilos del período. */
export const nivelPorKg = (kg, umbralKg) =>
  kg >= umbralKg ? "mayor" : "menor";

/** Precio que corresponde a un producto para una asignación (null = no lo define la lista). */
export function precioDe(t, { tarifa, nivel }, productId) {
  if (!t || !tarifa) return null;
  if (productId === "entero") {
    const l = t.listas.find((l) => l.id === tarifa);
    return l ? Number(l.pollo) : null;
  }
  const e = t.trozado[productId];
  if (!e) return null;
  return Number(e.oferta ? e.mayor : e[nivel]);
}

export function createTarifas({ store, events, actorOf, priceOps }) {
  const db = store.db;
  const { q: pq, saveOp, writePrices, opView, reference } = priceOps;

  // "Pata muslo" va en la planilla aparte del cuarto. En producción ya existe (se creó desde un
  // pedido); si el catálogo no la tiene, se agrega al aplicar las listas, como cualquier producto
  // nuevo (el mismo camino que "Otro" con nombre).
  const pataId = () => productByName("Pata muslo")?.id || "pata-muslo";
  function asegurarPata() {
    if (productByName("Pata muslo")) return false;
    const data = newProductFrom("Pata muslo");
    const saved = { ...data, category: "trozado", created: nowIso() };
    store.settings.set("customProducts", [
      ...store.settings.get("customProducts", []),
      saved,
    ]);
    registerProduct(saved);
    return true;
  }

  const q = {
    kilos: db.prepare(
      `SELECT o.customer, i.product_id AS productId,
         CASE WHEN i.kg > 0 THEN i.kg ELSE COALESCE(i.ordered, 0) END AS kg
       FROM orders o JOIN order_items i ON i.order_id = o.id
       WHERE COALESCE(o.delivery_date, substr(o.created, 1, 10)) BETWEEN ? AND ?
         AND o.status != 'cancelado' AND o.cancelled = 0`,
    ),
    pedidos: db.prepare(
      "SELECT COUNT(*) AS n, MAX(COALESCE(delivery_date, substr(created, 1, 10))) AS ultimo FROM orders WHERE customer = ? AND status != 'cancelado'",
    ),
    own: db.prepare(
      "SELECT product_id AS productId, price FROM customer_prices WHERE customer = ?",
    ),
  };

  const porDefecto = () => ({
    listas: INICIAL.LISTAS_INICIALES.map((l) => ({ ...l })),
    trozado: Object.fromEntries(
      Object.entries(INICIAL.TROZADO_INICIAL).map(([pid, e]) => [
        pid === "pata-muslo" ? pataId() : pid,
        { ...e },
      ]),
    ),
    ...INICIAL.REGLA_INICIAL,
  });
  const guardada = () => store.settings.get("tarifas", null);
  const config = () => guardada() || porDefecto();

  // Propuesta inicial por nombre exacto de ficha.
  const propuesta = new Map();
  for (const [tarifa, nombres] of Object.entries(INICIAL.ASIGNACION_INICIAL))
    for (const n of nombres) propuesta.set(n, { tarifa });
  for (const [n, pollo] of Object.entries(INICIAL.ESPECIALES_INICIALES))
    propuesta.set(n, { tarifa: "especial", pollo });
  for (const n of INICIAL.SUCURSALES_BENEDETTI)
    propuesta.set(n, {
      tarifa: "especial",
      pollo: INICIAL.POLLO_BENEDETTI,
      sinPrecio: true,
      grupo: "Sucursal de Benedetti",
    });
  for (const n of INICIAL.SIN_PRECIO_ESPECIALES)
    propuesta.set(n, { tarifa: "especial", sinPrecio: true });
  for (const [n, nivel] of Object.entries(INICIAL.TROZADO_FIJO))
    propuesta.set(n, { ...propuesta.get(n), trozado: nivel });

  /** Kilos de trozado por cliente en el período de la regla. */
  function kilos(t, hoy = new Date()) {
    const hasta = fecha(hoy);
    const desde = fecha(new Date(hoy.getTime() - (t.dias - 1) * 86400000));
    const out = {};
    for (const r of q.kilos.all(desde, hasta)) {
      if (!t.trozado[r.productId]) continue;
      const c = (out[r.customer] ||= { kg: 0, productos: {} });
      c.kg += r.kg;
      c.productos[r.productId] = (c.productos[r.productId] || 0) + r.kg;
    }
    return { desde, hasta, porCliente: out };
  }

  /** Asignación vigente de una ficha: la guardada o, si nunca se aplicó, la propuesta. */
  function asignacion(c, t, kg) {
    const prop = c.tarifa === undefined ? propuesta.get(c.name) : null;
    const tarifa = c.tarifa !== undefined ? c.tarifa : prop?.tarifa || null;
    const trozado = c.trozadoNivel || prop?.trozado || "auto";
    const nivel = trozado === "auto" ? nivelPorKg(kg, t.umbralKg) : trozado;
    return { tarifa, trozado, nivel, prop };
  }

  /** Todo el tablero: clientes, precios actuales y los que corresponden, y cambios de fichas. */
  function build(hoy) {
    const t = config();
    const k = kilos(t, hoy);
    const activos = store.customers.all().filter((c) => !c.archived);
    const nombres = new Set(activos.map((c) => c.name));
    const clientes = [];
    for (const c of activos) {
      const kg = Math.round((k.porCliente[c.phone]?.kg || 0) * 10) / 10;
      const a = asignacion(c, t, kg);
      const own = q.own.all(c.phone);
      const filas = [];
      for (const r of own) {
        const p = products.find((x) => x.id === r.productId);
        let despues = r.price;
        if (r.productId === "entero" && a.tarifa === "especial")
          despues = a.prop?.pollo ?? r.price; // un especial conserva su precio
        else {
          const v = precioDe(t, a, r.productId);
          if (v !== null && Number.isFinite(v) && v > 0) despues = v;
        }
        filas.push({
          productId: r.productId,
          product: p?.name || r.productId,
          antes: r.price,
          despues,
        });
      }
      // Especial nuevo sin pollo cargado (p. ej. una sucursal): se le crea esa sola fila.
      if (
        a.prop?.pollo &&
        a.tarifa === "especial" &&
        !own.some((r) => r.productId === "entero")
      )
        filas.unshift({
          productId: "entero",
          product: "Pollo entero",
          antes: 0,
          despues: a.prop.pollo,
          nueva: true,
        });
      // Lo que la lista le daría en un pedido nuevo para productos que todavía no tiene con precio.
      const sugeridos = {};
      for (const pid of ["entero", ...Object.keys(t.trozado)]) {
        if (own.some((r) => r.productId === pid)) continue;
        const v = precioDe(t, a, pid);
        if (v) sugeridos[pid] = v;
      }
      clientes.push({
        phone: c.phone,
        name: c.name,
        tarifa: a.tarifa,
        propuesta: !!a.prop,
        trozado: a.trozado,
        nivel: a.nivel,
        kg,
        kgPorProducto: Object.fromEntries(
          Object.entries(k.porCliente[c.phone]?.productos || {}).map(
            ([pid, v]) => [pid, Math.round(v * 10) / 10],
          ),
        ),
        noPricing: !!c.noPricing,
        sinPrecioPropuesto: !!a.prop?.sinPrecio && !c.noPricing,
        grupo: a.prop?.grupo || "",
        filas,
        sugeridos,
        cambios: filas.filter((f) => f.antes !== f.despues).length,
      });
    }
    clientes.sort((a, b) => a.name.localeCompare(b.name, "es"));

    const porNombre = new Map(activos.map((c) => [c.name, c]));
    const eliminar = [];
    for (const n of INICIAL.ELIMINAR) {
      const c = porNombre.get(n);
      if (c) eliminar.push({ phone: c.phone, name: c.name, dudoso: "" });
    }
    for (const [n, motivo] of Object.entries(INICIAL.ELIMINAR_DUDOSOS)) {
      const c = porNombre.get(n);
      if (c) eliminar.push({ phone: c.phone, name: c.name, dudoso: motivo });
    }
    for (const e of eliminar) {
      const r = q.pedidos.get(e.phone);
      e.pedidos = r.n;
      e.ultimo = r.ultimo;
    }
    const sinPrecio = clientes
      .filter((c) => c.sinPrecioPropuesto)
      .map((c) => ({ phone: c.phone, name: c.name, grupo: c.grupo }));
    // Nombres de la planilla que no tienen ficha activa con ese nombre exacto.
    const noEncontrados = [...propuesta.keys()].filter((n) => !nombres.has(n));

    const cambios = clientes.flatMap((c) =>
      c.filas
        .filter((f) => f.antes !== f.despues)
        .map((f) => ({
          source: "cliente",
          customer: c.phone,
          customerName: c.name,
          productId: f.productId,
          from: toCents(f.antes),
          calc: toCents(f.despues),
          to: toCents(f.despues),
        })),
    );
    const asignar = clientes.filter((c) => c.propuesta);
    const ref = reference();
    const mayorista = t.listas.find((l) => l.id === "mayorista") || t.listas[0];
    const token = hash({
      t,
      g: !!guardada(),
      ref: ref?.cents ?? 0,
      c: cambios.map((r) => [r.customer, r.productId, r.from, r.to]),
      a: asignar.map((c) => [c.phone, c.tarifa, c.trozado]),
    });
    return {
      config: {
        ...t,
        guardada: !!guardada(),
        productos: Object.keys(t.trozado).map((pid) => ({
          id: pid,
          name: products.find((p) => p.id === pid)?.name || pid,
        })),
      },
      periodo: { desde: k.desde, hasta: k.hasta },
      referencia: ref ? pesos(ref.cents) : null,
      referenciaNueva: Number(mayorista.pollo),
      clientes,
      fichas: { eliminar, sinPrecio, noEncontrados },
      cambios,
      asignar: asignar.length,
      token,
    };
  }

  const view = (b) => {
    const { cambios, ...rest } = b;
    return {
      ...rest,
      resumen: {
        clientes: new Set(cambios.map((r) => r.customer)).size,
        precios: cambios.length,
        nuevas: cambios.filter((r) => !r.from).length,
        asignar: b.asignar,
      },
    };
  };

  function aplicar(session, body) {
    const opId = String(body.opId || "");
    if (!/^[\w-]{8,80}$/.test(opId))
      fail(400, "Falta el identificador de la operación.");
    const r = store.transaction(() => {
      const existing = pq.op.get(opId);
      if (existing) {
        if (existing.kind !== "tarifas" || existing.token !== body.token)
          fail(409, "Esa operación ya se registró con otros datos.");
        return { repeated: true, update: opView(existing) };
      }
      const b = build();
      if (b.token !== body.token)
        fail(
          409,
          "Los precios, las listas o las fichas cambiaron desde que abriste el tablero. Recargalo y revisá antes de aplicar.",
        );
      if (!b.cambios.length && !b.asignar)
        fail(400, "No hay precios ni asignaciones para aplicar.");
      const actor = actorOf(session);
      const at = nowIso();
      const t = config();
      if (!guardada() && asegurarPata())
        store.audit.log(session, "product.create", "product", pataId(), {
          name: "Pata muslo",
        });
      if (!guardada()) store.settings.set("tarifas", t);
      // La propuesta pasa a ser la asignación guardada de cada ficha.
      for (const c of b.clientes.filter((c) => c.propuesta)) {
        const f = store.customers.get(c.phone);
        f.tarifa = c.tarifa;
        if (c.trozado !== "auto") f.trozadoNivel = c.trozado;
        store.customers.save(f);
      }
      writePrices(b.cambios, actor, at);
      const before = reference()?.cents ?? 0;
      const after = toCents(b.referenciaNueva);
      store.settings.set("priceReference", {
        cents: after,
        updated: at,
        by: actor,
        opId,
      });
      saveOp(
        session,
        {
          id: opId,
          kind: "tarifas",
          deltaCents: after - before,
          refBefore: before,
          refAfter: after,
          factor: "—",
          percent: "—",
          rounding: { step: 0, mode: "exacto" },
          scope: {
            listas: t.listas,
            trozado: t.trozado,
            regla: { umbralKg: t.umbralKg, dias: t.dias },
            periodo: b.periodo,
            asignados: b.asignar,
          },
          token: b.token,
        },
        b.cambios,
      );
      store.audit.log(
        session,
        "prices.tarifas",
        "prices",
        opId,
        {
          tipo: "tarifas",
          alcance: {
            precios: b.cambios.length,
            clientes: new Set(b.cambios.map((r) => r.customer)).size,
            asignados: b.asignar,
          },
        },
        {
          antes: { referencia: pesos(before) },
          despues: { referencia: pesos(after) },
          opId,
          categoria: "Precios",
        },
      );
      return {
        repeated: false,
        update: opView(pq.op.get(opId)),
        customers: b.clientes.map((c) => c.phone),
      };
    });
    if (!r.repeated) {
      events.productsChanged?.();
      for (const phone of r.customers) events.customerChanged?.({ phone });
    }
    return { repeated: r.repeated, update: r.update };
  }

  const precio = (v, name) => {
    const n = Number(String(v ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 1000000)
      fail(400, `Revisá el precio de ${name}.`);
    return Math.round(n * 100) / 100;
  };
  function guardarConfig(session, body) {
    const t = structuredClone(config());
    if (Array.isArray(body.listas))
      for (const l of t.listas) {
        const e = body.listas.find((x) => x?.id === l.id);
        if (!e) continue;
        if (e.nombre !== undefined) {
          const nombre = String(e.nombre).trim();
          if (nombre.length < 2 || nombre.length > 30)
            fail(400, "El nombre de la lista va de 2 a 30 letras.");
          l.nombre = nombre;
        }
        if (e.pollo !== undefined)
          l.pollo = precio(e.pollo, `la lista ${l.nombre}`);
      }
    if (body.trozado && typeof body.trozado === "object")
      for (const [pid, e] of Object.entries(body.trozado)) {
        if (!t.trozado[pid]) fail(400, "Producto inválido: " + pid);
        const name = products.find((p) => p.id === pid)?.name || pid;
        if (e.mayor !== undefined) t.trozado[pid].mayor = precio(e.mayor, name);
        if (e.menor !== undefined) t.trozado[pid].menor = precio(e.menor, name);
        if (e.oferta !== undefined) t.trozado[pid].oferta = e.oferta === true;
      }
    if (body.umbralKg !== undefined) {
      const v = Number(body.umbralKg);
      if (!Number.isFinite(v) || v < 1 || v > 5000)
        fail(400, "El umbral va de 1 a 5000 kg.");
      t.umbralKg = v;
    }
    if (body.dias !== undefined) {
      const v = Number(body.dias);
      if (!Number.isInteger(v) || v < 1 || v > 60)
        fail(400, "El período va de 1 a 60 días.");
      t.dias = v;
    }
    const antes = config();
    store.transaction(() => {
      store.settings.set("tarifas", t);
      store.audit.log(session, "prices.listas", "prices", "tarifas", null, {
        categoria: "Precios",
        motivo:
          "Cambio en la definición de las listas (los precios de los clientes cambian al aplicar).",
        cambios: {
          listas: [
            antes.listas.map((l) => `${l.nombre} ${l.pollo}`).join(" · "),
            t.listas.map((l) => `${l.nombre} ${l.pollo}`).join(" · "),
          ],
        },
      });
    });
  }

  const TARIFAS = () => [...config().listas.map((l) => l.id), "especial"];
  function guardarCliente(session, phone, body) {
    const c = store.customers.get(phone);
    if (!c || c.archived) fail(404, "Cliente no encontrado.");
    const antes = {
      tarifa: c.tarifa ?? null,
      trozado: c.trozadoNivel || "auto",
    };
    if (body.tarifa !== undefined) {
      if (body.tarifa !== null && !TARIFAS().includes(body.tarifa))
        fail(400, "Lista inválida.");
      c.tarifa = body.tarifa;
    }
    if (body.trozado !== undefined) {
      if (!["auto", "mayor", "menor"].includes(body.trozado))
        fail(400, "Nivel de trozado inválido.");
      if (body.trozado === "auto") delete c.trozadoNivel;
      else c.trozadoNivel = body.trozado;
    }
    store.transaction(() => {
      store.customers.save(c);
      store.audit.log(session, "customer.tarifa", "customer", phone, null, {
        categoria: "Precios",
        cambios: {
          lista: [antes.tarifa, c.tarifa ?? null],
          trozado: [antes.trozado, c.trozadoNivel || "auto"],
        },
      });
    });
    events.customerChanged?.({ phone });
  }

  /** Cambios de fichas pedidos por administración: eliminar (o archivar) y marcar sin precio. */
  function fichas(session, body) {
    const eliminar = Array.isArray(body.eliminar)
      ? body.eliminar.map(String)
      : [];
    const sinPrecio = Array.isArray(body.sinPrecio)
      ? body.sinPrecio.map(String)
      : [];
    if (!eliminar.length && !sinPrecio.length)
      fail(400, "Elegí al menos una ficha.");
    const out = { eliminadas: 0, archivadas: 0, sinPrecio: 0 };
    store.transaction(() => {
      for (const phone of eliminar) {
        const c = store.customers.get(phone);
        if (!c || c.archived) continue;
        const removed = store.customers.remove(phone);
        if (!removed) store.customers.save({ ...c, archived: true });
        out[removed ? "eliminadas" : "archivadas"]++;
        store.audit.log(
          session,
          removed ? "customer.delete" : "customer.archive",
          "customer",
          phone,
          { name: c.name },
          { motivo: "Depuración de clientes al cargar las listas de precios." },
        );
      }
      for (const phone of sinPrecio) {
        const c = store.customers.get(phone);
        if (!c || c.archived || c.noPricing) continue;
        c.noPricing = true;
        store.customers.save(c);
        out.sinPrecio++;
        store.audit.log(session, "customer.ficha", "customer", phone, null, {
          antes: { noPricing: false },
          despues: { noPricing: true },
          motivo: "Va sin precio en el remito (solo kilos).",
        });
      }
    });
    for (const phone of [...eliminar, ...sinPrecio])
      events.customerChanged?.({ phone });
    return out;
  }

  /**
   * Precio que la lista le da a cada cliente para los productos que todavía no tiene con precio
   * propio: lo usa la carga de pedidos para que el precio venga puesto (y se pueda corregir).
   */
  function sugeridos(customers) {
    const t = config();
    const k = kilos(t);
    const out = {};
    for (const c of customers) {
      const kg = k.porCliente[c.phone]?.kg || 0;
      const a = asignacion(c, t, kg);
      if (!a.tarifa) continue;
      const m = {};
      for (const pid of ["entero", ...Object.keys(t.trozado)]) {
        const v =
          pid === "entero" && a.tarifa === "especial"
            ? a.prop?.pollo || null
            : precioDe(t, a, pid);
        if (v) m[pid] = v;
      }
      out[c.phone] = { tarifa: a.tarifa, nivel: a.nivel, precios: m };
    }
    return out;
  }

  const adminOnly = (session) => {
    if (session?.role !== "admin")
      fail(403, "Las listas de precios las maneja administración.");
  };

  async function handle({ method, path, body, session }) {
    if (!path.startsWith("/api/tarifas")) return null;
    const json = (status, b) => ({ status, body: b });
    adminOnly(session);
    if (path === "/api/tarifas" && method === "GET")
      return json(200, view(build()));
    if (path === "/api/tarifas/config" && method === "PUT") {
      guardarConfig(session, body || {});
      return json(200, view(build()));
    }
    if (path === "/api/tarifas/aplicar" && method === "POST") {
      const r = aplicar(session, body || {});
      return json(r.repeated ? 200 : 201, r);
    }
    if (path === "/api/tarifas/fichas" && method === "POST") {
      const r = fichas(session, body || {});
      return json(200, { ...r, tablero: view(build()) });
    }
    const one = path.match(/^\/api\/tarifas\/clientes\/([^/]+)$/);
    if (one && method === "PUT") {
      guardarCliente(session, decodeURIComponent(one[1]), body || {});
      return json(200, view(build()));
    }
    return null;
  }
  handle.sugeridos = sugeridos;
  handle.build = build;
  return handle;
}
