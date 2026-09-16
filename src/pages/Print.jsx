import React, { useEffect } from "react";
import { Printer, ArrowLeft, ShieldCheck } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute, Link } from "../lib/router.jsx";
import { today } from "../lib/report.js";
import { EmptyState, PageHead } from "../components/ui.jsx";
import PdfPreview from "../components/PdfPreview.jsx";
import Tickets from "../components/Tickets.jsx";
import { pedidosPdfBlob, pedidosFileName, remitoPdfBlob } from "../lib/pdf.js";
import { remitoFileName } from "../lib/remito.js";

/**
 * Impresión (solo administración):
 * /imprimir?tipo=pedidos|tickets|remito|remitos&fecha=YYYY-MM-DD&repartidor=Nombre&pedido=…&turno=manana|tarde
 * "pedidos" genera la hoja de pedidos en PDF (A4 apaisada, todos los pedidos de la fecha);
 * "remito" el PDF de un pedido y "remitos" los del camión y fecha (un original por pedido,
 * 4 por hoja A4 a proporción 10 × 15). Los PDF se arman en el navegador y se muestran en una
 * vista previa con Descargar / Imprimir / Compartir; no dependen de los márgenes del navegador.
 * "tickets" sigue siendo la comandera 80 mm (impresión nativa).
 */
export default function Print() {
  const { query } = useRoute();
  const { session, orders, customers, config, loaded } = useStore();
  const tipo = query.get("tipo") || "pedidos";
  const fecha = query.get("fecha") || today();
  const repartidor = query.get("repartidor") || "";
  const turno = query.get("turno") || "";
  const native = tipo === "tickets";
  useEffect(() => {
    if (!native) return;
    document.body.classList.add("printing");
    return () => document.body.classList.remove("printing");
  }, [native]);
  if (session?.role !== "admin")
    return (
      <>
        <PageHead
          title="Impresión."
          description="Solo administración imprime hojas de pedidos y remitos."
        />
        <EmptyState
          icon={ShieldCheck}
          title="Ingresá con tu usuario del equipo"
          to="/admin"
          action="Ir al acceso"
        />
      </>
    );
  const onDate = (o) =>
    (o.deliveryDate || o.created.slice(0, 10)) === fecha &&
    o.status !== "cancelado";
  const back = (
    <Link to="/operacion/imprimir" className="secondary">
      <ArrowLeft size={15} /> Volver a Imprimir
    </Link>
  );
  if (tipo === "tickets") {
    const pedido = query.get("pedido");
    const list = pedido
      ? orders.filter((o) => o.id === pedido)
      : orders
          .filter(onDate)
          .filter(
            (o) =>
              !repartidor || repartidor === "todos" || o.driver === repartidor,
          )
          .sort(
            (a, b) =>
              (a.driver || "").localeCompare(b.driver || "") ||
              (a.number || 0) - (b.number || 0),
          );
    return (
      <div className="print-page tickets-page">
        <style>{"@page { size: 80mm auto; margin: 0; }"}</style>
        <div className="print-toolbar no-print">
          {back}
          <span className="muted">
            {list.length} {list.length === 1 ? "ticket" : "tickets"} · comandera
            80 mm, blanco y negro
          </span>
          <button className="primary" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir
          </button>
        </div>
        <Tickets orders={list} customers={customers} />
      </div>
    );
  }
  if (!loaded)
    return (
      <div className="print-page">
        <p className="muted">Cargando pedidos…</p>
      </div>
    );
  if (tipo === "remito" || tipo === "remitos") {
    const list =
      tipo === "remito"
        ? orders.filter((o) => o.id === query.get("pedido"))
        : orders
            .filter(onDate)
            .filter(
              (o) =>
                !repartidor ||
                repartidor === "todos" ||
                o.driver === repartidor ||
                o.driver2 === repartidor,
            )
            .sort(
              (a, b) =>
                (a.driver || "").localeCompare(b.driver || "") ||
                (a.number || 0) - (b.number || 0),
            );
    const n = list.length;
    const hojas = Math.ceil(n / 4);
    return (
      <div className="print-page">
        {n === 0 ? (
          <>
            <div className="print-toolbar">{back}</div>
            <p className="muted">No hay pedidos para imprimir.</p>
          </>
        ) : (
          <PdfPreview
            key={list.map((o) => o.id).join(",")}
            deps={[list.map((o) => o.id + ":" + o.total).join(",")]}
            generate={() =>
              remitoPdfBlob({
                orders: list,
                customers,
                fiscal: config?.fiscal || {},
              })
            }
            fileName={remitoFileName(list, {
              date: fecha,
              driver: tipo === "remitos" ? repartidor : "",
            })}
            shareText={
              n === 1
                ? `Remito de ${list[0].name} · El Pollito Casero`
                : "Remitos del día · El Pollito Casero"
            }
            summary={`${n} remito${n === 1 ? "" : "s"} · ${hojas} hoja${hojas === 1 ? "" : "s"} A4, 4 por hoja (10 × 15 cm), solo original`}
          >
            {back}
          </PdfPreview>
        )}
      </div>
    );
  }
  const list = orders
    .filter(onDate)
    .filter((o) => !turno || o.shift === turno)
    .filter(
      (o) =>
        !repartidor ||
        repartidor === "todos" ||
        o.driver === repartidor ||
        o.driver2 === repartidor,
    );
  return (
    <div className="print-page">
      <PdfPreview
        deps={[fecha, turno, repartidor, list.map((o) => o.id).join(",")]}
        generate={() =>
          pedidosPdfBlob({ date: fecha, orders: list, shift: turno })
        }
        fileName={pedidosFileName({ date: fecha, shift: turno })}
        shareText="Hoja de pedidos · El Pollito Casero"
        summary={`${list.length} ${list.length === 1 ? "pedido" : "pedidos"} · A4 apaisada`}
      >
        {back}
      </PdfPreview>
    </div>
  );
}
