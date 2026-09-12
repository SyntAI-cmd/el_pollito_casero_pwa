import React, { useState } from "react";
import {
  Wallet,
  Copy,
  Check,
  ExternalLink,
  Banknote,
  Clock,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money, timeText } from "../lib/format.js";

function CopyField({ label, value }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy-field">
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={`Copiar ${label}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

/** Qué tiene que hacer el cliente para pagar este pedido, según el medio elegido. */
export default function PaymentPanel({ order: o }) {
  const { config, reportTransfer, payOnline, busy } = useStore();
  const [reference, setReference] = useState("");
  if (o.status === "cancelado") return null;
  if (o.paid)
    return (
      <div className="pay-panel paid">
        <Check size={18} />
        <div>
          <strong>Pago registrado</strong>
          <p>
            {o.paidBy === "saldo a favor"
              ? "Se descontó de tu saldo a favor."
              : `Recibimos tu pago${o.paidAt ? ` el ${new Date(o.paidAt).toLocaleDateString("es-AR")} a las ${timeText(o.paidAt)}` : ""}.`}
          </p>
        </div>
      </div>
    );
  if (o.payment === "cuenta")
    return (
      <div className="pay-panel">
        <Wallet size={18} />
        <div>
          <strong>A cuenta corriente</strong>
          <p>
            {money(o.total)} se suman a tu cuenta. Podés pagar al repartidor o
            coordinar con administración.
          </p>
        </div>
      </div>
    );
  if (o.payment === "entrega")
    return (
      <div className="pay-panel">
        <Banknote size={18} />
        <div>
          <strong>Pagás en efectivo al recibir</strong>
          <p>
            Tené {money(o.total)} listos para {o.driver || "el repartidor"}.
            {o.weighed
              ? ""
              : " El importe final se ajusta con el peso de balanza."}
          </p>
        </div>
      </div>
    );
  if (o.payment === "mercadopago")
    return (
      <div className="pay-panel highlight">
        <Wallet size={18} />
        <div>
          <strong>Pagá online con Mercado Pago</strong>
          <p>
            Tarjeta, dinero en cuenta o QR. Te confirmamos automáticamente
            cuando se acredita.
          </p>
          <button
            className="primary"
            disabled={busy || !config?.mercadopago}
            onClick={() => payOnline(o)}
          >
            Pagar {money(o.total)} <ExternalLink size={15} />
          </button>
        </div>
      </div>
    );
  // Transferencia
  const t = config?.transfer;
  return (
    <div className="pay-panel highlight">
      <Wallet size={18} />
      <div>
        <strong>Transferí {money(o.total)}</strong>
        {t ? (
          <>
            <div className="copy-fields">
              <CopyField label="Alias" value={t.alias} />
              {t.cvu && <CopyField label="CVU / CBU" value={t.cvu} />}
              {t.holder && <CopyField label="Titular" value={t.holder} />}
              <CopyField label="Importe" value={String(o.total)} />
            </div>
            {o.transfer ? (
              <p className="pay-status">
                <Clock size={14} /> Avisaste a las{" "}
                {timeText(o.transfer.reportedAt)}
                {o.transfer.reference ? ` (ref. ${o.transfer.reference})` : ""}.
                Administración confirma el pago al verlo acreditado.
              </p>
            ) : (
              <form
                className="pay-report"
                onSubmit={(e) => {
                  e.preventDefault();
                  reportTransfer(o, reference);
                }}
              >
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength="60"
                  placeholder="Nº de operación o comprobante (opcional)"
                  aria-label="Referencia de la transferencia"
                />
                <button className="primary" disabled={busy}>
                  Ya transferí <Check size={15} />
                </button>
              </form>
            )}
          </>
        ) : (
          <p>
            El negocio todavía no cargó su alias. Pagá al recibir o escribinos
            por WhatsApp.
          </p>
        )}
      </div>
    </div>
  );
}
