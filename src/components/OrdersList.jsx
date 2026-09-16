import React, { useState } from "react";
import { ChevronDown, ChevronUp, Ticket } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link } from "../lib/router.jsx";
import { money, orderNumber, labels } from "../lib/format.js";
import { methodNames } from "../lib/photo.js";
import OrderCard from "./OrderCard.jsx";

const kg = (n) =>
  Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 1 });

/**
 * Pedidos en lista: una fila por pedido con N°, cliente, zona, productos, kilos, importe,
 * preventista, pago, estado y el casillero CARGADO. "Abrir" despliega la tarjeta con las acciones.
 * Es la vista por defecto de Pedidos (muchos clientes por preventista); las tarjetas quedan como alternativa.
 */
export default function OrdersList({ orders, role = "admin" }) {
  const { update, busy } = useStore();
  const [open, setOpen] = useState(null);
  if (!orders.length) return <p className="board-empty">Nada por acá.</p>;
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
                      {p.kg > 0
                        ? ` · ${kg(p.kg)} kg`
                        : p.boxes
                          ? ""
                          : ` · ${kg(p.ordered ?? p.kg)} kg`}
                    </div>
                  ))}
                  {o.notes ? (
                    <small className="muted">“{o.notes}”</small>
                  ) : null}
                </td>
                <td className="num">
                  {kg(o.items.reduce((s, p) => s + (p.kg || 0), 0))}
                </td>
                <td className="num">
                  <strong>{money(o.total)}</strong>
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
                  <Link
                    to={`/imprimir?tipo=tickets&pedido=${o.id}`}
                    className="link-button small"
                    title="Ticket de preparación (comandera)"
                  >
                    <Ticket size={13} /> Ticket
                  </Link>
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
                    <OrderCard order={o} role={role} />
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
