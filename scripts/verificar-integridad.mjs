/**
 * Integridad y restauración de una base SQLite de Pollito Casero, SIN tocar el original.
 *
 *  1. Copia consistente con la API de backup de SQLite (lectura; respeta el WAL: no se copia el
 *     archivo suelto mientras el servidor escribe).
 *  2. Sobre la COPIA: PRAGMA quick_check, integrity_check y foreign_key_check.
 *  3. Datos de negocio: pedidos, cajones (kilos netos y cajas), saldos de clientes, auditoría.
 *  4. Restauración de prueba: la app abre la copia (corre sus migraciones sobre la copia) y lee.
 *
 *   node scripts/verificar-integridad.mjs <base.sqlite> [<otra.sqlite> ...] [--salida=archivo.json]
 *                                         [--guardar=/data/backups/antes-de-publicar.sqlite]
 *
 * `--guardar` conserva la copia verificada (sólo si todo dio ok y el destino no existe).
 *
 * En Railway (volumen /data), con el servicio andando:
 *   railway ssh -- node scripts/verificar-integridad.mjs /data/pollito.sqlite
 * (requiere copiar este script a la imagen o ejecutarlo con `node -e`; ver RECUPERACION.md).
 */
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, rm, writeFile, stat, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const out = process.argv.find((a) => a.startsWith("--salida="))?.split("=")[1];
const keep = process.argv.find((a) => a.startsWith("--guardar="))?.split("=")[1];
if (!files.length) {
  console.error("Uso: node scripts/verificar-integridad.mjs <base.sqlite> [...]");
  process.exit(2);
}
const sha = async (p) => createHash("sha256").update(await readFile(p)).digest("hex").slice(0, 16);
const report = { sqlite: null, fecha: new Date().toISOString(), bases: [] };
for (const file of files) {
  const r = { archivo: file, bytes: (await stat(file)).size };
  const dir = await mkdtemp(join(tmpdir(), "pollito-integridad-"));
  const copy = join(dir, basename(file));
  try {
    r.sha256Antes = await sha(file);
    const src = new DatabaseSync(file, { readOnly: true });
    report.sqlite ??= src.prepare("select sqlite_version() v").get().v;
    await backup(src, copy);
    src.close();
    const db = new DatabaseSync(copy, { readOnly: true });
    r.quickCheck = db.prepare("PRAGMA quick_check").all().map((x) => Object.values(x)[0]);
    r.integrityCheck = db.prepare("PRAGMA integrity_check").all().map((x) => Object.values(x)[0]);
    r.foreignKeyCheck = db.prepare("PRAGMA foreign_key_check").all().length;
    const tables = new Set(db.prepare("select name from sqlite_master where type='table'").all().map((t) => t.name));
    const count = (t) => (tables.has(t) ? db.prepare(`select count(*) n from ${t}`).get().n : null);
    r.filas = Object.fromEntries(
      ["orders", "order_items", "crates", "customers", "payments", "box_movements", "audit_log", "staff_users", "schema_migrations"].map((t) => [t, count(t)]),
    );
    if (tables.has("crates")) {
      const c = db.prepare("select count(*) n, coalesce(round(sum(net),2),0) kg, coalesce(sum(boxes),0) cajas from crates where voided is null or voided = 0").get();
      r.cajonesVigentes = { filas: c.n, kgNetos: c.kg, cajas: c.cajas };
      // Consistencia de pesada: neto = bruto − tara por fila (tolerancia de redondeo).
      r.cajonesInconsistentes = db.prepare("select count(*) n from crates where abs(round(gross - tare, 2) - net) > 0.011").get().n;
    }
    if (tables.has("schema_migrations"))
      r.esquema = db.prepare("select max(version) v from schema_migrations").get().v;
    db.close();
    r.sha256Despues = await sha(file);
    r.originalIntacto = r.sha256Antes === r.sha256Despues;
    // Restauración de prueba: la app abre una copia de la copia (sus migraciones no tocan nada más).
    const restore = join(dir, "restaurada.sqlite");
    await copyFile(copy, restore);
    const { openStore } = await import("../server/store.mjs");
    const store = await openStore(restore, { log: { info() {}, warn() {}, error() {} } });
    const orders = store.orders.count();
    const customers = store.customers.all().length;
    const sample = store.orders.all().slice(0, 50);
    let kg = 0;
    for (const o of sample) kg += store.crates.forOrder(o.id).filter((c) => !c.voided).reduce((s, c) => s + c.net, 0);
    store.close();
    r.restauracion = { ok: true, pedidos: orders, clientes: customers, kgMuestra50: Math.round(kg * 100) / 100 };
    r.resultado =
      r.quickCheck.join() === "ok" && r.integrityCheck.join() === "ok" && r.foreignKeyCheck === 0 && r.originalIntacto
        ? "ok"
        : "REVISAR";
    if (keep && files.length === 1) {
      if (r.resultado !== "ok") r.guardada = "no: la copia no pasó los chequeos";
      else {
        const exists = await stat(keep).then(() => true, () => false);
        if (exists) r.guardada = "no: el destino ya existe (no se pisa)";
        else {
          await copyFile(copy, keep);
          r.guardada = keep;
        }
      }
    }
  } catch (e) {
    r.resultado = "ERROR";
    r.error = String(e.message || e);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  report.bases.push(r);
}
if (out) await writeFile(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.bases.every((b) => b.resultado === "ok") ? 0 : 1);
