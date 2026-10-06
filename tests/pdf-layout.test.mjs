import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import React from "react";
import { pdf } from "@react-pdf/renderer";

async function component(name) {
  const url = new URL(`../src/pdf/${name}.jsx`, import.meta.url);
  const source = (await readFile(url, "utf8")).replace(
    /from "([^"]+)"/g,
    (_, specifier) =>
      `from "${specifier.startsWith(".") ? new URL(specifier, url).href : import.meta.resolve(specifier)}"`,
  );
  const { code } = await transform(source, { loader: "jsx", format: "esm" });
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    )
  )[name.replace("Pdf", "Document")];
}
const HojaDocument = await component("HojaPdf");
const RemitoDocument = await component("RemitoPdf");
const order = (number, count = 3) => ({
  id: `PC-${number}`,
  number,
  customer: `c${number}`,
  name: `Cliente ${number}`,
  address: "Av. San Martín 1234",
  phone: "5492634567890",
  driver: "Juan",
  deliveryDate: "2026-09-24",
  status: "en_camino",
  weighed: true,
  total: 123456.78,
  items: Array.from({ length: count }, () => ({
    name: "Pollo entero fresco",
    kg: 23.5,
    boxes: 2,
    price: 3250,
    lineTotal: 76375,
  })),
});
async function render(element) {
  let layout;
  await pdf(
    React.cloneElement(element, {
      onRender: (data) => {
        layout = data._INTERNAL__LAYOUT__DATA_;
      },
    }),
  ).toBlob();
  return layout.children;
}
const text = (node) => node.value || (node.children || []).map(text).join(" ");
function fits(page) {
  for (const child of page.children) {
    assert.ok(
      child.box.top + child.box.height <= page.box.height + 0.1,
      "contenido dentro del papel",
    );
  }
}

test("hoja: catorce pedidos cortos en el frente y solo seis totales en el reverso A4", async () => {
  const pages = await render(
    HojaDocument({
      date: "2026-09-24",
      orders: Array.from({ length: 14 }, (_, i) => order(i + 1)),
      logo: null,
    }),
  );
  assert.equal(pages.length, 2);
  for (const page of pages) {
    assert.ok(Math.abs(page.box.height - 595.28) < 0.1);
    fits(page);
  }
  assert.ok(text(pages[0]).includes("00014"));
  const back = text(pages[1]);
  for (const label of [
    "SUMA DE BOLETA CORRECTA",
    "EFECTIVO TOTAL",
    "TRANSFERENCIA",
    "CHEQUE",
    "GASTOS",
    "PEN. SALDO DEL DÍA (CUENTA)",
  ])
    assert.ok(back.includes(label));
  for (const label of [
    "RENDICIÓN",
    "Concepto",
    "Comprobante",
    "FIRMA REPARTIDOR",
    "FIRMA CONTROL / ADMINISTRACIÓN",
  ]) {
    assert.ok(back.includes(label));
    if (label !== "RENDICIÓN") assert.ok(!text(pages[0]).includes(label));
  }
  const table = pages[0].children.find((c) =>
    c.children?.some((x) => text(x).includes("00001")),
  );
  for (const row of table.children.filter((c) => /^000\d+/.test(text(c))))
    assert.ok(row.box.height >= 30);
  assert.ok(!text(pages[0]).includes("SUMA DE BOLETA CORRECTA"));
});

test("hoja: pedidos largos continúan después del reverso sin perder ninguno", async () => {
  const orders = Array.from({ length: 31 }, (_, i) => ({
    ...order(i + 1),
    name: "Almacén de María González",
    zone: "San Martín",
  }));
  const pages = await render(
    HojaDocument({ date: "2026-09-24", orders, logo: null }),
  );
  assert.ok(pages.length > 2);
  assert.ok(text(pages[1]).includes("EFECTIVO TOTAL"));
  const all = pages.map(text).join(" ");
  for (const o of orders)
    assert.equal(all.split(String(o.number).padStart(5, "0")).length - 1, 1);
  pages.forEach(fits);
});

test("remito: mínimo A6, se alarga con los productos y el total queda antes de la firma", async () => {
  for (const count of [1, 6, 8, 14, 30]) {
    const pages = await render(
      RemitoDocument({
        orders: [{ ...order(1, count), notes: "Entregar por la mañana." }],
        logo: null,
      }),
    );
    assert.equal(pages.length, 1);
    assert.ok(Math.abs(pages[0].box.width - (105 * 72) / 25.4) < 0.1);
    const a6 = (148 * 72) / 25.4;
    if (count <= 6) assert.ok(Math.abs(pages[0].box.height - a6) < 0.1);
    else assert.ok(pages[0].box.height >= a6 - 0.1);
    fits(pages[0]);
    const children = pages[0].children[0].children;
    const sign = children.find((c) => text(c).includes("Firma Conforme"));
    const total = children.find((c) => text(c).includes("TOTAL:"));
    assert.ok(
      total.box.top + total.box.height < sign.box.top,
      "total antes de la firma",
    );
    assert.ok(
      sign.box.top + sign.box.height <= pages[0].box.height,
      "firma dentro del papel",
    );
  }
});

