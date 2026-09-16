import React, { useState } from "react";
import { FileText, Share2, Printer, Loader2 } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { hojaAction } from "../lib/pdf.js";

const canShareFiles = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.canShare === "function" &&
  navigator.canShare({
    files: [new File(["x"], "x.pdf", { type: "application/pdf" })],
  });

/**
 * Botones de la hoja de ruta · rendición del repartidor (PDF por camioneta/preventistas):
 * descargar, compartir (WhatsApp) e imprimir.
 */
export default function HojaActions({
  orders,
  date,
  drivers = [],
  vehicle = "",
  actions = ["open", "download", "share"],
  small = false,
  label = "Hoja de ruta (PDF)",
}) {
  const { customers, notify } = useStore();
  const [busy, setBusy] = useState("");
  const list = (orders || []).filter((o) => o.status !== "cancelado");
  if (!list.length) return null;
  // Validación: la hoja sale con preventista y vehículo asignados.
  const missing = !drivers?.filter(Boolean).length
    ? "Asigná un preventista."
    : !vehicle
      ? "Elegí el vehículo."
      : "";
  const run = async (action) => {
    setBusy(action);
    try {
      await hojaAction(action, {
        date,
        drivers,
        vehicle,
        orders: list,
        customers,
      });
    } catch (e) {
      notify(e?.message || "No se pudo generar la hoja.");
    } finally {
      setBusy("");
    }
  };
  const cls = small ? "link-button small" : "secondary";
  const size = small ? 13 : 15;
  return (
    <>
      {actions.includes("open") && (
        <button
          type="button"
          className={cls}
          disabled={!!busy || !!missing}
          onClick={() => run("open")}
          title={missing || "Abrir para imprimir"}
        >
          {busy === "open" ? (
            <Loader2 size={size} className="spin" />
          ) : (
            <Printer size={size} />
          )}{" "}
          {label}
        </button>
      )}
      {actions.includes("download") && (
        <button
          type="button"
          className={cls}
          disabled={!!busy || !!missing}
          onClick={() => run("download")}
          title={missing || "Descargar el PDF"}
        >
          {busy === "download" ? (
            <Loader2 size={size} className="spin" />
          ) : (
            <FileText size={size} />
          )}{" "}
          PDF
        </button>
      )}
      {actions.includes("share") && canShareFiles() && (
        <button
          type="button"
          className={cls}
          disabled={!!busy || !!missing}
          onClick={() => run("share")}
          title={missing || "Enviar por WhatsApp"}
        >
          {busy === "share" ? (
            <Loader2 size={size} className="spin" />
          ) : (
            <Share2 size={size} />
          )}{" "}
          Compartir
        </button>
      )}
    </>
  );
}
