import React, { useEffect, useState } from "react";
import {
  MapPin,
  MessageCircle,
  Package,
  Wallet,
  Scale,
  Camera,
  Pencil,
  ArrowRight,
  Clock,
  FileText,
  Users,
  Trash2,
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
} from "../lib/format.js";
import { StatusBadge } from "./ui.jsx";
import RemitoActions from "./RemitoActions.jsx";
import { ReceiptList } from "./Receipts.jsx";
import { receiptsOf, methodNames } from "../lib/photo.js";
import CajasBox from "./CajasBox.jsx";

/**
 * Ficha completa de un pedido, en tres niveles: resumen, detalle y acciones.
 * Abrirla no cambia nada del pedido: cobrar, pesar, envases y entrega son botones aparte,
 * y hay una sola acción principal según el estado.
 */
export default function OrderDetail({ order: abierto, role }) {
  const {
    orders,
    customers,
    setModal,
    busy,
    startingOrders,
    update,
    editOrder,
    deleteOrder,
    config,
  } = useStore();
  // Pedido fresco: si se cambia el preventista o se pesa mientras la ficha está abierta,
  // lo que se ve es lo que quedó guardado, no la foto de cuando se abrió.
  const o = orders.find((x) => x.id === abierto.id) || abierto;
  const customer = customers.find((x) => x.phone === o.customer);
  const admin = role === "admin";
  const [receipts, setReceipts] = useState(null);
  useEffect(() => {
    let alive = true;
    receiptsOf(o.id)
      .then((r) => alive && setReceipts(r))
      .catch(() => alive && setReceipts([]));
    return () => {
      alive = false;
    };
  }, [o.id]);

  // El pedido a cuenta impago ya está sumado en el saldo del cliente: se resta para no contarlo dos veces.
  const onAccount = o.payment === "cuenta" && !o.paid ? o.total : 0;
  const previous =
    Math.round(((customer?.summary?.balance || 0) - onAccount) * 100) / 100;
  const owedTotal = Math.round((previous + onAccount) * 100) / 100;
  const priced = !o.noPricing && o.weighed;
  const canWeigh = !["cancelado", "entregado"].includes(o.status);
  const boxesLeft = Math.max(
    0,
    Math.min((o.boxes || 0) - (o.returned || 0), customer?.summary?.boxes || 0),
  );
  const cerrado = ["entregado", "cancelado"].includes(o.status);
  const drivers = config?.drivers || [];

  return (
    <div className="od">
      {/* ---- Nivel 1: resumen ---- */}
      <header className="od-head">
        <div>
          <span className="eyebrow">PEDIDO N° {orderNumber(o)}</span>
          <h2>{o.name}</h2>
          {customer?.branch && (
            <span className="ui-tag sucursal">
              Sucursal · {customer.branch}
            </span>
          )}
        </div>
        <StatusBadge status={o.status} />
      </header>

      {/* ---- Nivel 2: detalle ---- */}
      <section className="od-block">
        <p>
          <MapPin size={15} />
          <span>
            {o.address || "Sin dirección"}
            {localityText(o) ? ` · ${localityText(o)}` : ""}
          </span>
        </p>
        {o.phone && /^\d{8,}$/.test(o.phone) && (
          <p>
            <MessageCircle size={15} />
            <a
              href={waLink(
                o.phone,
                `Hola ${o.name.split(" ")[0]}, te escribo de Pollito Casero por tu pedido N° ${orderNumber(o)}.`,
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {o.phone.replace(/^549/, "")}
            </a>
          </p>
        )}
        <p>
          <Clock size={15} />
          <span>
            {dateText(o.created)} {timeText(o.created)}
            {o.shift
              ? ` · turno ${o.shift === "manana" ? "mañana" : "tarde"}`
              : ""}
          </span>
        </p>
        {o.notes && <p className="od-notes">“{o.notes}”</p>}
      </section>

      {/* Asignación: espacio propio, con "Sin asignar" bien visible */}
      <section className="op-assign" aria-label="Asignación del reparto">
        <label>
          <span>
            <Users size={13} /> Preventista
          </span>
          {admin && !cerrado ? (
            <select
              value={o.driver || ""}
              disabled={busy}
              aria-label="Preventista del pedido"
              onChange={(e) => editOrder(o, { driver: e.target.value })}
            >
              <option value="">Sin asignar</option>
              {drivers.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          ) : (
            <strong className={o.driver ? "" : "sin-asignar"}>
              {o.driver || "Sin asignar"}
            </strong>
          )}
        </label>
        <label>
          <span>
            <Users size={13} /> Segundo preventista
          </span>
          {admin && !cerrado ? (
            <select
              value={o.driver2 || ""}
              disabled={busy}
              aria-label="Segundo preventista del pedido"
              onChange={(e) => editOrder(o, { driver2: e.target.value })}
            >
              <option value="">Va solo</option>
              {drivers
                .filter((d) => d !== o.driver)
                .map((d) => (
                  <option key={d}>{d}</option>
                ))}
            </select>
          ) : (
            <strong className={o.driver2 ? "" : "sin-asignar"}>
              {o.driver2 || "Va solo"}
            </strong>
          )}
        </label>
      </section>

      <section className="od-items" aria-label="Productos del pedido">
        {o.items.map((p) => (
          <div key={p.id} className="od-item">
            <div className="od-item-name">
              <strong>{p.name}</strong>
              <small>
                {p.boxes
                  ? `Pidió ${p.boxes} ${p.boxes === 1 ? "caja" : "cajas"}`
                  : `Pidió ${kgText(p.ordered ?? p.kg)}`}
                {!o.noPricing && p.price ? ` · ${money(p.price)}/kg` : ""}
              </small>
            </div>
            <div className="od-item-num">
              {p.weighed ? (
                <>
                  <strong>{kgText(p.kg)}</strong>
                  {!o.noPricing && <small>{money(p.lineTotal)}</small>}
                </>
              ) : (
                <em className="od-pending">Pendiente de pesaje</em>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="od-totals">
        <div>
          <dt>Total del pedido</dt>
          <dd>
            {o.noPricing ? (
              <em>Sin precio</em>
            ) : priced ? (
              money(o.total)
            ) : (
              <em>A pesar</em>
            )}
          </dd>
        </div>
        {!o.noPricing && previous !== 0 && (
          <div>
            <dt>Saldo anterior</dt>
            <dd className={previous > 0 ? "red" : "green"}>
              {previous > 0 ? money(previous) : `${money(-previous)} a favor`}
            </dd>
          </div>
        )}
        {!o.noPricing && (previous !== 0 || onAccount > 0) && (
          <div className="od-total-owed">
            <dt>Total adeudado</dt>
            <dd className={owedTotal > 0 ? "red" : "green"}>
              {owedTotal > 0
                ? money(owedTotal)
                : `${money(-owedTotal)} a favor`}
            </dd>
          </div>
        )}
      </section>

      {/* Las cajas van aparte del dinero, con las cuatro cifras a la vista */}
      <CajasBox order={o} customer={customer} />

      <section className="od-block od-state">
        <p>
          <Wallet size={15} />
          <span>
            {paymentLabel(o)} ·{" "}
            <b
              className={o.paid ? "green" : o.payment === "cuenta" ? "" : "red"}
            >
              {o.paid
                ? `Cobrado${o.paidMethod && o.paidMethod !== o.payment ? " (" + (methodNames[o.paidMethod] || o.paidMethod) + ")" : ""}`
                : o.payment === "cuenta"
                  ? "A cuenta"
                  : "Pendiente de cobro"}
            </b>
          </span>
        </p>
      </section>

      <section className="od-block">
        <h3>
          <FileText size={15} /> Comprobantes
        </h3>
        {receipts === null ? (
          <p className="muted small">Buscando comprobantes…</p>
        ) : (
          <>
            <ReceiptList
              order={o}
              receipts={receipts}
              compact
              onChange={() => receiptsOf(o.id).then(setReceipts)}
            />
            {receipts.length > 0 && (
              <p className="muted small">
                Tocá una foto para verla en grande o descargarla.
              </p>
            )}
          </>
        )}
      </section>

      {/* ---- Nivel 3: acciones. Una sola principal según el estado. ---- */}
      <div className="od-actions op-level">
        <div className="op-actions-main">
          {o.status === "recibido" && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => update(o, { status: "preparando" })}
            >
              Preparar pedido <ArrowRight size={16} />
            </button>
          )}
          {o.status === "preparando" && (
            <button
              type="button"
              className="primary"
              disabled={busy || startingOrders[o.id] || !o.driver}
              aria-busy={!!startingOrders[o.id]}
              title={o.driver ? "" : "Asigná un preventista primero"}
              onClick={() => update(o, { status: "en_camino" })}
            >
              {startingOrders[o.id] ? "Iniciando reparto…" : "Iniciar reparto"} <ArrowRight size={16} />
            </button>
          )}
          {o.status === "en_camino" && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => setModal({ type: "delivery", order: o })}
            >
              Confirmar entrega <ArrowRight size={16} />
            </button>
          )}
          {o.status === "entregado" && boxesLeft > 0 && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => setModal({ type: "return", order: o })}
            >
              <Package size={16} /> Recibir {boxesLeft} envases
            </button>
          )}
        </div>

        <div className="op-actions-more">
          {canWeigh && (
            <button
              type="button"
              className="secondary small"
              disabled={busy}
              onClick={() => setModal({ type: "weights", order: o })}
            >
              <Scale size={15} /> {o.weighed ? "Corregir peso" : "Pesar"}
            </button>
          )}
          {!cerrado && (
            <button
              type="button"
              className="secondary small"
              disabled={busy}
              onClick={() => setModal({ type: "edit-order", order: o })}
            >
              <Pencil size={15} /> Editar
            </button>
          )}
          <button
            type="button"
            className="secondary small"
            disabled={busy}
            onClick={() => setModal({ type: "receipts", order: o })}
          >
            <Camera size={15} /> Comprobantes
          </button>
          {!o.paid && o.payment !== "cuenta" && o.status !== "cancelado" && (
            <button
              type="button"
              className="secondary small"
              disabled={busy}
              onClick={() => setModal({ type: "payment", order: o })}
            >
              <Wallet size={15} /> Registrar cobro
            </button>
          )}
          {o.payment === "cuenta" && customer && owedTotal > 0 && (
            <button
              type="button"
              className="secondary small"
              disabled={busy}
              onClick={() =>
                setModal({ type: "account-payment", customer, order: o })
              }
            >
              <Wallet size={15} /> Cobrar cuenta
            </button>
          )}
          {admin && o.status !== "cancelado" && (
            <RemitoActions orders={[o]} actions={["download", "share"]} />
          )}
        </div>

        {admin && o.status !== "cancelado" && (
          <div className="op-actions-danger">
            <button
              type="button"
              className="link-button danger"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(
                  `¿Eliminar el pedido N° ${orderNumber(o)} de ${o.name}? Se borra con sus cajones y no se puede recuperar.\nMotivo (opcional):`,
                );
                if (reason !== null) deleteOrder(o, reason);
              }}
            >
              <Trash2 size={14} /> Eliminar pedido
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
