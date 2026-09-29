/**
 * Desmarcar una entrega hecha por error: el pedido vuelve al estado que tenía antes (recibido,
 * preparando o en camino), como si nunca se hubiera entregado.
 *
 * Borra los pasos del historial agregados al entregar, la fecha y quién entregó, las cajas dejadas
 * (y su movimiento) y la marca de entrega en lote. Si la entrega en lote lo dio por cobrado
 * ("cobrados"), también quita ese cobro automático. Los saldos salen de los pedidos: vuelven solos.
 * Lo usan la API (botón "Desmarcar entregado") y scripts/deshacer-entregas.mjs.
 */

const AUTO_PAID_WINDOW_MS = 10_000;

/** Qué habría que deshacer en el pedido `id`, o { error } si no se puede. No escribe nada. */
export function planDesentrega(db, id) {
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!o) return { id, error: "no existe" };
  if (o.status !== "entregado" || !o.delivered_at)
    return { id, error: `no está entregado (${o.status})` };
  const ev = db
    .prepare("SELECT id, status, at FROM order_events WHERE order_id = ? ORDER BY id")
    .all(id);
  const keep = ev.filter((e) => e.at < o.delivered_at);
  const drop = ev.filter((e) => e.at >= o.delivered_at);
  const prev = keep.at(-1)?.status || "recibido";
  // Cobro puesto solo por la tanda: mismo actor, sin pago asociado, segundos antes de entregar.
  const inBatch = JSON.parse(o.data || "{}").deliveredInBatch;
  const unpay =
    !!inBatch &&
    !!o.paid &&
    o.paid_by === inBatch &&
    o.payment !== "cuenta" &&
    !o.payment_id &&
    !!o.paid_at &&
    Math.abs(Date.parse(o.delivered_at) - Date.parse(o.paid_at)) <=
      AUTO_PAID_WINDOW_MS;
  const unDepart = !!o.departed_at && o.departed_at >= o.delivered_at;
  return { id, o, prev, drop, unpay, unDepart };
}

/** Aplica un plan de planDesentrega. Va dentro de la transacción de quien llama. */
export function aplicarDesentrega(db, { o, prev, drop, unpay, unDepart }) {
  const delEvent = db.prepare("DELETE FROM order_events WHERE id = ?");
  for (const e of drop) delEvent.run(e.id);
  db.prepare("DELETE FROM box_movements WHERE order_id = ? AND kind = 'left'").run(o.id);
  const data = JSON.parse(o.data || "{}");
  delete data.deliveredInBatch;
  delete data.boxBalanceBefore;
  if (unpay) delete data.paidMethod;
  db.prepare(
    `UPDATE orders SET status = ?, delivered_at = NULL, delivered_by = NULL, boxes = 0,
     departed_at = ?, paid = ?, paid_at = ?, paid_by = ?, data = ?, updated = ? WHERE id = ?`,
  ).run(
    prev,
    unDepart ? null : o.departed_at,
    unpay ? 0 : o.paid,
    unpay ? null : o.paid_at,
    unpay ? null : o.paid_by,
    Object.keys(data).length ? JSON.stringify(data) : null,
    new Date().toISOString(),
    o.id,
  );
  return {
    status: prev,
    deliveredAt: o.delivered_at,
    deliveredBy: o.delivered_by,
    boxes: o.boxes,
    paid: unpay ? false : !!o.paid,
  };
}
