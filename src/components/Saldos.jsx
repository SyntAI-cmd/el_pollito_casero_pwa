import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Wallet,
  Package,
  Plus,
  Minus,
  Check,
  X,
  Save,
  RotateCcw,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money, dateText } from "../lib/format.js";
import { ledger } from "../lib/ledger.js";
import { modalGuard } from "../lib/guard.js";

const parse = (v) =>
  Number(
    String(v ?? "")
      .trim()
      .replace(",", "."),
  );
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Saldos de un cliente: dinero y cajas, cada uno por su lado.
 *
 * Se pueden hacer varias correcciones seguidas sin que la ventana se cierre: cada una entra
 * en una lista de "cambios pendientes" que muestra el estado anterior y el resultado previsto.
 * Recién al tocar "Guardar estado" se envía todo junto, en una sola operación (ni a medias ni
 * duplicada, aunque se reintente). Después de guardar la ventana sigue abierta.
 */
export default function Saldos({ customer }) {
  const { saveBalances, busy, setModal, orders, customers, formError } =
    useStore();
  // Ficha fresca: después de guardar, los saldos de arriba tienen que mostrar lo nuevo.
  const c = customers.find((x) => x.phone === customer.phone) || customer;
  const actual = c.summary || { balance: 0, boxes: 0 };

  const [saveError, setSaveError] = useState("");
  const saving = useRef(false);
  const [tab, setTab] = useState("dinero");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pendientes, setPendientes] = useState([]);
  const [guardado, setGuardado] = useState(false);
  const [preguntando, setPreguntando] = useState(false);
  const opId = useRef(crypto.randomUUID().slice(0, 20));

  const n = parse(amount);
  const esDinero = tab === "dinero";
  const valido = esDinero
    ? Number.isFinite(n) && n > 0 && n <= 100000000
    : Number.isInteger(n) && n > 0 && n <= 10000;

  const deltaDinero = r2(
    pendientes.filter((p) => p.kind === "dinero").reduce((s, p) => s + p.n, 0),
  );
  const deltaCajas = pendientes
    .filter((p) => p.kind === "cajas")
    .reduce((s, p) => s + p.n, 0);
  const hayCambios = pendientes.length > 0;
  const previstoDinero = r2((actual.balance || 0) + deltaDinero);
  const previstoCajas = (actual.boxes || 0) + deltaCajas;

  // Con cambios sin guardar, cerrar la ventana pregunta primero.
  useEffect(() => {
    modalGuard.check = () => {
      if (busy || saving.current) return false;
      if (!hayCambios && !amount.trim()) return true;
      setPreguntando(true);
      return false;
    };
    return () => {
      modalGuard.check = null;
    };
  }, [hayCambios, amount, busy]);

  const moves = useMemo(
    () =>
      ledger(
        orders.filter((o) => o.customer === c.phone),
        c.payments || [],
        c.balanceAdjustments || [],
      )
        .reverse()
        .slice(0, 4),
    [orders, c],
  );

  function agregar(signo) {
    if (!valido || busy) return;
    if (!esDinero && signo < 0 && n > previstoCajas) {
      setSaveError("La devolución supera las cajas pendientes.");
      return;
    }
    setSaveError("");
    setPendientes((l) => [
      ...l,
      {
        id: crypto.randomUUID().slice(0, 8),
        kind: tab,
        n: signo * n,
        note: note.trim(),
      },
    ]);
    setAmount("");
    setGuardado(false);
  }
  const quitar = (id) => setPendientes((l) => l.filter((p) => p.id !== id));

  async function guardar() {
    if (!hayCambios || busy || saving.current) return;
    if (amount.trim()) {
      setSaveError("Agregá o borrá el importe escrito antes de guardar.");
      return;
    }
    if (previstoCajas < 0) {
      setSaveError("El saldo de cajas no puede ser negativo.");
      return;
    }
    setSaveError("");
    const notas = [...new Set(pendientes.map((p) => p.note).filter(Boolean))];
    const data = { opId: opId.current };
    if (deltaDinero !== 0) data.delta = deltaDinero;
    if (deltaCajas !== 0) data.boxesDelta = deltaCajas;
    if (notas.length) data.note = notas.join(" · ").slice(0, 200);
    if (!data.delta && !data.boxesDelta) {
      setPendientes([]);
      setGuardado(true);
      return;
    }
    saving.current = true;
    const ok = await saveBalances(c, data);
    saving.current = false;
    if (!ok)
      setSaveError(
        "No se pudo confirmar el guardado. Tus cambios siguen acá; podés reintentar.",
      );
    // Si falla, lo escrito no se pierde: los cambios pendientes quedan como estaban.
    if (ok) {
      setPendientes([]);
      setNote("");
      setGuardado(true);
      opId.current = crypto.randomUUID().slice(0, 20);
    }
  }

  const etiqueta = (p) =>
    p.kind === "dinero"
      ? `${p.n > 0 ? "Suma deuda" : "Resta deuda"} ${money(Math.abs(p.n))}`
      : `${p.n > 0 ? "Suma" : "Devolvió"} ${Math.abs(p.n)} ${Math.abs(p.n) === 1 ? "caja" : "cajas"}`;

  return (
    <div className="saldos-edit">
      <div>
        <span className="eyebrow">SALDOS</span>
        <h2>{c.name}</h2>
      </div>

      {/* Estado anterior · cambios pendientes · resultado previsto */}
      <div className="saldos-state" aria-label="Estado de la cuenta">
        <div>
          <small>Estado anterior</small>
          <strong className={actual.balance > 0 ? "red" : ""}>
            {money(actual.balance || 0)}
          </strong>
          <small>
            {actual.boxes || 0} {actual.boxes === 1 ? "caja" : "cajas"}
          </small>
        </div>
        <div>
          <small>Cambios pendientes</small>
          <strong>
            {deltaDinero === 0
              ? "—"
              : (deltaDinero > 0 ? "+" : "−") + money(Math.abs(deltaDinero))}
          </strong>
          <small>
            {deltaCajas === 0
              ? "sin cajas"
              : `${deltaCajas > 0 ? "+" : "−"}${Math.abs(deltaCajas)} cajas`}
          </small>
        </div>
        <div className={hayCambios ? "previsto" : ""}>
          <small>Resultado previsto</small>
          <strong className={previstoDinero > 0 ? "red" : ""}>
            {money(previstoDinero)}
          </strong>
          <small>
            {previstoCajas} {previstoCajas === 1 ? "caja" : "cajas"}
          </small>
        </div>
      </div>

      <div className="saldos-tabs" role="tablist" aria-label="Qué corregir">
        <button
          type="button"
          role="tab"
          aria-selected={esDinero}
          onClick={() => {
            setTab("dinero");
            setAmount("");
          }}
        >
          <Wallet size={15} /> Saldo monetario
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!esDinero}
          onClick={() => {
            setTab("cajas");
            setAmount("");
          }}
        >
          <Package size={15} /> Cajas
        </button>
      </div>

      <div className="saldos-entry">
        <label>
          {esDinero ? "Importe" : "Cantidad de cajas"}
          <input
            type="text"
            inputMode={esDinero ? "decimal" : "numeric"}
            enterKeyHint="done"
            autoFocus
            placeholder="0"
            disabled={busy}
            value={amount}
            onChange={(e) =>
              setAmount(
                e.target.value.replace(esDinero ? /[^\d.,]/g : /[^\d]/g, ""),
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregar(+1);
              }
            }}
            aria-label={esDinero ? "Importe" : "Cantidad de cajas"}
          />
        </label>
        <input
          className="wallet-note"
          disabled={busy}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength="200"
          placeholder="Motivo (opcional): saldo inicial, arreglo, conteo…"
          aria-label="Motivo"
        />
        <div className="saldos-entry-row">
          <button
            type="button"
            className="secondary"
            disabled={!valido || busy}
            onClick={() => agregar(+1)}
          >
            <Plus size={16} /> {esDinero ? "Suma deuda" : "Suma cajas"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!valido || busy}
            onClick={() => agregar(-1)}
          >
            <Minus size={16} /> {esDinero ? "Resta deuda" : "Devolvió cajas"}
          </button>
        </div>
        <p className="muted small">
          {esDinero
            ? "“Suma deuda” aumenta el saldo; “resta deuda” lo baja (saldo a favor, nota de crédito). Los cobros de pedidos se registran desde el pedido."
            : "Las cajas se cuentan aparte del dinero. Acá se corrige el conteo; las entregas y devoluciones de cada pedido se cargan desde el pedido."}
        </p>
      </div>

      {hayCambios && (
        <div className="saldos-pending">
          <h3>Cambios pendientes de guardar</h3>
          <ul>
            {pendientes.map((p) => (
              <li key={p.id}>
                <span>
                  {etiqueta(p)}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
                <button
                  type="button"
                  className="link-button"
                  aria-label={"Quitar " + etiqueta(p)}
                  disabled={busy}
                  onClick={() => quitar(p.id)}
                >
                  <X size={14} /> quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {saveError && (
        <p role="alert" className="saldos-error">
          {saveError}
        </p>
      )}
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      {guardado && !hayCambios && (
        <p className="saldos-saved" role="status">
          <Check size={16} /> Guardado. Podés seguir corrigiendo.
        </p>
      )}

      <div className="saldos-actions">
        <button
          type="button"
          className="primary"
          disabled={!hayCambios || busy}
          onClick={guardar}
        >
          <Save size={16} /> Guardar estado
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            hayCambios || amount.trim() ? setPreguntando(true) : setModal(null)
          }
        >
          Cerrar
        </button>
      </div>

      {preguntando && (
        <div className="saldos-pending" role="alertdialog">
          <h3>Tenés cambios sin guardar</h3>
          <div className="saldos-entry-row">
            <button
              type="button"
              className="secondary"
              onClick={() => setPreguntando(false)}
            >
              <RotateCcw size={15} /> Seguir editando
            </button>
            <button
              type="button"
              className="link-button danger"
              onClick={() => {
                setPendientes([]);
                setPreguntando(false);
                modalGuard.check = null;
                setModal(null);
              }}
            >
              Descartar y cerrar
            </button>
          </div>
        </div>
      )}

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
      {(c.boxAdjustments || []).length > 0 && (
        <section className="wallet-moves">
          <h3>Últimas correcciones de cajas</h3>
          <ul>
            {[...c.boxAdjustments]
              .reverse()
              .slice(0, 3)
              .map((a) => (
                <li key={a.id}>
                  <span>
                    <b>{a.boxes > 0 ? "Suma" : "Devolución"}</b> ·{" "}
                    {dateText(a.at)}
                    <small>
                      {a.by}
                      {a.note ? ` · ${a.note}` : ""}
                    </small>
                  </span>
                  <strong>
                    {a.boxes > 0 ? "+" : "−"}
                    {Math.abs(a.boxes)}
                  </strong>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
