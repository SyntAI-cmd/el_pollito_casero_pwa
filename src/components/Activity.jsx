import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { dateText, timeText } from "../lib/format.js";

export default function Activity({ entity = "orders", id, revision }) {
  const [state, setState] = useState({ movimientos: [], siguiente: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const base = `/${entity}/${encodeURIComponent(id)}/movimientos`;
  useEffect(() => {
    let active = true;
    setError("");
    api(base)
      .then((data) => {
        if (active) setState(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, revision]);
  return (
    <details className="od-block">
      <summary>Quién hizo cada cambio</summary>
      {error && <p role="alert">{error}</p>}
      {!state.movimientos.length && !error && (
        <p className="muted small">Sin movimientos registrados.</p>
      )}
      <ul className="wallet-moves">
        {state.movimientos.map((m) => (
          <li key={m.id}>
            <strong>{m.actor || "Sistema"}</strong> · ID:{" "}
            {m.actorId || "No registrado (histórico)"}
            <small>
              {" "}
              · {dateText(m.at)} {timeText(m.at)} · {m.accion}
            </small>
            {m.motivo && <p>{m.motivo}</p>}
          </li>
        ))}
      </ul>
      {state.siguiente && (
        <button
          type="button"
          className="secondary"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              const next = await api(`${base}?cursor=${state.siguiente}`);
              setState((prev) => ({
                movimientos: [...prev.movimientos, ...next.movimientos],
                siguiente: next.siguiente,
              }));
            } catch (e) {
              setError(e.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          Ver movimientos anteriores
        </button>
      )}
    </details>
  );
}
