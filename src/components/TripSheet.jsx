import React from "react";
import { money, kgText } from "../lib/format.js";
import { dayLabel } from "../lib/report.js";
import { vehicleLabel } from "./Vehicles.jsx";

const shiftName = { manana: "Mañana", tarde: "Tarde" };
const kg = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });

/**
 * Hoja de viaje: la planilla de papel que se lleva el reparto, una por camioneta y día.
 * Cabecera con fecha, vehículo, repartidores y turno; un renglón por pedido con NOMBRE, SALDO,
 * PEDIDO, PRECIO UNITARIO, KILOS e IMPORTE, y columnas en blanco (cobrado, cajas, observaciones)
 * para completar a mano y rendir después. Termina con totales y renglones libres.
 */
export default function TripSheet({
  date,
  vehicle,
  drivers = [],
  departure,
  orders,
  customers,
}) {
  const rows = orders.map((o) => {
    const c = customers.find((x) => x.phone === o.customer);
    const onAccount = o.payment === "cuenta" && !o.paid ? o.total : 0;
    const previous = c
      ? Math.round(((c.summary?.balance || 0) - onAccount) * 100) / 100
      : 0;
    return { o, c, previous };
  });
  const shifts = [...new Set(orders.map((o) => o.shift).filter(Boolean))];
  const totalKg = orders.reduce(
    (s, o) => s + o.items.reduce((k, i) => k + (i.kg || 0), 0),
    0,
  );
  const totalBoxes = orders.reduce(
    (s, o) => s + o.items.reduce((k, i) => k + (i.boxes || 0), 0),
    0,
  );
  const total = orders.reduce((s, o) => s + o.total, 0);
  const blank = Math.max(3, 14 - rows.length);
  return (
    <section className="trip-sheet">
      <header className="trip-head">
        <div className="trip-brand">
          <img src="/brand/logo-texto.png" alt="El Pollito Casero" />
        </div>
        <dl>
          <div>
            <dt>Fecha</dt>
            <dd>{dayLabel(date)}</dd>
          </div>
          <div>
            <dt>Camioneta</dt>
            <dd>{vehicle ? vehicleLabel(vehicle) : "—"}</dd>
          </div>
          <div>
            <dt>Repartidores</dt>
            <dd>{drivers.length ? drivers.join(" y ") : "—"}</dd>
          </div>
          <div>
            <dt>Turno</dt>
            <dd>
              {shifts.length
                ? shifts.map((s) => shiftName[s] || s).join(" / ")
                : "—"}
              {departure ? ` · sale ${departure}` : ""}
            </dd>
          </div>
        </dl>
      </header>
      <table className="trip-table">
        <thead>
          <tr>
            <th className="n">#</th>
            <th>Nombre</th>
            <th className="num">Saldo</th>
            <th>Pedido</th>
            <th className="num">Precio unitario</th>
            <th className="num">Kilos</th>
            <th className="num">Importe</th>
            <th className="hand">Cobrado</th>
            <th className="hand">Cajas dej. / dev.</th>
            <th className="hand wide">Observaciones</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ o, c, previous }, i) => (
            <tr key={o.id}>
              <td className="n">{i + 1}</td>
              <td>
                <strong>{c?.alias || o.name}</strong>
                <small>
                  {[o.zone || c?.zone, o.address].filter(Boolean).join(" · ")}
                  {o.payment === "cuenta"
                    ? " · cta. cte."
                    : " · paga al recibir"}
                  {o.notes ? ` · “${o.notes}”` : ""}
                </small>
              </td>
              <td className="num">
                {previous ? money(previous) : <span className="dash">—</span>}
              </td>
              <td>
                {o.items.map((it) => (
                  <div key={it.id}>
                    {it.boxes
                      ? `${it.boxes} ${it.boxes === 1 ? "caja" : "cajas"} ${it.name.toLowerCase()}`
                      : `${kg(it.ordered ?? it.kg)} kg ${it.name.toLowerCase()}`}
                  </div>
                ))}
              </td>
              <td className="num">
                {o.items.map((it) => (
                  <div key={it.id}>{money(it.price)}</div>
                ))}
              </td>
              <td className="num">
                {o.items.map((it) => (
                  <div key={it.id}>
                    {it.kg > 0 ? kg(it.kg) : <span className="line" />}
                  </div>
                ))}
              </td>
              <td className="num">
                {o.weighed || o.items.every((it) => !it.boxes) ? (
                  money(o.total)
                ) : (
                  <span className="line" />
                )}
              </td>
              <td className="hand" />
              <td className="hand" />
              <td className="hand wide" />
            </tr>
          ))}
          {Array.from({ length: blank }, (_, i) => (
            <tr key={"b" + i} className="blank">
              <td className="n">{rows.length + i + 1}</td>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
              <td className="hand" />
              <td className="hand" />
              <td className="hand wide" />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="3">
              {orders.length} {orders.length === 1 ? "pedido" : "pedidos"}
            </td>
            <td>{totalBoxes ? `${totalBoxes} cajas` : ""}</td>
            <td />
            <td className="num">{totalKg ? kg(totalKg) : ""}</td>
            <td className="num">{money(total)}</td>
            <td className="hand" />
            <td className="hand" />
            <td className="hand wide" />
          </tr>
        </tfoot>
      </table>
      <footer className="trip-foot">
        <div>
          <span>Efectivo rendido: $ ______________</span>
          <span>Transferencias: $ ______________</span>
          <span>Cheques: $ ______________</span>
        </div>
        <div className="signatures">
          <span>Firma repartidor</span>
          <span>Firma administración</span>
        </div>
      </footer>
    </section>
  );
}
