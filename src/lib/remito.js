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

/** N° de remito estilo talonario: punto de venta 0001 + correlativo de 8 dígitos. */
export const remitoNumber = (o) =>
  o.number
    ? `0001-${String(o.number).padStart(8, "0")}`
    : o.id.replace("PC-", "");

const dmy = (o) => {
  const d = new Date(o.deliveryDate ? o.deliveryDate + "T12:00:00" : o.created);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/**
 * Datos ya formateados del remito de un pedido (compartidos por el PDF y la vista HTML):
 * cabecera, cliente, renglones, cajas adeudadas, saldo y total.
 */
export function remitoData(o, c) {
  const lines = o.items
    .filter((i) => i.kg > 0 || i.boxes)
    .map((l) => ({
      kg: fmtKg(l.kg),
      detail: `${l.name}${l.boxes ? ` · ${l.boxes} ${l.boxes === 1 ? "caja" : "cajas"}` : ""}`,
      unit: money(l.price),
      total: money(l.lineTotal),
    }));
  const owedBoxes = Math.max(0, c?.summary?.boxes || 0);
  const onAccount = o.payment === "cuenta" && !o.paid ? o.total : 0;
  const previous = c
    ? Math.round(((c.summary?.balance || 0) - onAccount) * 100) / 100
    : 0;
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
    lines,
    owedBoxes,
    total: money(o.total),
    balance:
      previous !== 0
        ? `Saldo anterior: ${money(previous)} · Saldo con este remito: ${money(previous + onAccount)}`
        : "",
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
