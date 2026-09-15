// Datos de prueba para recorrer la app: 10 clientes "Prueba 1"…"Prueba 10" con zona, dirección,
// CUIT y preventista; 10 pedidos para HOY (cajas y kilos, a cuenta y al recibir) repartidos entre
// los preventistas, dos de ellos con segundo preventista; dos vehículos y sus salidas del día.
//
//   node scripts/prueba.mjs              → crea (o vuelve a crear) los datos de prueba
//   node scripts/prueba.mjs --borrar     → borra los clientes "Prueba N" con sus pedidos, cajones,
//                                          comprobantes y salidas de prueba
//   DB_PATH=/data/pollito.sqlite node scripts/prueba.mjs   (en Railway: railway ssh -- node scripts/prueba.mjs)
//
// Escribe directo en la base (misma lógica de precios que la app). Los clientes conectados ven los
// cambios al refrescar.
import { randomUUID } from "node:crypto";
import { openStore } from "../server/store.mjs";
import { priceOrder, localities } from "../domain.mjs";

const dbPath =
  process.env.DB_PATH ||
  `${(process.env.DATA_DIR || "data").replace(/\/$/, "")}/pollito.sqlite`;
const borrar = process.argv.includes("--borrar");
const store = await openStore(dbPath, { log: { info() {}, warn() {} } });
const now = () => new Date().toISOString();
const today = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // Mendoza (UTC−3)

const PRUEBA = /^Prueba \d+$/;
const drivers = store.drivers.all().filter((d) => d.active);
if (!drivers.length) {
  console.error("No hay preventistas cargados.");
  process.exit(1);
}

function clear() {
  const customers = store.customers.all().filter((c) => PRUEBA.test(c.name));
  let orders = 0;
  for (const c of customers) {
    for (const o of store.orders.forCustomer(c.phone)) {
      store.orders.remove?.(o.id) ??
        store.db.prepare("DELETE FROM orders WHERE id = ?").run(o.id);
      orders++;
    }
    store.db.prepare("DELETE FROM payments WHERE customer = ?").run(c.phone);
    store.db.prepare("DELETE FROM customers WHERE phone = ?").run(c.phone);
  }
  const trips = store.trips
    .forDate(today)
    .filter((t) => t.id.startsWith("prueba-"));
  for (const t of trips) store.trips.remove(t.id);
  console.log(
    `Borrados ${customers.length} clientes de prueba, ${orders} pedidos y ${trips.length} salidas.`,
  );
}

clear();
if (borrar) process.exit(0);

// Vehículos (si no hay ninguno, dos de ejemplo).
let vehicles = store.vehicles.all().filter((v) => v.active);
if (!vehicles.length) {
  vehicles = [
    store.vehicles.save({
      id: "hino1",
      name: "Toyota Hino",
      plate: "A7234",
      active: true,
      sort: 0,
      created: now(),
    }),
    store.vehicles.save({
      id: "iveco1",
      name: "Iveco Daily",
      plate: "AC 512 KL",
      active: true,
      sort: 1,
      created: now(),
    }),
  ];
}
const [v1, v2 = v1] = vehicles;

const zonas = ["Palmira", "San Martín", "Junín", "Rivadavia", "La Colonia"];
const calles = [
  "Belgrano",
  "San Martín",
  "Rivadavia",
  "Mitre",
  "Sarmiento",
  "Alem",
  "Lavalle",
  "Moreno",
  "Chile",
  "Perú",
];
const products = ["entero", "cuarto-trasero", "pechuga", "alas"];
const customers = [];
for (let i = 1; i <= 10; i++) {
  const d = drivers[(i - 1) % drivers.length];
  const zone = zonas[(i - 1) % zonas.length];
  const loc = localities.find((l) =>
    l.name.toLowerCase().startsWith(zone.toLowerCase().slice(0, 5)),
  );
  const c = store.customers.save({
    phone: "n-prueba" + String(i).padStart(2, "0"),
    name: `Prueba ${i}`,
    alias: `Prueba ${i}`,
    legalName: i % 3 === 0 ? `Prueba ${i} S.R.L.` : "",
    cuit:
      i % 2 === 0
        ? `20${String(30000000 + i * 1111).padStart(8, "0")}${i % 10}`
        : "",
    contactPhone:
      i % 3 === 1 ? `5492634${String(500000 + i * 137).padStart(6, "0")}` : "",
    zone,
    address: `${calles[i - 1]} ${100 * i}`,
    localityId: loc?.id || "",
    truck: d.name,
    driver: d.name,
    shift: i % 2 ? "manana" : "tarde",
    plan: i % 4 === 0 ? "intermedio" : "mayorista",
    credit: i % 3 !== 0,
    creditBalance: 0,
    status: i % 2 === 0 ? "ok" : "incompleto",
    created: now(),
  });
  customers.push({ c, d });
}
// Precio propio para dos clientes (para ver el precio personalizado en el pedido y el remito).
store.db
  .prepare(
    "INSERT OR REPLACE INTO customer_prices(customer, product_id, price, updated) VALUES(?,?,?,?)",
  )
  .run(customers[1].c.phone, "entero", 5200, now());

