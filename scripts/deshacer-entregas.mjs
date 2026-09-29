/**
 * Deshace entregas marcadas por error: el pedido vuelve al estado que tenía antes (recibido,
 * preparando o en camino) como si nunca se hubiera entregado.
 *
 * Por pedido: borra los pasos del historial agregados al entregar, la fecha y quién entregó, las
 * cajas dejadas (y su movimiento), la marca de entrega en lote y, si la tanda cobró sola
 * (`cobrados`), ese cobro automático. Los saldos se recalculan solos a partir de los pedidos.
 *
 *   node scripts/deshacer-entregas.mjs                 → lista las tandas y los entregados (no toca nada)
 *   node scripts/deshacer-entregas.mjs lote:<n>        → simula deshacer esa tanda (número de la lista)
 *   node scripts/deshacer-entregas.mjs lotes           → simula deshacer TODAS las entregas en lote
 *   node scripts/deshacer-entregas.mjs fecha:2026-09-28 → simula deshacer todo lo entregado ese día
 *   node scripts/deshacer-entregas.mjs ids:P-1,P-2     → simula deshacer esos pedidos
 *   … --aplicar                                         → lo hace de verdad (con respaldo antes)
 *
 * En Railway: `railway ssh -- node scripts/deshacer-entregas.mjs …` (DB_PATH=/data/pollito.sqlite),
 * o RESET_DATOS=deshacer-entregas:<alcance> (y sacar la variable + `railway redeploy --yes`).
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { planDesentrega, aplicarDesentrega } from "../server/desentregar.mjs";

/**
 * Tandas de "Marcar entregados del día". El registro de auditoría de la tanda no guardaba la lista
 * de pedidos, así que se reconstruyen por la marca `deliveredInBatch` que queda en cada pedido:
 * todos los de una tanda comparten `delivered_at`.
 */
function batches(db) {
  const rows = db
    .prepare(
      `SELECT id, name, delivered_at, json_extract(data, '$.deliveredInBatch') AS by
       FROM orders WHERE status = 'entregado' AND json_extract(data, '$.deliveredInBatch') IS NOT NULL
       ORDER BY delivered_at`,
    )
    .all();
  const map = new Map();
  for (const r of rows) {
    const k = `${r.delivered_at}|${r.by}`;
    if (!map.has(k)) map.set(k, { at: r.delivered_at, by: r.by, ids: [] });
    map.get(k).ids.push(r.id);
  }
  return [...map.values()].map((b, i) => ({ n: i + 1, ...b }));
}

/** Resuelve el alcance a una lista de ids. */
function pick(db, scope) {
  const [kind, value = ""] = scope.split(":");
  const all = batches(db);
  if (kind === "lote") {
    const b = all.find((x) => String(x.n) === value);
    if (!b) throw new Error(`No hay tanda ${value}.`);
    return b.ids;
  }
  if (kind === "lotes") return all.flatMap((b) => b.ids);
  if (kind === "fecha") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("fecha:AAAA-MM-DD");
    // Día de Argentina (UTC-3).
    const from = new Date(`${value}T03:00:00.000Z`).toISOString();
    const to = new Date(Date.parse(from) + 86400000).toISOString();
    return db
      .prepare(
        `SELECT id FROM orders WHERE status = 'entregado' AND delivered_at >= ? AND delivered_at < ?`,
      )
      .all(from, to)
      .map((r) => r.id);
  }
  if (kind === "ids") return value.split(",").filter(Boolean);
  throw new Error(`Alcance desconocido: ${scope}`);
}

export function deshacerEntregas(
  db,
  scope,
  { aplicar = false, dir = "data", log = console.log } = {},
) {
  const targets = pick(db, scope);
  const plan = [];
  const skipped = [];
  for (const id of targets) {
    const p = planDesentrega(db, id);
    if (p.error) skipped.push(`${id}: ${p.error}`);
    else plan.push(p);
  }

  log(`Pedidos a volver atrás: ${plan.length}`);
  for (const { o, prev, unpay } of plan)
    log(
      `  ${o.id} · ${o.name} · entregado ${o.delivered_at} por ${o.delivered_by || "?"} → ${prev}` +
        (o.boxes ? ` · quita ${o.boxes} cajas` : "") +
        (unpay ? " · quita cobro automático" : ""),
    );
  for (const s of skipped) log(`  (salteado) ${s}`);
  if (!aplicar) {
    log("Simulación: no se modificó nada. Agregá --aplicar para hacerlo.");
    return { aplicado: false, pedidos: plan.map((p) => p.o.id), skipped };
  }
  if (!plan.length) return { aplicado: false, pedidos: [], skipped };

  mkdirSync(join(dir, "backups"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(dir, "backups", `antes-de-deshacer-entregas-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  log(`Respaldo: ${backup}`);

  const audit = db.prepare(`INSERT INTO audit_log(at, actor_role, actor, actor_name, action, entity,
    entity_id, category, detail) VALUES(?,?,?,?,?,?,?,?,?)`);
  const at = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const p of plan) {
      const { o, prev, unpay } = p;
      aplicarDesentrega(db, p);
      audit.run(
        at,
        "admin",
        "mantenimiento",
        "Mantenimiento",
        "order.deliver.undo",
        "order",
        o.id,
        "pedidos",
        JSON.stringify({
          vuelveA: prev,
          entregadoEl: o.delivered_at,
          entregadoPor: o.delivered_by,
          cajas: o.boxes,
          cobroQuitado: !!unpay,
          motivo: "entrega marcada por error",
        }),
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  log(`Listo: ${plan.length} pedidos volvieron a su estado anterior.`);
  return { aplicado: true, pedidos: plan.map((p) => p.o.id), skipped, backup };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const scope = args.find((a) => !a.startsWith("--"));
  const path =
    process.env.DB_PATH ||
    (process.env.DATA_DIR ? join(process.env.DATA_DIR, "pollito.sqlite") : "data/pollito.sqlite");
  const db = new DatabaseSync(path, { readOnly: !aplicar });
  if (!scope) {
    console.log("Tandas de 'Marcar entregados del día':");
    for (const b of batches(db))
      console.log(`  lote:${b.n} · ${b.at} · ${b.by} · ${b.ids.length} pedidos`);
    console.log("Entregados por día (hora Argentina):");
    for (const r of db
      .prepare(
        `SELECT substr(datetime(delivered_at, '-3 hours'), 1, 10) AS dia, count(*) AS n
         FROM orders WHERE status = 'entregado' GROUP BY dia ORDER BY dia`,
      )
      .all())
      console.log(`  ${r.dia}: ${r.n}`);
  } else deshacerEntregas(db, scope, { aplicar, dir: dirname(path) });
  db.close();
}
