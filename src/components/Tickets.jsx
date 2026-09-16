import React from "react";
import { orderNumber } from "../lib/format.js";

const dmy = (iso) => (iso || "").split("-").reverse().join("/");
const MAX_BOX_MARKS = 40;

/**
 * Ticket de preparación por pedido para la comandera térmica (80 mm, blanco y negro, solo texto):
 * cliente, zona, cada producto con sus cajas (un casillero por caja para ir marcando) o kilos,
 * y un casillero final de CARGADO. Uno por pedido; se imprimen todos seguidos y la comandera
 * corta entre tickets.
 */
export default function Tickets({ orders, customers = [] }) {
  return (
    <div className="tickets">
      {orders.map((o) => {
        const c = customers.find((x) => x.phone === o.customer);
        return (
          <section className="ticket" key={o.id}>
            <div className="t-center t-big">EL POLLITO CASERO</div>
            <div className="t-center">PREPARACIÓN · {dmy(o.deliveryDate)}</div>
            <div className="t-rule" />
            <div className="t-row t-big">
              <span>PEDIDO N° {orderNumber(o)}</span>
              <span>{(o.shift || "").toUpperCase().slice(0, 1)}</span>
            </div>
            <div className="t-rule" />
            <div className="t-huge">{(c?.alias || o.name).toUpperCase()}</div>
            <div>
              ZONA:{" "}
              {(o.zone || c?.zone || o.locality?.name || "—").toUpperCase()}
            </div>
            {o.driver ? (
              <div>
                PREV.: {o.driver}
                {o.driver2 ? ` / ${o.driver2}` : ""}
              </div>
            ) : null}
            <div className="t-rule" />
            {o.items.map((p) => (
              <div className="t-product" key={p.id}>
                <div className="t-row">
                  <span className="t-strong">{p.name.toUpperCase()}</span>
                  <span className="t-strong">
                    {p.boxes
                      ? `${p.boxes} ${p.boxes === 1 ? "CAJA" : "CAJAS"}`
                      : `${Number(p.ordered ?? p.kg).toLocaleString("es-AR")} KG`}
                  </span>
                </div>
                {p.boxes ? (
                  <div className="t-boxes">
                    {Array.from(
                      { length: Math.min(p.boxes, MAX_BOX_MARKS) },
                      (_, i) => (
                        <span key={i}>[ ]</span>
                      ),
                    )}
                    {p.boxes > MAX_BOX_MARKS ? (
                      <span>+{p.boxes - MAX_BOX_MARKS}</span>
                    ) : null}
                  </div>
                ) : (
                  <div className="t-boxes">PESO: ______ kg</div>
                )}
              </div>
            ))}
            {o.notes ? (
              <>
                <div className="t-rule" />
                <div>OBS: {o.notes}</div>
              </>
            ) : null}
            <div className="t-rule" />
            <div className="t-row t-big">
              <span>CARGADO</span>
              <span>[ ]</span>
            </div>
            <div className="t-center t-small">
              controlar cliente · producto · cajas
            </div>
          </section>
        );
      })}
      {!orders.length && <p className="muted">No hay pedidos para imprimir.</p>}
    </div>
  );
}
