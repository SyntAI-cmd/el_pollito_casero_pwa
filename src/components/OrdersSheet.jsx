import React from "react";
import { orderNumber } from "../lib/format.js";
import { dayLabel } from "../lib/report.js";

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

/**
 * Hoja de pedidos (impresa, A4 apaisada): la planilla amarilla del piso, una sección por
 * preventista. Cabecera EL POLLITO CASERO · fecha · kilos totales; por pedido CLIENTE, N° PEDIDO,
 * PRODUCTOS, KG (pesados o en blanco), PRECIO UNITARIO, OBSERVACIÓN (en blanco, a lapicera) y
 * CHECKLIST de cargado. Se descarga en PDF desde el navegador (Imprimir → Guardar como PDF).
 */
export default function OrdersSheet({ sheet }) {
  const shifts = [...new Set(sheet.orders.map((o) => o.shift).filter(Boolean))];
  return (
    <div className="hoja">
      <header className="hoja-head">
        <div className="hoja-brand">
          <img src="/brand/logo-texto.png" alt="El Pollito Casero" />
        </div>
        <h1>Hoja de pedidos</h1>
        <dl className="hoja-topline">
          <div>
            <dt>Fecha</dt>
            <dd>{dayLabel(sheet.date)}</dd>
          </div>
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
            <dd>{sheet.orders.length}</dd>
          </div>
          <div>
            <dt>Kilos totales</dt>
            <dd>{kg(sheet.kg)} kg</dd>
          </div>
        </dl>
      </header>
      {sheet.byDriver.map(([driver, list]) => (
        <section key={driver} className="hoja-group">
          <h2>
            Preventista: {driver}
            <small>
              {list.length} {list.length === 1 ? "pedido" : "pedidos"} ·{" "}
              {kg(
                list.reduce(
                  (s, o) => s + o.items.reduce((n, p) => n + (p.kg || 0), 0),
                  0,
                ),
              )}{" "}
              kg
            </small>
          </h2>
          <table className="hoja-table">
            <thead>
              <tr>
                <th className="c-client">Cliente</th>
                <th className="c-num">Pedido</th>
                <th className="c-products">Productos</th>
                <th className="c-kg">Kg</th>
                <th className="c-price">Precio unitario</th>
                <th className="c-obs">Observación</th>
                <th className="c-check">Cargado</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id}>
                  <td className="c-client">
                    <strong>{o.name}</strong>
                    <small>
                      {[o.zone || o.locality?.name, o.address]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </td>
                  <td className="c-num">{orderNumber(o)}</td>
                  <td className="c-products">
                    {o.items.map((p) => (
                      <div key={p.id}>
                        {p.boxes
                          ? `${p.boxes} ${p.boxes === 1 ? "caja" : "cajas"} `
                          : `${kg(p.ordered ?? p.kg)} kg `}
                        {p.name.toLowerCase()}
                      </div>
                    ))}
                    {o.notes ? <em>“{o.notes}”</em> : null}
                  </td>
                  <td className="c-kg">
                    {o.items.map((p) => (
                      <div key={p.id}>
                        {p.kg > 0 ? kg(p.kg) : <span className="line" />}
                      </div>
                    ))}
                  </td>
                  <td className="c-price">
                    {o.items.map((p) => (
                      <div key={p.id}>{money(p.price)}</div>
                    ))}
                  </td>
                  <td className="c-obs" />
                  <td className="c-check">{o.loaded ? "☑" : "☐"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {sheet.orders.length === 0 && (
        <p className="muted">No hay pedidos para esta fecha.</p>
      )}
      <footer className="hoja-foot">
        <span>
          Observaciones: ______________________________________________
        </span>
        <span>Control / Administración: ____________________________</span>
      </footer>
    </div>
  );
}
