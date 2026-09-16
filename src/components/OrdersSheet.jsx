import React from "react";
import { orderNumber } from "../lib/format.js";

const shiftName = { manana: "Mañana", tarde: "Tarde" };
const kg = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
const money = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
const dmy = (iso) => (iso || "").split("-").reverse().join("/");

/**
 * Hoja de pedidos (impresa, A4 apaisada): control general del día en UNA sola tabla, ordenada por
 * preventista y N° de pedido. Cabecera con fecha, turno, pedidos y kilos totales; por pedido N°,
 * cliente, preventista, productos, kg (pesados o en blanco), precio unitario, importe, observación
 * en blanco y casillero de cargado. Imprimir → Guardar como PDF.
 */
export default function OrdersSheet({ sheet }) {
  const orders = [...sheet.orders].sort(
    (a, b) =>
      (a.driver || "").localeCompare(b.driver || "") ||
      (a.number || 0) - (b.number || 0),
  );
  const shifts = [...new Set(orders.map((o) => o.shift).filter(Boolean))];
  const total = orders.reduce((s, o) => s + o.total, 0);
  return (
    <div className="hoja">
      <header className="hoja-head">
        <img src="/brand/logo-texto.png" alt="El Pollito Casero" />
        <div className="hoja-title">
          <h1>Hoja de pedidos</h1>
          <p>{dmy(sheet.date)}</p>
        </div>
        <dl className="hoja-facts">
          <div>
            <dt>Turno</dt>
            <dd>
              {shifts.length
                ? shifts.map((s) => shiftName[s] || s).join(" / ")
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Pedidos</dt>
            <dd>{orders.length}</dd>
          </div>
          <div>
            <dt>Kilos totales</dt>
            <dd>{kg(sheet.kg)} kg</dd>
          </div>
          <div>
            <dt>Importe</dt>
            <dd>{money(total)}</dd>
          </div>
        </dl>
      </header>
      <table className="hoja-table">
        <thead>
          <tr>
            <th className="c-num">N°</th>
            <th className="c-client">Cliente</th>
            <th className="c-driver">Preventista</th>
            <th className="c-products">Productos</th>
            <th className="c-kg">Kg</th>
            <th className="c-price">Precio unit.</th>
            <th className="c-total">Importe</th>
            <th className="c-obs">Observación</th>
            <th className="c-check">Cargado</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td className="c-num">{orderNumber(o)}</td>
              <td className="c-client">
                <strong>{o.name}</strong>
                <small>
                  {[o.zone || o.locality?.name, o.address]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </td>
              <td className="c-driver">
                {o.driver || "—"}
                {o.driver2 ? <small>+ {o.driver2}</small> : null}
              </td>
              <td className="c-products">
                {o.items.map((p) => (
                  <div key={p.id}>
                    {p.boxes
                      ? `${p.boxes} ${p.boxes === 1 ? "caja" : "cajas"} `
                      : `${kg(p.ordered ?? p.kg)} kg `}
                    {p.name.toLowerCase()}
                  </div>
                ))}
                {o.notes ? <small>“{o.notes}”</small> : null}
              </td>
              <td className="c-kg">
                {o.items.map((p) => (
                  <div key={p.id}>{p.kg > 0 ? kg(p.kg) : ""}</div>
                ))}
              </td>
              <td className="c-price">
                {o.items.map((p) => (
                  <div key={p.id}>{money(p.price)}</div>
                ))}
              </td>
              <td className="c-total">{o.total > 0 ? money(o.total) : ""}</td>
              <td className="c-obs" />
              <td className="c-check">{o.loaded ? "☑" : "☐"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="4">
              {orders.length} {orders.length === 1 ? "pedido" : "pedidos"}
            </td>
            <td className="c-kg">{kg(sheet.kg)}</td>
            <td />
            <td className="c-total">{money(total)}</td>
            <td colSpan="2" />
          </tr>
        </tfoot>
      </table>
      {orders.length === 0 && (
        <p className="muted">No hay pedidos para esta fecha.</p>
      )}
      <footer className="hoja-foot">
        <span>Observaciones</span>
        <span>Control / Administración</span>
      </footer>
    </div>
  );
}
