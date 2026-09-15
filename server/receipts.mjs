import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fail } from "./errors.mjs";
import { str, num, oneOf } from "./validate.mjs";

/**
 * Comprobantes: fotos que el preventista saca en la entrega (transferencia, cheque, remito
 * firmado, efectivo) para que administración concilie saldos. Las imágenes van al volumen de datos
 * (`DATA_DIR/receipts/`, fuera de la base) y la fila queda en `receipts`.
 *
 * Es un cuarto enrutador: `createApi` lo consulta después de piso y flota.
 */
const now = () => new Date().toISOString();
export const RECEIPT_KINDS = [
  "transferencia",
  "cheque",
  "firma",
  "efectivo",
  "otro",
];
export const MAX_IMAGE_BYTES = 2_500_000; // JPEG ya reducido en el celular (≤ 1600 px)

export function createReceipts({ store, events, isStaff, actorOf, dataDir }) {
  const dir = `${dataDir}/receipts`;
  const staffOnly = (session) => {
    if (!isStaff(session)) fail(403, "Solo el equipo.");
  };
  const canTouch = (session, o) =>
    session.role === "admin" ||
    (session.role === "repartidor" &&
      (!o.driver || o.driver === session.driver));

  return async function handle({ method, path, body, query, session }) {
    const json = (status, b, extra = {}) => ({ status, body: b, ...extra });

    const forOrder = path.match(/^\/api\/orders\/([^/]+)\/comprobantes?$/);
    if (forOrder && method === "POST") {
      staffOnly(session);
      const o = store.orders.get(decodeURIComponent(forOrder[1]));
      if (!o) fail(404, "Pedido no encontrado.");
      if (!canTouch(session, o)) fail(403, "Ese pedido es de otro camión.");
      const kind = oneOf(
        body.kind || "firma",
        RECEIPT_KINDS,
        "tipo de comprobante",
      );
      const m =
        /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
          String(body.image || ""),
        );
      if (!m) fail(400, "Falta la foto del comprobante (JPEG, PNG o WebP).");
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length < 200) fail(400, "La foto está vacía.");
      if (bytes.length > MAX_IMAGE_BYTES)
        fail(413, "La foto es muy grande: sacala de nuevo o achicala.");
      const ext = m[1] === "jpg" ? "jpeg" : m[1];
      const id = "CB-" + randomUUID().slice(0, 8).toUpperCase();
      const file = `${o.id}-${id}.${ext}`;
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/${file}`, bytes);
      const receipt = store.receipts.add({
        id,
        orderId: o.id,
        customer: o.customer,
        kind,
        amount:
          num(body.amount, {
            min: 0,
            max: 100000000,
            name: "el importe",
            optional: true,
          }) ?? null,
        note: str(body.note, { max: 200, name: "la nota", optional: true }),
        file,
        mime: `image/${ext}`,
        bytes: bytes.length,
        by: actorOf(session),
        at: now(),
      });
      store.audit.log(session, "receipt.add", "order", o.id, {
        id,
        kind,
        bytes: bytes.length,
      });
      events.orderChanged(o);
      return json(201, receipt);
    }
    if (forOrder && method === "GET") {
      staffOnly(session);
      const o = store.orders.get(decodeURIComponent(forOrder[1]));
      if (!o) fail(404, "Pedido no encontrado.");
      if (!canTouch(session, o)) fail(403, "Ese pedido es de otro camión.");
      return json(200, store.receipts.forOrder(o.id));
    }
    // Conciliación (administración): comprobantes de una fecha, opcionalmente de un preventista.
    if (path === "/api/comprobantes" && method === "GET") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      const date = query.get("fecha");
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        fail(400, "Indicá la fecha (AAAA-MM-DD).");
      const driver = query.get("repartidor") || "";
      const list = store.receipts.forDate(date).map((r) => {
        const o = store.orders.get(r.orderId);
        return {
          ...r,
          order: o
            ? {
                id: o.id,
                name: o.name,
                driver: o.driver,
                total: o.total,
                paid: !!o.paid,
                paidMethod: o.paidMethod || null,
                status: o.status,
              }
            : null,
        };
      });
      return json(
        200,
        driver ? list.filter((r) => r.order?.driver === driver) : list,
      );
    }
    const image = path.match(/^\/api\/comprobantes\/([^/]+)\/imagen$/);
    if (image && method === "GET") {
      staffOnly(session);
      const r = store.receipts.get(decodeURIComponent(image[1]));
      if (!r) fail(404, "Comprobante no encontrado.");
      const o = store.orders.get(r.orderId);
      if (o && !canTouch(session, o))
        fail(403, "Ese pedido es de otro camión.");
      let raw;
      try {
        raw = await readFile(`${dir}/${r.file}`);
      } catch {
        fail(404, "La imagen ya no está en el servidor.");
      }
      return {
        status: 200,
        raw,
        headers: {
          "Content-Type": r.mime,
          "Cache-Control": "private, max-age=3600",
        },
      };
    }
    const one = path.match(/^\/api\/comprobantes\/([^/]+)$/);
    if (one && method === "PATCH") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      const r = store.receipts.get(decodeURIComponent(one[1]));
      if (!r) fail(404, "Comprobante no encontrado.");
      const next = store.receipts.update(r.id, {
        kind:
          body.kind === undefined
            ? undefined
            : oneOf(body.kind, RECEIPT_KINDS, "tipo"),
        amount:
          body.amount === undefined
            ? undefined
            : body.amount === null || body.amount === ""
              ? null
              : num(body.amount, {
                  min: 0,
                  max: 100000000,
                  name: "el importe",
                }),
        note:
          body.note === undefined
            ? undefined
            : str(body.note, { max: 200, name: "la nota", optional: true }),
      });
      store.audit.log(session, "receipt.update", "order", r.orderId, {
        id: r.id,
        ...body,
      });
      return json(200, next);
    }
    if (one && method === "DELETE") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      const r = store.receipts.get(decodeURIComponent(one[1]));
      if (!r) fail(404, "Comprobante no encontrado.");
      store.receipts.void(
        r.id,
        str(body.reason, { max: 200, name: "el motivo", optional: true }),
      );
      store.audit.log(session, "receipt.void", "order", r.orderId, {
        id: r.id,
        reason: body.reason,
      });
      return json(200, { ok: true });
    }
    return null;
  };
}
