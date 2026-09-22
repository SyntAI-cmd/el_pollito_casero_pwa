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

export function remitoData(o, c) {
  // Cliente exclusivo (sin precio ni saldo): el remito lleva solo kilos y detalle.
  const plain = !!o.noPricing;
  const lines = o.items
    .filter((i) => i.kg > 0 || i.boxes || i.ordered)
    .map((l) => ({
      kg: l.kg > 0 ? fmtKg(l.kg) : "",
      detail: `${l.name}${l.boxes ? ` · ${l.boxes} ${l.boxes === 1 ? "caja" : "cajas"}` : !l.kg && l.ordered ? ` · pedido ${fmtKg(l.ordered)} kg` : ""}`,
      // Renglón sin pesar (kg 0): sin precio ni importe hasta la balanza.
      unit: plain || !(l.weighed || l.kg > 0) ? "" : money(l.price),
      total: plain || !(l.weighed || l.kg > 0) ? "" : money(l.lineTotal),
    }));
  if (plain)
    return {
      ...remitoHeader(o, c),
      lines,
      owedBoxes: 0,
      owedBoxesText: "",
      total: "",
      saldo: "",
      previous: "",
      balance: "",
    };
  const owedBoxes = Math.max(0, c?.summary?.boxes || 0);
  const onAccount = o.payment === "cuenta" && !o.paid ? o.total : 0;
  const previous = c
    ? Math.round(((c.summary?.balance || 0) - onAccount) * 100) / 100
    : 0;
  const after = Math.round((previous + onAccount) * 100) / 100;
  // Si el cliente DEBE, el saldo anterior entra al cuerpo del remito como un renglón virtual (sin
  // kilos ni precio unitario) y el TOTAL impreso es productos + saldo anterior: lo que debe con este
  // remito. Sin deuda (o con saldo a favor) el remito no menciona saldo.
  const owes = previous > 0;
  if (owes)
    lines.push({
      id: SALDO_ANTERIOR,
      virtual: true,
      kg: "",
      detail: "Saldo anterior",
      unit: "",
      total: money(previous),
    });
  const printedTotal =
    Math.round((o.total + (owes ? previous : 0)) * 100) / 100;
  return {
    ...remitoHeader(o, c),
    lines,
    owedBoxes,
    owedBoxesText: owedBoxes
      ? `${owedBoxes} ${owedBoxes === 1 ? "caja" : "cajas"}`
      : "",
    /** Total impreso: productos + saldo anterior. */
    total: money(printedTotal),
    productsTotal: money(o.total),
    /** Saldo anterior (solo deuda); el TOTAL ya lo incluye. El remito no lleva línea de saldo al pie. */
    saldo: owes ? money(previous) : "",
    after: after !== 0 ? money(after) : "",
    previous: previous !== 0 ? money(previous) : "",
    balance:
      previous !== 0
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
