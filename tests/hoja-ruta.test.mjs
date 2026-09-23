import test from "node:test";
import assert from "node:assert/strict";
import { routeRows, routeParts } from "../src/lib/routeRows.js";

/**
 * PC-016 — Importe total de la hoja de ruta.
 *
 * Importe total = pedido del día + saldo del cliente. Es lo que el preventista tiene que
 * cobrar en esa parada. La deuda previa se cuenta UNA sola vez por cliente.
 */

/** Misma cuenta que imprime la hoja. */
const importeTotal = (r) =>
  (r.order.noPricing ? 0 : r.order.total || 0) +
  (r.firstCustomer ? r.moneyBefore || 0 : 0);

const pedido = (n, customer, extra = {}) => ({
  id: `PC-${n}`,
  number: n,
  customer,
  name: "Cliente " + customer,
  status: "en_camino",
  items: [{ id: "entero", boxes: 2 }],
  boxes: 0,
  returned: 0,
  total: 10000,
  weighed: true,
  payment: "entrega",
  paid: false,
  ...extra,
});

test("al importe del pedido se le suma la deuda del cliente", () => {
  const cliente = { phone: "c1", summary: { balance: 25000, boxes: 0 } };
  const [r] = routeRows([pedido(1, "c1")], [cliente]);
  assert.equal(r.moneyBefore, 25000, "la deuda previa es la del cliente");
  assert.equal(importeTotal(r), 35000, "10.000 del pedido + 25.000 de deuda");
});

test("un cliente sin deuda cobra solo su pedido", () => {
  const cliente = { phone: "c2", summary: { balance: 0, boxes: 0 } };
  const [r] = routeRows([pedido(2, "c2")], [cliente]);
  assert.equal(importeTotal(r), 10000);
});

test("con dos pedidos del mismo cliente, la deuda se suma una sola vez", () => {
  const cliente = { phone: "c3", summary: { balance: 25000, boxes: 0 } };
  const filas = routeRows([pedido(3, "c3"), pedido(4, "c3")], [cliente]);
  assert.equal(filas[0].firstCustomer, true);
  assert.equal(filas[1].firstCustomer, false);
  assert.equal(importeTotal(filas[0]), 35000, "el primero lleva pedido + deuda");
  assert.equal(importeTotal(filas[1]), 10000, "el segundo, solo su pedido");
  const total = filas.reduce((n, r) => n + importeTotal(r), 0);
  assert.equal(total, 45000, "20.000 de pedidos + 25.000 de deuda, una vez");
});

test("un cliente con saldo a favor descuenta del importe a cobrar", () => {
  const cliente = { phone: "c4", summary: { balance: -3000, boxes: 0 } };
  const [r] = routeRows([pedido(5, "c4")], [cliente]);
  assert.equal(importeTotal(r), 7000, "10.000 menos 3.000 a favor");
});

test("un cliente sin precio con deuda muestra al menos su deuda", () => {
  const cliente = { phone: "c5", summary: { balance: 8000, boxes: 0 } };
  const [r] = routeRows([pedido(6, "c5", { noPricing: true, total: 0 })], [cliente]);
  assert.equal(importeTotal(r), 8000, "el pedido no vale, pero la deuda sí");
});

test("la deuda previa no incluye el pedido a cuenta que todavía está en la hoja", () => {
  // El saldo del cliente ya contiene este pedido a cuenta impago: no se puede contar dos veces.
  const cliente = { phone: "c6", summary: { balance: 30000, boxes: 0 } };
  const [r] = routeRows(
    [pedido(7, "c6", { payment: "cuenta", paid: false, total: 10000 })],
    [cliente],
  );
  assert.equal(r.moneyBefore, 20000, "se descuenta el pedido de hoy");
  assert.equal(importeTotal(r), 30000, "coincide con el saldo real del cliente");
});

test("la hoja se divide en partes sin perder pedidos", () => {
  const cliente = { phone: "c7", summary: { balance: 0, boxes: 0 } };
  const filas = routeRows(
    Array.from({ length: 31 }, (_, i) => pedido(100 + i, "c7")),
    [cliente],
  );
  const partes = routeParts(filas, 14);
  assert.deepEqual(
    partes.map((p) => p.length),
    [14, 14, 3],
  );
  assert.equal(partes.flat().length, 31);
});
