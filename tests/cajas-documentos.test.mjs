import test from "node:test";
import assert from "node:assert/strict";
import { remitoData } from "../src/lib/remito.js";
import { routeRows } from "../src/lib/routeRows.js";
import { outgoingBoxes } from "../src/lib/cajas.js";

const customer = { phone: "c1", summary: { boxes: 9, balance: 60000 } };
const order = {
  id: "PC-1",
  number: 1,
  customer: "c1",
  name: "Cliente de prueba",
  status: "en_camino",
  deliveryDate: "2026-09-24",
  payment: "entrega",
  weighed: true,
  boxes: 0,
  returned: 2,
  total: 10000,
  items: [{ name: "Pollo", kg: 20, boxes: 4, price: 500, lineTotal: 10000 }],
};

test("sin precio y opciones de impresión nunca borran deuda ni movimientos de cajas", () => {
  for (const noPricing of [false, true])
    for (const hidePrices of [false, true])
      for (const hideBalance of [false, true]) {
        const o = { ...order, noPricing };
        const data = remitoData(o, customer, { hidePrices, hideBalance });
        assert.equal(data.owedBoxes, 9);
        assert.equal(data.owedBoxesText, "9 cajas");
        const [row] = routeRows([o], [customer]);
        assert.deepEqual(
          [row.before, row.out, row.back, row.after],
          [11, 4, 2, 13],
        );
        if (noPricing || hidePrices) assert.equal(data.lines[0].unit, "");
        if (noPricing || hideBalance) assert.equal(data.saldo, "");
      }
});

test("cajas: pesada real respeta cero envases, lotes y pesadas anuladas", () => {
  assert.equal(outgoingBoxes({ ...order, crates: [{ boxes: 0 }] }), 0);
  assert.equal(
    outgoingBoxes({
      ...order,
      crates: [{ boxes: 3 }, { boxes: 0 }, { boxes: 8, voided: true }],
    }),
    3,
  );
  assert.equal(outgoingBoxes({ ...order, crates: [{}] }), 1);
  assert.equal(
    outgoingBoxes({
      ...order,
      status: "entregado",
      boxes: 5,
      crates: [{ boxes: 20 }],
    }),
    5,
  );
});

test("cajas: pedidos repetidos sin precio trasladan el saldo una sola vez", () => {
  const rows = routeRows(
    [
      { ...order, noPricing: true },
      { ...order, id: "PC-2", number: 2, noPricing: true, returned: 0 },
    ],
    [customer],
  );
  assert.deepEqual(
    rows.map((r) => [r.before, r.out, r.back, r.after]),
    [
      [11, 4, 2, 13],
      [13, 4, 0, 17],
    ],
  );
});
