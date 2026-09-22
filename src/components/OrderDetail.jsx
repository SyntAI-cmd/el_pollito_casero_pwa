import React, { useEffect, useState } from "react";
import {
  Store,
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
  Download,
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

/**
 * Ficha completa de un pedido: qué lleva, cuánto pesó, cuánto se debe y qué papeles hay.
 * Abrirla no cambia nada del pedido: cobrar, pesar, envases y entrega son botones aparte.
 */
export default function OrderDetail({ order: o, role }) {
  const { customers, setModal, busy, update, deleteOrder } = useStore();
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
  const boxesLeft = (o.boxes || 0) - (o.returned || 0);

  return (
    <div className="od">
      <header className="od-head">
        <div>
          <span className="eyebrow">PEDIDO N° {orderNumber(o)}</span>
          <h2>{o.name}</h2>
        </div>
        <StatusBadge status={o.status} />
      </header>

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
            {o.driver ? ` · ${o.driver}` : ""}
            {o.driver2 ? ` y ${o.driver2}` : ""}
            {o.shift
              ? ` · turno ${o.shift === "manana" ? "mañana" : "tarde"}`
              : ""}
          </span>
        </p>
        {o.notes && <p className="od-notes">“{o.notes}”</p>}
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
                <em className="od-pending">A pesar</em>
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
        <p>
          <Package size={15} />
          <span>
            {o.boxes
              ? `${boxesLeft} de ${o.boxes} envases a devolver`
              : "Sin envases registrados"}
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

      <div className="od-actions">
        {canWeigh && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setModal({ type: "weights", order: o })}
          >
            <Scale size={16} /> {o.weighed ? "Corregir peso" : "Pesar"}
          </button>
        )}
        {!["entregado", "cancelado"].includes(o.status) && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setModal({ type: "edit-order", order: o })}
          >
            <Pencil size={16} /> Editar pedido
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setModal({ type: "receipts", order: o })}
        >
          <Camera size={16} /> Agregar comprobante
        </button>
        {!o.paid && o.payment !== "cuenta" && o.status !== "cancelado" && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setModal({ type: "payment", order: o })}
          >
            <Wallet size={16} /> Registrar cobro
          </button>
        )}
        {o.payment === "cuenta" && customer && owedTotal > 0 && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              setModal({ type: "account-payment", customer, order: o })
            }
          >
            <Wallet size={16} /> Cobrar cuenta corriente
          </button>
        )}
        {o.status === "entregado" && boxesLeft > 0 && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setModal({ type: "return", order: o })}
          >
            <Package size={16} /> Devolver envases ({boxesLeft})
          </button>
        )}
        {admin && o.status !== "cancelado" && (
          <RemitoActions orders={[o]} actions={["download", "share"]} />
        )}
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
            disabled={busy || !o.driver}
            title={o.driver ? "" : "Asigná un preventista primero"}
            onClick={() => update(o, { status: "en_camino" })}
          >
            Iniciar reparto <ArrowRight size={16} />
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
        {admin && o.status !== "cancelado" && (
          <button
            type="button"
            className="link-button danger od-delete"
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
        )}
      </div>
    </div>
  );
}
