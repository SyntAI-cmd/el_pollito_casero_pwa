import React, { useState } from "react";
import {
  Printer,
  FileText,
  Truck,
  ClipboardList,
  Wallet,
  Ticket,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link } from "../lib/router.jsx";
import { PageHead } from "../components/ui.jsx";
import RemitoActions from "../components/RemitoActions.jsx";
import HojaActions from "../components/HojaActions.jsx";
import { todayKey, dmy } from "../lib/day.js";

/** Pestaña Imprimir (administración): todo lo que se imprime de un día, en un solo lugar. */
export default function PrintHub() {
  const { orders, config, session } = useStore();
  const [date, setDate] = useState(todayKey());
  const admin = session?.role === "admin";
  const day = orders.filter(
    (o) =>
      (o.deliveryDate || o.created.slice(0, 10)) === date &&
      o.status !== "cancelado",
  );
  const drivers = admin
    ? config?.drivers || []
    : [session?.driver].filter(Boolean);
  return (
    <div className="floor print-hub">
      <PageHead
        eyebrow="OPERACIÓN · IMPRIMIR"
        title={`Impresiones del ${dmy(date)}.`}
        description={`${day.length} ${day.length === 1 ? "pedido" : "pedidos"} · hojas de pedidos, de viaje, remitos y rendición`}
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
        <section className="panel">
          <h2>
            <Truck size={17} /> Hoja de ruta · rendición (PDF)
          </h2>
          <p className="muted">
            La que se lleva cada preventista y rinde en papel: N° pedido/remito,
            cliente, total, saldo de cajas, y efectivo / transferencia / cheque
            / saldo en blanco. Más de 20 clientes por hoja.
          </p>
          <div className="actions-row">
            {drivers.map((d) => {
              const list = day.filter((o) => o.driver === d || o.driver2 === d);
              return list.length ? (
                <span key={d} className="hub-driver">
                  <b>{d}</b> ({list.length}){" "}
                  <HojaActions
                    orders={list}
                    date={date}
                    drivers={[d]}
                    actions={["open", "download", "share"]}
                    small
                    label="Abrir"
                  />
                </span>
              ) : null;
            })}
            {!day.length && <span className="muted">Sin pedidos.</span>}
          </div>
        </section>
        <section className="panel">
          <h2>
            <Ticket size={17} /> Tickets de preparación
          </h2>
          <p className="muted">
            Un ticket por pedido para la comandera (80 mm, blanco y negro):
            cliente, zona, cajas por producto para marcar y casillero de
            cargado.
          </p>
          <div className="actions-row">
            <Link
              to={`/imprimir?tipo=tickets&fecha=${date}&repartidor=todos`}
              className="primary"
            >
              <Printer size={15} /> Tickets del día
            </Link>
            {drivers.map((d) =>
              day.some((o) => o.driver === d) ? (
                <Link
                  key={d}
                  to={`/imprimir?tipo=tickets&fecha=${date}&repartidor=${encodeURIComponent(d)}`}
                  className="link-button"
                >
                  {d}
                </Link>
              ) : null,
            )}
          </div>
        </section>
        <section className="panel">
          <h2>
            <ClipboardList size={17} /> Hoja de pedidos (todos)
          </h2>
          <p className="muted">
            Todos los pedidos del día con importe, casillero <b>Cargado ☐</b> y
            espacio para observaciones. Para pesar y cargar.
          </p>
          <Link to={`/imprimir?tipo=pedidos&fecha=${date}`} className="primary">
            <Printer size={15} /> Imprimir hoja de pedidos
          </Link>
        </section>
        <section className="panel">
          <h2>
            <Truck size={17} /> Hojas de viaje
          </h2>
          <p className="muted">
            Una por camioneta: nombre, saldo, pedido, precio, kilos y columnas
            en blanco para completar a mano.
          </p>
          <Link to={`/imprimir?tipo=viaje&fecha=${date}`} className="secondary">
            <Printer size={15} /> Imprimir hojas de viaje
          </Link>
        </section>
        <section className="panel">
          <h2>
            <FileText size={17} /> Remitos
          </h2>
          <p className="muted">
            Original y duplicado de cada pedido del día, en un solo PDF.
          </p>
          <div className="actions-row">
            <RemitoActions
              orders={day}
              date={date}
              actions={["open", "download"]}
              labels={{ open: "Imprimir todos los remitos", download: "PDF" }}
            />
          </div>
        </section>
        {admin && (
          <section className="panel">
            <h2>
              <Wallet size={17} /> Rendición
            </h2>
            <p className="muted">
              Resumen compacto de cobros por preventista (solo administración) y
              la hoja de ruta completa.
            </p>
            <div className="actions-row">
              <Link
                to={`/imprimir?tipo=rendicion&fecha=${date}&repartidor=todos`}
                className="secondary"
              >
                <Printer size={15} /> Resumen de rendición
              </Link>
              <Link to={`/operacion/reparto`} className="link-button">
                Hoja de ruta por preventista
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
