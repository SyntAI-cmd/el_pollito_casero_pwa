import { totalKg } from "./format.js";
import { ledger, balanceBefore } from "./ledger.js";

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
/** Medio con el que efectivamente se cobró (o se cobrará) un pedido. */
export const paidMethodOf = (o) =>
  o.paidMethod || (o.payment === "entrega" ? "efectivo" : o.payment);
/** Importe cobrado de un pedido por medio (soporta cobros mixtos con `paidSplit`). */
export function paidByMethod(o) {
  const out = { efectivo: 0, transferencia: 0, cheque: 0, mercadopago: 0 };
  if (!o.paid || o.payment === "cuenta") return out;
  if (Array.isArray(o.paidSplit) && o.paidSplit.length)
    for (const p of o.paidSplit)
      out[p.method in out ? p.method : "transferencia"] += p.amount;
  else {
    const m = paidMethodOf(o);
    out[m in out ? m : "transferencia"] += o.total;
  }
  return out;
}

/**
 * Total por cobrar del negocio: pedidos sin pagar que no van a cuenta corriente,
 * más la deuda neta de cada cliente de cuenta corriente (descontando su saldo a favor).
 */
export function receivables(orders, customers) {
  const direct = orders
    .filter(
      (o) => !o.paid && o.status !== "cancelado" && o.payment !== "cuenta",
    )
    .reduce((s, o) => s + Math.round(o.total * 100), 0);
  const account = customers.reduce(
    (s, c) => s + Math.max(0, Math.round((c.summary?.balance || 0) * 100)),
    0,
  );
  return {
    direct: direct / 100,
    account: account / 100,
    total: (direct + account) / 100,
  };
}

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
      const method = paidMethodOf(o);
      const delivered = o.status === "entregado";
      const by = paidByMethod(o);
      return {
        order: o,
        customer,
        kg: totalKg(o),
        method,
        // Efectivo que el repartidor debe cobrar en la puerta (pendiente) o ya cobró él mismo.
        cash: o.payment === "entrega" && !o.paid ? o.total : 0,
        collected: o.paidBy === driver ? by.efectivo : 0,
        transfers: by.transferencia + by.mercadopago,
        cheques: by.cheque,
        accountPlanned: o.payment === "cuenta" ? o.total : 0,
        account: o.payment === "cuenta" && delivered ? o.total : 0,
        boxesLeft: o.boxes || 0,
        boxesReturned: (o.returns || [])
          .filter((r) => dayKey(r.at) === date)
          .reduce((s, r) => s + r.boxes, 0),
        boxesPending: customer?.summary?.boxes || 0,
      };
    });
  // Saldo de cada cliente al inicio de ese día, desde el libro de movimientos (corte histórico real),
  // calculado una sola vez por cliente aunque tenga varias paradas.
  const previousByCustomer = new Map();
  for (const s of stops) {
    if (!s.customer || previousByCustomer.has(s.customer.phone)) continue;
    const rows = ledger(
      orders.filter((o) => o.customer === s.customer.phone),
      s.customer.payments || [],
    );
    previousByCustomer.set(s.customer.phone, round(balanceBefore(rows, date)));
  }
  for (const s of stops)
    s.previousBalance = s.customer
      ? previousByCustomer.get(s.customer.phone)
      : 0;
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
      .filter((p) => p.method !== "efectivo" && p.method !== "cheque")
      .reduce((s, p) => s + p.amount, 0),
  );
  const accountCheques = round(
    accountPayments
      .filter((p) => p.method === "cheque")
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
    cash: round(sum("cash") + sum("collected")),
    collected: sum("collected"),
    transfers: sum("transfers"),
    cheques: sum("cheques"),
    pendingCash: sum("cash"),
    accountPayments,
    accountCash,
    accountTransfers,
    accountCheques,
    // Solo el efectivo que pasó por las manos del repartidor: cobros en la puerta y de cuenta corriente.
    toSettle: round(sum("collected") + accountCash),
    accountPlanned: sum("accountPlanned"),
    account: sum("account"),
    boxesLeft: sum("boxesLeft"),
    boxesReturned: sum("boxesReturned"),
    previousBalance: round(
      [...previousByCustomer.values()].reduce((a, b) => a + b, 0),
    ),
  };
}
