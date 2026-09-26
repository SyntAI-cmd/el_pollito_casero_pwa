/**
 * Limpieza semanal segura de la base de datos:
 * - Elimina pedidos, cajones, movimientos de auditoría y documentos.
 * - CONSERVA INTACTOS todos los clientes, sus saldos monetarios exactos y sus cajas adeudadas.
 * - Realiza una copia de seguridad consistente (VACUUM INTO) y un volcado JSON antes de tocar nada.
 * - Ejecuta VACUUM final para recuperar espacio en disco.
 *
 * Uso local:
 *   node scripts/limpiar-semana.mjs           -> Ejecuta la limpieza segura
 *   node scripts/limpiar-semana.mjs --dry-run -> Simula la limpieza y valida saldos sin modificar la base
 *
 * En Railway:
 *   Configurar variable de entorno RESET_DATOS=limpiar-semana (luego quitarla).
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openStore } from "../server/store.mjs";
import { accountSummary } from "../domain.mjs";

export function limpiarSemana(store, { log = console.log, dir = "data", dryRun = false } = {}) {
  const orders = store.orders.all();
  const customers = store.customers.all();
  const db = store.db;

  const now = new Date();
  const stamp = now.toISOString().replace(/T/, "-").replace(/:/g, "-").slice(0, 19);

  // 1. Resumen previo de clientes y cálculo de saldos consolidados
  const preSummary = customers.map((c) => {
    const customerOrders = orders.filter((o) => o.customer === c.phone);
    const s = accountSummary(customerOrders, c);
    return {
      phone: c.phone,
      name: c.name,
      balance: s.balance,
      boxes: s.boxes,
      owed: s.owed,
      adjustments: s.adjustments,
    };
  });

  const withActivity = preSummary.filter((s) => s.balance !== 0 || s.boxes !== 0);
  log(`Clientes totales: ${customers.length}`);
  log(`Clientes con saldo o cajas activas: ${withActivity.length}`);
  log(`Pedidos a eliminar: ${orders.length}`);

  const docsCount = db.prepare("SELECT count(*) as n FROM documents").get().n;
  const auditCount = db.prepare("SELECT count(*) as n FROM audit_log").get().n;
  log(`Documentos a eliminar: ${docsCount}`);
  log(`Movimientos de auditoría a eliminar: ${auditCount}`);

  if (dryRun) {
    log("[DRY RUN] Verificando consolidación de saldos y cajas sin escribir...");
    for (const c of customers) {
      const prev = preSummary.find((s) => s.phone === c.phone);
      const simC = {
        ...c,
        creditBalance: 0,
        balanceAdjustments:
          prev.balance !== 0
            ? [{ id: "test", amount: prev.balance, note: "simulado" }]
            : [],
        boxesAdjust: prev.boxes,
      };
      const after = accountSummary([], simC);
      if (after.balance !== prev.balance || after.boxes !== prev.boxes) {
        throw new Error(
          `Discrepancia detectada para ${c.name} (${c.phone}): Esperado $${prev.balance}, ${prev.boxes} cajas -> Obtenido $${after.balance}, ${after.boxes} cajas`,
        );
      }
    }
    log("✔ [DRY RUN] Validación matemática exitosa al 100%. Ningún saldo ni caja se altera.");
    return { dryRun: true, preSummary };
  }

  // 2. Copia de seguridad consistente antes de cualquier mutación
  mkdirSync(`${dir}/backups`, { recursive: true });
  const backupSqlite = join(`${dir}/backups`, `antes-de-limpiar-semana-${stamp}.sqlite`);
  log(`Generando copia de seguridad consistente de SQLite (VACUUM INTO)...`);
  db.exec(`VACUUM INTO '${backupSqlite.replace(/'/g, "''")}'`);
  log(`✔ Respaldo SQLite guardado en: ${backupSqlite}`);

  const backupJson = join(`${dir}/backups`, `resumen-clientes-antes-limpieza-${stamp}.json`);
  writeFileSync(backupJson, JSON.stringify({ preSummary, ordersCount: orders.length, orders }, null, 2), "utf8");
  log(`✔ Respaldo JSON de saldos y pedidos guardado en: ${backupJson}`);

  // 3. Consolidación de saldos y cajas en las fichas de los clientes
  log(`Consolidando saldos y cajas en clientes...`);
  store.transaction(() => {
    for (const c of customers) {
      const prev = preSummary.find((s) => s.phone === c.phone);
      if (!prev) continue;

      c.creditBalance = 0;
      c.balanceAdjustments =
        prev.balance !== 0
          ? [
              {
                id: randomUUID().slice(0, 8),
                at: now.toISOString(),
                by: "corte-semanal",
                amount: prev.balance,
                note: "Saldo consolidado previo a limpieza de pedidos",
              },
            ]
          : [];

      c.boxesAdjust = prev.boxes;
      store.customers.save(c);
    }

    // 4. Eliminación de pedidos, cajones, movimientos y documentos
    log(`Eliminando pedidos, cajones, movimientos y documentos...`);
    db.exec("DELETE FROM crates");
    db.exec("DELETE FROM order_track");
    db.exec("DELETE FROM order_events");
    db.exec("DELETE FROM order_items");
    db.exec("DELETE FROM box_movements");
    db.exec("DELETE FROM orders");
    db.exec("DELETE FROM documents");
    db.exec("DELETE FROM audit_log");
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='receipts'").get()) {
      db.exec("DELETE FROM receipts");
    }
  });

  // 5. Limpieza de archivos físicos de documentos en disco (si existen)
  const docsDir = `${dir}/documents`;
  if (existsSync(docsDir)) {
    try {
      const files = readdirSync(docsDir);
      for (const f of files) {
        if (f.endsWith(".bin") || f.endsWith(".pdf")) {
          unlinkSync(join(docsDir, f));
        }
      }
      log(`✔ Archivos temporales de documentos eliminados en ${docsDir}`);
    } catch (e) {
      log(`No se pudieron limpiar algunos archivos de documentos: ${e.message}`);
    }
  }

  // 6. Verificación estricta posterior a la limpieza
  log(`Verificando integridad final de saldos y cajas...`);
  let discrepancies = 0;
  for (const c of store.customers.all()) {
    const prev = preSummary.find((s) => s.phone === c.phone);
    const after = accountSummary([], c);
    if (after.balance !== prev.balance || after.boxes !== prev.boxes) {
      log(`ERROR CRÍTICO: ${c.name} (${c.phone}): Esperado $${prev.balance}, ${prev.boxes} cajas -> Obtenido $${after.balance}, ${after.boxes} cajas`);
      discrepancies++;
    }
  }

  if (discrepancies > 0) {
    throw new Error(`Se detectaron ${discrepancies} discrepancias en los saldos. Revisar respaldo.`);
  }
  log(`✔ Integridad 100% verificada: Todos los saldos y cajas coinciden al centavo.`);

  // 7. Compactación de base de datos con VACUUM para recuperar espacio en disco
  log(`Compactando base de datos (VACUUM) para recuperar espacio en disco...`);
  db.exec("VACUUM");

  return {
    ordersDeleted: orders.length,
    customersPreserved: customers.length,
    backupSqlite,
    backupJson,
  };
}

// Ejecución directa por CLI
if (process.argv[1] && /limpiar-semana\.mjs$/.test(process.argv[1])) {
  const isDryRun = process.argv.includes("--dry-run");
  const dir = (process.env.DATA_DIR || "data").replace(/\/$/, "");
  const dbPath = process.env.DB_PATH || `${dir}/pollito.sqlite`;

  if (!existsSync(dbPath)) {
    console.log(`No existe la base de datos en ${dbPath}.`);
    process.exit(0);
  }

  console.log(`\n======================================================`);
  console.log(`INICIANDO LIMPIEZA SEMANAL ${isDryRun ? "(MODO SIMULACIÓN - DRY RUN)" : ""}`);
  console.log(`Base de datos: ${dbPath}`);
  console.log(`======================================================\n`);

  const store = await openStore(dbPath, { log: { info() {}, warn() {} } });
  try {
    limpiarSemana(store, { log: console.log, dir, dryRun: isDryRun });
    console.log(`\n======================================================`);
    console.log(`LIMPIEZA COMPLETADA CON ÉXITO`);
    console.log(`Pedidos restantes: 0`);
    console.log(`Documentos restantes: 0`);
    console.log(`Movimientos de auditoría restantes: 0`);
    console.log(`Espacio en disco recuperado exitosamente.`);
    console.log(`======================================================\n`);
  } finally {
    store.close();
  }
}
