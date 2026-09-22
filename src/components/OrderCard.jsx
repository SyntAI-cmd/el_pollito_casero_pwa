import React from "react";
import {
  ArrowRight,
  MessageCircle,
  MapPin,
  Package,
  Wallet,
  Clock,
  Store,
  Scale,
  Camera,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import {
  orderNumber,
  money,
  kgText,
  timeText,
  dateText,
  paymentLabel,
  localityText,
  waLink,
  planNames,
} from "../lib/format.js";
import { StatusBadge } from "./ui.jsx";
import RemitoActions from "./RemitoActions.jsx";
import { methodNames } from "../lib/photo.js";
import { Tags, Trash2, Pencil } from "lucide-react";

/** Tarjeta operativa de un pedido, con acciones según el rol (admin o repartidor). */
export default function OrderCard({ order: o, role, onClose }) {
  const { config, busy, update, setModal, customers, deleteOrder } = useStore();
  const customer = customers.find((x) => x.phone === o.customer);
  const admin = role === "admin";
  const canWeigh =
    o.status !== "cancelado" &&
    o.status !== "entregado" &&
    !(o.paid && o.payment !== "cuenta");
  // Saldo anterior del cliente: lo que debía antes de este pedido.
  const accountBalance =
    Math.round(
      ((customer?.summary?.balance || 0) -
        (o.payment === "cuenta" && !o.paid ? o.total : 0)) *
        100,
    ) / 100;
  const unpaid = !o.paid && o.status !== "cancelado";
  const created = new Date(o.created);
  const today = created.toDateString() === new Date().toDateString();
  return (
    <article
      className={"operation-order status-" + o.status}
      aria-labelledby={"op-" + o.id}
    >
      <header>
        <div>
          <h3 id={"op-" + o.id}>
            N° {orderNumber(o)} <StatusBadge status={o.status} />
          </h3>
          <small>
            <Clock size={12} /> {today ? "Hoy" : dateText(o.created)}{" "}
            {timeText(o.created)} · {planNames[o.plan]}
            {o.createdBy === "admin" ? " · cargado por administración" : ""}
          </small>
        </div>
        <strong className="amount">
          {o.noPricing ? "Sin precio" : o.weighed ? money(o.total) : "A pesar"}
        </strong>
      </header>
      <div className="op-grid">
        <div className="op-customer">
          <p>
            <Store size={15} /> <strong>{o.name}</strong>
            {o.phone && /^\d{8,}$/.test(o.phone) && (
              <a
                className="wa-inline"
                href={waLink(
                  o.phone,
                  `Hola ${o.name.split(" ")[0]}, te escribo de Pollito Casero por tu pedido N° ${orderNumber(o)}.`,
                )}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp de ${o.name}: ${o.phone}`}
              >
                <MessageCircle size={14} /> {o.phone}
              </a>
            )}
          </p>
          <p>
            <MapPin size={15} /> {o.address}, {localityText(o)}
          </p>
          {o.notes && <p className="notes">“{o.notes}”</p>}
        </div>
        <div className="op-side">
          <p className="op-payment">
            <Wallet size={15} /> {paymentLabel(o)} ·{" "}
            <b
              className={o.paid ? "green" : o.payment === "cuenta" ? "" : "red"}
            >
              {o.paid
                ? `Cobrado${o.paidMethod && o.paidMethod !== o.payment ? " (" + (methodNames[o.paidMethod] || o.paidMethod) + ")" : ""}${
                    Array.isArray(o.paidSplit) && o.paidSplit.length > 1
                      ? ": " +
                        o.paidSplit
                          .map(
                            (p) =>
                              `${methodNames[p.method] || p.method} ${money(p.amount)}`,
                          )
                          .join(" + ")
                      : ""
                  }`
                : o.payment === "cuenta"
                  ? "A cuenta"
                  : o.payment === "transferencia" && o.transfer
                    ? `Transferencia informada ${timeText(o.transfer.reportedAt)}${o.transfer.reference ? " · ref. " + o.transfer.reference : ""} · verificar`
                    : "Pendiente de cobro"}
            </b>
            {o.plan === "mayorista" && o.status === "entregado" && (
              <>
                {" "}
                · <Package size={15} />{" "}
                {o.boxes
                  ? `${o.boxes - o.returned} de ${o.boxes} envases pendientes`
                  : "Sin envases"}
              </>
            )}
          </p>
          {o.payment === "cuenta" && customer && accountBalance !== 0 && (
            <p
              className={"op-balance " + (accountBalance > 0 ? "red" : "green")}
            >
              <Wallet size={14} />{" "}
              {accountBalance > 0
                ? `Saldo anterior de ${o.name.split(" ")[0]}: ${money(accountBalance)}`
                : `Saldo a favor: ${money(-accountBalance)}`}
            </p>
          )}
          {(o.departedAt || o.deliveredAt) && (
            <p className="op-eta">
              <Clock size={15} />
              {o.departedAt ? `Salió ${timeText(o.departedAt)}` : ""}
              {o.deliveredAt ? ` · entregado ${timeText(o.deliveredAt)}` : ""}
            </p>
          )}
        </div>
      </div>
      <ul className="op-items">
        {o.items.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <strong>
              {p.boxes ? (
                <>
                  Pidió {p.boxes} {p.boxes === 1 ? "caja" : "cajas"}
                  <small>
                    {p.kg > 0 ? ` · pesaron ${kgText(p.kg)}` : " · sin pesar"}
                  </small>
                </>
              ) : p.weighed ? (
                <>
                  {kgText(p.kg)}
                  {p.ordered !== p.kg && (
                    <small> · pedido {kgText(p.ordered)}</small>
                  )}
                </>
              ) : (
                <>
                  Pidió {kgText(p.ordered ?? p.kg)}
                  <small> · sin pesar</small>
                </>
              )}
            </strong>
          </li>
        ))}
        {o.weighed && (
          <li className="weighed">
            <span>
              <Scale size={13} /> Pesado en balanza
              {o.weighedBy && o.weighedBy !== "admin"
                ? ` por ${o.weighedBy}`
                : ""}{" "}
              · {timeText(o.weighedAt)}
            </span>
            <strong>{o.noPricing ? "sin precio" : money(o.total)}</strong>
          </li>
        )}
      </ul>
      {o.status !== "cancelado" && (
        <div className="operation-actions">
          {admin && o.status !== "entregado" && (
            <label>
              Repartidor
              <select
                aria-label={"Repartidor " + o.id}
                value={o.driver}
                disabled={busy}
                onChange={async (e) => {
                  if (await update(o, { driver: e.target.value })) onClose?.();
                }}
              >
                <option value="" disabled>
                  Asignar…
                </option>
                {(config?.drivers || []).map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          )}
          {!admin && o.driver && (
            <span className="op-driver">
              Asignado a {o.driver}
              {o.driver2 ? ` y ${o.driver2}` : ""}
            </span>
          )}
          {o.status === "recibido" && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => update(o, { status: "preparando" })}
            >
              Preparar pedido <ArrowRight size={16} />
            </button>
          )}
          {o.status === "preparando" && (
            <button
              className="primary"
              disabled={busy || !o.driver}
              title={o.driver ? "" : "Asigná un repartidor primero"}
              onClick={() => update(o, { status: "en_camino" })}
            >
              Iniciar reparto <ArrowRight size={16} />
            </button>
          )}
          {o.status === "en_camino" && (
            <>
              <button
                className="primary"
                disabled={busy}
                onClick={() => setModal({ type: "delivery", order: o })}
              >
                Completar entrega <ArrowRight size={16} />
              </button>
            </>
          )}
          {!["entregado", "cancelado"].includes(o.status) && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setModal({ type: "edit-order", order: o })}
            >
              <Pencil size={15} /> Editar pedido
            </button>
          )}
          {canWeigh && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setModal({ type: "weights", order: o })}
            >
              <Scale size={15} /> {o.weighed ? "Corregir peso" : "Pesar"}
            </button>
          )}
          {!o.noPricing &&
            (admin || o.status !== "entregado") &&
            o.status !== "cancelado" &&
            !(o.paid && o.payment !== "cuenta") && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setModal({ type: "order-prices", order: o })}
              >
                <Tags size={15} /> Precios
              </button>
            )}
          {o.status !== "cancelado" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setModal({ type: "receipts", order: o })}
            >
              <Camera size={15} /> Comprobantes
            </button>
          )}
          {unpaid && o.payment !== "cuenta" && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setModal({ type: "payment", order: o })}
            >
              Registrar cobro
            </button>
          )}
          {admin && o.status !== "cancelado" && (
            <RemitoActions orders={[o]} actions={["download", "share"]} />
          )}
          {admin && (
            <button
              className="link-button danger"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(
                  `¿Eliminar el pedido N° ${orderNumber(o)} de ${o.name}? Se borra con sus cajones y no se puede recuperar.\nMotivo (opcional):`,
                );
                if (reason !== null) deleteOrder(o, reason);
              }}
            >
              <Trash2 size={14} /> Eliminar
            </button>
          )}
          {o.payment === "cuenta" && customer && accountBalance > 0 && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                setModal({ type: "account-payment", customer, order: o })
              }
            >
              <Wallet size={15} /> Cobrar cuenta corriente
            </button>
          )}
          {o.status === "entregado" && o.boxes > o.returned && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setModal({ type: "return", order: o })}
            >
              <Package size={15} /> Devolver envases ({o.boxes - o.returned})
            </button>
          )}
        </div>
      )}
    </article>
  );
}
