import { outgoingBoxes } from "./cajas.js";

/** Projection at document emission. Each customer balance is carried once, never per order. */
export function routeRows(orders, customers) {
  const list = orders
    .filter((o) => o.status !== "cancelado")
    .sort((a, b) => (a.number || 0) - (b.number || 0));
  const balances = new Map(),
    seen = new Set();
  for (const o of list) {
    if (balances.has(o.customer)) continue;
    const c = customers.find((c) => c.phone === o.customer);
    const group = list.filter((x) => x.customer === o.customer);
    const included = group.reduce(
      (n, x) => n + (x.boxes || 0) - (x.returned || 0),
      0,
    );
    const charge = group
      .filter((x) => x.payment === "cuenta" && !x.paid)
      .reduce((n, x) => n + (x.total || 0), 0);
    balances.set(o.customer, {
      boxes: (c?.summary?.boxes || 0) - included,
      money: (c?.summary?.balance || 0) - charge,
    });
  }
  return list.map((o) => {
    const customer = customers.find((c) => c.phone === o.customer),
      b = balances.get(o.customer);
    const out = outgoingBoxes(o);
    const back = o.returned || 0,
      before = b.boxes,
      after = before + out - back;
    const firstCustomer = !seen.has(o.customer);
    seen.add(o.customer);
    b.boxes = after;
    return {
      order: o,
      customer,
      before,
      out,
      back,
      after,
      firstCustomer,
      moneyBefore: b.money,
    };
  });
}
export function routeParts(rows, size = 10) {
  const parts = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += size)
    parts.push(rows.slice(i, i + size));
  return parts;
}