test("remito: deuda en rojo, saldo a favor en verde y descontado del total", async () => {
  const o = { ...order(1, 1), total: 76375, payment: "cuenta" };
  const remito = (balance) =>
    render(
      RemitoDocument({
        orders: [o],
        customers: [
          { phone: o.customer, summary: { balance: balance + 76375 } },
        ],
        logo: null,
      }),
    );
  const favor = text((await remito(-40000))[0]);
  assert.ok(favor.includes("Saldo a favor"));
  assert.ok(favor.includes("36.375,00"));
  const cubre = text((await remito(-200000))[0]).replace(/\s+/g, " ");
  assert.ok(cubre.includes("TOTAL: $ 0,00"));
  assert.ok(cubre.includes("Le queda a favor: $ 123.625,00"));
  const debe = text((await remito(50000))[0]);
  assert.ok(debe.includes("Saldo anterior (deuda)"));
  assert.ok(debe.includes("126.375,00"));
});

test("remito sin precio ni saldo muestra solo las cajas adeudadas registradas", async () => {
  const o = { ...order(1), noPricing: true, total: 0, returned: 2 };
  const customers = [
    { phone: o.customer, summary: { boxes: 9, balance: 100000 } },
  ];
  const [route, remito] = await Promise.all([
    render(
      HojaDocument({
        orders: [o],
        customers,
        date: o.deliveryDate,
        logo: null,
      }),
    ),
    render(
      RemitoDocument({
        orders: [o],
        customers,
        hidePrices: true,
        hideBalance: true,
        logo: null,
      }),
    ),
  ]);
  assert.ok(text(remito[0]).includes("CAJAS ADEUDADAS: 9 cajas"));
  assert.ok(!text(remito[0]).includes("SALIENTES"));
  const empty = await render(
    RemitoDocument({
      orders: [o],
      customers: [{ phone: o.customer, summary: { boxes: 0, balance: 0 } }],
      logo: null,
    }),
  );
  assert.ok(!text(empty[0]).includes("0 cajas"));
  const routeTable = route[0].children.find((c) => text(c).includes("00001"));
  const row = routeTable.children.find((c) => text(c).startsWith("00001"));
  // Previas (9 de saldo + 2 ya devueltas en este pedido) y salientes (3 × 2) salen de la
  // página; devueltas y saldo de cajas los completa el preventista.
  assert.deepEqual(row.children.slice(6, 10).map(text), ["11", "6", "", ""]);
  assert.ok(!text(remito[0]).includes("Saldo anterior"));
  assert.ok(!text(remito[0]).includes("100.000"));
});

test("hoja: las cajas previas nunca salen negativas", async () => {
  const o = order(1);
  const pages = await render(
    HojaDocument({
      orders: [o],
      customers: [{ phone: o.customer, summary: { boxes: -3, balance: 0 } }],
      date: o.deliveryDate,
      logo: null,
    }),
  );
  const table = pages[0].children.find((c) => text(c).includes("00001"));
  const row = table.children.find((c) => text(c).startsWith("00001"));
  assert.deepEqual(row.children.slice(6, 10).map(text), ["0", "6", "", ""]);
});

test("hoja: la fila TOTAL suma la columna importe (pedido + saldo) en un solo casillero", async () => {
  const a = { ...order(1), total: 100000 };
  const b = { ...order(2), total: 50000 };
  const c = { ...order(3), total: 20000, customer: a.customer };
  const d = { ...order(4), total: 5000 };
  const pages = await render(
    HojaDocument({
      orders: [a, b, c, d],
      customers: [
        { phone: a.customer, summary: { balance: 30000 } },
        { phone: b.customer, summary: { balance: -10000 } },
        // Crédito mayor que el pedido: la fila imprime 0 y la suma también cuenta 0.
        { phone: d.customer, summary: { balance: -8000 } },
      ],
      date: a.deliveryDate,
      logo: null,
    }),
  );
  const table = pages[0].children.find((x) => text(x).includes("00001"));
  const filas = table.children.filter((x) => /^000\d/.test(text(x)));
  const impresos = filas.map((f) =>
    Number(text(f.children[2]).replace(/\./g, "").replace(",", ".")),
  );
  assert.deepEqual(impresos, [130000, 40000, 20000, 0]);
  const total = table.children.find((x) => text(x).startsWith("TOTAL"));
  // Rótulo, importe + saldo unidos (190.000) y corrección en blanco.
  assert.deepEqual(total.children.slice(0, 3).map(text), [
    "TOTAL",
    "190.000",
    "",
  ]);
});

test("hoja: la hoja de continuación con pocos pedidos no estira los casilleros", async () => {
  const orders = Array.from({ length: 16 }, (_, i) => order(i + 1));
  const pages = await render(
    HojaDocument({ date: "2026-09-24", orders, logo: null }),
  );
  const ultima = pages.at(-1);
  const table = ultima.children.find((c) => text(c).includes("TOTAL GENERAL"));
  for (const row of table.children.filter((c) => /^000\d+/.test(text(c))))
    assert.ok(row.box.height <= 40, `fila de ${row.box.height}`);
});
