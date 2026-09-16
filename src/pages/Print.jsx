import React, { useEffect, useState } from "react";
import { Printer, ArrowLeft, ShieldCheck } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute, Link } from "../lib/router.jsx";
import { ordersSheet, routeSheet, today } from "../lib/report.js";
import { EmptyState, PageHead } from "../components/ui.jsx";
import RouteSheet from "../components/RouteSheet.jsx";
import OrdersSheet from "../components/OrdersSheet.jsx";
import Remito from "../components/Remito.jsx";
import RemitoActions from "../components/RemitoActions.jsx";
import TripSheet from "../components/TripSheet.jsx";
import SettlementSheet from "../components/SettlementSheet.jsx";
import Tickets from "../components/Tickets.jsx";
import { api } from "../lib/api.js";

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
  const vehiculo = query.get("vehiculo") || "";
  const [trips, setTrips] = useState([]);
  const [closures, setClosures] = useState([]);
  useEffect(() => {
    if (tipo !== "rendicion") return;
    api("/closures?date=" + fecha)
      .then(setClosures)
      .catch(() => setClosures([]));
  }, [tipo, fecha]);
  useEffect(() => {
    if (tipo !== "viaje") return;
    api("/salidas?fecha=" + fecha)
      .then(setTrips)
      .catch(() => setTrips([]));
  }, [tipo, fecha]);
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
  if (session?.role !== "admin" && session?.role !== "repartidor")
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
          <Link
            to={
              session.role === "admin"
                ? "/operacion/imprimir"
                : "/reparto/imprimir"
            }
            className="secondary"
          >
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
  if (tipo === "rendicion") {
    if (session.role !== "admin")
      return (
        <EmptyState
          icon={ShieldCheck}
          title="Solo administración"
          to="/reparto"
          action="Volver"
        />
      );
    const drivers =
      repartidor && repartidor !== "todos"
        ? [repartidor]
        : config?.drivers || [];
    const sheets = drivers
      .map((d) => routeSheet(orders, customers, { driver: d, date: fecha }))
      .filter((s) => s.stops.length);
    return (
      <div className="print-page rendicion">
        <style>{"@page { size: A4 portrait; margin: 10mm; }"}</style>
        <div className="print-toolbar no-print">
          <Link to="/operacion/imprimir" className="secondary">
            <ArrowLeft size={15} /> Volver a Imprimir
          </Link>
          <span className="muted">
            Resumen de rendición del {fecha.split("-").reverse().join("/")} ·
            solo administración
          </span>
          <button className="primary" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir
          </button>
        </div>
        <SettlementSheet sheets={sheets} date={fecha} closures={closures} />
      </div>
    );
  }
  if (tipo === "viaje") {
    const dayOrders = orders.filter(
      (o) => o.deliveryDate === fecha && o.status !== "cancelado",
    );
    // Un viaje por salida (vehículo del día): sus pedidos son los asignados al vehículo o a sus
    // preventistas. Sin salidas armadas, un viaje por preventista.
    const tripList = trips.filter((t) => !vehiculo || t.vehicleId === vehiculo);
    const assigned = new Set();
    const sheets = tripList.map((t) => {
      const list = dayOrders.filter(
        (o) =>
          o.vehicleId === t.vehicleId ||
          (!o.vehicleId &&
            (t.drivers.includes(o.driver) || t.drivers.includes(o.driver2))),
      );
      list.forEach((o) => assigned.add(o.id));
      return {
        key: t.id,
        vehicle: t.vehicle,
        drivers: t.drivers,
        departure: t.departure,
        orders: list,
      };
    });
    if (!vehiculo) {
      const rest = dayOrders.filter((o) => !assigned.has(o.id));
      const byDriver = {};
      for (const o of rest)
        (byDriver[o.driver || "Sin asignar"] ||= []).push(o);
      for (const [d, list] of Object.entries(byDriver))
        sheets.push({
          key: "d:" + d,
          vehicle: null,
          drivers: d === "Sin asignar" ? [] : [d],
          departure: "",
          orders: list,
        });
    }
    const sortStops = (list) =>
      [...list].sort(
        (a, b) =>
          (a.zone || a.locality?.name || "").localeCompare(
            b.zone || b.locality?.name || "",
          ) || a.name.localeCompare(b.name),
      );
    return (
      <div className="print-page viajes">
        <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
        <div className="print-toolbar no-print">
          <Link
            to={
              session.role === "admin"
                ? "/operacion/imprimir"
                : "/reparto/imprimir"
            }
            className="secondary"
          >
            <ArrowLeft size={15} /> Volver
          </Link>
          <span className="muted">
            {sheets.length}{" "}
            {sheets.length === 1 ? "hoja de viaje" : "hojas de viaje"} · A4
            apaisada, una por camioneta
          </span>
          <button className="primary" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir
          </button>
        </div>
        {sheets.length === 0 ? (
          <p className="muted">No hay pedidos para esta fecha.</p>
        ) : (
          sheets.map((s) => (
            <TripSheet
              key={s.key}
              date={fecha}
              vehicle={s.vehicle}
              drivers={s.drivers}
              departure={s.departure}
              orders={sortStops(s.orders)}
              customers={customers}
            />
          ))
        )}
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
      <div className="print-toolbar no-print">
        <Link
          to={
            session.role === "admin"
              ? "/operacion/imprimir"
              : "/reparto/imprimir"
          }
          className="secondary"
        >
          <ArrowLeft size={15} /> Volver a Imprimir
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
