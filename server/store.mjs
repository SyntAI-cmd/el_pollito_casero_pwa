/**
 * Persistencia en SQLite (node:sqlite) con esquema relacional, migraciones,
 * transacciones, auditoría y copias de seguridad.
 *
 * La API trabaja con objetos "pedido" completos (items, historial, recorrido,
 * devoluciones); este módulo los arma desde las tablas y los guarda de forma
 * atómica. Las tablas de la versión 1 (JSON en `payload`) se migran solas.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 5;
const SESSION_DAYS = 90;
const now = () => new Date().toISOString();
const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const p = (s, fallback = null) =>
  s === null || s === undefined ? fallback : JSON.parse(s);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers(
  phone TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'minorista',
  credit INTEGER NOT NULL DEFAULT 0, driver TEXT, address TEXT, locality_id TEXT,
  lat REAL, lng REAL, credit_balance REAL NOT NULL DEFAULT 0,
  created TEXT NOT NULL, updated TEXT NOT NULL, data TEXT);
CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY, customer TEXT NOT NULL REFERENCES customers(phone),
  amount REAL NOT NULL CHECK(amount > 0), method TEXT NOT NULL, note TEXT,
  by_actor TEXT NOT NULL, at TEXT NOT NULL, applied TEXT NOT NULL DEFAULT '[]');
CREATE INDEX IF NOT EXISTS payments_customer ON payments(customer, at);
CREATE TABLE IF NOT EXISTS orders(
  id TEXT PRIMARY KEY, idem_key TEXT UNIQUE, customer TEXT NOT NULL REFERENCES customers(phone),
  name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, locality TEXT NOT NULL,
  notes TEXT, plan TEXT NOT NULL, payment TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0, paid_at TEXT, paid_by TEXT, payment_id TEXT,
  status TEXT NOT NULL, driver TEXT NOT NULL DEFAULT '',
  subtotal REAL NOT NULL, shipping REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  boxes INTEGER NOT NULL DEFAULT 0, returned INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL, updated TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'cliente',
  departed_at TEXT, delivered_at TEXT, delivered_by TEXT,
  weighed INTEGER NOT NULL DEFAULT 0, weighed_at TEXT, weighed_by TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0,
  destination TEXT, location TEXT, eta TEXT, transfer TEXT, data TEXT);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer, created);
CREATE INDEX IF NOT EXISTS orders_driver ON orders(driver, created);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_items(
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, position INTEGER NOT NULL,
  product_id TEXT NOT NULL, name TEXT NOT NULL, kg REAL NOT NULL, ordered REAL,
  price REAL NOT NULL, line_total REAL NOT NULL, weighed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(order_id, product_id));
CREATE TABLE IF NOT EXISTS order_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS order_events_order ON order_events(order_id, id);
CREATE TABLE IF NOT EXISTS order_track(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  lat REAL NOT NULL, lng REAL NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS order_track_order ON order_track(order_id, id);
CREATE TABLE IF NOT EXISTS box_movements(
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  customer TEXT NOT NULL, boxes INTEGER NOT NULL CHECK(boxes > 0), kind TEXT NOT NULL CHECK(kind IN ('left','returned')),
  at TEXT NOT NULL, by_actor TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS box_movements_customer ON box_movements(customer, at);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, role TEXT NOT NULL, phone TEXT, name TEXT, driver TEXT, plan TEXT,
  created TEXT NOT NULL, expires TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
CREATE TABLE IF NOT EXISTS accounts(
  id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, phone TEXT, password_hash TEXT,
  google_sub TEXT UNIQUE, created TEXT NOT NULL, last_login TEXT);
CREATE INDEX IF NOT EXISTS accounts_phone ON accounts(phone);
CREATE TABLE IF NOT EXISTS auth_tokens(
  token TEXT PRIMARY KEY, purpose TEXT NOT NULL, subject TEXT, payload TEXT, expires TEXT NOT NULL, used_at TEXT);
CREATE TABLE IF NOT EXISTS passkeys(
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT, device TEXT,
  created TEXT NOT NULL, last_used TEXT);
CREATE TABLE IF NOT EXISTS staff_users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','repartidor')), driver TEXT, password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, last_login TEXT);
CREATE TABLE IF NOT EXISTS push_subscriptions(
  endpoint TEXT PRIMARY KEY, role TEXT NOT NULL, phone TEXT, driver TEXT, created TEXT NOT NULL, subscription TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS geocache(query TEXT PRIMARY KEY, payload TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT NOT NULL, from_role TEXT NOT NULL, from_name TEXT NOT NULL,
  text TEXT NOT NULL, at TEXT NOT NULL, read_at TEXT);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread, id);
CREATE TABLE IF NOT EXISTS customer_prices(
  customer TEXT NOT NULL REFERENCES customers(phone) ON DELETE CASCADE, product_id TEXT NOT NULL,
  price REAL NOT NULL CHECK(price >= 0), updated TEXT NOT NULL, by_actor TEXT, PRIMARY KEY(customer, product_id));
CREATE TABLE IF NOT EXISTS drivers(
  name TEXT PRIMARY KEY, phone TEXT, cuit TEXT, zones TEXT NOT NULL DEFAULT '[]', shift TEXT,
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crates(
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL,
  gross REAL NOT NULL, tare REAL NOT NULL, net REAL NOT NULL, by_actor TEXT NOT NULL, at TEXT NOT NULL,
  loaded_at TEXT, loaded_by TEXT, voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT);
CREATE INDEX IF NOT EXISTS crates_order ON crates(order_id, at);
CREATE TABLE IF NOT EXISTS news(
  id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, by_actor TEXT NOT NULL, at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cash_closures(
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, driver TEXT NOT NULL,
  expected REAL NOT NULL, received REAL NOT NULL, transfers REAL NOT NULL DEFAULT 0, account_cash REAL NOT NULL DEFAULT 0,
  note TEXT, by_actor TEXT NOT NULL, at TEXT NOT NULL, UNIQUE(date, driver));
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor_role TEXT, actor TEXT,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity, entity_id);
CREATE TABLE IF NOT EXISTS vehicles(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, plate TEXT, active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trips(
  id TEXT PRIMARY KEY, date TEXT NOT NULL, vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  drivers TEXT NOT NULL DEFAULT '[]', departure TEXT, departed_at TEXT,
  created TEXT NOT NULL, updated TEXT NOT NULL, UNIQUE(date, vehicle_id));
CREATE TABLE IF NOT EXISTS trip_track(
  id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  lat REAL NOT NULL, lng REAL NOT NULL, speed REAL, heading REAL, by_actor TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trip_track_trip ON trip_track(trip_id, id);
CREATE TABLE IF NOT EXISTS receipts(
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, customer TEXT,
  kind TEXT NOT NULL, amount REAL, note TEXT, file TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  by_actor TEXT NOT NULL, at TEXT NOT NULL, voided INTEGER NOT NULL DEFAULT 0, void_reason TEXT);
CREATE INDEX IF NOT EXISTS receipts_order ON receipts(order_id);
CREATE INDEX IF NOT EXISTS receipts_at ON receipts(at);
`;

export async function openStore(path, { log = console } = {}) {
  const memory = path === ":memory:";
  if (!memory) await mkdir(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (!memory) {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
  db.exec("PRAGMA busy_timeout = 5000");

  // Esquema v1 (tablas con payload JSON): se aparta y se importa.
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name),
  );
  const legacy =
    tables.has("orders") &&
    db
      .prepare("PRAGMA table_info(orders)")
      .all()
      .some((c) => c.name === "payload");
  if (legacy) {
    log.info?.("Migrando base de datos v1 → v2");
    for (const t of ["orders", "customers", "sessions", "push", "geocache"])
      if (tables.has(t)) db.exec(`ALTER TABLE ${t} RENAME TO ${t}_v1`);
  }
  db.exec(SCHEMA);
  const sessionCols = db
    .prepare("PRAGMA table_info(sessions)")
    .all()
    .map((c) => c.name);
  if (!sessionCols.includes("account_id"))
    db.exec("ALTER TABLE sessions ADD COLUMN account_id TEXT");
  if (!sessionCols.includes("staff_id"))
    db.exec("ALTER TABLE sessions ADD COLUMN staff_id INTEGER");
  // v4: un pedido pertenece a un teléfono verificado, o a la cuenta / sesión que lo creó.
  const orderCols = db
    .prepare("PRAGMA table_info(orders)")
    .all()
    .map((c) => c.name);
  if (!orderCols.includes("account_id"))
    db.exec("ALTER TABLE orders ADD COLUMN account_id TEXT");
  if (!orderCols.includes("session_id"))
    db.exec("ALTER TABLE orders ADD COLUMN session_id TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS orders_account ON orders(account_id); CREATE INDEX IF NOT EXISTS orders_session ON orders(session_id)",
  );
  // v5: reparto por fecha y turno; ítems pedidos por cajas (los kilos nacen en la balanza).
  if (!orderCols.includes("delivery_date"))
    db.exec("ALTER TABLE orders ADD COLUMN delivery_date TEXT");
  if (!orderCols.includes("shift"))
    db.exec("ALTER TABLE orders ADD COLUMN shift TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS orders_delivery ON orders(delivery_date)",
  );
  // v6: cierre de caja con cheques desglosados.
  const closureCols = db
    .prepare("PRAGMA table_info(cash_closures)")
    .all()
    .map((c) => c.name);
  if (!closureCols.includes("cheques"))
    db.exec(
      "ALTER TABLE cash_closures ADD COLUMN cheques REAL NOT NULL DEFAULT 0",
    );
  const itemCols = db
    .prepare("PRAGMA table_info(order_items)")
    .all()
    .map((c) => c.name);
  if (!itemCols.includes("boxes"))
    db.exec("ALTER TABLE order_items ADD COLUMN boxes REAL");
  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((r) => r.version),
  );
  if (!applied.has(SCHEMA_VERSION))
    db.prepare(
      "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)",
    ).run(SCHEMA_VERSION, now());

  const q = {
    order: db.prepare("SELECT rowid AS seq, * FROM orders WHERE id = ?"),
    orderByKey: db.prepare(
      "SELECT rowid AS seq, * FROM orders WHERE idem_key = ?",
    ),
    ordersAll: db.prepare(
      "SELECT rowid AS seq, * FROM orders ORDER BY created DESC, rowid DESC",
    ),
    ordersCustomer: db.prepare(
      "SELECT rowid AS seq, * FROM orders WHERE customer = ? ORDER BY created DESC, rowid DESC",
    ),
    ordersDriver: db.prepare(
      "SELECT rowid AS seq, * FROM orders WHERE driver = ? ORDER BY created DESC, rowid DESC",
    ),
    ordersAccount: db.prepare(
      "SELECT rowid AS seq, * FROM orders WHERE account_id = ? ORDER BY created DESC, rowid DESC",
    ),
    ordersSession: db.prepare(
      "SELECT rowid AS seq, * FROM orders WHERE session_id = ? ORDER BY created DESC, rowid DESC",
    ),
    ordersCount: db.prepare("SELECT COUNT(*) AS n FROM orders"),
    ordersForDate: db.prepare(
      "SELECT rowid AS seq, * FROM orders WHERE delivery_date = ? ORDER BY created",
    ),
    ordersCustomerCount: db.prepare(
      "SELECT COUNT(*) AS n FROM orders WHERE customer = ?",
    ),
    items: db.prepare(
      "SELECT * FROM order_items WHERE order_id = ? ORDER BY position",
    ),
    events: db.prepare(
      "SELECT status, at FROM order_events WHERE order_id = ? ORDER BY id",
    ),
    track: db.prepare(
      "SELECT lat, lng FROM (SELECT id, lat, lng FROM order_track WHERE order_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id",
    ),
    returns: db.prepare(
      "SELECT boxes, at, by_actor AS by FROM box_movements WHERE order_id = ? AND kind = 'returned' ORDER BY id",
    ),
    upsertOrder:
      db.prepare(`INSERT INTO orders(id, idem_key, customer, name, phone, address, locality, notes, plan, payment, paid, paid_at, paid_by, payment_id,
        status, driver, subtotal, shipping, total, boxes, returned, created, updated, created_by, departed_at, delivered_at, delivered_by,
        weighed, weighed_at, weighed_by, cancelled, demo, destination, location, eta, transfer, data, account_id, session_id, delivery_date, shift)
      VALUES(@id, @idem_key, @customer, @name, @phone, @address, @locality, @notes, @plan, @payment, @paid, @paid_at, @paid_by, @payment_id,
        @status, @driver, @subtotal, @shipping, @total, @boxes, @returned, @created, @updated, @created_by, @departed_at, @delivered_at, @delivered_by,
        @weighed, @weighed_at, @weighed_by, @cancelled, @demo, @destination, @location, @eta, @transfer, @data, @account_id, @session_id, @delivery_date, @shift)
      ON CONFLICT(id) DO UPDATE SET idem_key=excluded.idem_key, customer=excluded.customer, name=excluded.name, phone=excluded.phone,
        address=excluded.address, locality=excluded.locality, notes=excluded.notes, plan=excluded.plan, payment=excluded.payment,
        paid=excluded.paid, paid_at=excluded.paid_at, paid_by=excluded.paid_by, payment_id=excluded.payment_id, status=excluded.status,
        driver=excluded.driver, subtotal=excluded.subtotal, shipping=excluded.shipping, total=excluded.total, boxes=excluded.boxes,
        returned=excluded.returned, updated=excluded.updated, departed_at=excluded.departed_at, delivered_at=excluded.delivered_at,
        delivered_by=excluded.delivered_by, weighed=excluded.weighed, weighed_at=excluded.weighed_at, weighed_by=excluded.weighed_by,
        cancelled=excluded.cancelled, demo=excluded.demo, destination=excluded.destination, location=excluded.location, eta=excluded.eta,
        transfer=excluded.transfer, data=excluded.data, account_id=excluded.account_id, session_id=excluded.session_id,
        delivery_date=excluded.delivery_date, shift=excluded.shift`),
    deleteItems: db.prepare("DELETE FROM order_items WHERE order_id = ?"),
    insertItem: db.prepare(
      "INSERT INTO order_items(order_id, position, product_id, name, kg, ordered, price, line_total, weighed, boxes) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ),
    pricesFor: db.prepare(
      "SELECT product_id AS productId, price, updated FROM customer_prices WHERE customer = ?",
    ),
    pricesAll: db.prepare(
      "SELECT customer, product_id AS productId, price FROM customer_prices",
    ),
    upsertPrice: db.prepare(
      "INSERT INTO customer_prices(customer, product_id, price, updated, by_actor) VALUES(?,?,?,?,?) ON CONFLICT(customer, product_id) DO UPDATE SET price=excluded.price, updated=excluded.updated, by_actor=excluded.by_actor",
    ),
    deletePrice: db.prepare(
      "DELETE FROM customer_prices WHERE customer = ? AND product_id = ?",
    ),
    driversAll: db.prepare("SELECT * FROM drivers ORDER BY sort, name"),
    driver: db.prepare("SELECT * FROM drivers WHERE name = ?"),
    upsertDriver: db.prepare(
      `INSERT INTO drivers(name, phone, cuit, zones, shift, active, sort, created) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET phone=excluded.phone, cuit=excluded.cuit, zones=excluded.zones, shift=excluded.shift, active=excluded.active, sort=excluded.sort`,
    ),
    cratesFor: db.prepare(
      "SELECT * FROM crates WHERE order_id = ? ORDER BY at, rowid",
    ),
    cratesForDate: db.prepare(
      "SELECT c.* FROM crates c JOIN orders o ON o.id = c.order_id WHERE o.delivery_date = ? ORDER BY c.at",
    ),
    crate: db.prepare("SELECT * FROM crates WHERE id = ?"),
    insertCrate: db.prepare(
      "INSERT OR IGNORE INTO crates(id, order_id, product_id, gross, tare, net, by_actor, at) VALUES(?,?,?,?,?,?,?,?)",
    ),
    voidCrate: db.prepare(
      "UPDATE crates SET voided = 1, void_reason = ? WHERE id = ? AND voided = 0",
    ),
    loadCrate: db.prepare(
      "UPDATE crates SET loaded_at = ?, loaded_by = ? WHERE id = ? AND voided = 0",
    ),
    unloadCrate: db.prepare(
      "UPDATE crates SET loaded_at = NULL, loaded_by = NULL WHERE id = ?",
    ),
    newsList: db.prepare(
      "SELECT id, text, by_actor AS by, at, pinned FROM news WHERE archived = 0 ORDER BY pinned DESC, id DESC LIMIT ?",
    ),
    insertNews: db.prepare(
      "INSERT INTO news(text, by_actor, at, pinned) VALUES(?,?,?,?)",
    ),
    deleteNews: db.prepare("DELETE FROM news WHERE id = ?"),
    updateNews: db.prepare(
      "UPDATE news SET pinned = COALESCE(?, pinned), archived = COALESCE(?, archived) WHERE id = ?",
    ),
    setting: db.prepare("SELECT value FROM settings WHERE key = ?"),
    vehiclesAll: db.prepare("SELECT * FROM vehicles ORDER BY sort, name"),
    vehicle: db.prepare("SELECT * FROM vehicles WHERE id = ?"),
    saveVehicle: db.prepare(
      "INSERT INTO vehicles(id, name, plate, active, sort, created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, plate = excluded.plate, active = excluded.active, sort = excluded.sort",
    ),
    tripsForDate: db.prepare(
      "SELECT * FROM trips WHERE date = ? ORDER BY departure, created",
    ),
    trip: db.prepare("SELECT * FROM trips WHERE id = ?"),
    saveTrip: db.prepare(
      "INSERT INTO trips(id, date, vehicle_id, drivers, departure, departed_at, created, updated) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET vehicle_id = excluded.vehicle_id, drivers = excluded.drivers, departure = excluded.departure, departed_at = excluded.departed_at, updated = excluded.updated",
    ),
    deleteTrip: db.prepare("DELETE FROM trips WHERE id = ?"),
    insertTripPos: db.prepare(
      "INSERT INTO trip_track(trip_id, lat, lng, speed, heading, by_actor, at) VALUES(?,?,?,?,?,?,?)",
    ),
    tripLast: db.prepare(
      "SELECT lat, lng, speed, heading, at FROM trip_track WHERE trip_id = ? ORDER BY id DESC LIMIT 1",
    ),
    tripTrack: db.prepare(
      "SELECT lat, lng, speed, at FROM (SELECT id, lat, lng, speed, at FROM trip_track WHERE trip_id = ? ORDER BY id DESC LIMIT 600) ORDER BY id",
    ),
    tripTrim: db.prepare(
      "DELETE FROM trip_track WHERE trip_id = ? AND id NOT IN (SELECT id FROM trip_track WHERE trip_id = ? ORDER BY id DESC LIMIT 600)",
    ),
    setSetting: db.prepare(
      "INSERT INTO settings(key, value, updated) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
    ),
    countEvents: db.prepare(
      "SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?",
    ),
    insertEvent: db.prepare(
      "INSERT INTO order_events(order_id, status, at) VALUES(?,?,?)",
    ),
    countTrack: db.prepare(
      "SELECT COUNT(*) AS n FROM order_track WHERE order_id = ?",
    ),
    insertTrack: db.prepare(
      "INSERT INTO order_track(order_id, lat, lng, at) VALUES(?,?,?,?)",
    ),
    trimTrack: db.prepare(
      "DELETE FROM order_track WHERE order_id = ? AND id NOT IN (SELECT id FROM order_track WHERE order_id = ? ORDER BY id DESC LIMIT 200)",
    ),
    countReturns: db.prepare(
      "SELECT COUNT(*) AS n FROM box_movements WHERE order_id = ? AND kind = 'returned'",
    ),
    insertBox: db.prepare(
      "INSERT INTO box_movements(order_id, customer, boxes, kind, at, by_actor) VALUES(?,?,?,?,?,?)",
    ),
    boxesLeftFor: db.prepare(
      "SELECT COUNT(*) AS n FROM box_movements WHERE order_id = ? AND kind = 'left'",
    ),
    customer: db.prepare("SELECT * FROM customers WHERE phone = ?"),
    customersAll: db.prepare("SELECT * FROM customers ORDER BY updated DESC"),
    deleteCustomer: db.prepare("DELETE FROM customers WHERE phone = ?"),
    deleteOrder: db.prepare("DELETE FROM orders WHERE id = ?"),
    upsertCustomer:
      db.prepare(`INSERT INTO customers(phone, name, plan, credit, driver, address, locality_id, lat, lng, credit_balance, created, updated, data)
      VALUES(@phone, @name, @plan, @credit, @driver, @address, @locality_id, @lat, @lng, @credit_balance, @created, @updated, @data)
      ON CONFLICT(phone) DO UPDATE SET name=excluded.name, plan=excluded.plan, credit=excluded.credit, driver=excluded.driver,
        address=excluded.address, locality_id=excluded.locality_id, lat=excluded.lat, lng=excluded.lng, credit_balance=excluded.credit_balance,
        updated=excluded.updated, data=excluded.data`),
    payments: db.prepare(
      "SELECT * FROM payments WHERE customer = ? ORDER BY at",
    ),
    paymentsAll: db.prepare("SELECT * FROM payments ORDER BY at"),
    insertPayment: db.prepare(
      "INSERT INTO payments(id, customer, amount, method, note, by_actor, at, applied) VALUES(?,?,?,?,?,?,?,?)",
    ),
    boxMovements: db.prepare(
      "SELECT * FROM box_movements WHERE customer = ? ORDER BY id",
    ),
    session: db.prepare(
      `SELECT s.*, u.active AS staff_active, u.role AS staff_role, u.driver AS staff_driver
       FROM sessions s LEFT JOIN staff_users u ON u.id = s.staff_id WHERE s.id = ? AND s.expires > ?`,
    ),
    insertSession: db.prepare(
      "INSERT INTO sessions(id, role, phone, name, driver, plan, created, expires, last_seen, account_id, staff_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ),
    touchSession: db.prepare("UPDATE sessions SET last_seen = ? WHERE id = ?"),
    updateSession: db.prepare(
      "UPDATE sessions SET phone = COALESCE(?, phone), name = COALESCE(?, name), plan = COALESCE(?, plan) WHERE id = ?",
    ),
    deleteSessionsFor: db.prepare(
      "DELETE FROM sessions WHERE (account_id = ? AND account_id IS NOT NULL) OR (staff_id = ? AND staff_id IS NOT NULL)",
    ),
    account: db.prepare("SELECT * FROM accounts WHERE id = ?"),
    accountByEmail: db.prepare("SELECT * FROM accounts WHERE email = ?"),
    accountByGoogle: db.prepare("SELECT * FROM accounts WHERE google_sub = ?"),
    accountByPhone: db.prepare(
      "SELECT * FROM accounts WHERE phone = ? ORDER BY created LIMIT 1",
    ),
    insertAccount: db.prepare(
      "INSERT INTO accounts(id, email, name, phone, password_hash, google_sub, created, last_login) VALUES(?,?,?,?,?,?,?,?)",
    ),
    updateAccount: db.prepare(
      "UPDATE accounts SET email = ?, name = ?, phone = ?, password_hash = ?, google_sub = ?, last_login = ? WHERE id = ?",
    ),
    insertToken: db.prepare(
      "INSERT INTO auth_tokens(token, purpose, subject, payload, expires) VALUES(?,?,?,?,?)",
    ),
    token: db.prepare(
      "SELECT * FROM auth_tokens WHERE token = ? AND purpose = ? AND used_at IS NULL AND expires > ?",
    ),
    useToken: db.prepare("UPDATE auth_tokens SET used_at = ? WHERE token = ?"),
    putToken: db.prepare(
      "INSERT OR REPLACE INTO auth_tokens(token, purpose, subject, payload, expires) VALUES(?,?,?,?,?)",
    ),
    tokenPayload: db.prepare(
      "UPDATE auth_tokens SET payload = ? WHERE token = ?",
    ),
    deleteToken: db.prepare("DELETE FROM auth_tokens WHERE token = ?"),
    purgeTokens: db.prepare("DELETE FROM auth_tokens WHERE expires < ?"),
    passkeysFor: db.prepare("SELECT * FROM passkeys WHERE account_id = ?"),
    passkey: db.prepare("SELECT * FROM passkeys WHERE id = ?"),
    insertPasskey: db.prepare(
      "INSERT INTO passkeys(id, account_id, public_key, counter, transports, device, created) VALUES(?,?,?,?,?,?,?)",
    ),
    usePasskey: db.prepare(
      "UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?",
    ),
    deletePasskey: db.prepare(
      "DELETE FROM passkeys WHERE id = ? AND account_id = ?",
    ),
    staffAll: db.prepare(
      "SELECT id, username, name, role, driver, active, created, last_login FROM staff_users ORDER BY role, name",
    ),
    staffByUsername: db.prepare("SELECT * FROM staff_users WHERE username = ?"),
    staffById: db.prepare("SELECT * FROM staff_users WHERE id = ?"),
    staffCount: db.prepare("SELECT COUNT(*) AS n FROM staff_users"),
    insertStaff: db.prepare(
      "INSERT INTO staff_users(username, name, role, driver, password_hash, active, created) VALUES(?,?,?,?,?,1,?)",
    ),
    updateStaff: db.prepare(
      "UPDATE staff_users SET name = ?, role = ?, driver = ?, active = ?, password_hash = COALESCE(?, password_hash) WHERE id = ?",
    ),
    touchStaff: db.prepare(
      "UPDATE staff_users SET last_login = ? WHERE id = ?",
    ),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    purgeSessions: db.prepare("DELETE FROM sessions WHERE expires <= ?"),
    pushRole: db.prepare(
      "SELECT endpoint, subscription FROM push_subscriptions WHERE role = ?",
    ),
    pushCustomer: db.prepare(
      "SELECT endpoint, subscription FROM push_subscriptions WHERE phone = ? AND role = 'cliente'",
    ),
    pushDriver: db.prepare(
      "SELECT endpoint, subscription FROM push_subscriptions WHERE driver = ? AND role = 'repartidor'",
    ),
    pushSave:
      db.prepare(`INSERT INTO push_subscriptions(endpoint, role, phone, driver, created, subscription) VALUES(?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET role=excluded.role, phone=excluded.phone, driver=excluded.driver, subscription=excluded.subscription`),
    pushDelete: db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?"),
    geo: db.prepare("SELECT payload FROM geocache WHERE query = ?"),
    geoSave: db.prepare(
      "INSERT OR REPLACE INTO geocache(query, payload, at) VALUES(?,?,?)",
    ),
    messages: db.prepare(
      "SELECT id, thread, from_role AS fromRole, from_name AS fromName, text, at, read_at AS readAt FROM messages WHERE thread = ? ORDER BY id DESC LIMIT ?",
    ),
    insertMessage: db.prepare(
      "INSERT INTO messages(thread, from_role, from_name, text, at) VALUES(?,?,?,?,?)",
    ),
    markRead: db.prepare(
      "UPDATE messages SET read_at = ? WHERE thread = ? AND from_role != ? AND read_at IS NULL",
    ),
    unread: db.prepare(
      "SELECT thread, COUNT(*) AS n FROM messages WHERE from_role != ? AND read_at IS NULL GROUP BY thread",
    ),
    threads: db.prepare(
      "SELECT thread, MAX(id) AS last FROM messages GROUP BY thread ORDER BY last DESC",
    ),
    audit: db.prepare(
      "INSERT INTO audit_log(at, actor_role, actor, action, entity, entity_id, detail) VALUES(?,?,?,?,?,?,?)",
    ),
    closuresFor: db.prepare(
      "SELECT id, date, driver, expected, received, transfers, cheques, account_cash AS accountCash, note, by_actor AS by, at FROM cash_closures WHERE date = ? ORDER BY driver",
    ),
    closuresRecent: db.prepare(
      "SELECT id, date, driver, expected, received, transfers, cheques, account_cash AS accountCash, note, by_actor AS by, at FROM cash_closures ORDER BY date DESC, driver LIMIT ?",
    ),
    upsertClosure:
      db.prepare(`INSERT INTO cash_closures(date, driver, expected, received, transfers, cheques, account_cash, note, by_actor, at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(date, driver) DO UPDATE SET expected=excluded.expected, received=excluded.received, transfers=excluded.transfers,
        cheques=excluded.cheques, account_cash=excluded.account_cash, note=excluded.note, by_actor=excluded.by_actor, at=excluded.at`),
    receiptsFor: db.prepare(
      "SELECT * FROM receipts WHERE order_id = ? AND voided = 0 ORDER BY id",
    ),
    receipt: db.prepare("SELECT * FROM receipts WHERE id = ?"),
    receiptsForDate: db.prepare(
      "SELECT * FROM receipts WHERE voided = 0 AND at >= ? AND at < ? ORDER BY at",
    ),
    insertReceipt: db.prepare(
      "INSERT INTO receipts(id, order_id, customer, kind, amount, note, file, mime, bytes, by_actor, at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ),
    updateReceipt: db.prepare(
      "UPDATE receipts SET kind = COALESCE(?, kind), amount = CASE WHEN ? = 1 THEN ? ELSE amount END, note = COALESCE(?, note) WHERE id = ?",
    ),
    voidReceipt: db.prepare(
      "UPDATE receipts SET voided = 1, void_reason = ? WHERE id = ?",
    ),
    auditFor: db.prepare(
      "SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 100",
    ),
  };

  const rowToOrder = (r) => {
    if (!r) return null;
    const extra = p(r.data, {});
    const o = {
      ...extra,
      id: r.id,
      number: r.seq ?? null,
      key: r.idem_key,
      customer: r.customer,
      name: r.name,
      phone: r.phone,
      address: r.address,
      locality: p(r.locality),
      notes: r.notes || "",
      plan: r.plan,
      payment: r.payment,
      paid: !!r.paid,
      status: r.status,
      driver: r.driver || "",
      subtotal: r.subtotal,
      shipping: r.shipping,
      total: r.total,
      boxes: r.boxes,
      returned: r.returned,
      created: r.created,
      updated: r.updated,
      createdBy: r.created_by,
      items: q.items.all(r.id).map((i) => ({
        id: i.product_id,
        name: i.name,
        kg: i.kg,
        price: i.price,
        lineTotal: i.line_total,
        ...(i.ordered !== null ? { ordered: i.ordered } : {}),
        ...(i.boxes !== null && i.boxes !== undefined
          ? { boxes: i.boxes }
          : {}),
        ...(i.weighed ? { weighed: true } : {}),
      })),
      history: q.events.all(r.id),
    };
    if (r.paid_at) o.paidAt = r.paid_at;
    if (r.paid_by) o.paidBy = r.paid_by;
    if (r.payment_id) o.paymentId = r.payment_id;
    if (r.departed_at) o.departedAt = r.departed_at;
    if (r.delivered_at) o.deliveredAt = r.delivered_at;
    if (r.delivered_by) o.deliveredBy = r.delivered_by;
    if (r.weighed)
      Object.assign(o, {
        weighed: true,
        weighedAt: r.weighed_at,
        weighedBy: r.weighed_by,
      });
    if (r.cancelled) o.cancelled = true;
    if (r.demo) o.demo = true;
    if (r.account_id) o.accountId = r.account_id;
    if (r.session_id) o.sessionId = r.session_id;
    if (r.delivery_date) o.deliveryDate = r.delivery_date;
    if (r.shift) o.shift = r.shift;
    if (r.destination !== null) o.destination = p(r.destination);
    if (r.location) o.location = p(r.location);
    if (r.eta) o.eta = p(r.eta);
    if (r.transfer) o.transfer = p(r.transfer);
    const track = q.track.all(r.id).map((t) => [t.lat, t.lng]);
    if (track.length) o.track = track;
    const returns = q.returns.all(r.id);
    if (returns.length) o.returns = returns;
    return o;
  };
  const knownOrderKeys = new Set([
    "id",
    "key",
    "customer",
    "name",
    "phone",
    "address",
    "locality",
    "notes",
    "plan",
    "payment",
    "paid",
    "paidAt",
    "paidBy",
    "paymentId",
    "status",
    "driver",
    "subtotal",
    "shipping",
    "total",
    "boxes",
    "returned",
    "created",
    "updated",
    "createdBy",
    "departedAt",
    "deliveredAt",
    "deliveredBy",
    "weighed",
    "weighedAt",
    "weighedBy",
    "cancelled",
    "demo",
    "destination",
    "location",
    "eta",
    "transfer",
    "items",
    "history",
    "track",
    "returns",
    "driverContact",
    "accountId",
    "sessionId",
    "deliveryDate",
    "shift",
  ]);

  function saveOrder(o) {
    return transaction(() => {
      const extra = Object.fromEntries(
        Object.entries(o).filter(([k]) => !knownOrderKeys.has(k)),
      );
      q.upsertOrder.run({
        id: o.id,
        idem_key: o.key || null,
        customer: o.customer,
        name: o.name,
        phone: o.phone,
        address: o.address,
        locality: j(o.locality),
        notes: o.notes || null,
        plan: o.plan,
        payment: o.payment,
        paid: o.paid ? 1 : 0,
        paid_at: o.paidAt || null,
        paid_by: o.paidBy || null,
        payment_id: o.paymentId || null,
        status: o.status,
        driver: o.driver || "",
        subtotal: o.subtotal,
        shipping: o.shipping || 0,
        total: o.total,
        boxes: o.boxes || 0,
        returned: o.returned || 0,
        created: o.created,
        updated: now(),
        created_by: o.createdBy || "cliente",
        departed_at: o.departedAt || null,
        delivered_at: o.deliveredAt || null,
        delivered_by: o.deliveredBy || null,
        weighed: o.weighed ? 1 : 0,
        weighed_at: o.weighedAt || null,
        weighed_by: o.weighedBy || null,
        cancelled: o.cancelled ? 1 : 0,
        demo: o.demo ? 1 : 0,
        destination:
          o.destination === undefined ? null : JSON.stringify(o.destination),
        location: j(o.location),
        eta: j(o.eta),
        transfer: j(o.transfer),
        data: Object.keys(extra).length ? JSON.stringify(extra) : null,
        account_id: o.accountId || null,
        session_id: o.sessionId || null,
        delivery_date: o.deliveryDate || null,
        shift: o.shift || null,
      });
      // `destination: null` (no ubicable) se distingue de "sin geocodificar" (undefined) guardando la cadena "null".
      q.deleteItems.run(o.id);
      o.items.forEach((i, idx) =>
        q.insertItem.run(
          o.id,
          idx,
          i.id,
          i.name,
          i.kg,
          i.ordered ?? null,
          i.price,
          i.lineTotal ?? Math.round(i.price * i.kg * 100) / 100,
          i.weighed ? 1 : 0,
          i.boxes ?? null,
        ),
      );
      // Historial, recorrido y devoluciones son "solo agregar": se insertan las entradas nuevas.
      const have = q.countEvents.get(o.id).n;
      for (const e of (o.history || []).slice(have))
        q.insertEvent.run(o.id, e.status, e.at);
      // Recorrido GPS: los puntos nuevos entran por orders.addTrack; acá solo se importa uno inicial.
      if (o.track?.length && q.countTrack.get(o.id).n === 0)
        for (const [lat, lng] of o.track)
          q.insertTrack.run(o.id, lat, lng, o.location?.at || now());
      const haveReturns = q.countReturns.get(o.id).n;
      for (const r of (o.returns || []).slice(haveReturns))
        q.insertBox.run(
          o.id,
          o.customer,
          r.boxes,
          "returned",
          r.at,
          r.by || "admin",
        );
      if (o.boxes > 0 && q.boxesLeftFor.get(o.id).n === 0)
        q.insertBox.run(
          o.id,
          o.customer,
          o.boxes,
          "left",
          o.deliveredAt || now(),
          o.deliveredBy || "admin",
        );
      return o;
    });
  }

  const rowToCustomer = (r) => {
    if (!r) return null;
    const c = {
      ...p(r.data, {}),
      phone: r.phone,
      name: r.name,
      plan: r.plan,
      credit: !!r.credit,
      driver: r.driver || "",
      creditBalance: r.credit_balance,
      created: r.created,
      updated: r.updated,
    };
    if (r.address) c.address = r.address;
    if (r.locality_id) c.localityId = r.locality_id;
    if (r.lat !== null && r.lng !== null)
      c.location = { lat: r.lat, lng: r.lng };
    c.payments = q.payments.all(r.phone).map(rowToPayment);
    return c;
  };
  const rowToPayment = (r) => ({
    id: r.id,
    amount: r.amount,
    method: r.method,
    note: r.note || "",
    by: r.by_actor,
    at: r.at,
    applied: p(r.applied, []),
  });
  const knownCustomerKeys = new Set([
    "phone",
    "name",
    "plan",
    "credit",
    "driver",
    "address",
    "localityId",
    "location",
    "creditBalance",
    "created",
    "updated",
    "payments",
    "summary",
  ]);
  function saveCustomer(c) {
    const extra = Object.fromEntries(
      Object.entries(c).filter(([k]) => !knownCustomerKeys.has(k)),
    );
    q.upsertCustomer.run({
      phone: c.phone,
      name: c.name,
      plan: c.plan || "minorista",
      credit: c.credit ? 1 : 0,
      driver: c.driver || null,
      address: c.address || null,
      locality_id: c.localityId || null,
      lat: c.location?.lat ?? null,
      lng: c.location?.lng ?? null,
      credit_balance: c.creditBalance || 0,
      created: c.created || now(),
      updated: now(),
      data: Object.keys(extra).length ? JSON.stringify(extra) : null,
    });
    return c;
  }

  const rowToVehicle = (r) =>
    r
      ? {
          id: r.id,
          name: r.name,
          plate: r.plate || "",
          active: !!r.active,
          sort: r.sort,
          created: r.created,
        }
      : null;
  const rowToTrip = (r) =>
    r
      ? {
          id: r.id,
          date: r.date,
          vehicleId: r.vehicle_id,
          drivers: p(r.drivers, []),
          departure: r.departure || "",
          departedAt: r.departed_at || null,
          created: r.created,
          updated: r.updated,
        }
      : null;
  const rowToReceipt = (r) =>
    r
      ? {
          id: r.id,
          orderId: r.order_id,
          customer: r.customer,
          kind: r.kind,
          amount: r.amount,
          note: r.note || "",
          file: r.file,
          mime: r.mime,
          bytes: r.bytes,
          by: r.by_actor,
          at: r.at,
          voided: !!r.voided,
        }
      : null;
  const rowToCrate = (r) =>
    r
      ? {
          id: r.id,
          orderId: r.order_id,
          productId: r.product_id,
          gross: r.gross,
          tare: r.tare,
          net: r.net,
          by: r.by_actor,
          at: r.at,
          loadedAt: r.loaded_at || null,
          loadedBy: r.loaded_by || null,
          voided: !!r.voided,
          voidReason: r.void_reason || null,
        }
      : null;
  const rowToAccount = (r) =>
    r
      ? {
          id: r.id,
          email: r.email,
          name: r.name,
          phone: r.phone,
          passwordHash: r.password_hash,
          googleSub: r.google_sub,
          created: r.created,
          lastLogin: r.last_login,
        }
      : null;
  const rowToPasskey = (r) =>
    r
      ? {
          id: r.id,
          accountId: r.account_id,
          publicKey: r.public_key,
          counter: r.counter,
          transports: p(r.transports, []),
          device: r.device,
          created: r.created,
          lastUsed: r.last_used,
        }
      : null;

  let depth = 0;
  function transaction(fn) {
    if (depth > 0) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
    }
  }

  const store = {
    db,
    transaction,
    orders: {
      all: () => q.ordersAll.all().map(rowToOrder),
      forCustomer: (phone) => q.ordersCustomer.all(phone).map(rowToOrder),
      forDriver: (name) => q.ordersDriver.all(name).map(rowToOrder),
      get: (id) => rowToOrder(q.order.get(id)),
      byKey: (key) => rowToOrder(q.orderByKey.get(key)),
      forAccount: (id) => q.ordersAccount.all(id).map(rowToOrder),
      forDate: (date) => q.ordersForDate.all(date).map(rowToOrder),
      forSession: (id) => q.ordersSession.all(id).map(rowToOrder),
      /** Borra el pedido con sus renglones, eventos, recorrido y cajones (FK en cascada). */
      remove: (id) => q.deleteOrder.run(id).changes,
      save: saveOrder,
      count: () => q.ordersCount.get().n,
      countFor: (phone) => q.ordersCustomerCount.get(phone).n,
      /** Agrega un punto al recorrido y conserva los últimos 200 (secuencia propia, no depende del array en memoria). */
      addTrack: (id, lat, lng, at = now()) =>
        transaction(() => {
          q.insertTrack.run(id, lat, lng, at);
          q.trimTrack.run(id, id);
        }),
    },
    customers: {
      get: (phone) => rowToCustomer(q.customer.get(phone)),
      all: () => q.customersAll.all().map(rowToCustomer),
      save: saveCustomer,
      boxMovements: (phone) => q.boxMovements.all(phone),
      /** Borra una ficha sin pedidos ni pagos (p. ej. importada por error). */
      remove: (key) =>
        q.ordersCustomerCount.get(key).n === 0 &&
        q.payments.all(key).length === 0
          ? q.deleteCustomer.run(key).changes
          : 0,
    },
    payments: {
      forCustomer: (phone) => q.payments.all(phone).map(rowToPayment),
      all: () => q.paymentsAll.all().map(rowToPayment),
      add: (customer, payment) => {
        q.insertPayment.run(
          payment.id,
          customer,
          payment.amount,
          payment.method,
          payment.note || null,
          payment.by,
          payment.at,
          JSON.stringify(payment.applied || []),
        );
        return payment;
      },
    },
    boxes: {
      returned: (customer, boxes, by, orderId = null) =>
        q.insertBox.run(orderId, customer, boxes, "returned", now(), by),
    },
    sessions: {
      get: (id) => {
        if (!id) return null;
        const r = q.session.get(id, now());
        if (!r) return null;
        // Un usuario del equipo desactivado, degradado o reasignado pierde la sesión al instante.
        if (
          r.staff_id &&
          (!r.staff_active ||
            r.staff_role !== r.role ||
            (r.role === "repartidor" && r.staff_driver !== r.driver))
        ) {
          q.deleteSession.run(id);
          return null;
        }
        if (Date.now() - new Date(r.last_seen) > 3600000)
          q.touchSession.run(now(), id);
        return {
          id: r.id,
          role: r.role,
          phone: r.phone,
          name: r.name,
          driver: r.driver,
          plan: r.plan,
          accountId: r.account_id || null,
          staffId: r.staff_id || null,
        };
      },
      create: (data) => {
        const id = randomUUID();
        const days = data.role === "cliente" ? SESSION_DAYS : 14;
        const expires = new Date(Date.now() + days * 86400000).toISOString();
        q.insertSession.run(
          id,
          data.role,
          data.phone || null,
          data.name || null,
          data.driver || null,
          data.plan || null,
          now(),
          expires,
          now(),
          data.accountId || null,
          data.staffId || null,
        );
        return { id, ...data };
      },
      update: (id, { phone, name, plan } = {}) =>
        q.updateSession.run(phone ?? null, name ?? null, plan ?? null, id),
      delete: (id) => q.deleteSession.run(id),
      deleteFor: ({ accountId = null, staffId = null }) =>
        q.deleteSessionsFor.run(accountId, staffId).changes,
      purge: () => {
        q.purgeTokens.run(now());
        return q.purgeSessions.run(now()).changes;
      },
    },
    accounts: {
      get: (id) => rowToAccount(q.account.get(id)),
      byEmail: (email) =>
        rowToAccount(q.accountByEmail.get(String(email).toLowerCase())),
      byGoogle: (sub) => rowToAccount(q.accountByGoogle.get(sub)),
      byPhone: (phone) => rowToAccount(q.accountByPhone.get(phone)),
      create: (a) => {
        const id = randomUUID();
        q.insertAccount.run(
          id,
          a.email ? a.email.toLowerCase() : null,
          a.name,
          a.phone || null,
          a.passwordHash || null,
          a.googleSub || null,
          now(),
          now(),
        );
        return rowToAccount(q.account.get(id));
      },
      save: (a) => {
        q.updateAccount.run(
          a.email ? a.email.toLowerCase() : null,
          a.name,
          a.phone || null,
          a.passwordHash || null,
          a.googleSub || null,
          a.lastLogin || null,
          a.id,
        );
        return a;
      },
    },
    tokens: {
      create: (purpose, subject, payload, ttlMs) => {
        const token =
          randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
        q.insertToken.run(
          token,
          purpose,
          subject || null,
          payload ? JSON.stringify(payload) : null,
          new Date(Date.now() + ttlMs).toISOString(),
        );
        return token;
      },
      consume: (token, purpose) => {
        const r = q.token.get(token, purpose, now());
        if (!r) return null;
        q.useToken.run(now(), token);
        return { subject: r.subject, payload: p(r.payload, null) };
      },
      /** Token con clave conocida (p. ej. un código por teléfono): reemplaza al anterior. */
      put: (token, purpose, subject, payload, ttlMs) =>
        q.putToken.run(
          token,
          purpose,
          subject || null,
          payload ? JSON.stringify(payload) : null,
          new Date(Date.now() + ttlMs).toISOString(),
        ),
      peek: (token, purpose) => {
        const r = q.token.get(token, purpose, now());
        return r ? { subject: r.subject, payload: p(r.payload, null) } : null;
      },
      setPayload: (token, payload) =>
        q.tokenPayload.run(JSON.stringify(payload), token),
      remove: (token) => q.deleteToken.run(token),
    },
    passkeys: {
      forAccount: (accountId) => q.passkeysFor.all(accountId).map(rowToPasskey),
      get: (id) => rowToPasskey(q.passkey.get(id)),
      add: (k) =>
        q.insertPasskey.run(
          k.id,
          k.accountId,
          k.publicKey,
          k.counter || 0,
          JSON.stringify(k.transports || []),
          k.device || null,
          now(),
        ),
      used: (id, counter) => q.usePasskey.run(counter, now(), id),
      remove: (id, accountId) => q.deletePasskey.run(id, accountId).changes,
    },
    /** Precio propio de cada cliente por producto (la lista de mañana/tarde hecha datos). */
    prices: {
      forCustomer: (key) => q.pricesFor.all(key),
      all: () => {
        const map = {};
        for (const r of q.pricesAll.all())
          (map[r.customer] ||= {})[r.productId] = r.price;
        return map;
      },
      set: (key, productId, price, by) =>
        price === null || price === undefined || price === ""
          ? q.deletePrice.run(key, productId)
          : q.upsertPrice.run(key, productId, Number(price), now(), by || null),
    },
    /** Repartidores / preventistas (camiones), con zonas y turno. */
    drivers: {
      all: () =>
        q.driversAll.all().map((d) => ({
          ...d,
          zones: p(d.zones, []),
          active: !!d.active,
        })),
      get: (name) => {
        const d = q.driver.get(name);
        return d ? { ...d, zones: p(d.zones, []), active: !!d.active } : null;
      },
      save: (d) =>
        q.upsertDriver.run(
          d.name,
          d.phone || null,
          d.cuit || null,
          JSON.stringify(d.zones || []),
          d.shift || null,
          d.active === false ? 0 : 1,
          d.sort || 0,
          d.created || now(),
        ),
    },
    /** Cajones pesados: cada uno con bruto, tara y neto; se anulan, nunca se borran. */
    crates: {
      forOrder: (orderId) => q.cratesFor.all(orderId).map(rowToCrate),
      forDate: (date) => q.cratesForDate.all(date).map(rowToCrate),
      get: (id) => rowToCrate(q.crate.get(id)),
      add: (c) =>
        q.insertCrate.run(
          c.id,
          c.orderId,
          c.productId,
          c.gross,
          c.tare,
          c.net,
          c.by,
          c.at || now(),
        ).changes,
      void: (id, reason) => q.voidCrate.run(reason || null, id).changes,
      load: (id, by) => q.loadCrate.run(now(), by, id).changes,
      unload: (id) => q.unloadCrate.run(id).changes,
    },
    news: {
      list: (limit = 50) =>
        q.newsList.all(limit).map((n) => ({ ...n, pinned: !!n.pinned })),
      add: (text, by, pinned = false) =>
        Number(
          q.insertNews.run(text, by, now(), pinned ? 1 : 0).lastInsertRowid,
        ),
      update: (id, { pinned, archived } = {}) =>
        q.updateNews.run(
          pinned === undefined ? null : pinned ? 1 : 0,
          archived === undefined ? null : archived ? 1 : 0,
          id,
        ).changes,
      remove: (id) => q.deleteNews.run(id).changes,
    },
    vehicles: {
      all: () => q.vehiclesAll.all().map(rowToVehicle),
      get: (id) => rowToVehicle(q.vehicle.get(id)),
      save: (v) => {
        q.saveVehicle.run(
          v.id,
          v.name,
          v.plate || "",
          v.active === false ? 0 : 1,
          v.sort || 0,
          v.created || now(),
        );
        return rowToVehicle(q.vehicle.get(v.id));
      },
    },
    trips: {
      forDate: (date) => q.tripsForDate.all(date).map(rowToTrip),
      get: (id) => rowToTrip(q.trip.get(id)),
      save: (t) => {
        q.saveTrip.run(
          t.id,
          t.date,
          t.vehicleId,
          JSON.stringify(t.drivers || []),
          t.departure || "",
          t.departedAt || null,
          t.created || now(),
          t.updated || now(),
        );
        return rowToTrip(q.trip.get(t.id));
      },
      remove: (id) => q.deleteTrip.run(id).changes,
      addPosition: (tripId, p) => {
        q.insertTripPos.run(
          tripId,
          p.lat,
          p.lng,
          p.speed ?? null,
          p.heading ?? null,
          p.by || null,
          p.at || now(),
        );
        q.tripTrim.run(tripId, tripId);
      },
      lastPosition: (tripId) => q.tripLast.get(tripId) || null,
      track: (tripId) => q.tripTrack.all(tripId),
    },
    settings: {
      get: (key, fallback = null) => {
        const r = q.setting.get(key);
        return r ? p(r.value, fallback) : fallback;
      },
      set: (key, value) => q.setSetting.run(key, JSON.stringify(value), now()),
    },
    /** Cierres de caja por repartidor y día: efectivo esperado vs. recibido, con quién y cuándo. */
    closures: {
      forDate: (date) => q.closuresFor.all(date),
      recent: (n = 60) => q.closuresRecent.all(n),
      save: (c) => {
        q.upsertClosure.run(
          c.date,
          c.driver,
          c.expected,
          c.received,
          c.transfers || 0,
          c.cheques || 0,
          c.accountCash || 0,
          c.note || null,
          c.by,
          now(),
        );
        return q.closuresFor.all(c.date).find((x) => x.driver === c.driver);
      },
    },
    receipts: {
      forOrder: (orderId) => q.receiptsFor.all(orderId).map(rowToReceipt),
      get: (id) => rowToReceipt(q.receipt.get(id)),
      // Comprobantes del día en hora local de Mendoza (UTC−3): de 03:00Z de ese día a 03:00Z del siguiente.
      forDate: (date) => {
        const from = new Date(date + "T03:00:00.000Z");
        const to = new Date(from.getTime() + 86400000);
        return q.receiptsForDate
          .all(from.toISOString(), to.toISOString())
          .map(rowToReceipt);
      },
      add: (r) => {
        q.insertReceipt.run(
          r.id,
          r.orderId,
          r.customer || null,
          r.kind,
          r.amount ?? null,
          r.note || null,
          r.file,
          r.mime,
          r.bytes,
          r.by,
          r.at || now(),
        );
        return rowToReceipt(q.receipt.get(r.id));
      },
      void: (id, reason) => q.voidReceipt.run(reason || null, id).changes,
      update: (id, { kind, amount, note } = {}) => {
        q.updateReceipt.run(
          kind ?? null,
          amount === undefined ? 0 : 1,
          amount === undefined ? null : amount,
          note ?? null,
          id,
        );
        return rowToReceipt(q.receipt.get(id));
      },
    },
    staff: {
      all: () => q.staffAll.all().map((r) => ({ ...r, active: !!r.active })),
      byUsername: (u) => q.staffByUsername.get(String(u).toLowerCase()),
      get: (id) => q.staffById.get(id),
      count: () => q.staffCount.get().n,
      create: ({ username, name, role, driver, passwordHash }) => {
        const { lastInsertRowid } = q.insertStaff.run(
          username.toLowerCase(),
          name,
          role,
          driver || null,
          passwordHash,
          now(),
        );
        return q.staffById.get(Number(lastInsertRowid));
      },
      update: (id, { name, role, driver, active, passwordHash }) =>
        q.updateStaff.run(
          name,
          role,
          driver || null,
          active ? 1 : 0,
          passwordHash || null,
          id,
        ),
      touch: (id) => q.touchStaff.run(now(), id),
    },
    push: {
      forRole: (role) =>
        q.pushRole.all(role).map((r) => ({
          endpoint: r.endpoint,
          subscription: JSON.parse(r.subscription),
        })),
      forCustomer: (phone) =>
        q.pushCustomer.all(phone).map((r) => ({
          endpoint: r.endpoint,
          subscription: JSON.parse(r.subscription),
        })),
      forDriver: (name) =>
        q.pushDriver.all(name).map((r) => ({
          endpoint: r.endpoint,
          subscription: JSON.parse(r.subscription),
        })),
      save: (session, subscription) =>
        q.pushSave.run(
          subscription.endpoint,
          session.role,
          session.phone || null,
          session.driver || null,
          now(),
          JSON.stringify(subscription),
        ),
      delete: (endpoint) => q.pushDelete.run(endpoint),
    },
    geocache: {
      get: (query) => {
        const r = q.geo.get(query);
        return r ? JSON.parse(r.payload) : undefined;
      },
      save: (query, value) =>
        q.geoSave.run(query, JSON.stringify(value), now()),
    },
    messages: {
      list: (thread, limit = 100) => q.messages.all(thread, limit).reverse(),
      add: (thread, from, text) => {
        const at = now();
        const { lastInsertRowid } = q.insertMessage.run(
          thread,
          from.role,
          from.name,
          text,
          at,
        );
        return {
          id: Number(lastInsertRowid),
          thread,
          fromRole: from.role,
          fromName: from.name,
          text,
          at,
          readAt: null,
        };
      },
      markRead: (thread, readerRole) =>
        q.markRead.run(now(), thread, readerRole).changes,
      unreadFor: (readerRole) =>
        Object.fromEntries(
          q.unread.all(readerRole).map((r) => [r.thread, r.n]),
        ),
      threads: () => q.threads.all().map((r) => r.thread),
    },
    audit: {
      log: (session, action, entity, entityId, detail) =>
        q.audit.run(
          now(),
          session?.role || "sistema",
          session?.driver || session?.name || session?.phone || null,
          action,
          entity,
          entityId || null,
          detail ? JSON.stringify(detail) : null,
        ),
      for: (entity, entityId) => q.auditFor.all(entity, entityId),
    },
    /** Copia de seguridad consistente (VACUUM INTO); conserva las últimas `keep`. */
    async backup(dir = "data/backups", keep = 14) {
      if (memory) return null;
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const file = `${dir}/pollito-${stamp}.sqlite`;
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const files = (await readdir(dir))
        .filter((f) => /^pollito-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
        .sort();
      for (const old of files.slice(0, Math.max(0, files.length - keep)))
        await unlink(`${dir}/${old}`).catch(() => {});
      return file;
    },
    health: () => ({
      ok: db.prepare("SELECT 1 AS ok").get().ok === 1,
      schema: SCHEMA_VERSION,
      orders: q.ordersCount.get().n,
    }),
    close: () => db.close(),
  };

  if (legacy) importLegacy(db, store, tables, log);
  store.sessions.purge();
  return store;
}

