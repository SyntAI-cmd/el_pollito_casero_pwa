import test from "node:test";
import assert from "node:assert/strict";
import { routeSheet, receivables, dayKey } from "../src/lib/report.js";

const today = dayKey();
const at = new Date().toISOString();
const order = (id, extra) => ({
  id,
  customer: "549111",
  name: "Almacén",
  address: "Calle 1",
  locality: { name: "San Martín" },
  plan: "mayorista",
  items: [{ id: "entero", name: "Pollo entero", kg: 10, price: 900 }],
  total: 9000,
  shipping: 0,
  status: "en_camino",
  driver: "Franco",
  created: at,
  departedAt: at,
  boxes: 0,
  returned: 0,
  ...extra,
});
const customers = [
  {
    phone: "549111",
    name: "Almacén",
    plan: "mayorista",
    payments: [],
    summary: { balance: 20000, boxes: 0 },
  },
];

test("una transferencia cobrada no entra en el efectivo a rendir", () => {
  const sheet = routeSheet(
    [
      order("A", {
        payment: "transferencia",
        paid: true,
        paidBy: "Franco",
        status: "entregado",
        deliveredAt: at,
      }),
      order("B", {
        payment: "entrega",
        paid: true,
        paidMethod: "efectivo",
        paidBy: "Franco",
        status: "entregado",
        deliveredAt: at,
      }),
      order("C", { payment: "entrega", paid: false }),
    ],
    customers,
    { driver: "Franco", date: today },
  );
  assert.equal(sheet.collected, 9000, "solo el efectivo cobrado por él");
  assert.equal(sheet.transfers, 9000);
  assert.equal(sheet.pendingCash, 9000, "lo que falta cobrar en la puerta");
  assert.equal(sheet.toSettle, 9000);
});

test("un cobro en efectivo registrado por administración no lo rinde el repartidor", () => {
  const sheet = routeSheet(
    [
      order("A", {
        payment: "entrega",
        paid: true,
        paidMethod: "efectivo",
        paidBy: "Mauro",
        status: "entregado",
        deliveredAt: at,
      }),
    ],
    customers,
    { driver: "Franco", date: today },
  );
  assert.equal(sheet.collected, 0);
  assert.equal(sheet.toSettle, 0);
});

test("entregado a cuenta cuenta solo lo entregado; el saldo anterior es el corte histórico, una vez por cliente", () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const sheet = routeSheet(
    [
      order("Z", {
        payment: "cuenta",
        paid: false,
        status: "entregado",
        created: yesterday,
        departedAt: yesterday,
        deliveredAt: yesterday,
        items: [{ id: "entero", name: "Pollo entero", kg: 10, price: 200 }],
        total: 2000,
      }),
      order("A", { payment: "cuenta", paid: false }),
      order("B", {
        payment: "cuenta",
        paid: false,
        status: "entregado",
        deliveredAt: at,
      }),
    ],
    customers,
    { driver: "Franco", date: today },
  );
  assert.equal(sheet.accountPlanned, 18000);
  assert.equal(sheet.account, 9000, "solo B fue entregado");
  // Ayer quedó debiendo 2000; hoy se suman A y B, pero el corte al inicio del día es 2000, una sola vez.
  assert.equal(sheet.previousBalance, 2000);
  assert.equal(sheet.stops[0].previousBalance, 2000);
  assert.equal(sheet.stops[1].previousBalance, 2000);
});

test("por cobrar descuenta el saldo a favor de la cuenta corriente", () => {
  const r = receivables(
    [
      order("A", { payment: "entrega", paid: false, total: 5000 }),
      order("B", { payment: "cuenta", paid: false, total: 9000 }),
      order("C", { payment: "entrega", paid: false, status: "cancelado" }),
    ],
    [{ phone: "549111", summary: { balance: 6000 } }],
  );
  assert.equal(r.direct, 5000);
  assert.equal(
    r.account,
    6000,
    "deuda neta del cliente, no el total del pedido",
  );
  assert.equal(r.total, 11000);
});

test("un cobro mixto reparte efectivo, transferencia y cheque; solo el efectivo se rinde", () => {
  const sheet = routeSheet(
    [
      order("PC-M1", {
        payment: "entrega",
        paid: true,
        paidBy: "Franco",
        paidMethod: "mixto",
        paidSplit: [
          { method: "efectivo", amount: 4000 },
          { method: "transferencia", amount: 3000 },
          { method: "cheque", amount: 2000 },
        ],
      }),
      order("PC-M2", {
        payment: "entrega",
        paid: true,
        paidBy: "Franco",
        paidMethod: "cheque",
      }),
    ],
    customers,
    { driver: "Franco", date: today },
  );
  assert.equal(sheet.collected, 4000);
  assert.equal(sheet.transfers, 3000);
  assert.equal(sheet.cheques, 2000 + 9000);
  assert.equal(sheet.toSettle, 4000);
});
