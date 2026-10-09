import { createHash } from "node:crypto";
import { products, plans, productPrice, validateLists } from "../domain.mjs";
import { fail } from "./errors.mjs";
import { tarifaGet, tarifaSet, tarifaKeys, tarifaLabel } from "./tarifas.mjs";

/**
 * Actualización masiva de precios (solo administración).
 *
 * El administrativo ingresa cuánto cambia el kilo de pollo (D). El porcentaje sale UNA vez del
 * precio de referencia (B): factor = (B + D) / B. Ese factor se aplica una sola vez a cada fuente
 * de precio que existe hoy:
 *   - las listas por modalidad (mayorista / intermedio / minorista), compartidas por todos los
 *     clientes de esa modalidad que no tienen precio propio para el producto;
 *   - los precios propios de cada cliente (customer_prices), que pisan la lista.
 * No hay descuentos ni bonificaciones en el modelo: cada precio propio es un importe fijo.
 * No se crean combinaciones cliente-producto nuevas ni se tocan pedidos ya cargados.
 *
 * Toda la cuenta es en centavos con enteros (BigInt para el producto): el porcentaje que se muestra
 * (7,69 %) es solo informativo; el precio nuevo usa el factor exacto.
 */

export const STEPS = [0, 10, 50, 100];
export const MODES = ["cercano", "arriba"];
const MAX_PRICE_CENTS = 100000000; // $1.000.000, el mismo tope que el resto de la app
const nowIso = () => new Date().toISOString();
export const toCents = (n) => Math.round(Number(n) * 100);
const pesos = (c) => c / 100;

/** División entera redondeando al más cercano (mitades hacia arriba), para positivos. */
const divRound = (num, den) => (2n * num + den) / (2n * den);
const divCeil = (num, den) => (num + den - 1n) / den;

/**
 * Precio nuevo de un precio vigente `pc` (centavos) con la referencia que pasa de `refBefore` a
 * `refAfter`. Devuelve el cálculo proporcional (a dos decimales, la política monetaria de la app) y
 * el precio final con el redondeo comercial elegido aplicado sobre ese cálculo.
 */
export function scale(
  pc,
  refBefore,
  refAfter,
  { step = 0, mode = "cercano" } = {},
) {
  const calc = divRound(BigInt(pc) * BigInt(refAfter), BigInt(refBefore));
  if (!step) return { calc: Number(calc), final: Number(calc) };
  const s = BigInt(step * 100);
  const final = (mode === "arriba" ? divCeil(calc, s) : divRound(calc, s)) * s;
  return { calc: Number(calc), final: Number(final) };
}

/** "1,0769230769" a partir de la fracción exacta. */
export function factorText(refBefore, refAfter) {
  const scaled = (BigInt(refAfter) * 10n ** 10n) / BigInt(refBefore);
  const s = scaled.toString().padStart(11, "0");
  return `${s.slice(0, -10)},${s.slice(-10)}`;
}
/** Porcentaje a mostrar, con dos decimales y signo: "7,69" o "-5,13". */
export function percentText(refBefore, delta) {
  const v = (delta / refBefore) * 100;
  return v.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Productos avícolas por kilo: el pollo entero y el trozado del catálogo. "Otro" es un renglón libre. */
const poultry = (p) =>
  p.id !== "otro" && ["entero", "trozado"].includes(p.category);
const productName = (id) => products.find((p) => p.id === id)?.name || id;
const planLabel = {
  mayorista: "Mayorista",
  intermedio: "Intermedio",
  minorista: "Minorista",
};

/** Valida los parámetros de una actualización. Devuelve { deltaCents, rounding, excluded }. */
export function parseParams(body = {}) {
  if (!["aumentar", "disminuir"].includes(body.direction))
    fail(400, "Elegí si el pollo aumenta o disminuye.");
  const raw = String(body.amount ?? "")
    .trim()
    .replace(",", ".");
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount <= 0)
    fail(400, "Ingresá un importe mayor que cero, en pesos por kilo.");
  if (amount > 1000000) fail(400, "El importe es demasiado alto.");
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 1e-6)
    fail(400, "El importe admite hasta dos decimales.");
  const step = Number(body.rounding?.step ?? 0);
  if (!STEPS.includes(step)) fail(400, "Elegí un redondeo válido.");
  const mode = step ? String(body.rounding?.mode || "") : "cercano";
  if (!MODES.includes(mode)) fail(400, "Elegí la dirección del redondeo.");
  const excluded = Array.isArray(body.excluded)
    ? [...new Set(body.excluded.map(String))]
        .filter((id) => products.some((p) => p.id === id))
        .sort()
    : [];
  return {
    direction: body.direction,
    deltaCents: body.direction === "aumentar" ? cents : -cents,
    rounding: { step, mode },
    excluded,
  };
}

