import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { openStore } from "../server/store.mjs";
import { accountSummary } from "../domain.mjs";

/**
 * Por defecto sólo informa. Un cero no demuestra una pérdida histórica.
 * --plan=archivo.json --apply aplica exclusivamente diferencias conciliadas:
 * [{phone, balanceDelta, boxesDelta, expectedBalance, expectedBoxes, reason}]
 * El plan debe indicar lo que falta, no el saldo completo del backup.
 */
export async function restaurarHistoricos({
  dbPath = "data/pollito.sqlite",
  backupPath = "data/backups/pollito-2026-09-22.sqlite",
  plan = [],
  apply = false,
  log = console.log,
} = {}) {
  if (!existsSync(dbPath) || !existsSync(backupPath))
    throw Error(
      "La base actual y el respaldo deben existir. No se crea una base vacía.",
    );
  if (resolve(dbPath) === resolve(backupPath))
    throw Error("El respaldo debe ser distinto de la base actual.");
  if (!Array.isArray(plan) || (apply && !plan.length))
    throw Error(
      "Para aplicar se requiere un plan de diferencias conciliadas por cliente.",
    );
  const phones = new Set();
  for (const row of plan) {
    if (
      !row.phone ||
      phones.has(row.phone) ||
      !row.reason?.trim() ||
      ![
        row.balanceDelta,
        row.boxesDelta,
        row.expectedBalance,
        row.expectedBoxes,
      ].every(Number.isFinite) ||
      !Number.isInteger(row.boxesDelta) ||
      !Number.isInteger(row.expectedBoxes)
    )
      throw Error(
        "Plan inválido: clientes únicos, importes y cajas válidos, estado esperado y motivo obligatorios.",
      );
    phones.add(row.phone);
  }
  const temp = await mkdtemp(join(tmpdir(), "pollito-historicos-"));
  let old, current;
  try {
    // Leer una copia consistente: nunca ejecutar migraciones sobre el respaldo original.
    const source = new DatabaseSync(backupPath, { readOnly: true });
    try {
      await sqliteBackup(source, join(temp, "historico.sqlite"));
    } finally {
      source.close();
    }
    old = await openStore(join(temp, "historico.sqlite"));
    const historical = new Map(
      old.customers
        .all()
        .map((c) => [
          c.phone,
          accountSummary(old.orders.forCustomer(c.phone), c),
        ]),
    );
    old.close();
    old = null;
    current = await openStore(dbPath);
    const key =
      "restauracion:" +
      createHash("sha256")
        .update(
          JSON.stringify(
            [...plan].sort((a, b) => a.phone.localeCompare(b.phone)),
          ),
        )
        .digest("hex");
    if (apply && current.settings.get(key))
      return { restaurados: 0, alreadyApplied: true };
    const validate = () =>
      plan.map((row) => {
        const c = current.customers.get(row.phone);
        if (!c || !historical.has(row.phone))
          throw Error(
            "Cliente del plan ausente en base actual o respaldo: " + row.phone,
          );
        const before = accountSummary(current.orders.forCustomer(c.phone), c);
        if (
          before.balance !== row.expectedBalance ||
          before.boxes !== row.expectedBoxes
        )
          throw Error(
            "El saldo cambió; volver a conciliar el cliente " + row.phone,
          );
        return { row, c, before };
      });
    const candidates = current.customers.all().map((c) => ({
      phone: c.phone,
      historical: historical.get(c.phone),
      current: accountSummary(current.orders.forCustomer(c.phone), c),
    }));
    validate();
    if (!apply) {
      log(
        "Sólo revisión. Ningún saldo se restaura por estar en cero; se requiere un plan conciliado.",
      );
      return { dryRun: true, restaurados: 0, candidates, plan };
    }
    const backupDir = join(dirname(dbPath), "backups");
    mkdirSync(backupDir, { recursive: true });
    const safetyBackup = join(
      backupDir,
      `antes-restauracion-${randomUUID()}.sqlite`,
    );
    current.db.exec(`VACUUM INTO '${safetyBackup.replace(/'/g, "''")}'`);
    current.transaction(() => {
      for (const { row, c } of validate()) {
        c.balanceAdjustments = [
          ...(c.balanceAdjustments || []),
          {
            id: key + ":" + c.phone,
            at: new Date().toISOString(),
            by: "restauracion-conciliada",
            amount: row.balanceDelta,
            note: row.reason,
          },
        ];
        c.boxesAdjust = (c.boxesAdjust || 0) + row.boxesDelta;
        current.customers.save(c);
      }
      current.settings.set(key, {
        at: new Date().toISOString(),
        plan,
        safetyBackup,
      });
    });
    return { restaurados: plan.length, safetyBackup };
  } finally {
    old?.close();
    current?.close();
    await rm(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && /restaurar-historicos\.mjs$/.test(process.argv[1])) {
  const arg = (name) =>
    process.argv
      .find((x) => x.startsWith(`--${name}=`))
      ?.split("=")
      .slice(1)
      .join("=");
  const result = await restaurarHistoricos({
    dbPath:
      arg("db") ||
      process.env.DB_PATH ||
      `${process.env.DATA_DIR || "data"}/pollito.sqlite`,
    backupPath: arg("backup") || undefined,
    plan: arg("plan") ? JSON.parse(readFileSync(arg("plan"), "utf8")) : [],
    apply: process.argv.includes("--apply"),
  });
  console.log(JSON.stringify(result, null, 2));
}
