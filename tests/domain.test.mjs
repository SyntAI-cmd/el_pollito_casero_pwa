import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceOrder,
  normalizePhone,
  accountSummary,
  applyWeights,
  applyPayment,
  validateLists,
  withLists,
  applyPrices,
} from "../domain.mjs";

const base = {
  plan: "mayorista",
  payment: "cuenta",
  items: [{ id: "entero", kg: 10 }],
  address: "Calle de prueba 123",
  localityId: "san-martin",
  name: "Prueba Local",
  phone: "263 500-0000",
};

test("precios por modalidad calculados por el servidor", () => {
  assert.equal(priceOrder(base).total, 55000);
  assert.equal(
    priceOrder({ ...base, plan: "intermedio", payment: "entrega" }).total,
    61500,
  );
  assert.equal(
    priceOrder({ ...base, plan: "minorista", payment: "entrega" }).total,
    66500,
  );
});

test("ignora importes alterados por el cliente", () =>
  assert.equal(
    priceOrder({
      ...base,
      total: 1,
      items: [{ id: "entero", kg: 10, price: 1 }],
    }).total,
    55000,
  ));

test("minorista e intermedio no tienen crédito", () => {
  for (const plan of ["minorista", "intermedio"])
    assert.throws(() => priceOrder({ ...base, plan }));
});

test("rechaza cantidades inválidas, infinitas y productos duplicados", () => {
  for (const kg of [-1, 0, NaN, Infinity, 1001, 1.3])
    assert.throws(() => priceOrder({ ...base, items: [{ id: "entero", kg }] }));
  assert.throws(() =>
    priceOrder({
      ...base,
      items: [
        { id: "entero", kg: 1 },
        { id: "entero", kg: 2 },
      ],
    }),
  );
  assert.throws(() =>
    priceOrder({ ...base, items: [{ id: "trozado", kg: 2 }] }),
  );
});

test("acepta medios kilos y suma varios cortes", () => {
  const priced = priceOrder({
    ...base,
    items: [
      { id: "entero", kg: 8.5 },
      { id: "suprema", kg: 2 },
    ],
  });
  assert.equal(priced.total, 8.5 * 5500 + 2 * 11690);
  assert.equal(priced.shipping, 0);
});

test("las modalidades mayorista e intermedio tienen un mínimo de kilos", () => {
  assert.throws(
    () => priceOrder({ ...base, items: [{ id: "entero", kg: 3 }] }),
    /a partir de 10 kg/,
  );
  assert.throws(
    () =>
      priceOrder({
        ...base,
        plan: "intermedio",
        payment: "entrega",
        items: [{ id: "entero", kg: 4.5 }],
      }),
    /a partir de 5 kg/,
  );
  assert.equal(
    priceOrder({
      ...base,
      plan: "minorista",
      payment: "entrega",
      items: [{ id: "entero", kg: 1 }],
    }).subtotal,
    6500,
  );
});

test("requiere datos de entrega válidos y localidad de Mendoza", () => {
  assert.throws(() => priceOrder({ ...base, address: "x" }));
  assert.throws(() => priceOrder({ ...base, phone: "abc" }));
  assert.throws(() => priceOrder({ ...base, phone: "12345" }));
  assert.throws(() => priceOrder({ ...base, localityId: "caba" }));
  assert.equal(priceOrder(base).locality.name, "San Martín");
});

test("normaliza teléfonos argentinos a formato WhatsApp", () => {
  assert.equal(normalizePhone("2635037286"), "5492635037286");
  assert.equal(normalizePhone("0263 15 503-7286"), "5492635037286");
  assert.equal(normalizePhone("+54 9 263 503 7286"), "5492635037286");
  assert.equal(normalizePhone("+54 263 503 7286"), "5492635037286");
  assert.equal(normalizePhone("11 2345 6789"), "5491123456789");
  assert.equal(normalizePhone("1234"), null);
});

