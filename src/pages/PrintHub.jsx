import React, { useState } from "react";
import { Printer, FileText, Truck, ClipboardList, Ticket } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link } from "../lib/router.jsx";
import { PageHead } from "../components/ui.jsx";
import RemitoActions from "../components/RemitoActions.jsx";
import HojaActions from "../components/HojaActions.jsx";
import { todayKey, dmy } from "../lib/day.js";

/**
 * Imprimir: las cuatro cosas que se imprimen en el día, en un solo lugar.
 *  1. Hoja de pedidos (control general, una sola tabla).
 *  2. Hoja de ruta · rendición (PDF) de cada preventista, para llevar y rendir en papel.
 *  3. Tickets de preparación (comandera 80 mm).
 *  4. Remitos (original + duplicado).
 * El repartidor ve solo su hoja de ruta, sus tickets y sus remitos.
 */
export default function PrintHub() {
  const { orders, config, session } = useStore();
  const [date, setDate] = useState(todayKey());
  const admin = session?.role === "admin";
  const mineOnly = (o) =>
    admin || o.driver === session?.driver || o.driver2 === session?.driver;
  const day = orders.filter(
    (o) =>
      (o.deliveryDate || o.created.slice(0, 10)) === date &&
      o.status !== "cancelado" &&
      mineOnly(o),
  );
  const drivers = admin
    ? (config?.drivers || []).filter((d) =>
        day.some((o) => o.driver === d || o.driver2 === d),
      )
    : [session?.driver].filter(Boolean);
  return (
    <div className="floor print-hub">
      <PageHead
        eyebrow="IMPRIMIR"
        title={`${dmy(date)}.`}
        description={`${day.length} ${day.length === 1 ? "pedido" : "pedidos"} para esta fecha`}
      >
        <div className="head-actions">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha"
          />
        </div>
      </PageHead>
      <div className="print-hub-grid">
        {admin && (
          <section className="panel">
            <h2>
              <ClipboardList size={17} /> Hoja de pedidos
            </h2>
            <p className="muted">
              Control general del día: todos los pedidos en una tabla, con kg,
              precio, importe, observación en blanco y casillero de cargado.
            </p>
            <div className="actions-row">
              <Link
                to={`/imprimir?tipo=pedidos&fecha=${date}`}
                className="primary"
              >
                <Printer size={15} /> Imprimir
              </Link>
              <a
                className="secondary"
                href={`/api/export/consolidado?fecha=${date}`}
              >
                Excel del día
              </a>
            </div>
          </section>
        )}
        <section className="panel">
          <h2>
            <Truck size={17} /> Hoja de ruta · rendición
          </h2>
          <p className="muted">
            La que se lleva cada preventista y rinde a lapicera: N° pedido /
            remito, cliente, total, saldo de cajas, efectivo, transferencia,
            cheque y saldo.
          </p>
          <div className="actions-row">
            {drivers.map((d) => (
              <span key={d} className="hub-driver">
                <b>{d}</b>{" "}
                <HojaActions
                  orders={day.filter((o) => o.driver === d || o.driver2 === d)}
                  date={date}
                  drivers={[d]}
                  actions={["open", "share"]}
                  small
                  label="Abrir PDF"
                />
              </span>
            ))}
            {!drivers.length && (
              <span className="muted">Sin pedidos asignados.</span>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>
            <Ticket size={17} /> Tickets
          </h2>
          <p className="muted">
            Uno por pedido para la comandera (80 mm): cliente, zona, productos
            con cajas o kilos, totales y línea de cargado.
          </p>
          <div className="actions-row">
            <Link
              to={`/imprimir?tipo=tickets&fecha=${date}&repartidor=${admin ? "todos" : encodeURIComponent(session?.driver || "")}`}
              className="primary"
            >
              <Printer size={15} /> Imprimir tickets
            </Link>
            {admin &&
              drivers.map((d) => (
                <Link
                  key={d}
                  to={`/imprimir?tipo=tickets&fecha=${date}&repartidor=${encodeURIComponent(d)}`}
                  className="link-button"
                >
                  {d}
                </Link>
              ))}
          </div>
        </section>
        <section className="panel">
          <h2>
            <FileText size={17} /> Remitos
          </h2>
          <p className="muted">
            Original y duplicado de cada pedido, en un solo PDF.
          </p>
          <div className="actions-row">
            <RemitoActions
              orders={day}
              date={date}
              actions={["open", "download"]}
              labels={{ open: "Imprimir remitos", download: "PDF" }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