const lists = store.settings.get("priceLists", null);
const orders = [];
customers.forEach(({ c, d }, i) => {
  const items =
    i % 3 === 0
      ? [{ id: "entero", boxes: 6 + i }]
      : i % 3 === 1
        ? [
            { id: "entero", boxes: 4 },
            { id: products[1 + (i % 3)], kg: 5 + i },
          ]
        : [
            { id: "entero", kg: 20 + i * 2 },
            { id: "alas", kg: 3 },
          ];
  const prices = Object.fromEntries(
    store.prices.forCustomer(c.phone).map((p) => [p.productId, p.price]),
  );
  const locality = localities.find((l) => l.id === c.localityId) || {
    id: c.localityId || "otra",
    name: c.zone || "Sin localidad",
    postalCode: "",
    province: "Mendoza",
    country: "Argentina",
  };
  const payment = c.credit ? "cuenta" : "entrega";
  const priced = priceOrder(
    {
      plan: c.plan,
      payment,
      items,
      address: c.address,
      name: c.name,
      phone: c.contactPhone || "",
      localityId: locality.id,
    },
    { enforceMin: false, prices, staff: true, locality, lists },
  );
  const driver2 = i % 4 === 1 ? drivers[(i + 1) % drivers.length].name : "";
  const o = {
    ...priced,
    locality,
    id: "PC-" + randomUUID().slice(0, 8).toUpperCase(),
    key: `${c.phone}:prueba-${today}`,
    customer: c.phone,
    name: c.name,
    phone: c.contactPhone || "",
    address: c.address,
    notes:
      i === 2
        ? "Dejar en depósito del fondo"
        : i === 6
          ? "Llamar antes de llegar"
          : "",
    plan: c.plan,
    payment,
    paid: false,
    status: "recibido",
    driver: d.name,
    deliveryDate: today,
    shift: c.shift,
    driver2,
    vehicleId: i % 2 ? v2.id : v1.id,
    zone: c.zone,
    boxes: 0,
    returned: 0,
    created: now(),
    createdBy: i % 2 ? `preventista:${d.name}` : "admin",
    history: [{ status: "recibido", at: now() }],
    destination: null,
  };
  store.orders.save(o);
  orders.push(o);
});

// Dos pedidos ya pesados por lote (para ver la carga, el remito con kilos y el Excel con datos).
const tare = Number(store.settings.get("tare", 1.7)) || 1.7;
for (const o of orders.slice(0, 2)) {
  const item = o.items.find((it) => it.boxes);
  if (!item) continue;
  const boxes = item.boxes;
  const netTotal = Math.round(boxes * 21.4 * 100) / 100;
  const each = Math.round((netTotal / boxes) * 100) / 100;
  const batch = "prueba-" + o.id;
  for (let k = 1; k <= boxes; k++) {
    const net =
      k === boxes
        ? Math.round((netTotal - each * (boxes - 1)) * 100) / 100
        : each;
    store.crates.add({
      id: `${batch}:${k}`,
      orderId: o.id,
      productId: item.id,
      gross: Math.round((net + tare) * 100) / 100,
      tare,
      net,
      by: o.driver,
    });
  }
  const kg = Math.round(netTotal * 100) / 100;
  o.items = o.items.map((it) =>
    it.id === item.id
      ? {
          ...it,
          ordered: it.kg,
          kg,
          lineTotal: Math.round(Math.round(it.price * 100) * kg) / 100,
          weighed: true,
        }
      : it,
  );
  o.subtotal =
    Math.round(
      o.items.reduce((s, it) => s + Math.round(it.lineTotal * 100), 0),
    ) / 100;
  o.total = Math.round((o.subtotal + (o.shipping || 0)) * 100) / 100;
  o.status = "preparando";
  o.weighed = true;
  o.history = [...o.history, { status: "preparando", at: now() }];
  store.orders.save(o);
}

// Salidas del día: dos vehículos con dos preventistas cada uno y hora de salida.
const crews = [
  [drivers[0]?.name, drivers[1]?.name].filter(Boolean),
  [drivers[2]?.name, drivers[3]?.name].filter(Boolean),
];
[v1, v2].forEach((v, i) => {
  if (v2 === v1 && i === 1) return;
  const existing = store.trips.forDate(today).find((t) => t.vehicleId === v.id);
  store.trips.save({
    id: existing?.id || "prueba-" + v.id,
    date: today,
    vehicleId: v.id,
    drivers: crews[i].length ? crews[i] : [drivers[0].name],
    departure: i ? "07:00" : "06:30",
    departedAt: null,
    created: now(),
    updated: now(),
  });
});

store.news?.add?.(
  `Datos de prueba cargados: 10 clientes "Prueba N" y 10 pedidos para el ${today.split("-").reverse().join("/")}. Para borrarlos: node scripts/prueba.mjs --borrar`,
  "Sistema",
  true,
);

console.log(
  `Listo: 10 clientes y ${orders.length} pedidos para ${today}; vehículos ${[v1, v2].map((v) => v.name).join(" y ")}.`,
);