/** Importa las tablas v1 (JSON) al esquema v2 dentro de una transacción. */
function importLegacy(db, store, tables, log) {
  store.transaction(() => {
    let customers = 0;
    let orders = 0;
    if (tables.has("customers"))
      for (const r of db.prepare("SELECT payload FROM customers_v1").all()) {
        const c = JSON.parse(r.payload);
        store.customers.save(c);
        for (const pm of c.payments || []) store.payments.add(c.phone, pm);
        customers++;
      }
    for (const r of db.prepare("SELECT payload FROM orders_v1").all()) {
      const o = JSON.parse(r.payload);
      if (!o.customer) o.customer = "desconocido";
      if (!store.customers.get(o.customer))
        store.customers.save({
          phone: o.customer,
          name: o.name || "Cliente",
          plan: o.plan || "minorista",
          credit: false,
          created: o.created,
        });
      store.orders.save(o);
      orders++;
    }
    if (tables.has("sessions"))
      for (const r of db
        .prepare("SELECT id, created, payload FROM sessions_v1")
        .all()) {
        const s = JSON.parse(r.payload);
        db.prepare(
          "INSERT OR IGNORE INTO sessions(id, role, phone, name, driver, plan, created, expires, last_seen) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          r.id,
          s.role,
          s.phone || null,
          s.name || null,
          s.driver || null,
          s.plan || null,
          r.created,
          new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
          r.created,
        );
      }
    if (tables.has("push"))
      for (const r of db
        .prepare(
          "SELECT endpoint, role, phone, driver, created, payload FROM push_v1",
        )
        .all())
        db.prepare(
          "INSERT OR IGNORE INTO push_subscriptions(endpoint, role, phone, driver, created, subscription) VALUES(?,?,?,?,?,?)",
        ).run(r.endpoint, r.role, r.phone, r.driver, r.created, r.payload);
    if (tables.has("geocache"))
      for (const r of db
        .prepare("SELECT query, payload FROM geocache_v1")
        .all())
        store.geocache.save(r.query, JSON.parse(r.payload));
    log.info?.(`Migración completa: ${customers} clientes, ${orders} pedidos.`);
  });
  for (const t of [
    "orders_v1",
    "customers_v1",
    "sessions_v1",
    "push_v1",
    "geocache_v1",
  ])
    db.exec(`DROP TABLE IF EXISTS ${t}`);
}
