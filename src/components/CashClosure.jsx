import React, { useEffect, useState } from "react";
import { Lock, Check, AlertTriangle } from "lucide-react";
import { api, post } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { money, timeText } from "../lib/format.js";

/**
 * Cierre de caja de un repartidor en una fecha: lo que la hoja de ruta dice que debe rendir
 * en efectivo contra lo que administración recibió. Queda guardado con quién y cuándo lo cerró
 * (y en audit_log); se puede corregir volviendo a cerrar.
 */
export default function CashClosure({ sheet, date, driver }) {
  const { notify } = useStore();
  const [closures, setClosures] = useState([]);
  const [received, setReceived] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () =>
    api("/closures?date=" + date)
      .then(setClosures)
      .catch(() => setClosures([]));
  useEffect(() => {
    load();
  }, [date]);
  const mine = closures.find((c) => c.driver === driver);
  useEffect(() => {
    setReceived(mine ? String(mine.received) : "");
    setNote(mine?.note || "");
  }, [mine?.id, mine?.at, driver]);
  const expected = sheet.toSettle;
  const value = Number(String(received).replace(",", "."));
  const diff = Number.isFinite(value)
    ? Math.round((value - expected) * 100) / 100
    : null;
  const changed =
    !mine || mine.received !== value || (mine.note || "") !== note;
  async function close(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/closures", {
        date,
        driver,
        expected,
        received: value,
        transfers: sheet.transfers + sheet.accountTransfers,
        accountCash: sheet.accountCash,
        note,
      });
      await load();
      notify(`Caja de ${driver} cerrada.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel cash-closure">
      <div className="section-line">
        <h2>
          <Lock size={17} /> Cierre de caja · {driver}
        </h2>
        <span className="muted">
          Efectivo que debía rendir según la hoja vs. lo recibido
        </span>
      </div>
      <form className="closure-form" onSubmit={close}>
        <div className="closure-figure">
          <span>Debe rendir (efectivo)</span>
          <strong>{money(expected)}</strong>
        </div>
        <label>
          Efectivo recibido
          <input
            inputMode="decimal"
            value={received}
            onChange={(e) => setReceived(e.target.value)}
            placeholder="0"
            required
            pattern="[0-9]+([.,][0-9]{1,2})?"
            aria-label={"Efectivo recibido de " + driver}
          />
        </label>
        <div className="closure-figure">
          <span>Diferencia</span>
          <strong
            className={
              diff === null ? "" : diff < 0 ? "red" : diff > 0 ? "green" : ""
            }
          >
            {diff === null
              ? "—"
              : diff === 0
                ? "Sin diferencia"
                : (diff > 0 ? "+" : "−") + money(Math.abs(diff))}
          </strong>
        </div>
        <label className="wide">
          Nota <small>(opcional)</small>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength="300"
            placeholder="Faltante justificado, vuelto, etc."
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || !Number.isFinite(value) || !changed}
        >
          <Check size={15} /> {mine ? "Corregir cierre" : "Cerrar caja"}
        </button>
      </form>
      {mine && (
        <p
          className={
            "closure-state " + (mine.received < mine.expected ? "warn" : "")
          }
        >
          {mine.received < mine.expected ? (
            <AlertTriangle size={14} />
          ) : (
            <Check size={14} />
          )}{" "}
          Cerrada por {mine.by} a las {timeText(mine.at)} · esperado{" "}
          {money(mine.expected)} · recibido {money(mine.received)}
          {mine.transfers ? ` · transferencias ${money(mine.transfers)}` : ""}
        </p>
      )}
      {closures.filter((c) => c.driver !== driver).length > 0 && (
        <p className="muted small">
          Otros cierres del día:{" "}
          {closures
            .filter((c) => c.driver !== driver)
            .map(
              (c) =>
                `${c.driver} ${money(c.received)} (${c.received === c.expected ? "sin diferencia" : (c.received > c.expected ? "+" : "−") + money(Math.abs(c.received - c.expected))})`,
            )
            .join(" · ")}
        </p>
      )}
    </section>
  );
}