test("resumen de cuenta: saldo a cuenta, envases y cancelados excluidos", () => {
  const s = accountSummary([
    {
      payment: "cuenta",
      paid: false,
      total: 1000,
      boxes: 3,
      returned: 1,
      status: "entregado",
    },
    {
      payment: "cuenta",
      paid: true,
      total: 500,
      boxes: 2,
      returned: 2,
      status: "entregado",
    },
    {
      payment: "entrega",
      paid: false,
      total: 700,
      boxes: 0,
      returned: 0,
      status: "recibido",
    },
    {
      payment: "cuenta",
      paid: false,
      total: 9999,
      boxes: 0,
      returned: 0,
      status: "cancelado",
    },
  ]);
  assert.deepEqual(s, {
    balance: 1000,
    owed: 1000,
    creditBalance: 0,
    pendingOrders: 1,
    boxes: 2,
  });
});

test("pesaje en balanza recalcula líneas y total, conservando lo pedido", () => {
  const order = {
    shipping: 1500,
    items: [
      {
        id: "entero",
        name: "Pollo entero",
        kg: 2,
        price: 4500,
        lineTotal: 9000,
      },
      { id: "alas", name: "Alas", kg: 1, price: 3300, lineTotal: 3300 },
    ],
  };
  const r = applyWeights(order, { entero: 1.96 });
  assert.equal(r.items[0].kg, 1.96);
  assert.equal(r.items[0].ordered, 2);
  assert.equal(r.items[0].lineTotal, 8820);
  assert.equal(r.items[1].weighed, undefined);
  assert.equal(r.total, 8820 + 3300 + 1500);
  assert.throws(() => applyWeights(order, { entero: 0 }));
  assert.throws(() => applyWeights(order, { entero: "x" }));
});

test("un pago a cuenta cubre los pedidos más viejos y deja saldo a favor", () => {
  const orders = [
    {
      id: "b",
      payment: "cuenta",
      paid: false,
      status: "entregado",
      total: 30000,
      created: "2026-09-02",
    },
    {
      id: "a",
      payment: "cuenta",
      paid: false,
      status: "entregado",
      total: 20000,
      created: "2026-09-01",
    },
    {
      id: "c",
      payment: "entrega",
      paid: false,
      status: "entregado",
      total: 5000,
      created: "2026-09-03",
    },
    {
      id: "x",
      payment: "cuenta",
      paid: false,
      status: "cancelado",
      total: 999,
      created: "2026-08-01",
    },
  ];
  const r = applyPayment(orders, 45000);
  assert.deepEqual(
    r.covered.map((o) => o.id),
    ["a"],
  );
  assert.equal(r.leftover, 25000);
  const r2 = applyPayment(orders, 5000, 25000);
  assert.deepEqual(
    r2.covered.map((o) => o.id),
    ["a"],
  );
  assert.equal(r2.leftover, 10000);
  assert.throws(() => applyPayment(orders, -1));
  const s = accountSummary(orders, { creditBalance: 10000 });
  assert.equal(s.owed, 50000);
  assert.equal(s.balance, 40000);
});

test("listas editadas pisan business.json y se validan", () => {
  const lists = validateLists({
    entero: { mayorista: "6000", minorista: 7000 },
  });
  assert.deepEqual(lists, { entero: { mayorista: 6000, minorista: 7000 } });
  assert.equal(priceOrder(base, { lists }).total, 60000);
  assert.equal(withLists(lists).find((p) => p.id === "entero").wholesale, 6000);
  assert.equal(
    withLists(lists).find((p) => p.id === "entero").intermediate,
    6000,
  );
  assert.throws(() => validateLists({ entero: { mayorista: -1 } }), /inválido/);
});

test("cambio de precio en el pedido recalcula renglones y total", () => {
  const order = {
    shipping: 0,
    items: [
      {
        id: "entero",
        name: "Pollo entero",
        kg: 20,
        price: 5500,
        lineTotal: 110000,
      },
      { id: "alas", name: "Alas", kg: 1, price: 4150, lineTotal: 4150 },
    ],
  };
  const r = applyPrices(order, { entero: 5200 });
  assert.equal(r.items[0].price, 5200);
  assert.equal(r.items[0].ownPrice, true);
  assert.equal(r.items[0].lineTotal, 104000);
  assert.equal(r.total, 108150);
  assert.throws(() => applyPrices(order, { entero: 0 }), /inválido/);
});
