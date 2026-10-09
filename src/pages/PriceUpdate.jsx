import React, { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, History, RotateCcw, Check, Loader2 } from "lucide-react";
import { api, post } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { money, normalize } from "../lib/format.js";
import { PageHead } from "../components/ui.jsx";
import SearchField from "../components/SearchField.jsx";
import { Link } from "../lib/router.jsx";

const PAGE = 50;
const STEPS = [
  [0, "Sin redondeo comercial (centavos)"],
  [10, "A múltiplos de $10"],
  [50, "A múltiplos de $50"],
  [100, "A múltiplos de $100"],
];
const planName = {
  mayorista: "mayorista",
  intermedio: "intermedio",
  minorista: "minorista",
};
const kindName = {
  aumento: "Aumento",
  disminucion: "Disminución",
  reversion: "Reversión",
  tarifas: "Listas por cliente",
};
const parseAmount = (v) =>
  Number(
    String(v ?? "")
      .trim()
      .replace(",", "."),
  );
const pct = (v) =>
  v.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const perKg = (v) => `${money(v)}/kg`;
const when = (iso) =>
  new Date(iso).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Mendoza",
  });
export const roundingText = (r) =>
  !r?.step
    ? "Sin redondeo comercial: precios con dos decimales (centavos)."
    : `Redondeo a múltiplos de $${r.step}, ${r.mode === "arriba" ? "siempre hacia arriba" : "al más cercano"}.`;
const sourceText = (i) =>
  i.source === "lista"
    ? `Lista ${planName[i.plan] || i.plan}`
    : i.source === "tarifa"
      ? i.plan.startsWith("lista:")
        ? `Lista ${i.plan.slice(6)}`
        : `Trozado por ${i.plan.slice(8)}`
      : i.customerName || i.customer;
