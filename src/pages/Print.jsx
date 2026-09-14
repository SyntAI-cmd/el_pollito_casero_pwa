import React, { useEffect } from "react";
import { Printer, ArrowLeft, ShieldCheck } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute, Link } from "../lib/router.jsx";
import { ordersSheet, routeSheet, today } from "../lib/report.js";
import { EmptyState, PageHead } from "../components/ui.jsx";
import RouteSheet from "../components/RouteSheet.jsx";
import OrdersSheet from "../components/OrdersSheet.jsx";
import Remito from "../components/Remito.jsx";

/**
 * Vista de impresión: /imprimir?tipo=pedidos|ruta|remito|remitos&fecha=YYYY-MM-DD&repartidor=Nombre&pedido=PC-…
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
  const sheet =
    tipo === "ruta"
      ? routeSheet(orders, customers, { driver: repartidor, date: fecha })
      : ordersSheet(orders, fecha);
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
  if (remitoOrders)
    return (
      <div className="print-page remitos">
        <style>{"@page { size: 100mm 150mm; margin: 0; }"}</style>
        <div className="print-toolbar no-print">
          <Link to="/operacion/dia" className="secondary">
            <ArrowLeft size={15} /> Volver a la nota del día
          </Link>
          <span className="muted">
            {remitoOrders.length} remito{remitoOrders.length === 1 ? "" : "s"} ·
            papel 10 × 15 cm
          </span>
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
      <div className="print-toolbar no-print">
        <Link to="/operacion" className="secondary">
          <ArrowLeft size={15} /> Volver a Operación
        </Link>
        <button className="primary" onClick={() => window.print()}>
          <Printer size={16} /> Imprimir
        </button>
      </div>
      {tipo === "ruta" ? (
        <RouteSheet sheet={sheet} />
      ) : (
        <OrdersSheet sheet={sheet} />
      )}
    </div>
  );
}
