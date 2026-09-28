/**
 * Cómo salen los documentos de un cliente o pedido (remito y hoja de ruta):
 *  - "completo":  precios, total y saldo de cuenta corriente.
 *  - "sinSaldo":  precios y total del pedido, sin deuda ni saldo a favor.
 *  - "exclusivo": sin precio ni saldo (familiares, facturación propia): solo kilos y detalle.
 * Se guarda como dos marcas: `noPricing` y `noBalance`.
 */
export const DOC_MODES = {
  completo: "Con precio y saldo",
  sinSaldo: "Con precio, sin saldo",
  exclusivo: "Sin precio ni saldo (cliente exclusivo)",
};

export const docModeOf = (x) =>
  x?.noPricing ? "exclusivo" : x?.noBalance ? "sinSaldo" : "completo";

export const docModeFlags = (mode) => ({
  noPricing: mode === "exclusivo",
  noBalance: mode === "sinSaldo",
});

/** Etiqueta corta para listas ("" cuando es el modo normal). */
export const docModeTag = (x) =>
  x?.noPricing
    ? "sin precio ni saldo"
    : x?.noBalance
      ? "con precio, sin saldo"
      : "";