const hash = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

export function createPriceUpdates({ store, events, actorOf }) {
  const db = store.db;
  const SCHEMA_OPS = `
CREATE TABLE IF NOT EXISTS price_updates(
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('aumento','disminucion','reversion','tarifas')),
  at TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL,
  delta_cents INTEGER NOT NULL, ref_before INTEGER NOT NULL, ref_after INTEGER NOT NULL,
  factor TEXT NOT NULL, percent TEXT NOT NULL, rounding TEXT NOT NULL, scope TEXT NOT NULL,
  token TEXT NOT NULL, reverts TEXT REFERENCES price_updates(id), reverted_by TEXT, changes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS price_update_items(
  update_id TEXT NOT NULL REFERENCES price_updates(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('lista','cliente','tarifa')), plan TEXT, customer TEXT, customer_name TEXT,
  product_id TEXT NOT NULL, before_cents INTEGER NOT NULL, calc_cents INTEGER NOT NULL, after_cents INTEGER NOT NULL);`;
  const INDEXES = `
CREATE INDEX IF NOT EXISTS price_updates_at ON price_updates(at DESC);
CREATE INDEX IF NOT EXISTS price_update_items_op ON price_update_items(update_id);`;
  const existing = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'price_updates'",
    )
    .get();
  if (existing && !existing.sql.includes("'tarifas'")) {
    // Migración (10/2026): las tablas del 08/10 no admitían el tipo "tarifas" ni la fuente "tarifa".
    // SQLite no cambia un CHECK: se rearman con las mismas columnas y se copian las filas.
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(
        "ALTER TABLE price_update_items RENAME TO price_update_items_v1; ALTER TABLE price_updates RENAME TO price_updates_v1; DROP INDEX IF EXISTS price_updates_at; DROP INDEX IF EXISTS price_update_items_op;",
      );
      db.exec(SCHEMA_OPS);
      db.exec(
        "INSERT INTO price_updates SELECT * FROM price_updates_v1; INSERT INTO price_update_items SELECT * FROM price_update_items_v1; DROP TABLE price_update_items_v1; DROP TABLE price_updates_v1;",
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
  db.exec(SCHEMA_OPS + INDEXES);
  const q = {
    ownAll: db.prepare(
      `SELECT cp.customer, cp.product_id AS productId, cp.price, c.name, c.plan
       FROM customer_prices cp JOIN customers c ON c.phone = cp.customer
       ORDER BY c.name COLLATE NOCASE, cp.customer, cp.product_id`,
    ),
    own: db.prepare(
      "SELECT price FROM customer_prices WHERE customer = ? AND product_id = ?",
    ),
    setOwn: db.prepare(
      "UPDATE customer_prices SET price = ?, updated = ?, by_actor = ? WHERE customer = ? AND product_id = ? AND price = ?",
    ),
    addOwn: db.prepare(
      "INSERT INTO customer_prices(customer, product_id, price, updated, by_actor) VALUES(?,?,?,?,?) ON CONFLICT(customer, product_id) DO NOTHING",
    ),
    dropOwn: db.prepare(
      "DELETE FROM customer_prices WHERE customer = ? AND product_id = ? AND price = ?",
    ),
    planCounts: db.prepare(
      "SELECT plan, COUNT(*) AS n FROM customers GROUP BY plan",
    ),
    op: db.prepare("SELECT * FROM price_updates WHERE id = ?"),
    latest: db.prepare(
      "SELECT * FROM price_updates ORDER BY at DESC, rowid DESC LIMIT 1",
    ),
    recent: db.prepare(
      "SELECT * FROM price_updates ORDER BY at DESC, rowid DESC LIMIT ?",
    ),
    items: db.prepare(
      "SELECT * FROM price_update_items WHERE update_id = ? ORDER BY rowid",
    ),
    insertOp: db.prepare(
      `INSERT INTO price_updates(id, kind, at, actor_id, actor_name, delta_cents, ref_before, ref_after,
        factor, percent, rounding, scope, token, reverts, changes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ),
    insertItem: db.prepare(
      `INSERT INTO price_update_items(update_id, source, plan, customer, customer_name, product_id,
        before_cents, calc_cents, after_cents) VALUES(?,?,?,?,?,?,?,?,?)`,
    ),
    markReverted: db.prepare(
      "UPDATE price_updates SET reverted_by = ? WHERE id = ? AND reverted_by IS NULL",
    ),
  };

  /** Precio de referencia del pollo entero por kilo: configuración explícita de administración. */
  const reference = () => {
    const r = store.settings.get("priceReference", null);
    return r && Number.isInteger(r.cents) && r.cents > 0 ? r : null;
  };
  const storedLists = () => store.settings.get("priceLists", null) || {};
  const storedTarifas = () => store.settings.get("tarifas", null);

  /** Arma la operación completa contra los datos de este instante (vista previa y aplicación usan lo mismo). */
  function buildPlan(params) {
    const ref = reference();
    if (!ref)
      fail(
        409,
        "Falta configurar el precio de referencia del pollo antes de actualizar precios.",
      );
    const refBefore = ref.cents;
    const refAfter = refBefore + params.deltaCents;
    if (refAfter <= 0)
      fail(
        400,
        "La disminución deja el precio de referencia en cero o negativo.",
      );
    const excluded = new Set(params.excluded);
    const exclusions = [];
    const inScope = [];
    for (const p of products) {
      if (p.id === "otro")
        exclusions.push({
          productId: p.id,
          product: p.name,
          reason:
            "Renglón libre: puede ser cualquier producto, no se sabe si es pollo.",
        });
      else if (!poultry(p))
        exclusions.push({
          productId: p.id,
          product: p.name,
          reason: "No es un producto avícola del catálogo.",
        });
      else if (excluded.has(p.id))
        exclusions.push({
          productId: p.id,
          product: p.name,
          reason: "Excluido por administración en esta actualización.",
        });
      else inScope.push(p);
    }
    const scopeIds = new Set(inScope.map((p) => p.id));
    const items = [];
    const errors = [];
    const notes = [];
    const push = (it) => {
      const { calc, final } = scale(
        it.before,
        refBefore,
        refAfter,
        params.rounding,
      );
      const row = { ...it, calc, final };
      if (final <= 0) row.error = "El precio final queda en cero o negativo.";
      else if (final > MAX_PRICE_CENTS)
        row.error = "El precio final supera $1.000.000.";
      if (row.error) errors.push(row);
      items.push(row);
    };
    // 1) Listas por modalidad: una entrada por producto y modalidad, aunque la usen muchos clientes.
    const lists = storedLists();
    for (const p of inScope)
      for (const plan of plans) {
        const v = productPrice(p, plan, lists);
        if (Number.isFinite(Number(v)) && Number(v) > 0)
          push({
            source: "lista",
            plan,
            productId: p.id,
            product: p.name,
            before: toCents(v),
          });
        else
          notes.push(
            `${p.name}: sin precio en la lista ${planLabel[plan].toLowerCase()} (solo cambian sus precios propios).`,
          );
      }
    // 1b) Listas por cliente (Mayorista, Preferencial…) y trozado por mayor/por menor: una vez cada una.
    const tarifas = storedTarifas();
    if (tarifas)
      for (const [key, productId] of tarifaKeys(tarifas)) {
        if (!scopeIds.has(productId)) continue;
        const v = tarifaGet(tarifas, key, productId);
        if (Number.isFinite(v) && v > 0)
          push({
            source: "tarifa",
            plan: key,
            productId,
            product: productName(productId),
            before: toCents(v),
          });
      }
    // 2) Precios propios: cada fila existente, una vez. Las que no existen no se crean.
    for (const r of q.ownAll.all()) {
      const name = productName(r.productId);
      if (!scopeIds.has(r.productId)) {
        if (!products.some((p) => p.id === r.productId))
          exclusions.push({
            productId: r.productId,
            product: name,
            customer: r.customer,
            customerName: r.name,
            reason: "El producto ya no está en el catálogo.",
          });
        continue; // los productos excluidos ya figuran arriba, con su motivo
      }
      const before = toCents(r.price);
      if (!Number.isFinite(Number(r.price)) || before <= 0) {
        exclusions.push({
          productId: r.productId,
          product: name,
          customer: r.customer,
          customerName: r.name,
          reason: "Precio propio en cero o inválido: no se modifica.",
        });
        continue;
      }
      push({
        source: "cliente",
        customer: r.customer,
        customerName: r.name,
        productId: r.productId,
        product: name,
        before,
      });
    }
    // Cuántas filas de precio propio quedaron fuera por producto excluido (para que el alcance sea real).
    const ownSkipped = {};
    for (const r of q.ownAll.all())
      if (
        !scopeIds.has(r.productId) &&
        products.some((p) => p.id === r.productId)
      )
        ownSkipped[r.productId] = (ownSkipped[r.productId] || 0) + 1;
    for (const e of exclusions)
      if (!e.customer && ownSkipped[e.productId])
        e.ownRows = ownSkipped[e.productId];

    const token = hash({
      ref: refBefore,
      d: params.deltaCents,
      r: params.rounding,
      x: params.excluded,
      i: items.map((i) => [
        i.source,
        i.plan || i.customer,
        i.productId,
        i.before,
      ]),
    });
    const planCustomers = Object.fromEntries(
      q.planCounts.all().map((r) => [r.plan, r.n]),
    );
    return {
      kind: params.deltaCents > 0 ? "aumento" : "disminucion",
      deltaCents: params.deltaCents,
      refBefore,
      refAfter,
      factor: factorText(refBefore, refAfter),
      percent: percentText(refBefore, params.deltaCents),
      rounding: params.rounding,
      excluded: params.excluded,
      products: inScope.map((p) => ({ id: p.id, name: p.name })),
      planCustomers,
      items,
      errors,
      exclusions,
      notes,
      token,
    };
  }

  const view = (row) => ({
    ...row,
    before: pesos(row.before),
    calc: pesos(row.calc),
    final: pesos(row.final),
  });
  const planView = (plan) => ({
    ...plan,
    refBefore: pesos(plan.refBefore),
    refAfter: pesos(plan.refAfter),
    delta: pesos(plan.deltaCents),
    items: plan.items.map(view),
    errors: plan.errors.map(view),
    summary: {
      lists: plan.items.filter((i) => i.source !== "cliente").length,
      own: plan.items.filter((i) => i.source === "cliente").length,
      customers: new Set(
        plan.items.filter((i) => i.customer).map((i) => i.customer),
      ).size,
      products: new Set(plan.items.map((i) => i.productId)).size,
      unchanged: plan.items.filter((i) => i.final === i.before).length,
    },
  });

  const opView = (r, withItems = false) => {
    const latest = q.latest.get();
    const out = {
      id: r.id,
      kind: r.kind,
      at: r.at,
      actor: r.actor_name,
      delta: pesos(r.delta_cents),
      refBefore: pesos(r.ref_before),
      refAfter: pesos(r.ref_after),
      factor: r.factor,
      percent: r.percent,
      rounding: JSON.parse(r.rounding),
      scope: JSON.parse(r.scope),
      reverts: r.reverts,
      revertedBy: r.reverted_by,
      changes: r.changes,
      revertible:
        latest?.id === r.id && r.kind !== "reversion" && !r.reverted_by,
    };
    if (withItems)
      out.items = q.items.all(r.id).map((i) => ({
        source: i.source,
        plan: i.plan,
        customer: i.customer,
        customerName: i.customer_name,
        productId: i.product_id,
        product: productName(i.product_id),
        before: pesos(i.before_cents),
        calc: pesos(i.calc_cents),
        final: pesos(i.after_cents),
      }));
    return out;
  };

  /** Escribe los precios de una operación ya validada. Corre dentro de la transacción. */
  function writePrices(rows, actor, at) {
    const lists = structuredClone(storedLists());
    let listChanged = false;
    const tarifas = structuredClone(storedTarifas());
    let tarifaChanged = false;
    for (const r of rows) {
      if (r.source === "tarifa") {
        if (
          !tarifas ||
          toCents(tarifaGet(tarifas, r.plan, r.productId)) !== r.from
        )
          fail(
            409,
            `${tarifaLabel(tarifas, r.plan)} de ${productName(r.productId)} cambió mientras tanto. Recalculá la vista previa.`,
          );
        tarifaSet(tarifas, r.plan, r.productId, pesos(r.to));
        tarifaChanged = true;
      } else if (r.source === "lista") {
        // Se fija el valor de lista efectivo (business.json o editado) para ese producto y modalidad.
        const p = products.find((x) => x.id === r.productId);
        if (toCents(productPrice(p, r.plan, lists)) !== r.from)
          fail(
            409,
            `La lista ${r.plan} de ${p.name} cambió mientras tanto. Recalculá la vista previa.`,
          );
        (lists[r.productId] ||= {})[r.plan] = pesos(r.to);
        listChanged = true;
      } else {
        // Antes 0 = la fila no existía (se crea); después 0 = se borra (reversión de una creación).
        const done = !r.from
          ? q.addOwn.run(r.customer, r.productId, pesos(r.to), at, actor)
          : !r.to
            ? q.dropOwn.run(r.customer, r.productId, pesos(r.from))
            : q.setOwn.run(
                pesos(r.to),
                at,
                actor,
                r.customer,
                r.productId,
                pesos(r.from),
              );
        if (done.changes !== 1)
          fail(
            409,
            `El precio de ${r.customerName || r.customer} para ${productName(r.productId)} cambió mientras tanto. Recalculá la vista previa.`,
          );
      }
    }
    if (listChanged) store.settings.set("priceLists", validateLists(lists));
    if (tarifaChanged) store.settings.set("tarifas", tarifas);
  }

  function saveOp(session, op, rows) {
    const actor = actorOf(session);
    const at = nowIso();
    q.insertOp.run(
      op.id,
      op.kind,
      at,
      session.staffId != null ? `staff:${session.staffId}` : null,
      actor,
      op.deltaCents,
      op.refBefore,
      op.refAfter,
      op.factor,
      op.percent,
      JSON.stringify(op.rounding),
      JSON.stringify(op.scope),
      op.token,
      op.reverts || null,
      rows.length,
    );
    for (const r of rows)
      q.insertItem.run(
        op.id,
        r.source,
        r.plan || null,
        r.customer || null,
        r.customerName || null,
        r.productId,
        r.from,
        r.calc,
        r.to,
      );
    return at;
  }

  function apply(session, body) {
    const opId = String(body.opId || "");
    if (!/^[\w-]{8,80}$/.test(opId))
      fail(400, "Falta el identificador de la operación.");
    const params = parseParams(body);
    return store.transaction(() => {
      const existing = q.op.get(opId);
      if (existing) {
        if (existing.token !== body.token || existing.kind === "reversion")
          fail(409, "Esa operación ya se registró con otros datos.");
        return { repeated: true, update: opView(existing) };
      }
      const plan = buildPlan(params);
      if (plan.token !== body.token)
        fail(
          409,
          "Los precios o la referencia cambiaron desde la vista previa. Recalculala antes de confirmar.",
        );
      if (plan.errors.length)
        fail(400, "Hay precios con errores: revisá la vista previa.");
      if (!plan.items.length) fail(400, "No hay precios para actualizar.");
      const actor = actorOf(session);
      const at = nowIso();
      const rows = plan.items.map((i) => ({
        ...i,
        from: i.before,
        to: i.final,
      }));
      writePrices(rows, actor, at);
      store.settings.set("priceReference", {
        cents: plan.refAfter,
        updated: at,
        by: actor,
        opId,
      });
      saveOp(
        session,
        {
          id: opId,
          ...plan,
          scope: {
            products: plan.products,
            excluded: plan.excluded,
            exclusions: plan.exclusions,
            notes: plan.notes,
          },
        },
        rows,
      );
      store.audit.log(
        session,
        "prices.bulk",
        "prices",
        opId,
        {
          tipo: plan.kind,
          variacion: pesos(plan.deltaCents),
          porcentaje: plan.percent,
          factor: plan.factor,
          redondeo: plan.rounding,
          alcance: {
            listas: rows.filter((r) => r.source !== "cliente").length,
            preciosPropios: rows.filter((r) => r.source === "cliente").length,
          },
        },
        {
          antes: { referencia: pesos(plan.refBefore) },
          despues: { referencia: pesos(plan.refAfter) },
          opId,
          categoria: "Precios",
        },
      );
      return { repeated: false, update: opView(q.op.get(opId)) };
    });
  }

  /** Qué haría revertir `id`: valores a restaurar y conflictos que lo impiden. */
  function buildRevert(id) {
    const op = q.op.get(id);
    if (!op) fail(404, "Esa actualización no existe.");
    if (op.kind === "reversion")
      fail(
        409,
        "Una reversión no se revierte. Si hace falta, cargá una actualización nueva.",
      );
    if (op.reverted_by) fail(409, "Esa actualización ya fue revertida.");
    const latest = q.latest.get();
    if (latest.id !== op.id)
      fail(
        409,
        "Solo se puede revertir la última actualización masiva. Después de esta hubo otra operación.",
      );
    const items = q.items.all(id);
    const conflicts = [];
    const ref = reference();
    if (!ref || ref.cents !== op.ref_after)
      conflicts.push({
        what: "Precio de referencia del pollo",
        expected: pesos(op.ref_after),
        current: ref ? pesos(ref.cents) : null,
      });
    const lists = storedLists();
    for (const i of items) {
      const product = productName(i.product_id);
      if (i.source === "tarifa") {
        const t = storedTarifas();
        const v = t ? tarifaGet(t, i.plan, i.product_id) : null;
        const current = Number.isFinite(v) ? toCents(v) : null;
        if (current !== i.after_cents)
          conflicts.push({
            what: `${tarifaLabel(t, i.plan)} · ${product}`,
            expected: pesos(i.after_cents),
            current: current === null ? null : pesos(current),
          });
      } else if (i.source === "lista") {
        const p = products.find((x) => x.id === i.product_id);
        const current = p ? toCents(productPrice(p, i.plan, lists)) : null;
        if (current !== i.after_cents)
          conflicts.push({
            what: `Lista ${planLabel[i.plan]?.toLowerCase() || i.plan} · ${product}`,
            expected: pesos(i.after_cents),
            current: current === null ? null : pesos(current),
          });
      } else {
        const r = q.own.get(i.customer, i.product_id);
        // Una fila que la operación borró (después 0) no debe existir para poder restaurarla.
        const current = r ? toCents(r.price) : i.after_cents === 0 ? 0 : null;
        if (current !== i.after_cents)
          conflicts.push({
            what: `${i.customer_name || i.customer} · ${product}`,
            expected: pesos(i.after_cents),
            current: current === null ? null : pesos(current),
          });
      }
    }
    const token = hash({
      revert: id,
      ref: ref?.cents ?? null,
      i: items.map((i) => [
        i.source,
        i.plan || i.customer,
        i.product_id,
        i.after_cents,
      ]),
      c: conflicts.length,
    });
    return { op, items, conflicts, token };
  }

  function revertPreview(id) {
    const { op, items, conflicts, token } = buildRevert(id);
    return {
      update: opView(op),
      refRestore: pesos(op.ref_before),
      items: items.map((i) => ({
        source: i.source,
        plan: i.plan,
        customer: i.customer,
        customerName: i.customer_name,
        productId: i.product_id,
        product: productName(i.product_id),
        current: pesos(i.after_cents),
        restore: pesos(i.before_cents),
      })),
      conflicts,
      token,
    };
  }

  function revert(session, id, body) {
    const opId = String(body.opId || "");
    if (!/^[\w-]{8,80}$/.test(opId))
      fail(400, "Falta el identificador de la operación.");
    return store.transaction(() => {
      const existing = q.op.get(opId);
      if (existing) {
        if (existing.reverts !== id)
          fail(409, "Esa operación ya se registró con otros datos.");
        return { repeated: true, update: opView(existing) };
      }
      const { op, items, conflicts, token } = buildRevert(id);
      if (conflicts.length)
        fail(
          409,
          "Hay precios que cambiaron después de la actualización. La reversión quedó bloqueada: revisá los conflictos.",
        );
      if (token !== body.token)
        fail(
          409,
          "Los datos cambiaron desde la vista previa de la reversión. Volvé a generarla.",
        );
      const actor = actorOf(session);
      const at = nowIso();
      const rows = items.map((i) => ({
        source: i.source,
        plan: i.plan,
        customer: i.customer,
        customerName: i.customer_name,
        productId: i.product_id,
        from: i.after_cents,
        calc: i.before_cents,
        to: i.before_cents,
      }));
      writePrices(rows, actor, at);
      store.settings.set("priceReference", {
        cents: op.ref_before,
        updated: at,
        by: actor,
        opId,
      });
      saveOp(
        session,
        {
          id: opId,
          kind: "reversion",
          deltaCents: op.ref_before - op.ref_after,
          refBefore: op.ref_after,
          refAfter: op.ref_before,
          factor: factorText(op.ref_after, op.ref_before),
          percent: percentText(op.ref_after, op.ref_before - op.ref_after),
          rounding: { step: 0, mode: "exacto" },
          scope: { restores: op.id },
          token,
          reverts: op.id,
        },
        rows,
      );
      q.markReverted.run(opId, op.id);
      store.audit.log(
        session,
        "prices.revert",
        "prices",
        opId,
        {
          tipo: "reversion",
          revierte: op.id,
          alcance: { precios: rows.length },
        },
        {
          antes: { referencia: pesos(op.ref_after) },
          despues: { referencia: pesos(op.ref_before) },
          opId,
          categoria: "Precios",
        },
      );
      return { repeated: false, update: opView(q.op.get(opId)) };
    });
  }

  function setReference(session, body) {
    const raw = String(body.value ?? "")
      .trim()
      .replace(",", ".");
    const v = Number(raw);
    if (!raw || !Number.isFinite(v) || v <= 0 || v > 1000000)
      fail(400, "Ingresá un precio de referencia mayor que cero.");
    const cents = Math.round(v * 100);
    if (Math.abs(v * 100 - cents) > 1e-6)
      fail(400, "El precio admite hasta dos decimales.");
    const before = reference();
    const at = nowIso();
    store.transaction(() => {
      store.settings.set("priceReference", {
        cents,
        updated: at,
        by: actorOf(session),
        manual: true,
      });
      store.audit.log(
        session,
        "prices.reference",
        "prices",
        "reference",
        null,
        {
          antes: { referencia: before ? pesos(before.cents) : null },
          despues: { referencia: pesos(cents) },
          motivo: body.motivo,
          categoria: "Precios",
        },
      );
    });
    return state();
  }

  function state() {
    const ref = reference();
    const lists = storedLists();
    const entero = products.find((p) => p.id === "entero");
    const last = q.recent.all(1)[0];
    return {
      reference: ref
        ? {
            value: pesos(ref.cents),
            updated: ref.updated,
            by: ref.by,
            manual: !!ref.manual,
          }
        : null,
      // Pista para la primera configuración: el "precio base" de las listas. No se toma solo.
      listBase: entero ? productPrice(entero, "mayorista", lists) : null,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        eligible: poultry(p),
        created: !!p.created,
      })),
      // Lo que se excluyó a mano la última vez se propone igual (por ejemplo, un producto que no es pollo).
      lastExcluded:
        last && last.kind !== "reversion"
          ? JSON.parse(last.scope).excluded || []
          : [],
      history: q.recent.all(30).map((r) => opView(r)),
    };
  }

  const adminOnly = (session) => {
    if (session?.role !== "admin")
      fail(403, "Solo administración actualiza precios.");
  };
  const notifyAll = (customers) => {
    events.productsChanged?.();
    for (const phone of new Set(customers)) events.customerChanged?.({ phone });
  };

  /** Enrutador del módulo: null si la ruta no es suya. */
  async function handle({ method, path, body, session }) {
    if (!path.startsWith("/api/precios/")) return null;
    const json = (status, b) => ({ status, body: b });
    if (path === "/api/precios/actualizacion" && method === "GET") {
      adminOnly(session);
      return json(200, state());
    }
    if (path === "/api/precios/referencia" && method === "PUT") {
      adminOnly(session);
      return json(200, setReference(session, body || {}));
    }
    if (
      path === "/api/precios/actualizacion/vista-previa" &&
      method === "POST"
    ) {
      adminOnly(session);
      return json(200, planView(buildPlan(parseParams(body || {}))));
    }
    if (path === "/api/precios/actualizacion" && method === "POST") {
      adminOnly(session);
      const r = apply(session, body || {});
      if (!r.repeated)
        notifyAll(
          q.items
            .all(r.update.id)
            .map((i) => i.customer)
            .filter(Boolean),
        );
      return json(r.repeated ? 200 : 201, r);
    }
    const one = path.match(
      /^\/api\/precios\/actualizaciones\/([\w-]+)(?:\/(reversion|reversion\/vista-previa))?$/,
    );
    if (one) {
      adminOnly(session);
      const id = one[1];
      if (!one[2] && method === "GET") {
        const r = q.op.get(id);
        if (!r) fail(404, "Esa actualización no existe.");
        return json(200, opView(r, true));
      }
      if (one[2] === "reversion/vista-previa" && method === "POST")
        return json(200, revertPreview(id));
      if (one[2] === "reversion" && method === "POST") {
        const r = revert(session, id, body || {});
        if (!r.repeated)
          notifyAll(
            q.items
              .all(r.update.id)
              .map((i) => i.customer)
              .filter(Boolean),
          );
        return json(r.repeated ? 200 : 201, r);
      }
    }
    return null;
  }
  // Las listas por cliente (server/tarifas.mjs) registran su operación en este mismo historial.
  handle.internal = { q, saveOp, writePrices, opView, reference, notifyAll };
  return handle;
}
