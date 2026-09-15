import React, { useEffect, useState } from "react";
import { Camera, Image as ImageIcon, Trash2, Loader2 } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { del, patch } from "../lib/api.js";
import { money, timeText, dateText, orderNumber } from "../lib/format.js";
import {
  uploadReceipt,
  receiptsOf,
  receiptImage,
  receiptKinds,
} from "../lib/photo.js";

/** Botón "sacar foto / elegir imagen" que sube un comprobante y avisa al terminar. */
export function ReceiptButton({
  order,
  kind = "firma",
  amount,
  label,
  className = "secondary",
  onDone,
}) {
  const { notify } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <label className={className + " receipt-button" + (busy ? " busy" : "")}>
      {busy ? <Loader2 size={15} className="spin" /> : <Camera size={15} />}{" "}
      {busy ? "Subiendo…" : label || "Sacar foto"}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const r = await uploadReceipt(order.id, file, { kind, amount });
            notify("Comprobante guardado.");
            onDone?.(r);
          } catch (err) {
            notify(err.message);
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

/** Galería de comprobantes de un pedido (fotos de transferencias, cheques y remitos firmados). */
export function ReceiptList({ order, receipts, onChange, compact = false }) {
  const { session, notify } = useStore();
  if (!receipts?.length)
    return (
      <p className="muted small">
        {compact ? "Sin comprobantes." : "Este pedido no tiene comprobantes."}
      </p>
    );
  return (
    <ul className={"receipt-list " + (compact ? "compact" : "")}>
      {receipts.map((r) => (
        <li key={r.id}>
          <a
            href={receiptImage(r.id)}
            target="_blank"
            rel="noopener noreferrer"
            title="Ver en grande"
          >
            <img
              src={receiptImage(r.id)}
              alt={receiptKinds[r.kind] || r.kind}
              loading="lazy"
            />
          </a>
          <div>
            <strong>{receiptKinds[r.kind] || r.kind}</strong>
            {r.amount ? <span> · {money(r.amount)}</span> : null}
            <small>
              {r.by} · {dateText(r.at)} {timeText(r.at)}
              {r.note ? ` · ${r.note}` : ""}
            </small>
          </div>
          {session?.role === "admin" && (
            <button
              type="button"
              className="link-button"
              title="Editar importe y nota"
              onClick={() => {
                const amount = window.prompt(
                  "Importe del comprobante (vacío = sin importe):",
                  r.amount ?? "",
                );
                if (amount === null) return;
                const note = window.prompt("Nota (opcional):", r.note || "");
                if (note === null) return;
                patch("/comprobantes/" + r.id, {
                  amount:
                    amount === ""
                      ? null
                      : Number(String(amount).replace(",", ".")),
                  note,
                })
                  .then(() => onChange?.())
                  .catch((e) => notify(e.message));
              }}
            >
              editar
            </button>
          )}
          {session?.role === "admin" && (
            <button
              type="button"
              className="link-button danger"
              title="Anular el comprobante"
              onClick={() => {
                const reason = window.prompt(
                  "¿Anular este comprobante? Motivo (opcional):",
                );
                if (reason === null) return;
                del("/comprobantes/" + r.id)
                  .then(() => onChange?.())
                  .catch((e) => notify(e.message));
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Modal "Comprobantes" de un pedido: galería + sacar otra foto. */
export default function Receipts({ order }) {
  const [list, setList] = useState(null);
  const load = () =>
    receiptsOf(order.id)
      .then(setList)
      .catch(() => setList([]));
  useEffect(() => {
    load();
  }, [order.id]);
  return (
    <>
      <h2>
        <ImageIcon size={18} /> Comprobantes
      </h2>
      <p>
        N° {orderNumber(order)} · {order.name} · {money(order.total)}
      </p>
      {list === null ? (
        <p className="muted">Cargando…</p>
      ) : (
        <ReceiptList order={order} receipts={list} onChange={load} />
      )}
      {order.status !== "cancelado" && (
        <div className="actions-row">
          <ReceiptButton
            order={order}
            kind="firma"
            label="Remito firmado"
            onDone={load}
          />
          <ReceiptButton
            order={order}
            kind="transferencia"
            label="Transferencia"
            onDone={load}
          />
          <ReceiptButton
            order={order}
            kind="cheque"
            label="Cheque"
            onDone={load}
          />
        </div>
      )}
    </>
  );
}
