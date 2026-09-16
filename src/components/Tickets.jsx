import React from "react";
import { orderNumber } from "../lib/format.js";

const dmy = (iso) => (iso || "").split("-").reverse().join("/");
const kg = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

/**
 * Ticket de preparación por pedido para la comandera térmica (80 mm, blanco y negro, solo texto):
 * un ticket por pedido con TODOS sus productos (cajas o kilos por producto), el total de cajas y
 * el total de kilos ya pesados, cliente, zona y una línea para marcar CARGADO. Lo que no se sabe
 * queda en blanco.
 */
export default function Tickets({ orders, customers = [] }) {
  return (
    <div className="tickets">
      {orders.map((o) => {
        const c = customers.find((x) => x.phone === o.customer);
        const totalBoxes = o.items.reduce((s, p) => s + (p.boxes || 0), 0);
        const totalKg = o.items.reduce((s, p) => s + (p.kg || 0), 0);
        return (
          <section className="ticket" key={o.id}>
            <div className="t-center t-big">EL POLLITO CASERO</div>
            <div className="t-center t-small">
              PEDIDO · {dmy(o.deliveryDate)}
              {o.shift ? ` · ${o.shift === "manana" ? "MAÑANA" : "TARDE"}` : ""}
            </div>
            <div className="t-rule" />
            <div className="t-huge">N° {orderNumber(o)}</div>
            <div className="t-huge">{(c?.alias || o.name).toUpperCase()}</div>
            <div>
              ZONA:{" "}
              {(o.zone || c?.zone || o.locality?.name || "").toUpperCase()}
            </div>
            {o.driver ? (
              <div>
                PREVENTISTA: {o.driver}
                {o.driver2 ? ` / ${o.driver2}` : ""}
              </div>
            ) : null}
            <div className="t-rule" />
            {o.items.map((p) => (
              <div className="t-row t-product" key={p.id}>
                <span>{p.name.toUpperCase()}</span>
                <span className="t-strong">
                  {p.boxes
                    ? `${p.boxes} ${p.boxes === 1 ? "CAJA" : "CAJAS"}`
                    : `${kg(p.ordered ?? p.kg)} KG`}
                  {p.boxes && p.kg > 0 ? ` · ${kg(p.kg)} KG` : ""}
                </span>
              </div>
            ))}
            <div className="t-rule" />
            <div className="t-row t-strong">
              <span>TOTAL CAJAS</span>
              <span>{totalBoxes || ""}</span>
            </div>
            <div className="t-row t-strong">
              <span>TOTAL KG</span>
              <span>{totalKg > 0 ? kg(totalKg) : ""}</span>
            </div>
            {o.notes ? (
              <>
                <div className="t-rule" />
                <div>OBS: {o.notes}</div>
              </>
            ) : null}
            <div className="t-rule" />
            <div className="t-big">CARGADO: ____________</div>
          </section>
        );
      })}
      {!orders.length && <p className="muted">No hay pedidos para imprimir.</p>}
    </div>
  );
}
