import React, { useState } from "react";
import { FileDown, Share2, Printer, Loader2 } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { remitoAction } from "../lib/pdf.js";

const canShareFiles = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.canShare === "function" &&
  navigator.canShare({
    files: [new File(["x"], "x.pdf", { type: "application/pdf" })],
  });

/**
 * Botones de remito en PDF (A4, original + duplicado) para uno o varios pedidos:
 * "Descargar", "Compartir" (hoja nativa: WhatsApp, correo; solo donde el dispositivo lo permite)
 * e "Imprimir" (abre el PDF en una pestaña para mandarlo a la impresora).
 * `actions` elige cuáles mostrar; `small` usa el tamaño compacto de las tablas.
 */
export default function RemitoActions({
  orders,
  date,
  driver,
  actions = ["download", "share"],
  small = false,
  labels = {},
  className = "",
}) {
  const { customers, config } = useStore();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const list = (orders || []).filter((o) => o.status !== "cancelado");
  if (!list.length) return null;
  const run = async (action) => {
    setBusy(action);
    setError("");
    try {
      await remitoAction(action, {
        orders: list,
        customers,
        fiscal: config?.fiscal || {},
        date,
        driver,
      });
    } catch (e) {
      setError(e?.message || "No se pudo generar el PDF.");
    } finally {
      setBusy("");
    }
  };
  const many = list.length > 1;
  const cls = (small ? "link-button small " : "secondary ") + className;
  const size = small ? 13 : 15;
  const Spin = () => <Loader2 size={size} className="spin" />;
  return (
    <>
      {actions.includes("download") && (
        <button
          type="button"
          className={cls}
          disabled={!!busy}
          onClick={() => run("download")}
          title="Descargar el remito en PDF (A4, original y duplicado)"
        >
          {busy === "download" ? <Spin /> : <FileDown size={size} />}{" "}
          {labels.download || (many ? "Remitos PDF" : "Remito PDF")}
        </button>
      )}
      {actions.includes("share") && canShareFiles() && (
        <button
          type="button"
          className={cls}
          disabled={!!busy}
          onClick={() => run("share")}
          title="Enviar el PDF por WhatsApp u otra app"
        >
          {busy === "share" ? <Spin /> : <Share2 size={size} />}{" "}
          {labels.share || "Compartir"}
        </button>
      )}
      {actions.includes("open") && (
        <button
          type="button"
          className={cls}
          disabled={!!busy}
          onClick={() => run("open")}
          title="Abrir el PDF para imprimirlo"
        >
          {busy === "open" ? <Spin /> : <Printer size={size} />}{" "}
          {labels.open || (many ? "Imprimir todos" : "Imprimir")}
        </button>
      )}
      {error && (
        <span className="notice error inline" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
