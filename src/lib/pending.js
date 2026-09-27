/**
 * Pesadas pendientes superpuestas al estado confirmado (PC-018).
 *
 * Lo que está en la cola del teléfono se muestra encima de lo que devolvió el servidor, hasta que
 * el servidor lo tiene (mismo id de cajón). Así un refresco de la nota —por un pedido cargado en
 * la PC o por otra pesada— nunca hace desaparecer una pesada todavía no confirmada, y el operador
 * no la vuelve a cargar.
 */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Filas que el servidor va a crear para una pesada (mismo cálculo que server/floor.mjs):
 * tara_total = cajas × tara; neto = bruto − tara_total; una fila por caja con el neto repartido
 * (la última absorbe el redondeo). Con 0 cajas (bolsa), una fila sin tara que vale 0 envases.
 */
export function pendingRows(body, tare = 1.7, at = "") {
  const t = body.tare === undefined || body.tare === null ? tare : Number(body.tare);
  const wrote = body.boxes !== undefined && body.boxes !== null && body.boxes !== "";
  const boxes = wrote ? Math.round(Number(body.boxes)) : 1;
  const taraTotal = round2(t * boxes);
  const netTotal =
    body.net !== undefined && body.net !== null && body.net !== ""
      ? Number(body.net)
      : round2(Number(body.gross) - taraTotal);
  if (!Number.isFinite(netTotal) || netTotal <= 0) return [];
  const filas = Math.max(1, boxes);
  const each = round2(netTotal / filas);
  const taraFila = boxes === 0 ? 0 : t;
  return Array.from({ length: filas }, (_, i) => {
    const net = i === filas - 1 ? round2(netTotal - each * (filas - 1)) : each;
    return {
      id: filas === 1 ? body.id : `${body.id}:${i + 1}`,
      productId: body.productId,
      gross: round2(net + taraFila),
      tare: taraFila,
      net,
      boxes: boxes === 0 ? 0 : 1,
      at,
    };
  });
}

const crateAdd = /^\/orders\/([^/]+)\/crates$/;
const crateVoid = /^\/crates\/([^/]+)$/;

/**
 * Pedidos del día con lo pendiente encima. `entries` son las operaciones en cola (de quien usa
 * la app); `sending` los ids en vuelo. Cada cajón pendiente lleva `pending: true` y, si se está
 * enviando, `sending: true`. Una anulación pendiente oculta el cajón hasta confirmarse.
 */
export function overlayPending(orders, entries, { tare = 1.7, sending = [] } = {}) {
  if (!entries?.length) return orders;
  const adds = new Map();
  const voids = new Set();
  for (const e of entries) {
    if (!e?.path) continue;
    const add = e.method === "POST" && e.path.match(crateAdd);
    if (add && e.body?.id) {
      const id = decodeURIComponent(add[1]);
      if (!adds.has(id)) adds.set(id, []);
      adds.get(id).push(e);
      continue;
    }
    const del = e.method === "DELETE" && e.path.match(crateVoid);
    if (del) voids.add(decodeURIComponent(del[1]));
  }
  if (!adds.size && !voids.size) return orders;
  const inFlight = new Set(sending);
  return orders.map((o) => {
    const add = adds.get(o.id);
    const current = o.crates || [];
    const voiding = voids.size && current.some((c) => voids.has(c.id) && !c.voided);
    if (!add && !voiding) return o;
    let crates = voiding
      ? current.map((c) =>
          voids.has(c.id) && !c.voided ? { ...c, voided: true, pending: true } : c,
        )
      : current;
    const known = new Set(current.map((c) => c.id));
    for (const e of add || []) {
      const rows = pendingRows(e.body, tare, e.at);
      // El servidor ya la tiene (confirmada o aplicada antes de que llegue la respuesta).
      if (!rows.length || rows.some((r) => known.has(r.id))) continue;
      const flags = { pending: true, ...(inFlight.has(e._outboxId) ? { sending: true } : {}) };
      crates = [...crates, ...rows.map((r) => ({ ...r, ...flags }))];
    }
    return crates === current ? o : { ...o, crates };
  });
}

/** Pesadas rechazadas de un pedido (requieren revisión), con su detalle legible. */
export function rejectedFor(orderId, review) {
  return (review || [])
    .filter((e) => {
      const m = e.method === "POST" && e.path?.match(crateAdd);
      return m && decodeURIComponent(m[1]) === orderId;
    })
    .map((e) => ({
      id: e._outboxId,
      productId: e.body?.productId,
      boxes: e.body?.boxes,
      gross: e.body?.gross,
      motivo: e.rechazo,
      at: e.rechazadoEn,
    }));
}