const newId = () =>
  crypto.randomUUID?.() ||
  `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  return online;
}

/** Tabla de precios con buscador por cliente o producto y páginas de 50 filas. */
function PriceRows({ rows, columns, label }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const q = normalize(query);
    return q
      ? rows.filter((r) =>
          normalize(`${sourceText(r)} ${r.product}`).includes(q),
        )
      : rows;
  }, [rows, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE, current * PAGE + PAGE);
  return (
    <div className="pu-rows">
      <SearchField
        value={query}
        onChange={(v) => {
          setQuery(v);
          setPage(0);
        }}
        label={`Buscar en ${label} por cliente o producto`}
        placeholder="Buscar cliente o producto"
        className="pu-search"
      />
      <div className="table-scroll">
        <table className="customers pu-table">
          <thead>
            <tr>
              <th>Fuente</th>
              <th>Producto</th>
              {columns.map(([, title]) => (
                <th key={title} className="num">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr
                key={`${r.source}/${r.plan || r.customer}/${r.productId}/${i}`}
                className={r.error ? "pu-error-row" : ""}
              >
                <td>
                  {r.source === "lista" ? (
                    <strong>{sourceText(r)}</strong>
                  ) : (
                    sourceText(r)
                  )}
                </td>
                <td>{r.product}</td>
                {columns.map(([render, title]) => (
                  <td key={title} className="num">
                    {render(r)}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={columns.length + 2} className="muted">
                  Ningún precio coincide con la búsqueda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pu-pager">
        <span className="muted">
          {filtered.length} {filtered.length === 1 ? "precio" : "precios"}
          {pages > 1 && ` · página ${current + 1} de ${pages}`}
        </span>
        {pages > 1 && (
          <span>
            <button
              type="button"
              className="secondary small"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Anterior
            </button>{" "}
            <button
              type="button"
              className="secondary small"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Siguiente
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

const variation = (r) => {
  if (!r.before) return "";
  const v = (r.final / r.before - 1) * 100;
  return `${v > 0 ? "+" : ""}${pct(v)} %`;
};
const PREVIEW_COLUMNS = [
  [(r) => money(r.before), "Anterior"],
  [(r) => money(r.calc), "Calculado"],
  [
    (r) =>
      r.error ? (
        <span className="pu-bad">{r.error}</span>
      ) : (
        <strong>{money(r.final)}</strong>
      ),
    "Final",
  ],
  [variation, "Variación"],
];

/**
 * Actualización masiva de precios (solo administración): se ingresa cuánto cambia el kilo de pollo,
 * el servidor calcula el porcentaje sobre la referencia y lo aplica una vez a cada lista y a cada
 * precio propio. Vista previa, confirmación, historial y reversión de la última.
 */
export default function PriceUpdate() {
  const { session, notify, refreshConfig } = useStore();
  const online = useOnline();
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [refDraft, setRefDraft] = useState("");
  const [editRef, setEditRef] = useState(false);
  const [direction, setDirection] = useState("aumentar");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState("");
  const [excluded, setExcluded] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [result, setResult] = useState(null);
  const [detail, setDetail] = useState(null);
  const [revert, setRevert] = useState(null);
  const lock = useRef(false);
  const opId = useRef(null);

  const load = () =>
    api("/precios/actualizacion")
      .then((s) => {
        setState(s);
        setExcluded((x) => x ?? s.lastExcluded);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // Cualquier cambio en los datos de la operación invalida la vista previa.
  const params = {
    direction,
    amount,
    rounding: { step, mode: step ? mode : "cercano" },
    excluded: excluded || [],
  };
  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    setPreview(null);
    setConfirming(false);
    setStale(false);
  }, [paramsKey]);

  if (session?.role !== "admin")
    return (
      <p className="notice error" role="alert">
        Esta pantalla es solo para administración.
      </p>
    );

  const ref = state?.reference?.value;
  const n = parseAmount(amount);
  const validAmount =
    Number.isFinite(n) &&
    n > 0 &&
    Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 &&
    (direction === "aumentar" || !ref || n < ref);
  const signed = direction === "aumentar" ? n : -n;
  const ready = !!ref && validAmount && (!step || mode) && online;

  async function guard(fn) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) setStale(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const saveReference = (e) => {
    e.preventDefault();
    guard(async () => {
      const s = await api("/precios/referencia", {
        method: "PUT",
        body: JSON.stringify({ value: refDraft }),
      });
      setState(s);
      setEditRef(false);
      setRefDraft("");
      notify("Precio de referencia guardado.");
    });
  };
  const makePreview = (e) => {
    e?.preventDefault();
    if (!ready) return;
    guard(async () => {
      setResult(null);
      setConfirming(false);
      setStale(false);
      const p = await post("/precios/actualizacion/vista-previa", params);
      opId.current = newId(); // un identificador por vista previa: el reintento no duplica
      setPreview(p);
    });
  };
  const apply = () =>
    guard(async () => {
      const r = await post("/precios/actualizacion", {
        ...params,
        token: preview.token,
        opId: opId.current,
      });
      setResult(r.update);
      setPreview(null);
      setConfirming(false);
      setAmount("");
      await Promise.all([load(), refreshConfig?.()]);
      notify("Precios actualizados.");
    });
  const openDetail = (id) =>
    guard(async () => {
      setRevert(null);
      setDetail(await api(`/precios/actualizaciones/${id}`));
    });
  const askRevert = (id) =>
    guard(async () => {
      setDetail(null);
      const r = await post(
        `/precios/actualizaciones/${id}/reversion/vista-previa`,
        {},
      );
      setRevert({ ...r, opId: newId(), confirming: false });
    });
  const doRevert = () =>
    guard(async () => {
      const r = await post(
        `/precios/actualizaciones/${revert.update.id}/reversion`,
        {
          token: revert.token,
          opId: revert.opId,
        },
      );
      setRevert(null);
      setResult(r.update);
      await Promise.all([load(), refreshConfig?.()]);
      notify("Actualización revertida.");
    });

  const eligible = (state?.products || []).filter((p) => p.eligible);
  const toggle = (id) =>
    setExcluded((x) =>
      (x || []).includes(id) ? x.filter((y) => y !== id) : [...(x || []), id],
    );
  const s = preview?.summary;

  return (
    <div className="price-update">
      <PageHead
        eyebrow="ADMINISTRACIÓN · PRECIOS"
        title="Actualizar precios."
        description="Ingresá cuánto cambia el kilo de pollo. El porcentaje se calcula solo y se aplica a las listas y a los precios propios de cada cliente."
      >
        <div className="head-actions">
          <Link to="/operacion/precios" className="secondary">
            Ver listas de precios
          </Link>
        </div>
      </PageHead>
      {!online && (
        <p className="notice error" role="alert">
          Sin conexión. La actualización de precios se hace solo con conexión y
          no queda guardada para después.
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
          {stale && (preview || revert) && (
            <>
              {" "}
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  revert ? askRevert(revert.update.id) : makePreview()
                }
              >
                Recalcular vista previa
              </button>
            </>
          )}
        </p>
      )}
      {result && (
        <p className="notice success" role="status">
          {result.kind === "reversion"
            ? `Reversión aplicada: ${result.changes} precios volvieron a su valor anterior. Referencia: ${perKg(result.refAfter)}.`
            : `${kindName[result.kind]} aplicado: ${result.changes} precios actualizados (${result.percent} %). Nueva referencia: ${perKg(result.refAfter)}.`}{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => openDetail(result.id)}
          >
            Ver detalle
          </button>
        </p>
      )}

      <section className="panel pu-reference">
        <h2>
          Precio de referencia del pollo:{" "}
          {ref ? perKg(ref) : <span className="pu-bad">sin configurar</span>}
        </h2>
        {state?.reference && (
          <p className="muted small">
            Es el pollo entero por kilo. Cada variación se calcula sobre este
            valor y, al confirmar, pasa a ser el nuevo. Último cambio:{" "}
            {when(state.reference.updated)} ({state.reference.by}).
          </p>
        )}
        {state && !ref && (
          <p>
            Antes de la primera actualización hay que indicar a cuánto está hoy
            el kilo de pollo entero. No se toma de ningún cliente ni de un
            promedio: lo confirma administración.
            {state.listBase
              ? ` Como dato, el precio base de la lista mayorista es ${perKg(state.listBase)}.`
              : ""}
          </p>
        )}
        {state && (!ref || editRef) ? (
          <form className="pu-inline" onSubmit={saveReference}>
            <label>
              Precio de referencia ($/kg)
              <input
                type="text"
                inputMode="decimal"
                value={refDraft}
                onChange={(e) => setRefDraft(e.target.value)}
                placeholder={ref ? String(ref) : "3900"}
              />
            </label>
            <button className="primary" disabled={busy || !online || !refDraft}>
              Guardar referencia
            </button>
            {editRef && (
              <button
                type="button"
                className="secondary"
                onClick={() => setEditRef(false)}
              >
                Cancelar
              </button>
            )}
          </form>
        ) : (
          ref && (
            <button
              type="button"
              className="link-button"
              onClick={() => setEditRef(true)}
            >
              Corregir referencia (no cambia ningún precio)
            </button>
          )
        )}
      </section>

      {ref && (
        <form className="panel pu-form" onSubmit={makePreview}>
          <h2>
            <TrendingUp size={17} /> Nueva variación
          </h2>
          <div
            className="pu-direction"
            role="radiogroup"
            aria-label="Tipo de cambio"
          >
            {[
              ["aumentar", "Aumentar"],
              ["disminuir", "Disminuir"],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={direction === k}
                className={direction === k ? "primary" : "secondary"}
                onClick={() => setDirection(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            Importe por kilo de pollo ($/kg)
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="300"
              aria-invalid={amount !== "" && !validAmount}
            />
          </label>
          {amount !== "" && !validAmount && (
            <p className="pu-bad small" role="alert">
              {direction === "disminuir" && Number.isFinite(n) && n >= ref
                ? "La disminución no puede igualar ni superar el precio de referencia."
                : "Ingresá un importe mayor que cero, con hasta dos decimales."}
            </p>
          )}
          {validAmount && (
            <p className="pu-message" role="status">
              El pollo {direction === "aumentar" ? "aumenta" : "baja"}{" "}
              {perKg(n)}. Esto representa{" "}
              {direction === "aumentar" ? "un aumento" : "una disminución"} del{" "}
              <strong>{pct((n / ref) * 100)} %</strong>. Se aplicará ese
              porcentaje a los precios incluidos en la actualización. La
              referencia pasa de {perKg(ref)} a {perKg(ref + signed)}.
            </p>
          )}
          <fieldset className="pu-rounding">
            <legend>Redondeo del precio final</legend>
            <select
              value={step}
              onChange={(e) => setStep(Number(e.target.value))}
              aria-label="Redondeo del precio final"
            >
              {STEPS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            {step > 0 && (
              <div
                className="pu-direction"
                role="radiogroup"
                aria-label="Dirección del redondeo"
              >
                {[
                  ["cercano", "Al más cercano"],
                  ["arriba", "Hacia arriba"],
                ].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={mode === k}
                    className={mode === k ? "primary" : "secondary"}
                    onClick={() => setMode(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {step > 0 && !mode && (
              <p className="muted small">Elegí la dirección del redondeo.</p>
            )}
          </fieldset>
          <fieldset className="pu-products">
            <legend>Productos incluidos (avícolas por kilo)</legend>
            {eligible.map((p) => (
              <label key={p.id} className="pu-check">
                <input
                  type="checkbox"
                  checked={!(excluded || []).includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
                {p.name}
                {p.created && (
                  <small className="muted"> · agregado desde un pedido</small>
                )}
              </label>
            ))}
            <p className="muted small">
              Destildá lo que no sea pollo. El renglón libre "Otro producto",
              los envases, las cajas y los fletes nunca se tocan.
            </p>
          </fieldset>
          <button className="primary" disabled={!ready || busy}>
            {busy && !preview ? <Loader2 size={15} className="spin" /> : null}{" "}
            Ver vista previa
          </button>
        </form>
      )}

      {preview && (
        <section className="panel pu-preview" aria-label="Vista previa">
          <h2>Vista previa</h2>
          <dl className="pu-facts">
            <div>
              <dt>Referencia</dt>
              <dd>
                {perKg(preview.refBefore)} →{" "}
                <strong>{perKg(preview.refAfter)}</strong>
              </dd>
            </div>
            <div>
              <dt>Porcentaje</dt>
              <dd>
                <strong>{preview.percent} %</strong>{" "}
                <small className="muted">
                  (factor exacto {preview.factor})
                </small>
              </dd>
            </div>
            <div>
              <dt>Alcance</dt>
              <dd>
                {s.lists} precios de listas y {s.own} precios propios de{" "}
                {s.customers} clientes, en {s.products} productos
              </dd>
            </div>
            <div>
              <dt>Redondeo</dt>
              <dd>{roundingText(preview.rounding)}</dd>
            </div>
          </dl>
          <p className="muted small">
            Las listas las usan los clientes de cada modalidad que no tienen
            precio propio para ese producto (
            {Object.entries(preview.planCustomers)
              .map(([plan, count]) => `${count} en ${planName[plan] || plan}`)
              .join(", ")}
            ). Se modifica cada lista una sola vez. El porcentaje se aplica con
            el factor exacto;{" "}
            {preview.rounding.step
              ? "el redondeo puede hacer que la variación de cada precio difiera un poco del porcentaje general."
              : "con centavos, la variación de cada precio coincide con el porcentaje general."}{" "}
            Los pedidos, remitos y documentos ya cargados conservan sus precios.
          </p>
          {preview.errors.length > 0 && (
            <div className="notice error" role="alert">
              <strong>
                {preview.errors.length} precios con error. No se puede aplicar
                así:
              </strong>
              <ul>
                {preview.errors.slice(0, 10).map((r, i) => (
                  <li key={i}>
                    {sourceText(r)} · {r.product}: {r.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(preview.exclusions.length > 0 || preview.notes.length > 0) && (
            <details className="pu-exclusions">
              <summary>
                Excluidos y avisos (
                {preview.exclusions.length + preview.notes.length})
              </summary>
              <ul>
                {preview.exclusions.map((x, i) => (
                  <li key={i}>
                    <strong>
                      {x.customerName ? `${x.customerName} · ` : ""}
                      {x.product}
                    </strong>
                    : {x.reason}
                    {x.ownRows
                      ? ` (${x.ownRows} precios propios quedan igual)`
                      : ""}
                  </li>
                ))}
                {preview.notes.map((t, i) => (
                  <li key={"n" + i}>{t}</li>
                ))}
              </ul>
            </details>
          )}
          <PriceRows
            rows={preview.items}
            columns={PREVIEW_COLUMNS}
            label="la vista previa"
          />
          {!confirming ? (
            <button
              type="button"
              className="primary"
              disabled={
                busy ||
                !online ||
                preview.errors.length > 0 ||
                !preview.items.length
              }
              onClick={() => setConfirming(true)}
            >
              Aplicar actualización…
            </button>
          ) : (
            <div
              className="pu-confirm"
              role="alertdialog"
              aria-label="Confirmar actualización"
            >
              <p>
                <strong>
                  Se van a cambiar {s.lists + s.own} precios: {s.lists} de las
                  listas mayorista, intermedia y minorista, y {s.own} precios
                  propios de {s.customers} clientes.
                </strong>{" "}
                El precio de referencia del pollo pasa de{" "}
                {perKg(preview.refBefore)} a {perKg(preview.refAfter)} (
                {preview.percent} %). Los pedidos ya cargados no cambian. Se
                puede revertir mientras sea la última actualización y nadie haya
                modificado esos precios.
              </p>
              <button
                type="button"
                className="primary"
                disabled={busy || !online}
                onClick={apply}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}{" "}
                Confirmar y aplicar
              </button>{" "}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Volver
              </button>
            </div>
          )}
        </section>
      )}

      {revert && (
        <section
          className="panel pu-preview"
          aria-label="Revertir actualización"
        >
          <h2>
            <RotateCcw size={17} /> Revertir la actualización del{" "}
            {when(revert.update.at)}
          </h2>
          {revert.conflicts.length > 0 ? (
            <div className="notice error" role="alert">
              <strong>
                No se puede revertir: {revert.conflicts.length} valores
                cambiaron después de esa actualización.
              </strong>{" "}
              Para no pisar esos cambios, la reversión quedó bloqueada.
              <ul>
                {revert.conflicts.map((c, i) => (
                  <li key={i}>
                    {c.what}: la actualización lo dejó en {money(c.expected)} y
                    ahora está en{" "}
                    {c.current === null ? "(no existe)" : money(c.current)}.
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>
              Se restauran exactamente los {revert.items.length} precios que
              cambió esa operación, y la referencia vuelve a{" "}
              {perKg(revert.refRestore)}. No se aplica un porcentaje inverso.
            </p>
          )}
          <PriceRows
            rows={revert.items}
            columns={[
              [(r) => money(r.current), "Ahora"],
              [(r) => <strong>{money(r.restore)}</strong>, "Vuelve a"],
            ]}
            label="la reversión"
          />
          {revert.conflicts.length === 0 &&
            (!revert.confirming ? (
              <button
                type="button"
                className="primary"
                disabled={busy || !online}
                onClick={() => setRevert({ ...revert, confirming: true })}
              >
                Revertir…
              </button>
            ) : (
              <div
                className="pu-confirm"
                role="alertdialog"
                aria-label="Confirmar reversión"
              >
                <p>
                  <strong>
                    Se van a restaurar {revert.items.length} precios y la
                    referencia vuelve a {perKg(revert.refRestore)}.
                  </strong>{" "}
                  Los pedidos ya cargados no cambian.
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !online}
                  onClick={doRevert}
                >
                  Confirmar reversión
                </button>{" "}
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setRevert({ ...revert, confirming: false })}
                >
                  Volver
                </button>
              </div>
            ))}{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => setRevert(null)}
          >
            Cerrar
          </button>
        </section>
      )}

      {detail && (
        <section
          className="panel pu-preview"
          aria-label="Detalle de la actualización"
        >
          <h2>
            {kindName[detail.kind]} del {when(detail.at)} · {detail.actor}
          </h2>
          <p className="muted small">
            Referencia {perKg(detail.refBefore)} → {perKg(detail.refAfter)} ·{" "}
            {detail.percent} % (factor {detail.factor}) ·{" "}
            {detail.kind === "reversion"
              ? "valores restaurados exactos"
              : roundingText(detail.rounding)}
            {detail.revertedBy && " · Esta actualización fue revertida."}
          </p>
          {detail.scope?.exclusions?.length > 0 && (
            <details className="pu-exclusions">
              <summary>Excluidos ({detail.scope.exclusions.length})</summary>
              <ul>
                {detail.scope.exclusions.map((x, i) => (
                  <li key={i}>
                    {x.customerName ? `${x.customerName} · ` : ""}
                    {x.product}: {x.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <PriceRows
            rows={detail.items}
            columns={
              detail.kind === "reversion"
                ? [
                    [(r) => money(r.before), "Antes"],
                    [(r) => <strong>{money(r.final)}</strong>, "Restaurado"],
                  ]
                : PREVIEW_COLUMNS
            }
            label="el detalle"
          />
          <button
            type="button"
            className="link-button"
            onClick={() => setDetail(null)}
          >
            Cerrar
          </button>
        </section>
      )}

      <section className="panel">
        <h2>
          <History size={17} /> Historial de actualizaciones
        </h2>
        {!state?.history?.length ? (
          <p className="muted">Todavía no hubo actualizaciones masivas.</p>
        ) : (
          <div className="table-scroll">
            <table className="customers pu-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th className="num">Variación</th>
                  <th className="num">Referencia</th>
                  <th className="num">%</th>
                  <th className="num">Precios</th>
                  <th>Responsable</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.history.map((h) => (
                  <tr key={h.id}>
                    <td>{when(h.at)}</td>
                    <td>
                      {kindName[h.kind]}
                      {h.revertedBy && (
                        <small className="muted"> · revertida</small>
                      )}
                    </td>
                    <td className="num">{perKg(h.delta)}</td>
                    <td className="num">
                      {money(h.refBefore)} → {money(h.refAfter)}
                    </td>
                    <td className="num">{h.percent} %</td>
                    <td className="num">{h.changes}</td>
                    <td>{h.actor}</td>
                    <td className="pu-actions">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => openDetail(h.id)}
                      >
                        Detalle
                      </button>
                      {h.revertible && (
                        <button
                          type="button"
                          className="link-button"
                          disabled={!online}
                          onClick={() => askRevert(h.id)}
                        >
                          Revertir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
