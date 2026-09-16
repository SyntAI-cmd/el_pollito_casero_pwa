import React, { useEffect } from "react";
import { Printer, ArrowLeft, ShieldCheck } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute, Link } from "../lib/router.jsx";
import { ordersSheet, today } from "../lib/report.js";
import { EmptyState, PageHead } from "../components/ui.jsx";
import OrdersSheet from "../components/OrdersSheet.jsx";
import Remito from "../components/Remito.jsx";
import RemitoActions from "../components/RemitoActions.jsx";
import Tickets from "../components/Tickets.jsx";

/**
 * Vista de impresión (solo administración):
 * /imprimir?tipo=pedidos|tickets|remito|remitos&fecha=YYYY-MM-DD&repartidor=Nombre&pedido=…
 * "pedidos" es la hoja de pedidos (A4 apaisada); "tickets" la comandera 80 mm;
 * "remito" imprime uno (10×15 cm); "remitos" todos los del camión y fecha, uno por hoja.
 */
export default function Print() {
  const { query } = useRoute();
  const { session, orders, customers, config, loaded } = useStore();
  const tipo = query.get("tipo") || "pedidos";
  const fecha = query.get("fecha") || today();
  const repartidor = query.get("repartidor") || config?.drivers?.[0] || "";
  const auto = query.get("auto") === "1";
  useEffect(() => {
    document.body.classList.add("printing");
    return () => document.body.classList.remove("printing");
  }, []);
  useEffect(() => {
    if (auto && loaded && session?.role === "admin") {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [auto, loaded, session]);
  if (session?.role !== "admin")
    return (
      <>
        <PageHead
          title="Impresión."
          description="Solo administración imprime hojas de pedidos y de ruta."
        />
        <EmptyState
          icon={ShieldCheck}
          title="Ingresá con tu usuario del equipo"
          to="/admin"
          action="Ir al acceso"
        />
      </>
    );
  const sheet = ordersSheet(orders, fecha);
  const remitoOrders =
    tipo === "remito"
      ? orders.filter((o) => o.id === query.get("pedido"))
      : tipo === "remitos"
        ? orders
            .filter(
              (o) =>
                o.deliveryDate === fecha &&
                o.driver === repartidor &&
                o.status !== "cancelado",
            )
            .sort(
              (a, b) =>
                (a.locality?.name || "").localeCompare(
                  b.locality?.name || "",
                ) || a.name.localeCompare(b.name),
            )
        : null;
  if (tipo === "tickets") {
    const pedido = query.get("pedido");
    const list = pedido
      ? orders.filter((o) => o.id === pedido)
      : orders
          .filter((o) => o.deliveryDate === fecha && o.status !== "cancelado")
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
          <Link to="/operacion/imprimir" className="secondary">
            <ArrowLeft size={15} /> Volver a Imprimir
          </Link>
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
  if (remitoOrders)
    return (
      <div className="print-page remitos">
        <style>{"@page { size: 100mm 150mm; margin: 0; }"}</style>
        <div className="print-toolbar no-print">
          <Link to="/operacion/imprimir" className="secondary">
            <ArrowLeft size={15} /> Volver a Imprimir
          </Link>
          <span className="muted">
            {remitoOrders.length} remito{remitoOrders.length === 1 ? "" : "s"} ·
            papel 10 × 15 cm
          </span>
          <RemitoActions
            orders={remitoOrders}
            date={fecha}
            driver={tipo === "remitos" ? repartidor : ""}
            actions={["download", "share"]}
            labels={{ download: "PDF A4 (original + duplicado)" }}
          />
          <button className="primary" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir
          </button>
        </div>
        {remitoOrders.length === 0 ? (
          <p className="muted">No hay pedidos para imprimir.</p>
        ) : (
          remitoOrders.map((o) => (
            <Remito
              key={o.id}
              order={o}
              customer={customers.find((c) => c.phone === o.customer)}
              fiscal={config?.fiscal}
            />
          ))
        )}
      </div>
    );
  return (
    <div className="print-page">
      <style>{"@page { size: A4 landscape; margin: 9mm; }"}</style>
      <div className="print-toolbar no-print">
        <Link to="/operacion/imprimir" className="secondary">
          <ArrowLeft size={15} /> Volver a Imprimir
        </Link>
        <button className="primary" onClick={() => window.print()}>
          <Printer size={16} /> Imprimir
        </button>
      </div>
      <OrdersSheet sheet={sheet} />
    </div>
  );
}
