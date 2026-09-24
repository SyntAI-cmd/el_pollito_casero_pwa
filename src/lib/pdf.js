import { archivePdf } from "./archive.js";
import { createElement } from "react";
import { remitoFileName } from "./remito.js";

/**
 * Generación y entrega de PDF en el navegador (hoja de pedidos, hoja de ruta y remitos).
 * `@react-pdf/renderer` pesa más de 1 MB, así que se carga recién cuando alguien pide un PDF
 * (import dinámico) y no en el arranque de la app. Todo se genera del lado del cliente: no hay
 * funciones serverless de por medio ni tiempos de espera.
 */

let cache = null;
async function engine() {
  if (!cache) {
    cache = import("@react-pdf/renderer").then((m) => m.pdf);
  }
  return cache;
}

const safe = (t) =>
  String(t || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Entrega un blob según la acción: "download" (por defecto), "open" (pestaña) o "share". */
async function deliver(action, blob, name, share) {
  if (action === "open") return (openBlob(blob, name), "opened");
  if (action === "share") return sharePdf(blob, name, share);
  downloadBlob(blob, name);
  return "downloaded";
}

/** Hoja de pedidos del día (A4 apaisada): N° pedido · cliente · producto · kg · observación. */
export async function pedidosPdfBlob({ date, orders, shift }) {
  const [pdf, { PedidosDocument }] = await Promise.all([
    engine(),
    import("../pdf/PedidosPdf.jsx"),
  ]);
  const blob = await pdf(
    createElement(PedidosDocument, { date, orders, shift }),
  ).toBlob();
  await archivePdf(blob, {
    name: pedidosFileName({ date, shift }),
    orders: orders.map((o) => o.id),
    kind: "pedidos",
  });
  return blob;
}
export const pedidosFileName = ({ date, shift }) =>
  `Hoja_pedidos_${safe(date)}${shift ? "_" + safe(shift) : ""}.pdf`;
export async function pedidosAction(action, { date, orders, shift }) {
  const blob = await pedidosPdfBlob({ date, orders, shift });
  const name = pedidosFileName({ date, shift });
  return deliver(action, blob, name, {
    title: name.replace(/\.pdf$/, "").replace(/_/g, " "),
    text: "Hoja de pedidos · El Pollito Casero",
  });
}

/** Hoja de ruta · rendición del repartidor (consolidado de la camioneta), como blob. */
export async function hojaPdfBlob({
  date,
  drivers,
  vehicle,
  orders,
  customers,
}) {
  if (!orders?.length) throw Error("No hay pedidos para la hoja.");
  const [pdf, { HojaDocument }] = await Promise.all([
    engine(),
    import("../pdf/HojaPdf.jsx"),
  ]);
  const blob = await pdf(
    createElement(HojaDocument, { date, drivers, vehicle, orders, customers }),
  ).toBlob();
  await archivePdf(blob, {
    name: `Hoja_ruta_${safe(date)}_${safe((drivers || []).join("_") || vehicle || "reparto")}.pdf`,
    orders: orders.map((o) => o.id),
    kind: "hojas-ruta",
  });
  return blob;
}
export async function hojaAction(
  action,
  { date, drivers, vehicle, orders, customers },
) {
  const blob = await hojaPdfBlob({ date, drivers, vehicle, orders, customers });
  const name = `Hoja_ruta_${safe(date)}_${safe((drivers || []).join("_") || vehicle || "reparto")}.pdf`;
  return deliver(action, blob, name, {
    title: name.replace(/\.pdf$/, "").replace(/_/g, " "),
    text: "Hoja de ruta · El Pollito Casero",
  });
}

/**
 * Blob del PDF de remitos: un solo original por pedido, uno por página A6 vertical. El respaldo queda en el sistema.
 */
export async function remitoPdfBlob({
  orders,
  customers,
  fiscal,
  hidePrices = false,
  hideBalance = false,
}) {
  if (!orders?.length) throw Error("No hay pedidos para el remito.");
  const [pdf, { RemitoDocument }] = await Promise.all([
    engine(),
    import("../pdf/RemitoPdf.jsx"),
  ]);
  const blob = await pdf(
    createElement(RemitoDocument, {
      orders,
      customers,
      fiscal,
      hidePrices,
      hideBalance,
    }),
  ).toBlob();
  await archivePdf(blob, {
    name: remitoFileName(orders, {}),
    orders: orders.map((o) => o.id),
    kind: "remitos",
  });
  return blob;
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
export function openBlob(blob, name = "documento.pdf") {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener");
  if (!w) downloadBlob(blob, name);
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
  return deliver(action, blob, name, {
    title: name.replace(/\.pdf$/, "").replace(/_/g, " "),
    text:
      orders.length === 1
        ? `Remito de ${orders[0].name} · El Pollito Casero`
        : `Remitos del día · El Pollito Casero`,
  });
}
