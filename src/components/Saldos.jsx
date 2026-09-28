import Activity from "./Activity.jsx";
import Receipts from "./Receipts.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Wallet, Package, Check, Save } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money, dateText } from "../lib/format.js";
import { ledger } from "../lib/ledger.js";
import { modalGuard } from "../lib/guard.js";
import { useFieldVisibility } from "../lib/media.js";
import { businessDate as todayKey } from "../lib/businessDate.js";
import Teclado, {
  useTecladoApp,
  CambiarTeclado,
  aplicarTecla,
} from "./Teclado.jsx";

const parse = (v) =>
  Number(
    String(v ?? "")
      .trim()
      .replace(",", "."),
  );
const r2 = (n) => Math.round(n * 100) / 100;
/** "$ 5.000" si debe, "$ 5.000 a favor" si es crédito del cliente, "al día" en cero. */
const deudaText = (n) =>
  n > 0 ? money(n) : n < 0 ? `${money(-n)} a favor` : "al día";

/**
 * Saldos de un cliente, en una sola pantalla y sin pasos intermedios.
 *
 * Dinero (el cliente debe = deuda anterior + pedidos a cuenta sin entregar):
 *  - "Cobró": registra un pago. Cancela pedidos (del más viejo al más nuevo) y lo que sobra
 *    queda a favor. Es la forma correcta de cargar cualquier cobro.
 *  - "Corregir deuda anterior": se escribe lo que el cliente debía ANTES de los pedidos en
 *    curso (saldo inicial, arreglo, error). La app guarda la diferencia como ajuste firmado.
 *    Nunca toca los pedidos del día, así el remito y la hoja de ruta los siguen cobrando.
 * Cajas: "Devolvió" o "Contar cajas" (conteo físico). Cada acción se guarda al tocar el botón.
 */
