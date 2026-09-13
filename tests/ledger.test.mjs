import test from "node:test";
import assert from "node:assert/strict";
import { ledger, balanceBefore } from "../src/lib/ledger.js";

const t = (d) => new Date(Date.UTC(2026, 8, d, 15)).toISOString();
const base = {
  customer: "549111",
  payment: "cuenta",
  status: "entregado",
  shipping: 0,
  history: [],
};

test("cargo, ajuste por peso, pago y anulación cuadran con el saldo del cliente", () => {
  const rows = ledger(
    [
      {
        ...base,
        id: "PC-1",
        created: t(1),
        items: [{ id: "e", price: 1000, kg: 12, ordered: 10, weighed: true }],
        total: 12000,
        weighed: true,
        weighedAt: t(2),
      },
      {
        ...base,
        id: "PC-2",
        created: t(3),
        status: "cancelado",
        items: [{ id: "e", price: 1000, kg: 5 }],
        total: 5000,
        history: [{ status: "cancelado", at: t(4) }],
      },
      {
        ...base,
        id: "PC-3",
        payment: "entrega",
        status: "cancelado",
        created: t(5),
        items: [{ id: "e", price: 1000, kg: 3 }],
        total: 3000,
        paid: true,
        refunded: { amount: 3000, at: t(5) },
      },
    ],
    [{ id: "PG-1", amount: 7000, method: "efectivo", by: "Franco", at: t(6) }],
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, r.amount, r.balance]),
    [
      ["cargo", 10000, 10000],
      ["ajuste", 2000, 12000],
      ["cargo", 5000, 17000],
      ["anulación", -5000, 12000],
      ["reintegro", -3000, 9000],
      ["pago", -7000, 2000],
    ],
  );
  assert.equal(balanceBefore(rows, "2026-09-04"), 17000);
  assert.equal(balanceBefore(rows, "2026-09-30"), 2000);
  assert.equal(balanceBefore(rows, "2026-09-01"), 0);
});
