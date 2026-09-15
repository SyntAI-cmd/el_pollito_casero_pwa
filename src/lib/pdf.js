import { createElement } from "react";
import { remitoFileName } from "./remito.js";

/**
 * Generación y entrega de remitos en PDF. `@react-pdf/renderer` pesa más de 1 MB, así que se
 * carga recién cuando alguien pide un PDF (import dinámico) y no en el arranque de la app.
 */

let cache = null;
async function engine() {
  if (!cache) {
    cache = Promise.all([
      import("@react-pdf/renderer"),
      import("../pdf/RemitoPdf.jsx"),
    ]).then(([pdf, remito]) => ({
      pdf: pdf.pdf,
      RemitoDocument: remito.RemitoDocument,
    }));
  }
  return cache;
}

/** Blob del PDF con un remito por hoja (original + duplicado) para los pedidos dados. */
export async function remitoPdfBlob({ orders, customers, fiscal }) {
  if (!orders?.length) throw Error("No hay pedidos para el remito.");
  const { pdf, RemitoDocument } = await engine();
  return pdf(
    createElement(RemitoDocument, { orders, customers, fiscal }),
  ).toBlob();
}

/** Descarga el blob como archivo (o lo abre en una pestaña si el navegador no permite descargar). */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Abre el PDF en una pestaña nueva para imprimirlo desde el visor del navegador. */
export function openBlob(blob) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener");
  if (!w) downloadBlob(blob, "remitos.pdf");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/**
 * Comparte el PDF con la hoja nativa del sistema (WhatsApp, correo…) si el dispositivo lo
 * permite; si no, lo descarga. Devuelve "shared", "downloaded" o "cancelled".
 */
export async function sharePdf(blob, name, { title, text } = {}) {
  const file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
    }
  }
  downloadBlob(blob, name);
  return "downloaded";
}

/** Atajos por acción: generar y descargar / abrir / compartir los remitos de `orders`. */
export async function remitoAction(
  action,
  { orders, customers, fiscal, date, driver },
) {
  const blob = await remitoPdfBlob({ orders, customers, fiscal });
  const name = remitoFileName(orders, { date, driver });
  if (action === "open") return (openBlob(blob), "opened");
  if (action === "share")
    return sharePdf(blob, name, {
      title: name.replace(/\.pdf$/, "").replace(/_/g, " "),
      text:
        orders.length === 1
          ? `Remito de ${orders[0].name} · El Pollito Casero`
          : `Remitos del día · El Pollito Casero`,
    });
  downloadBlob(blob, name);
  return "downloaded";
}
