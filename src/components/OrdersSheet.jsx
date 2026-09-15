import React from "react";
import {
  money,
  kgText,
  timeText,
  paymentLabel,
  labels,
  orderNumber,
} from "../lib/format.js";
import { dayLabel } from "../lib/report.js";

/** Hoja de pedidos del día para preparar en el local. */
export default function OrdersSheet({ sheet }) {
  return (
    <div className="sheet">
      <header className="sheet-head">
        <div>
          <span className="eyebrow">HOJA DE PEDIDOS</span>
          <h2>Pollito Casero</h2>
          <p>{dayLabel(sheet.date)}</p>
        </div>
        <dl className="sheet-facts">
          <div>
            <dt>Pedidos</dt>
            <dd>{sheet.orders.length}</dd>
          </div>
          <div>
            <dt>Kilos</dt>
            <dd>{kgText(sheet.kg)}</dd>
          </div>
          <div>
            <dt>Importe</dt>
            <dd>{money(sheet.total)}</dd>
          </div>
          {sheet.cancelled > 0 && (
            <div>
              <dt>Cancelados</dt>
              <dd>{sheet.cancelled}</dd>
            </div>
          )}
        </dl>
      </header>
      <div className="sheet-summary compact">
        <section>
          <h3>Total a preparar</h3>
          <dl>
            {sheet.byProduct.map(([name, kg]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{kgText(kg)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      {sheet.byDriver.map(([driver, list]) => (
        <section key={driver} className="sheet-group">
          <h3>
            {driver}{" "}
            <small>
              · {list.length} pedidos ·{" "}
              {kgText(
                list.reduce(
                  (s, o) => s + o.items.reduce((n, p) => n + p.kg, 0),
                  0,
                ),
              )}
            </small>
          </h3>
          <div className="table-scroll">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Hora</th>
                  <th>Cliente</th>
                  <th>Dirección</th>
                  <th>Productos</th>
                  <th className="num">Kg</th>
                  <th className="num">Importe</th>
                  <th>Pago</th>
                  <th>Estado</th>
                  <th className="check">Cargado</th>
                  <th className="obs">Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id}>
                    <td>{orderNumber(o)}</td>
                    <td>{timeText(o.created)}</td>
                    <td>
                      <strong>{o.name}</strong>
                      <br />
                      <small>{o.phone}</small>
                    </td>
                    <td>
                      {o.address}
                      <br />
                      <small>{o.locality?.name}</small>
                      {o.notes && (
                        <>
                          <br />
                          <small>“{o.notes}”</small>
                        </>
                      )}
                    </td>
                    <td>
                      {o.items.map((p) => (
                        <div key={p.id}>
                          {p.name} · {kgText(p.kg)}
                        </div>
                      ))}
                    </td>
                    <td className="num">
                      {o.items.reduce((n, p) => n + p.kg, 0)}
                    </td>
                    <td className="num">{money(o.total)}</td>
                    <td>{paymentLabel(o)}</td>
                    <td>{labels[o.status]}</td>
                    <td className="check">☐</td>
                    <td className="obs"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {sheet.orders.length === 0 && (
        <p className="muted">No hay pedidos para esta fecha.</p>
      )}
    </div>
  );
}
