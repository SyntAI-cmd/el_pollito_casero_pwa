import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function openStore(path) {
  if (path !== ":memory:") await mkdir("data", { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders(
      id TEXT PRIMARY KEY, customer TEXT, driver TEXT, status TEXT, created TEXT, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customers(phone TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, created TEXT, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS geocache(query TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push(endpoint TEXT PRIMARY KEY, role TEXT, phone TEXT, driver TEXT, created TEXT, payload TEXT NOT NULL);
  `);
  // Migración de la demo anterior (tabla con solo id/payload).
  const cols = db
    .prepare("PRAGMA table_info(orders)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("customer")) {
    for (const c of ["customer", "driver", "status", "created"])
      db.exec(`ALTER TABLE orders ADD COLUMN ${c} TEXT`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer)");
  const parse = (rows) => rows.map((r) => JSON.parse(r.payload));
  const q = {
    allOrders: db.prepare(
      "SELECT payload FROM orders ORDER BY created DESC, rowid DESC",
    ),
    customerOrders: db.prepare(
      "SELECT payload FROM orders WHERE customer = ? ORDER BY created DESC, rowid DESC",
    ),
    driverOrders: db.prepare(
      "SELECT payload FROM orders WHERE driver = ? ORDER BY created DESC, rowid DESC",
    ),
    order: db.prepare("SELECT payload FROM orders WHERE id = ?"),
    orderByKey: db.prepare(
      "SELECT payload FROM orders WHERE json_extract(payload, '$.key') = ?",
    ),
    saveOrder: db.prepare(
      `INSERT INTO orders(id, customer, driver, status, created, payload) VALUES(?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET customer=excluded.customer, driver=excluded.driver,
       status=excluded.status, created=excluded.created, payload=excluded.payload`,
    ),
    customer: db.prepare("SELECT payload FROM customers WHERE phone = ?"),
    customers: db.prepare("SELECT payload FROM customers"),
    saveCustomer: db.prepare(
      "INSERT INTO customers(phone, payload) VALUES(?,?) ON CONFLICT(phone) DO UPDATE SET payload=excluded.payload",
    ),
    session: db.prepare("SELECT payload FROM sessions WHERE id = ?"),
    saveSession: db.prepare(
      "INSERT INTO sessions(id, created, payload) VALUES(?,?,?)",
    ),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    pushAll: db.prepare("SELECT endpoint, payload FROM push WHERE role = ?"),
    pushCustomer: db.prepare(
      "SELECT endpoint, payload FROM push WHERE phone = ? AND role = 'cliente'",
    ),
    pushDriver: db.prepare(
      "SELECT endpoint, payload FROM push WHERE driver = ? AND role = 'repartidor'",
    ),
    pushSave: db.prepare(
      "INSERT INTO push(endpoint, role, phone, driver, created, payload) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET role=excluded.role, phone=excluded.phone, driver=excluded.driver, payload=excluded.payload",
    ),
    pushDelete: db.prepare("DELETE FROM push WHERE endpoint = ?"),
    geo: db.prepare("SELECT payload FROM geocache WHERE query = ?"),
    saveGeo: db.prepare(
      "INSERT OR REPLACE INTO geocache(query, payload) VALUES(?,?)",
    ),
  };
  return {
    orders: {
      all: () => parse(q.allOrders.all()),
      forCustomer: (phone) => parse(q.customerOrders.all(phone)),
      forDriver: (name) => parse(q.driverOrders.all(name)),
      get: (id) => {
        const r = q.order.get(id);
        return r ? JSON.parse(r.payload) : null;
      },
      byKey: (key) => {
        const r = q.orderByKey.get(key);
        return r ? JSON.parse(r.payload) : null;
      },
      save: (o) => {
        q.saveOrder.run(
          o.id,
          o.customer || null,
          o.driver || null,
          o.status,
          o.created,
          JSON.stringify(o),
        );
        return o;
      },
      count: () => q.allOrders.all().length,
    },
    customers: {
      get: (phone) => {
        const r = q.customer.get(phone);
        return r ? JSON.parse(r.payload) : null;
      },
      all: () => parse(q.customers.all()),
      save: (c) => {
        q.saveCustomer.run(c.phone, JSON.stringify(c));
        return c;
      },
    },
    sessions: {
      get: (id) => {
        if (!id) return null;
        const r = q.session.get(id);
        return r ? { id, ...JSON.parse(r.payload) } : null;
      },
      create: (data) => {
        const id = randomUUID();
        q.saveSession.run(id, new Date().toISOString(), JSON.stringify(data));
        return { id, ...data };
      },
      delete: (id) => q.deleteSession.run(id),
    },
    push: {
      forRole: (role) =>
        q.pushAll.all(role).map((r) => ({
          endpoint: r.endpoint,
          subscription: JSON.parse(r.payload),
        })),
      forCustomer: (phone) =>
        q.pushCustomer.all(phone).map((r) => ({
          endpoint: r.endpoint,
          subscription: JSON.parse(r.payload),
        })),
      forDriver: (name) =>
        q.pushDriver.all(name).map((r) => ({
          endpoint: r.endpoint,
          subscription: JSON.parse(r.payload),
        })),
      save: (session, subscription) =>
        q.pushSave.run(
          subscription.endpoint,
          session.role,
          session.phone || null,
          session.driver || null,
          new Date().toISOString(),
          JSON.stringify(subscription),
        ),
      delete: (endpoint) => q.pushDelete.run(endpoint),
    },
    geocache: {
      get: (query) => {
        const r = q.geo.get(query);
        return r ? JSON.parse(r.payload) : undefined;
      },
      save: (query, value) => q.saveGeo.run(query, JSON.stringify(value)),
    },
  };
}
