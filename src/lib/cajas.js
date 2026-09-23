/**
 * Cajas (envases) del lado de la pantalla. Nada de esto es dinero.
 *
 *   saldo de cajas = adeudadas anteriores + salientes − devueltas
 *
 * El saldo y sus partes los calcula el servidor sobre TODOS los pedidos del cliente
 * (un preventista solo ve los suyos, así que sumarlos acá daría un número distinto):
 * llegan en `customer.summary`. Acá solo se leen y se arma el detalle por pedido.
 */
export function boxSummary(customer) {
  const s = customer?.summary || {};
  return {
    out: s.boxesOut || 0,
    back: s.boxesBack || 0,
    adjust: s.boxesAdjust || 0,
    balance: s.boxes || 0,
  };
}

/**
 * Las cuatro cifras de UN pedido. `balance` es el saldo de cajas del cliente hoy;
 * las "anteriores" se deducen de ese saldo para que la cuenta siempre cierre.
 */
export function orderBoxes(order, balance = 0) {
  const salientes = order?.boxes || 0;
  const devueltas = order?.returned || 0;
  const previas = Number.isFinite(order?.boxBalanceBefore)
    ? order.boxBalanceBefore
    : null;
  return {
    previas,
    salientes,
    devueltas,
    saldo: previas === null ? null : previas + salientes - devueltas,
    actual: balance,
  };
}
