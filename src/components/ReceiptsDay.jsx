import React, { useCallback, useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { api, subscribe } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { money } from "../lib/format.js";
import { ReceiptList } from "./Receipts.jsx";
import { methodNames } from "../lib/photo.js";

/**
 * Conciliación (administración): todas las fotos que el preventista subió ese día (transferencias,
 * cheques, remitos firmados), agrupadas por pedido, para cruzarlas con los cobros y saldos.
 */
export default function ReceiptsDay({ date, driver }) {
  const { notify } = useStore();
  const [list, setList] = useState([]);
  const load = useCallback(
    () =>
      api(
        `/comprobantes?fecha=${date}${driver ? "&repartidor=" + encodeURIComponent(driver) : ""}`,
      )
        .then(setList)
        .catch((e) => notify(e.message)),
    [date, driver, notify],
  );
  useEffect(() => {
    load();
    return subscribe((type) => type === "orders" && load());
  }, [load]);
  const byOrder = [];
  for (const r of list) {
    const key = r.orderId;
    let g = byOrder.find((x) => x.key === key);
    if (!g) byOrder.push((g = { key, order: r.order, receipts: [] }));
    g.receipts.push(r);
  }
  return (
    <section className="panel receipts-day">
      <div className="section-line">
        <h2>
          <ImageIcon size={17} /> Comprobantes del día
          {driver ? ` · ${driver}` : ""}
        </h2>
        <span className="muted">
          {list.length
            ? `${list.length} foto${list.length === 1 ? "" : "s"} en ${byOrder.length} pedido${byOrder.length === 1 ? "" : "s"}`
            : "Transferencias, cheques y remitos firmados que subió el preventista"}
        </span>
      </div>
      {!byOrder.length ? (
        <p className="muted">Sin comprobantes para esta fecha.</p>
      ) : (
        <div className="receipts-groups">
          {byOrder.map((g) => (
            <article key={g.key}>
              <header>
                <strong>{g.order?.name || g.key}</strong>
                <small>
                  {g.key}
                  {g.order
                    ? ` · ${money(g.order.total)} · ${
                        g.order.paid
                          ? "cobrado" +
                            (g.order.paidMethod
                              ? " (" +
                                (methodNames[g.order.paidMethod] ||
                                  g.order.paidMethod) +
                                ")"
                              : "")
                          : "sin cobrar"
                      }`
                    : ""}
                </small>
              </header>
              <ReceiptList
                order={g.order || { id: g.key }}
                receipts={g.receipts}
                onChange={load}
                compact
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
