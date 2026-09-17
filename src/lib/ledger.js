import { lineAmount } from "./format.js";

/**
 * Libro de movimientos de la cuenta corriente de un cliente, derivado de sus pedidos y pagos.
 * No es una tabla aparte: se reconstruye siempre desde los datos reales, así el extracto,
 * el saldo actual y cualquier corte histórico salen de la misma fuente.
 *
 * Convención: cargo (+) aumenta la deuda; crédito (−) la reduce. El saldo es la suma acumulada.
 *   cargo      · pedido a cuenta, por el importe original pedido, en la fecha de creación
 *   ajuste     · diferencia por peso de balanza, en la fecha del pesaje
 *   anulación  · pedido a cuenta cancelado: se revierte cargo + ajuste, en la fecha de cancelación
 *   pago       · pago registrado (efectivo, transferencia, MP), por su importe, en su fecha
 *   reintegro  · pedido NO a cuenta que ya estaba pagado y se canceló: queda como saldo a favor
 */
const cents = (n) => Math.round((n || 0) * 100);
// Importe "pedido": kilos solicitados × precio. Un renglón que todavía espera la balanza (kg 0,
// sin pesar) no vale nada: el importe lo pone la pesada.
const originalTotal = (o) =>
  o.items.reduce(
    (s, i) =>
      s +
      (i.weighed || i.kg > 0
        ? cents(lineAmount(i.price, i.ordered ?? i.kg))
        : 0),
    0,
  ) + cents(o.shipping);
const cancelledAt = (o) =>
  (o.history || []).find((h) => h.status === "cancelado")?.at ||
  o.updated ||
  o.created;

export function ledger(orders, payments = [], adjustments = []) {
  const rows = [];
  for (const a of adjustments)
    rows.push({
      at: a.at,
      kind: "ajuste",
      label: `Ajuste a mano${a.by ? " · " + a.by : ""}${a.note ? " · " + a.note : ""}`,
      amount: cents(a.amount),
      ref: a.id || a.at,
    });
  for (const o of orders) {
    if (o.payment === "cuenta") {
      const original = originalTotal(o);
      const current = cents(o.total);
      if (original === 0 && current === 0 && o.status !== "cancelado") continue;
      rows.push({
        at: o.created,
        kind: "cargo",
        label: `Pedido ${o.id}`,
        amount: original,
        ref: o.id,
      });
      if (o.weighed && current !== original)
        rows.push({
          at: o.weighedAt || o.updated || o.created,
          kind: "ajuste",
          label: `Peso de balanza · ${o.id}`,
          amount: current - original,
          ref: o.id,
        });
      if (o.status === "cancelado")
        rows.push({
          at: cancelledAt(o),
          kind: "anulación",
          label: `Pedido cancelado · ${o.id}`,
          amount: -current,
          ref: o.id,
        });
    } else if (o.status === "cancelado" && o.refunded) {
      rows.push({
        at: o.refunded.at,
        kind: "reintegro",
        label: `Reintegro de ${o.id} (pagado y cancelado)`,
        amount: -cents(o.refunded.amount),
        ref: o.id,
      });
    }
  }
  for (const p of payments)
    rows.push({
      at: p.at,
      kind: "pago",
      label: `Pago ${p.id}${p.method ? " · " + p.method : ""}${p.by ? " · " + p.by : ""}`,
      amount: -cents(p.amount),
      ref: p.id,
    });
  rows.sort((a, b) => a.at.localeCompare(b.at));
  let running = 0;
  return rows.map((r) => {
    running += r.amount;
    return { ...r, amount: r.amount / 100, balance: running / 100 };
  });
}

/** Saldo al inicio de una fecha local (YYYY-MM-DD): suma de movimientos anteriores a ese día. */
export function balanceBefore(rows, date) {
  const start = new Date(date + "T00:00:00").toISOString();
  let balance = 0;
  for (const r of rows) if (r.at < start) balance = r.balance;
  return balance;
}
