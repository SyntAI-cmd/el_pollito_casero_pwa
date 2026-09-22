// Puesta a cero para arrancar a usar la app en serio, sin borrar fichas ni precios.
//
//   node scripts/reset.mjs --pedidos            → borra los pedidos de HOY (con cajones y comprobantes)
//   node scripts/reset.mjs --pedidos=2026-09-16 → borra los de esa fecha
//   node scripts/reset.mjs --pedidos=todos      → borra TODOS los pedidos y pagos
//   node scripts/reset.mjs --saldos             → deja en cero el saldo y las cajas de cada cliente
//   node scripts/reset.mjs --admin=maxi,franco  → pasa esos usuarios a administrador
//
// Siempre escribe antes una copia de los clientes (con su saldo y cajas) y de los pedidos borrados
// en DATA_DIR/backups/, para tener el registro histórico por si hay un reclamo.
import { mkdirSync, writeFileSync } from "node:fs";
import { openStore } from "../server/store.mjs";
import { accountSummary } from "../domain.mjs";

const now = () => new Date().toISOString();
const today = () =>
  new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const dayOf = (o) => o.deliveryDate || (o.created || "").slice(0, 10);

/** Copia de seguridad en DATA_DIR/backups/<nombre>-<fecha>.json. Devuelve la ruta. */
export function backup(name, data, dir = "data") {
  const path = `${dir.replace(/\/$/, "")}/backups`;
  mkdirSync(path, { recursive: true });
  const file = `${path}/${name}-${now().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return file;
}

/** Borra los pedidos de una fecha ("todos" borra todo) con sus cajones y comprobantes. */
export function resetOrders(
  store,
  { date = today(), log = console.log, dir = "data" } = {},
) {
  const all = store.orders.all();
  const target = date === "todos" ? all : all.filter((o) => dayOf(o) === date);
  if (!target.length) {
    log(`No hay pedidos para ${date === "todos" ? "borrar" : date}.`);
    return { orders: 0 };
  }
  const file = backup("pedidos", target, dir);
  store.transaction(() => {
    for (const o of target) store.orders.remove(o.id);
    if (date === "todos") store.db.exec("DELETE FROM payments");
  });
  log(`Borrados ${target.length} pedidos (${date}). Copia: ${file}`);
  return { orders: target.length, backup: file };
}

/**
 * Deja el saldo de cuenta corriente y el de cajas en cero para todos los clientes, sin tocar el
 * historial de pedidos: limpia saldo a favor y ajustes previos y escribe un ajuste que cancela lo
 * que quede pendiente (queda asentado quién y cuándo).
 */
export function resetBalances(
  store,
  { log = console.log, dir = "data", by = "reset" } = {},
) {
  const customers = store.customers.all();
  const orders = store.orders.all();
  const before = customers.map((c) => ({
    phone: c.phone,
    name: c.name,
    summary: accountSummary(
      orders.filter((o) => o.customer === c.phone),
      c,
    ),
  }));
  const file = backup("clientes-saldos", before, dir);
  let touched = 0;
  store.transaction(() => {
    for (const c of customers) {
      c.creditBalance = 0;
      c.balanceAdjustments = [];
      c.boxesAdjust = 0;
      const rest = accountSummary(
        orders.filter((o) => o.customer === c.phone),
        c,
      );
      const changes = {};
      if (rest.balance !== 0) {
        c.balanceAdjustments = [
          {
            id: "reset",
            at: now(),
            by,
            amount: -rest.balance,
            note: "Puesta a cero",
          },
        ];
        changes.balance = -rest.balance;
      }
      if (rest.boxes !== 0) {
        c.boxesAdjust = -rest.boxes;
        changes.boxes = -rest.boxes;
      }
      store.customers.save(c);
      if (Object.keys(changes).length) touched++;
    }
  });
  log(
    `Saldos y cajas en cero: ${customers.length} clientes (${touched} tenían movimiento). Copia: ${file}`,
  );
  return { customers: customers.length, touched, backup: file };
}

/** Pasa usuarios del equipo a administrador (por nombre de usuario). */
export function makeAdmin(store, names, { log = console.log } = {}) {
  const done = [];
  for (const raw of names) {
    const username = String(raw).trim().toLowerCase();
    const user = store.staff.byUsername(username);
    if (!user) {
      log(`Usuario no encontrado: ${username}`);
      continue;
    }
    store.staff.update(user.id, {
      name: user.name,
      role: "admin",
      driver: user.driver || null,
      active: 1,
      passwordHash: null,
    });
    done.push(username);
  }
  if (done.length) log(`Ahora son administradores: ${done.join(", ")}.`);
  return { admins: done };
}

// Uso por línea de comandos.
if (process.argv[1] && /reset\.mjs$/.test(process.argv[1])) {
  const dir = (process.env.DATA_DIR || "data").replace(/\/$/, "");
  const store = await openStore(
    process.env.DB_PATH || `${dir}/pollito.sqlite`,
    {
      log: { info() {}, warn() {} },
    },
  );
  const arg = (k) => process.argv.find((a) => a.startsWith(k))?.slice(k.length);
  const pedidos = process.argv.find((a) => a.startsWith("--pedidos"));
  if (pedidos) resetOrders(store, { date: arg("--pedidos=") || today(), dir });
  if (process.argv.includes("--saldos")) resetBalances(store, { dir });
  const admins = arg("--admin=");
  if (admins) makeAdmin(store, admins.split(","));
}
