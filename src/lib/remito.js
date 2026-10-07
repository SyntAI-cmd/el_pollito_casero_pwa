/** Importes del remito siempre con dos decimales ($ 3.167,40), como en el talonario. */
const money = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

const fmtKg = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });

/** N° de pedido = N° de remito: correlativo de 5 dígitos (00001), igual que domain.mjs. */
export const orderNumber = (o) =>
  o.number ? String(o.number).padStart(5, "0") : o.id.replace("PC-", "");
export const remitoNumber = orderNumber;

const dmy = (o) => {
  const d = new Date(o.deliveryDate ? o.deliveryDate + "T12:00:00" : o.created);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/**
 * Datos ya formateados del remito de un pedido: cabecera, cliente, renglones, cajas adeudadas,
 * saldo (de cuenta corriente, con este remito incluido) y total. Las cajas y el saldo van en
 * blanco cuando son cero: el remito no lleva guiones ni "0".
 */
/** Id del renglón virtual "Saldo anterior" (no es un producto: no toca stock ni pesada). */
export const SALDO_ANTERIOR = "ITEM_SALDO_ANTERIOR";

export function remitoData(
  o,
  c,
  { hidePrices = false, hideBalance = false } = {},
) {
  // Cliente exclusivo (ficha o pedido): ni precios ni saldo. Las casillas de la impresión recortan
  // una cosa u otra: "sin precios" conserva el saldo; "sin saldo" conserva los precios.
  const plain = !!o.noPricing;
  const sinPrecios = plain || hidePrices;
  const lines = o.items
    .filter((i) => i.kg > 0 || i.boxes || i.units || i.ordered)
    .map((l) => ({
      kg: l.kg > 0 ? fmtKg(l.kg) : "",
      detail: `${l.name}${l.boxes ? ` · ${l.boxes} ${l.boxes === 1 ? "caja" : "cajas"}` : l.units ? ` · ${l.units} ${l.units === 1 ? "unidad" : "unidades"}` : !l.kg && l.ordered ? ` · pedido ${fmtKg(l.ordered)} kg` : ""}`,
      // Renglón sin pesar (kg 0): sin precio ni importe hasta la balanza.
      unit: sinPrecios || !(l.weighed || l.kg > 0) ? "" : money(l.price),
      total: sinPrecios || !(l.weighed || l.kg > 0) ? "" : money(l.lineTotal),
    }));
  // Envases independientes del dinero, incluso en clientes exclusivos.
  const owedBoxes = Math.max(0, c?.summary?.boxes || 0);
  const boxesData = {
    owedBoxes,
    owedBoxesText: owedBoxes
      ? `${owedBoxes} ${owedBoxes === 1 ? "caja" : "cajas"}`
      : "",
  };
  if (plain)
    return {
      ...remitoHeader(o, c),
      lines,
      ...boxesData,
      total: "",
      saldo: "",
      previous: "",
      balance: "",
    };
  const onAccount = o.payment === "cuenta" && !o.paid ? o.total : 0;
  const previous = c
    ? Math.round(((c.summary?.balance || 0) - onAccount) * 100) / 100
    : 0;
  const after = Math.round((previous + onAccount) * 100) / 100;
  // El saldo anterior entra al cuerpo del remito como un renglón virtual (sin kilos ni precio
  // unitario). Si el cliente DEBE, el TOTAL impreso es productos + deuda (renglón en rojo). Si tiene
  // saldo A FAVOR, el cliente tiene que verlo: renglón en verde y el crédito se descuenta del total
  // (nunca menos de cero; lo que sobra queda a favor y se imprime bajo el total).
  // Pedido "con precio, sin saldo": el remito nunca lleva el saldo del cliente.
  const showBalance = !hideBalance && !o.noBalance;
  const owes = previous > 0 && showBalance;
  const credit = previous < 0 && showBalance ? -previous : 0;
  // Sin precios, el total impreso es solo el saldo adeudado: la mercadería va sin importes.
  const goods = sinPrecios ? 0 : o.total;
  if (owes)
    lines.push({
      id: SALDO_ANTERIOR,
      virtual: true,
      tone: "debt",
      kg: "",
      detail: "Saldo anterior (deuda)",
      unit: "",
      total: money(previous),
    });
  if (credit)
    lines.push({
      id: SALDO_ANTERIOR,
      virtual: true,
      tone: "credit",
      kg: "",
      detail: "Saldo a favor",
      unit: "",
      total: `- ${money(credit)}`,
    });
  const printedTotal = Math.max(
    0,
    Math.round((goods + (owes ? previous : 0) - credit) * 100) / 100,
  );
  // Crédito que sobra después de este remito (solo si la mercadería lleva precio).
  const leftover = credit && !sinPrecios ? Math.max(0, credit - goods) : 0;
  return {
    ...remitoHeader(o, c),
    lines,
    ...boxesData,
    /** Total impreso: productos (si llevan precio) + deuda anterior − saldo a favor. */
    total: printedTotal || credit ? money(printedTotal) : "",
    productsTotal: money(o.total),
    /** Saldo anterior (solo deuda); el TOTAL ya lo incluye. */
    saldo: owes ? money(previous) : "",
    /** Saldo a favor que trae el cliente (positivo, sin signo). */
    credit: credit ? money(credit) : "",
    /** Lo que le sigue quedando a favor después de este remito. */
    creditLeft: leftover ? money(leftover) : "",
    after: after !== 0 ? money(after) : "",
    previous: previous !== 0 ? money(previous) : "",
    balance:
      previous !== 0 && !o.noBalance
        ? `Saldo anterior: ${money(previous)} · Saldo con este remito: ${money(after)}`
        : "",
  };
}

/** Cabecera común del remito: número, fecha, cliente, dirección, teléfono, preventista y notas. */
function remitoHeader(o, c) {
  return {
    number: remitoNumber(o),
    date: dmy(o),
    name:
      (c?.alias || o.name) +
      (c?.legalName && c.legalName !== (c.alias || o.name)
        ? ` (${c.legalName})`
        : ""),
    address: o.address || c?.address || "",
    locality: o.locality?.name || c?.zone || "",
    phone: (o.phone || c?.contactPhone || "").replace(/^549/, ""),
    driver: o.driver || "",
    notes: o.notes || "",
  };
}

/** Nombre de archivo para el PDF: un pedido → cliente y número; varios → fecha y camión. */
export function remitoFileName(orders, { date, driver } = {}) {
  const safe = (t) =>
    String(t || "")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\w-]+/g, "_")
      .replace(/^_+|_+$/g, "");
  if (orders.length === 1)
    return `Remito_${remitoNumber(orders[0])}_${safe(orders[0].name)}.pdf`;
  return `Remitos_${safe(date || orders[0]?.deliveryDate)}${driver ? "_" + safe(driver) : ""}.pdf`;
}
