import { totalKg } from "./format.js";

/** Fecha local YYYY-MM-DD. */
export const dayKey = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const today = () => dayKey();
export const dayLabel = (key) => {
  const s = new Date(key + "T12:00:00").toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const round = (n) => Math.round(n * 100) / 100;
const orderDay = (o) => dayKey(o.departedAt || o.created);

/** Hoja de pedidos del día: todo lo pedido para preparar y repartir. */
export function ordersSheet(orders, date) {
  const list = orders.filter(
    (o) => dayKey(o.created) === date && o.status !== "cancelado",
  );
  const byProduct = {};
  for (const o of list)
    for (const p of o.items)
      byProduct[p.name] = round((byProduct[p.name] || 0) + p.kg);
  const byDriver = {};
  for (const o of list) (byDriver[o.driver || "Sin asignar"] ||= []).push(o);
  return {
    date,
    orders: list,
    byProduct: Object.entries(byProduct).sort((a, b) => b[1] - a[1]),
    byDriver: Object.entries(byDriver),
    kg: round(list.reduce((s, o) => s + totalKg(o), 0)),
    total: round(list.reduce((s, o) => s + o.total, 0)),
    cancelled: orders.filter(
      (o) => dayKey(o.created) === date && o.status === "cancelado",
    ).length,
  };
}

/**
 * Hoja de ruta y rendición de un repartidor en una fecha: salida, paradas en orden,
 * zonas, kilos, cobros, envases y saldo anterior de cada cliente habitual.
 */
export function routeSheet(orders, customers, { driver, date }) {
  const stops = orders
    .filter(
      (o) =>
        o.driver === driver &&
        ["preparando", "en_camino", "entregado"].includes(o.status) &&
        orderDay(o) === date,
    )
    .sort((a, b) =>
      (a.deliveredAt || a.departedAt || a.created).localeCompare(
        b.deliveredAt || b.departedAt || b.created,
      ),
    )
    .map((o) => {
      const customer = customers.find((c) => c.phone === o.customer);
      const balance = customer?.summary?.balance || 0;
      const pendingThis = o.payment === "cuenta" && !o.paid ? o.total : 0;
      const cash = o.payment !== "cuenta" ? o.total : 0;
      return {
        order: o,
        customer,
        kg: totalKg(o),
        cash,
        collected: o.payment !== "cuenta" && o.paid ? o.total : 0,
        account: o.payment === "cuenta" ? o.total : 0,
        previousBalance: round(balance - pendingThis),
        boxesLeft: o.boxes || 0,
        boxesReturned: (o.returns || [])
          .filter((r) => dayKey(r.at) === date)
          .reduce((s, r) => s + r.boxes, 0),
        boxesPending: customer?.summary?.boxes || 0,
      };
    });
  // Cobros de cuenta corriente registrados por el repartidor ese día (efectivo va a la rendición).
  const accountPayments = customers
    .flatMap((c) => (c.payments || []).map((p) => ({ ...p, customer: c })))
    .filter((p) => p.by === driver && dayKey(p.at) === date)
    .sort((a, b) => a.at.localeCompare(b.at));
  const accountCash = round(
    accountPayments
      .filter((p) => p.method === "efectivo")
      .reduce((s, p) => s + p.amount, 0),
  );
  const accountTransfers = round(
    accountPayments
      .filter((p) => p.method !== "efectivo")
      .reduce((s, p) => s + p.amount, 0),
  );
  const departures = stops
    .map((s) => s.order.departedAt)
    .filter(Boolean)
    .sort();
  const deliveries = stops
    .map((s) => s.order.deliveredAt)
    .filter(Boolean)
    .sort();
  const zones = [
    ...new Set(stops.map((s) => s.order.locality?.name).filter(Boolean)),
  ];
  const sum = (k) => round(stops.reduce((s, x) => s + x[k], 0));
  const byProduct = {};
  for (const s of stops)
    for (const p of s.order.items)
      byProduct[p.name] = round((byProduct[p.name] || 0) + p.kg);
  return {
    driver,
    date,
    stops,
    zones,
    departedAt: departures[0] || null,
    lastDeliveryAt: deliveries.at(-1) || null,
    delivered: stops.filter((s) => s.order.status === "entregado").length,
    kg: sum("kg"),
    byProduct: Object.entries(byProduct).sort((a, b) => b[1] - a[1]),
    cash: sum("cash"),
    collected: sum("collected"),
    pendingCash: round(sum("cash") - sum("collected")),
    accountPayments,
    accountCash,
    accountTransfers,
    toSettle: round(sum("collected") + accountCash),
    account: sum("account"),
    boxesLeft: sum("boxesLeft"),
    boxesReturned: sum("boxesReturned"),
    previousBalance: sum("previousBalance"),
  };
}