export default function Saldos({ customer, order, initialTab = "dinero" }) {
  const ensureFieldVisible = useFieldVisibility();
  const {
    saveBalances,
    registerPayment,
    busy,
    setModal,
    orders,
    customers,
    formError,
  } = useStore();
  // Ficha fresca: después de guardar, los saldos de arriba tienen que mostrar lo nuevo.
  const c = customers.find((x) => x.phone === customer.phone) || customer;
  const actual = c.summary || { balance: 0, boxes: 0 };

  const { tecladoApp, cambiar } = useTecladoApp("teclado-saldos");
  const [tab, setTab] = useState(initialTab);
  // Dinero: "cobro" o "deuda"; cajas: "devolvio" o "total".
  const [accion, setAccion] = useState(
    initialTab === "cajas" ? "devolvio" : "cobro",
  );
  const [amount, setAmount] = useState("");
  const [aFavor, setAFavor] = useState(false);
  const [method, setMethod] = useState("efectivo");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");
  const saving = useRef(false);
  const opId = useRef(crypto.randomUUID().slice(0, 20));

  const [receiptOrderId, setReceiptOrderId] = useState(order?.id || "");
  const customerOrders = orders.filter(
    (o) => o.customer === c.phone && o.status !== "cancelado",
  );
  const receiptOrder =
    customerOrders.find((o) => o.id === receiptOrderId) ||
    order ||
    customerOrders[0];

  // Lo que debe hoy se parte en dos: lo de antes y los pedidos a cuenta que todavía viajan.
  const total = r2(actual.balance || 0);
  // "En curso" = pedidos a cuenta de hoy en adelante. Por fecha, no por estado: si nadie
  // confirma las entregas, un pedido de hace una semana no es "de hoy".
  const hoy = todayKey();
  const enCurso = r2(
    customerOrders
      .filter(
        (o) =>
          o.payment === "cuenta" &&
          !o.paid &&
          (o.deliveryDate || o.created.slice(0, 10)) >= hoy,
      )
      .reduce((s, o) => s + (o.total || 0), 0),
  );
  const anterior = r2(total - enCurso);
  const cajas = actual.boxes || 0;

  const esDinero = tab === "dinero";
  const n = parse(amount);
  const escrito = amount.trim() !== "";
  const valido =
    escrito &&
    (esDinero
      ? Number.isFinite(n) &&
        n >= (accion === "deuda" ? 0 : 0.01) &&
        n <= 100000000
      : Number.isInteger(n) && n >= 0 && n <= 10000);

  // Resultado de la acción, antes de guardarla.
  const nuevaAnterior = aFavor ? -n : n;
  const resultado = !valido
    ? null
    : esDinero
      ? accion === "cobro"
        ? { dinero: r2(total - n) }
        : { dinero: r2(total + nuevaAnterior - anterior) }
      : accion === "devolvio"
        ? { cajas: cajas - n }
        : { cajas: n };
  const sinCambio =
    !!resultado &&
    ((esDinero && accion === "deuda" && nuevaAnterior === anterior) ||
      (!esDinero && accion === "total" && n === cajas) ||
      (!esDinero && accion === "devolvio" && n === 0));
  const excede = valido && !esDinero && accion === "devolvio" && n > cajas;

  // Con un importe escrito sin guardar, cerrar la ventana pregunta primero.
  useEffect(() => {
    modalGuard.check = () => {
      if (busy || saving.current) return false;
      if (!escrito) return true;
      return window.confirm(
        "Escribiste un importe sin guardar. ¿Cerrar igual?",
      );
    };
    return () => {
      modalGuard.check = null;
    };
  }, [escrito, busy]);

  const moves = useMemo(
    () =>
      ledger(
        orders.filter((o) => o.customer === c.phone),
        c.payments || [],
        c.balanceAdjustments || [],
      )
        .reverse()
        .slice(0, 5),
    [orders, c],
  );

  function limpiar() {
    setAmount("");
    setAFavor(false);
    setNote("");
    setError("");
  }
  function elegir(nextTab, nextAccion) {
    setTab(nextTab);
    if (nextAccion) setAccion(nextAccion);
    limpiar();
    setHecho("");
  }

  async function guardar() {
    if (!valido || sinCambio || excede || busy || saving.current) return;
    setError("");
    saving.current = true;
    let ok;
    let aviso;
    if (esDinero && accion === "cobro") {
      ok = await registerPayment(c, {
        amount: n,
        method,
        note: note.trim() || undefined,
      });
      aviso = `Cobro de ${money(n)} registrado.`;
    } else {
      // Se manda el estado que se tenía a la vista: si otro lo cambió, el servidor avisa.
      const data = {
        opId: opId.current,
        esperado: { balance: total, boxes: cajas },
      };
      if (esDinero) {
        data.delta = r2(nuevaAnterior - anterior);
        data.note = note.trim() || "Corrección de deuda anterior";
        aviso = `Deuda anterior corregida: ${deudaText(nuevaAnterior)}.`;
      } else {
        data.boxesDelta = accion === "devolvio" ? -n : n - cajas;
        data.note =
          note.trim() ||
          (accion === "devolvio" ? "Devolución de cajas" : "Conteo de cajas");
        aviso =
          accion === "devolvio"
            ? `Devolvió ${n} ${n === 1 ? "caja" : "cajas"}.`
            : `Cajas corregidas: tiene ${n}.`;
      }
      ok = await saveBalances(c, data);
    }
    saving.current = false;
    if (ok) {
      limpiar();
      setHecho(aviso);
      opId.current = crypto.randomUUID().slice(0, 20);
    } else
      setError(
        "No se guardó. Lo escrito sigue acá: mirá el aviso, revisá los números y reintentá.",
      );
  }

  const opciones = esDinero
    ? [
        ["cobro", "Cobró", "El cliente pagó (efectivo, transferencia, cheque)"],
        [
          "deuda",
          "Corregir deuda anterior",
          "Saldo inicial o arreglo: lo que debía antes de los pedidos en curso",
        ],
      ]
    : [
        ["devolvio", "Devolvió cajas", "Cajas vacías que trajo de vuelta"],
        ["total", "Contar cajas", "Cuántas cajas tiene en total ahora"],
      ];

  return (
    <div className="saldos-edit">
      <div>
        <span className="eyebrow">SALDOS</span>
        <h2>{c.name}</h2>
      </div>

      {/* Estado: cuánto debe y de dónde sale; cajas aparte */}
      <div className="saldos-state" aria-label="Estado de la cuenta">
        <div>
          <small>Debe en total</small>
          <strong className={total > 0 ? "red" : total < 0 ? "green" : ""}>
            {deudaText(total)}
          </strong>
          {enCurso !== 0 && (
            <small>
              Anterior {deudaText(anterior)} + pedidos sin entregar{" "}
              {money(enCurso)}
            </small>
          )}
        </div>
        <div>
          <small>Cajas en su poder</small>
          <strong>{cajas}</strong>
          <small>{cajas === 1 ? "caja" : "cajas"}</small>
        </div>
        {resultado && !sinCambio && !excede && (
          <div className="previsto">
            <small>Después de guardar</small>
            <strong>
              {"dinero" in resultado
                ? deudaText(resultado.dinero)
                : `${resultado.cajas} ${resultado.cajas === 1 ? "caja" : "cajas"}`}
            </strong>
            <small>
              {"dinero" in resultado ? "debe en total" : "en su poder"}
            </small>
          </div>
        )}
      </div>

      <div className="saldos-tabs" role="tablist" aria-label="Qué cargar">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "dinero"}
          onClick={() => elegir("dinero", "cobro")}
        >
          <Wallet size={15} /> Dinero
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "cajas"}
          onClick={() => elegir("cajas", "devolvio")}
        >
          <Package size={15} /> Cajas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "comprobantes"}
          onClick={() => elegir("comprobantes")}
        >
          Comprobantes
        </button>
      </div>

      {tab === "comprobantes" ? (
        <section aria-label="Comprobantes del cliente">
          {customerOrders.length > 1 && (
            <label>
              Pedido
              <select
                value={receiptOrder?.id || ""}
                onChange={(e) => setReceiptOrderId(e.target.value)}
              >
                {customerOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {String(o.number || o.id)} · {o.deliveryDate}
                  </option>
                ))}
              </select>
            </label>
          )}
          {receiptOrder ? (
            <Receipts key={receiptOrder.id} order={receiptOrder} />
          ) : (
            <p>Para adjuntar comprobantes, abrí un pedido de este cliente.</p>
          )}
        </section>
      ) : (
        <div className="saldos-entry">
          <div
            className="saldos-entry-row"
            role="radiogroup"
            aria-label="Acción"
          >
            {opciones.map(([k, label, hint]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={accion === k}
                className={accion === k ? "primary" : "secondary"}
                title={hint}
                disabled={busy}
                onClick={() => {
                  setAccion(k);
                  limpiar();
                  setHecho("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            {esDinero
              ? accion === "cobro"
                ? "Importe que pagó"
                : "Deuda anterior real (sin los pedidos en curso)"
              : accion === "devolvio"
                ? "Cajas que devolvió"
                : "Cajas que tiene en total"}
            <input
              type="text"
              /* Con el teclado de la app, el del teléfono no aparece: se ve lo que se escribe. */
              inputMode={tecladoApp ? "none" : esDinero ? "decimal" : "numeric"}
              enterKeyHint="done"
              autoFocus
              placeholder={
                esDinero && accion === "deuda"
                  ? String(Math.abs(anterior))
                  : "0"
              }
              disabled={busy}
              onFocus={tecladoApp ? undefined : ensureFieldVisible}
              value={amount}
              onChange={(e) =>
                setAmount(
                  e.target.value.replace(esDinero ? /[^\d.,]/g : /[^\d]/g, ""),
                )
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  guardar();
                }
              }}
              aria-label={esDinero ? "Importe" : "Cantidad de cajas"}
            />
          </label>
          {esDinero && accion === "cobro" && (
            <label>
              Medio
              <select
                value={method}
                disabled={busy}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="cheque">Cheque</option>
              </select>
            </label>
          )}
          {esDinero && accion === "deuda" && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={aFavor}
                disabled={busy}
                onChange={(e) => setAFavor(e.target.checked)}
              />{" "}
              Es saldo a favor del cliente (no debe: le debemos)
            </label>
          )}
          <CambiarTeclado tecladoApp={tecladoApp} cambiar={cambiar} />
          {tecladoApp && (
            <Teclado
              decimales={esDinero}
              vacio={amount === ""}
              etiqueta={
                esDinero ? "Teclado para el importe" : "Teclado para las cajas"
              }
              onTecla={(k) =>
                setAmount((v) =>
                  aplicarTecla(v, k, {
                    maxDecimales: esDinero ? 2 : 0,
                    maxLargo: esDinero ? 11 : 5,
                  }),
                )
              }
            />
          )}
          <input
            className="wallet-note"
            disabled={busy}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength="200"
            placeholder={
              esDinero && accion === "cobro"
                ? "Nota (opcional): recibo, comprobante…"
                : "Motivo (opcional): saldo inicial, arreglo, conteo…"
            }
            aria-label="Nota o motivo"
          />
          <p className="muted small">
            {esDinero
              ? accion === "cobro"
                ? "El cobro cancela los pedidos a cuenta del más viejo al más nuevo; si sobra, queda a favor."
                : "Solo cambia la deuda de antes. Los pedidos a cuenta en curso siguen sumando aparte y se cobran en su remito."
              : "Las cajas se cuentan aparte del dinero."}
          </p>
          {excede && (
            <p role="alert" className="saldos-error">
              Tiene {cajas} {cajas === 1 ? "caja" : "cajas"}: no puede devolver{" "}
              {n}.
            </p>
          )}
          {sinCambio && (
            <p className="muted small" role="status">
              Es lo mismo que ya figura: no hay nada que guardar.
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="saldos-error">
          {error}
        </p>
      )}
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      {hecho && !escrito && (
        <p className="saldos-saved" role="status">
          <Check size={16} /> {hecho}
        </p>
      )}

      <div className="saldos-actions">
        {tab !== "comprobantes" && (
          <button
            type="button"
            className="primary"
            disabled={!valido || sinCambio || excede || busy}
            onClick={guardar}
          >
            <Save size={16} />{" "}
            {esDinero
              ? accion === "cobro"
                ? "Registrar cobro"
                : "Guardar deuda anterior"
              : "Guardar cajas"}
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (modalGuard.check?.() !== false) setModal(null);
          }}
        >
          Cerrar
        </button>
      </div>

      <Activity entity="customers" id={c.phone} revision={c} />
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
