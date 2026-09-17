import React, { useState } from "react";
import { Wallet, Package } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money } from "../lib/format.js";

/**
 * Ajuste a mano del saldo de cuenta corriente y del saldo de cajas de un cliente (equipo).
 * Se escribe el saldo REAL; la app guarda la diferencia como ajuste con fecha y quién lo hizo.
 */
export default function Saldos({ customer: c }) {
  const { saveBalances, busy, setModal } = useStore();
  const current = c.summary || { balance: 0, boxes: 0 };
  const [balance, setBalance] = useState(String(current.balance ?? 0));
  const [boxes, setBoxes] = useState(String(current.boxes ?? 0));
  const [note, setNote] = useState("");
  const parse = (v) => Number(String(v).trim().replace(",", "."));
  const nb = parse(balance);
  const nx = parse(boxes);
  const valid =
    Number.isFinite(nb) && Number.isInteger(nx) && nx >= -10000 && nx <= 10000;
  const changed =
    Math.round(nb * 100) !== Math.round((current.balance || 0) * 100) ||
    nx !== (current.boxes || 0);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || !changed) return;
        if (await saveBalances(c, { balance: nb, boxes: nx, note }))
          setModal(null);
      }}
    >
      <span className="eyebrow">SALDOS</span>
      <h2>{c.name}</h2>
      <p className="muted">
        Escribí el saldo real. La diferencia con lo que calcula la app queda
        registrada como ajuste (quién, cuándo y motivo).
      </p>
      <div className="qo-grid">
        <label>
          <Wallet size={13} /> Saldo de cuenta corriente ($)
          <input
            type="text"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            aria-label="Saldo de cuenta corriente"
          />
          <small className="muted">
            Ahora: {money(current.balance || 0)}
            {current.balance < 0 ? " a favor del cliente" : ""}. Negativo =
            saldo a favor.
          </small>
        </label>
        <label>
          <Package size={13} /> Saldo de cajas (adeudadas)
          <input
            type="text"
            inputMode="numeric"
            value={boxes}
            onChange={(e) => setBoxes(e.target.value)}
            aria-label="Saldo de cajas"
          />
          <small className="muted">Ahora: {current.boxes || 0}.</small>
        </label>
        <label className="wide">
          Motivo <small>(opcional)</small>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength="200"
            placeholder="Saldo inicial, cajas contadas en el local…"
          />
        </label>
      </div>
      {!valid && (
        <p className="form-error" role="alert">
          Saldo en pesos (puede tener decimales) y cajas en número entero.
        </p>
      )}
      <button className="primary full" disabled={busy || !valid || !changed}>
        {busy ? "Guardando…" : "Guardar saldos"}
      </button>
    </form>
  );
}
