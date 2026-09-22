import React, { useState } from "react";
import { Wallet, Package, ArrowDown, ArrowUp } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money, dateText } from "../lib/format.js";
import { ledger } from "../lib/ledger.js";

const parse = (v) =>
  Number(
    String(v ?? "")
      .trim()
      .replace(",", "."),
  );

/**
 * Saldos de un cliente, estilo billetera: saldo actual en grande, importe y dos acciones claras
 * (registrar deuda / agregar saldo a favor). Debajo, los últimos movimientos y las cajas.
 * Cada carga queda como ajuste con fecha, autor y motivo.
 */
export default function Saldos({ customer: c }) {
  const { saveBalances, busy, setModal, orders, formError } = useStore();
  const current = c.summary || { balance: 0, boxes: 0 };
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [boxes, setBoxes] = useState("");
  const n = parse(amount);
  const valid = Number.isFinite(n) && n > 0 && n <= 100000000;
  const nb = parse(boxes);
  const boxesValid = Number.isInteger(nb) && nb > 0 && nb <= 10000;
  const moves = ledger(
    orders.filter((o) => o.customer === c.phone),
    c.payments || [],
    c.balanceAdjustments || [],
  )
    .reverse()
    .slice(0, 3);
  const apply = async (sign) => {
    if (!valid || busy) return;
    if (await saveBalances(c, { delta: sign * n, note })) setModal(null);
  };
  const applyBoxes = async (sign) => {
    if (!boxesValid || busy) return;
    if (await saveBalances(c, { boxesDelta: sign * nb, note })) setModal(null);
  };
  return (
    <div className="wallet">
      <span className="eyebrow">SALDOS</span>
      <h2>{c.name}</h2>
      <div className="wallet-balance">
        <small>Saldo actual</small>
        {current.balance === 0 && !current.boxes && (
          <span className="al-dia">Al día · sin deuda ni cajas</span>
        )}
        <strong
          className={
            current.balance > 0 ? "red" : current.balance < 0 ? "green" : ""
          }
        >
          {current.balance < 0
            ? `${money(-current.balance)} a favor`
            : money(current.balance || 0)}
        </strong>
        <span className="muted">
          <Package size={13} /> {current.boxes || 0}{" "}
          {current.boxes === 1 ? "caja adeudada" : "cajas adeudadas"}
        </span>
      </div>
      <label className="wallet-amount">
        Importe
        <input
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoFocus
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
          aria-label="Importe"
        />
      </label>
      <input
        className="wallet-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength="200"
        placeholder="Motivo (opcional): saldo inicial, arreglo, cajas contadas…"
        aria-label="Motivo"
      />
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <div className="wallet-actions">
        <button
          type="button"
          className="primary"
          disabled={!valid || busy}
          onClick={() => apply(+1)}
        >
          <ArrowUp size={16} /> Registrar deuda
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!valid || busy}
          onClick={() => apply(-1)}
        >
          <ArrowDown size={16} /> Agregar saldo a favor
        </button>
      </div>
      <p className="muted small">
        Deuda: suma al saldo. Saldo a favor: resta (un pago, una nota de crédito
        o un saldo inicial a favor). Los cobros de pedidos se registran desde el
        pedido, no acá.
      </p>
      <section className="wallet-moves">
        <h3>Últimos movimientos</h3>
        {moves.length === 0 ? (
          <p className="muted small">Sin movimientos todavía.</p>
        ) : (
          <ul>
            {moves.map((m) => (
              <li key={m.ref + m.at}>
                <span>
                  <b>{m.kind}</b> · {dateText(m.at)}
                  <small>{m.label}</small>
                </span>
                <strong className={m.amount > 0 ? "red" : "green"}>
                  {m.amount > 0 ? "+" : "−"}
                  {money(Math.abs(m.amount))}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="wallet-boxes">
        <h3>
          <Package size={15} /> Cajas
        </h3>
        <div className="wallet-boxes-row">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Cantidad"
            value={boxes}
            onChange={(e) => setBoxes(e.target.value.replace(/[^\d]/g, ""))}
            aria-label="Cantidad de cajas"
          />
          <button
            type="button"
            className="secondary small"
            disabled={!boxesValid || busy}
            onClick={() => applyBoxes(+1)}
          >
            Suma cajas adeudadas
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={!boxesValid || busy}
            onClick={() => applyBoxes(-1)}
          >
            Devolvió cajas
          </button>
        </div>
      </section>
      <button
        type="button"
        className="link-button"
        onClick={() => setModal(null)}
      >
        Cerrar
      </button>
    </div>
  );
}
