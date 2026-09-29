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
    // Sin ficha o sin saldo conocido (cliente archivado, lista sin cargar) no hay saldo
    // anterior: restarle los pedidos a un saldo desconocido inventaba un "a favor".
    const balance = c?.summary?.balance;
    balances.set(o.customer, {
      boxes: (c?.summary?.boxes || 0) - included,
      money: Number.isFinite(balance) ? balance - charge : 0,
    });
  }
  return list.map((o) => {
    const customer = customers.find((c) => c.phone === o.customer),
      b = balances.get(o.customer);
    const out = outgoingBoxes(o);
    // Previas: en un pedido entregado, las que registró la entrega (lo mismo que muestra el
    // panel de envases del pedido); si no, el saldo de cajas del cliente, el que imprime el
    // remito como "cajas adeudadas", descontando lo que ya movieron sus pedidos de la hoja.
    const back = o.returned || 0,
      before =
        o.status === "entregado" && Number.isFinite(o.boxBalanceBefore)
          ? o.boxBalanceBefore
          : b.boxes,
      after = before + out - back;
    // El saldo va en la primera fila del cliente que lo lleva ("con precio, sin saldo" no).
    const firstCustomer = !o.noBalance && !seen.has(o.customer);
    if (!o.noBalance) seen.add(o.customer);
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
