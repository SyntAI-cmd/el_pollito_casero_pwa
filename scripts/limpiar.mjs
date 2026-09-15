// Deja la base sin datos de prueba antes de empezar a usarla en serio.
//
//   node scripts/limpiar.mjs            → borra pedidos, cajones, pagos, cierres, chat, noticias, sesiones,
//                                          suscripciones push, auditoría y las fichas de prueba (sin CUIT ni
//                                          código GC, con teléfono 549…); conserva clientes importados,
//                                          precios propios, camiones, usuarios del equipo y ajustes.
//   node scripts/limpiar.mjs --todo     → además borra TODOS los clientes, precios propios y cuentas.
//   DB_PATH=otra.sqlite node scripts/limpiar.mjs
//
// Antes de tocar nada guarda una copia en data/backups/. Apagá el servidor antes de correrlo.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dbPath = process.env.DB_PATH || "data/pollito.sqlite";
const todo = process.argv.includes("--todo");
if (!existsSync(dbPath)) {
  console.log("No existe", dbPath, "— nada que limpiar.");
  process.exit(0);
}
mkdirSync("data/backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const copy = join("data/backups", `antes-de-limpiar-${stamp}.sqlite`);
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");
db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
console.log("Copia previa:", copy);

const count = (t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
const before = Object.fromEntries(
  [
    "orders",
    "crates",
    "payments",
    "customers",
    "messages",
    "news",
    "sessions",
    "audit_log",
  ].map((t) => [t, count(t)]),
);

db.exec("BEGIN");
try {
  // Movimiento del día a día.
  for (const t of [
    "crates",
    "order_track",
    "order_events",
    "order_items",
    "box_movements",
    "orders",
    "payments",
    "cash_closures",
    "messages",
    "news",
    "push_subscriptions",
    "sessions",
    "auth_tokens",
    "audit_log",
    "geocache",
  ])
    db.exec(`DELETE FROM ${t}`);
  db.exec("UPDATE customers SET credit_balance = 0");
  if (todo) {
    for (const t of ["customer_prices", "passkeys", "accounts", "customers"])
      db.exec(`DELETE FROM ${t}`);
  } else {
    // Fichas de prueba: teléfono como clave (portal de clientes / demo) y sin código GC ni CUIT.
    const test = db
      .prepare(
        `SELECT phone, name FROM customers
         WHERE phone GLOB '549*' AND (data IS NULL OR (json_extract(data, '$.code') IS NULL AND json_extract(data, '$.cuit') IS NULL))`,
      )
      .all();
    const del = db.prepare("DELETE FROM customers WHERE phone = ?");
    for (const c of test) {
      del.run(c.phone);
      console.log("Ficha de prueba borrada:", c.name, c.phone);
    }
    db.exec("DELETE FROM passkeys; DELETE FROM accounts");
  }
  db.exec("DELETE FROM sqlite_sequence");
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
db.exec("VACUUM");
console.log("Antes:", before);
console.log("Ahora:", {
  orders: count("orders"),
  customers: count("customers"),
  customer_prices: count("customer_prices"),
  drivers: count("drivers"),
  staff_users: count("staff_users"),
});
console.log(
  todo
    ? "Base vacía: solo quedan camiones, usuarios del equipo y ajustes."
    : "Base limpia: quedan clientes importados, precios propios, camiones, usuarios del equipo y ajustes.",
);
