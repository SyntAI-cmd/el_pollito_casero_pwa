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

test("remito: tipografía ampliada conserva A6 y el total queda antes de la firma", async () => {
  for (const count of [1, 6, 8, 14]) {
    const pages = await render(
      RemitoDocument({
        orders: [{ ...order(1, count), notes: "Entregar por la mañana." }],
        logo: null,
      }),
    );
    assert.equal(pages.length, 1);
    assert.ok(Math.abs(pages[0].box.width - (105 * 72) / 25.4) < 0.1);
    assert.ok(Math.abs(pages[0].box.height - (148 * 72) / 25.4) < 0.1);
    const children = pages[0].children[0].children;
    const sign = children.find((c) => text(c).includes("Firma Conforme"));
    for (const child of children.filter(
      (c) => c.style?.position !== "absolute",
    ))
      assert.ok(
        child.box.top + child.box.height < sign.box.top,
        "sin superposición con firma",
      );
  }
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
  assert.deepEqual(row.children.slice(5, 9).map(text), ["11", "6", "2", "15"]);
  assert.ok(!text(remito[0]).includes("Saldo anterior"));
  assert.ok(!text(remito[0]).includes("100.000"));
});
