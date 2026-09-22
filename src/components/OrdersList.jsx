import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  ArrowRight,
  Package,
  Scale,
  Wallet,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money, orderNumber, labels, orderShift } from "../lib/format.js";
import { methodNames } from "../lib/photo.js";
import { useIsMobile } from "../lib/media.js";
import { StatusBadge } from "./ui.jsx";
import OrderCard from "./OrderCard.jsx";

const kg = (n) =>
  Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 1 });

/**
 * Pedidos en lista: una fila por pedido con N°, cliente, zona, productos, kilos, importe,
 * preventista, pago, estado y el casillero CARGADO. "Abrir" despliega la tarjeta con las acciones.
 * Es la vista por defecto de Pedidos (muchos clientes por preventista); las tarjetas quedan como alternativa.
 */
export default function OrdersList({ orders, role = "admin" }) {
  const { update, busy, customers, setModal } = useStore();
  const [open, setOpen] = useState(null);
  const mobile = useIsMobile();
  if (!orders.length) return <p className="board-empty">Nada por acá.</p>;
  // En el celular la tabla no entra: cada pedido es una tarjeta con lo justo y "Ver pedido".
  if (mobile)
    return (
      <ul className="delivery-list orders-cards">
        {orders.map((o) => {
          const cajas = o.items.reduce((s, i) => s + (i.boxes || 0), 0);
          const kilos = o.items.reduce(
            (s, p) => s + (p.weighed ? p.kg || 0 : 0),
            0,
          );
          const shift = orderShift(o, customers);
          return (
            <li key={o.id} className={"delivery-card st-" + o.status}>
              <div className="dc-top">
                <span className="dc-num">
                  N° {orderNumber(o)}
                  {shift ? ` · ${shift === "manana" ? "Mañana" : "Tarde"}` : ""}
                </span>
                <StatusBadge status={o.status} />
              </div>
              <h3>{o.name}</h3>
              <p className="dc-where">
                {[o.zone || o.locality?.name, o.address]
                  .filter(Boolean)
                  .join(" · ") || "Sin dirección"}
              </p>
              <div className="dc-facts">
                <span>
                  <Package size={14} />
                  {cajas ? `${cajas} cj` : "Por kilo"}
                </span>
                <span>
                  <Scale size={14} />
                  {o.weighed ? `${kg(kilos)} kg` : "A pesar"}
                </span>
                <span>
                  <Wallet size={14} />
                  {o.noPricing
                    ? "Sin precio"
                    : o.total > 0
                      ? money(o.total)
                      : "A pesar"}
                </span>
              </div>
              <p className="dc-driver">
                {o.driver || "Sin preventista"}
                {o.driver2 ? ` + ${o.driver2}` : ""}
                {" · "}
                {o.paid
                  ? "Cobrado"
                  : o.payment === "cuenta"
                    ? "A cuenta"
                    : "Al recibir"}
              </p>
              <div className="dc-row">
                <label className="dc-loaded">
                  <input
                    type="checkbox"
                    checked={!!o.loaded}
                    disabled={busy}
                    aria-label={"Cargado " + orderNumber(o)}
                    onChange={(e) => update(o, { loaded: e.target.checked })}
                  />
                  Cargado
                </label>
                <button
                  type="button"
                  className="primary dc-open"
                  onClick={() => setModal({ type: "order-detail", order: o })}
                >
                  <FileText size={16} /> Ver pedido <ArrowRight size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  return (
    <div className="table-scroll">
      <table className="customers orders-list">
        <thead>
          <tr>
            <th>N°</th>
            <th>Cliente</th>
            <th>Productos</th>
            <th className="num">Kg</th>
            <th className="num">Importe</th>
            <th>Preventista</th>
            <th>Pago</th>
            <th>Estado</th>
            <th className="check">Cargado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <React.Fragment key={o.id}>
              <tr className={"st-" + o.status + (o.loaded ? " loaded" : "")}>
                <td>
                  <strong>{orderNumber(o)}</strong>
                  {(() => {
                    const shift = orderShift(o, customers);
                    return shift ? (
                      <>
                        <br />
                        <small
                          className="muted"
                          title={
                            o.shift ? "Turno del pedido" : "Turno de la ficha"
                          }
                        >
                          {shift === "manana" ? "Mañana" : "Tarde"}
                        </small>
                      </>
                    ) : null;
                  })()}
                </td>
                <td>
                  <strong>{o.name}</strong>
                  <br />
                  <small className="muted">
                    {[o.zone || o.locality?.name, o.address]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </td>
                <td>
                  {o.items.map((p) => (
                    <div key={p.id}>
                      {p.boxes ? `${p.boxes} cj ` : ""}
                      {p.name.toLowerCase()}
                      {p.weighed && p.kg > 0
                        ? ` · ${kg(p.kg)} kg`
                        : p.boxes
                          ? ""
                          : ` · pidió ${kg(p.ordered ?? p.kg)} kg`}
                    </div>
                  ))}
                  {o.noPricing ? (
                    <small className="muted">sin precio ni saldo</small>
                  ) : null}
                  {o.notes ? (
                    <small className="muted">“{o.notes}”</small>
                  ) : null}
                </td>
                <td className="num">
                  {o.weighed ? (
                    kg(
                      o.items.reduce(
                        (s, p) => s + (p.weighed ? p.kg || 0 : 0),
                        0,
                      ),
                    )
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="num">
                  {o.noPricing ? (
                    <span className="muted">s/precio</span>
                  ) : o.total > 0 ? (
                    <strong>{money(o.total)}</strong>
                  ) : (
                    <span className="muted">a pesar</span>
                  )}
                </td>
                <td>
                  {o.driver || <span className="muted">—</span>}
                  {o.driver2 ? (
                    <small className="muted"> + {o.driver2}</small>
                  ) : null}
                </td>
                <td>
                  {o.paid
                    ? `Cobrado${o.paidMethod ? " · " + (methodNames[o.paidMethod] || o.paidMethod) : ""}`
                    : o.payment === "cuenta"
                      ? "A cuenta"
                      : "Al recibir"}
                </td>
                <td>
                  <em className={"chip st-" + o.status}>{labels[o.status]}</em>
                </td>
                <td className="check">
                  <input
                    type="checkbox"
                    checked={!!o.loaded}
                    disabled={busy}
                    aria-label={"Cargado " + orderNumber(o)}
                    onChange={(e) => update(o, { loaded: e.target.checked })}
                  />
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="link-button small"
                    onClick={() => setOpen(open === o.id ? null : o.id)}
                  >
                    {open === o.id ? (
                      <ChevronUp size={13} />
                    ) : (
                      <ChevronDown size={13} />
                    )}{" "}
                    {open === o.id ? "Cerrar" : "Abrir"}
                  </button>
                </td>
              </tr>
              {open === o.id && (
                <tr className="orders-list-detail">
                  <td colSpan="10">
                    <OrderCard
                      order={o}
                      role={role}
                      onClose={() => setOpen(null)}
                    />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
