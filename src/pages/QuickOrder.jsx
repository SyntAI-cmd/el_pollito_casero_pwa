import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  UserPlus,
  Check,
  ArrowRight,
  Truck,
  Wallet,
  RotateCcw,
  Package,
  CalendarDays,
  Pencil,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link } from "../lib/router.jsx";
import {
  money,
  kgText,
  planNames,
  productPrice,
  lineAmount,
  normalize,
  paymentNames,
} from "../lib/format.js";
import { PageHead } from "../components/ui.jsx";
import { shiftNames } from "./Customers.jsx";

const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Los pedidos se cargan a la noche para el reparto de la mañana siguiente. */
const defaultDelivery = () => {
  const d = new Date();
  if (d.getHours() >= 13) d.setDate(d.getDate() + 1);
  return todayKey(d);
};

/**
 * Carga de pedidos para el reparto (administración y preventistas): se elige el cliente de la
 * lista (con su zona, turno, camión y precios propios), se indican cajas y/o kilos por producto,
 * fecha y turno de reparto, y listo. Los kilos definitivos los pone la balanza.
 */
export default function QuickOrder() {
  const {
    config,
    customers,
    createStaffOrder,
    busy,
    formError,
    setModal,
    session,
    orders,
  } = useStore();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [lines, setLines] = useState({}); // productId → { boxes, kg }
  const [priceEdits, setPriceEdits] = useState({}); // productId → "5500" (solo administración)
  const [editingPrice, setEditingPrice] = useState(null);
  const [deliveryDate, setDeliveryDate] = useState(defaultDelivery());
  const [shift, setShift] = useState("");
  const [driver, setDriver] = useState("");
  const [payment, setPayment] = useState("");
  const [notes, setNotes] = useState("");
  const [created, setCreated] = useState(null);
  const searchRef = useRef();
  const products = config?.products || [];
  const drivers = config?.drivers || [];
  const isAdmin = session?.role === "admin";

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    return customers
      .filter(
        (c) =>
          (c.status || "ok") !== "inactivo" &&
          normalize(
            `${c.name} ${c.alias || ""} ${c.legalName || ""} ${c.zone || ""} ${c.cuit || ""} ${(c.contactPhone || "").replace(/^549/, "")}`,
          ).includes(q),
      )
      .slice(0, 8);
  }, [query, customers]);

  function pick(c) {
    setPicked(c);
    setQuery("");
    setShift(c.shift || "");
    setDriver(drivers.includes(c.truck || c.driver) ? c.truck || c.driver : "");
    setPayment(c.credit ? "cuenta" : "entrega");
    setTimeout(() => document.querySelector(".qo-box input")?.focus(), 0);
  }
  function reset() {
    setPicked(null);
    setLines({});
    setNotes("");
    setCreated(null);
    setQuery("");
    setTimeout(() => searchRef.current?.focus(), 0);
  }
  const repeatLast = () => {
    if (!picked) return;
    const last = orders
      .filter((o) => o.customer === picked.phone && o.status !== "cancelado")
      .sort((a, b) => b.created.localeCompare(a.created))[0];
    if (!last) return;
    setLines(
      Object.fromEntries(
        last.items.map((i) => [
          i.id,
          {
            boxes: i.boxes ? String(i.boxes) : "",
            kg: i.boxes ? "" : String(i.ordered ?? i.kg),
          },
        ]),
      ),
    );
  };

  const parse = (v) =>
    Number(
      String(v ?? "")
        .trim()
        .replace(",", "."),
    );
  const priceOf = (p) => {
    const edited = priceEdits[p.id];
    if (edited !== undefined && String(edited).trim() !== "") {
      const v = Number(String(edited).replace(",", "."));
      return Number.isFinite(v) ? v : NaN;
    }
    const own = picked?.prices?.[p.id];
    return Number.isFinite(Number(own)) && own !== null && own !== ""
      ? Number(own)
      : productPrice(p, picked?.plan || "mayorista");
  };
  const rows = products.map((p) => {
    const l = lines[p.id] || {};
    const boxes = String(l.boxes ?? "").trim() === "" ? null : parse(l.boxes);
    const kg = String(l.kg ?? "").trim() === "" ? null : parse(l.kg);
    const boxesBad =
      boxes !== null && (!Number.isInteger(boxes) || boxes < 0 || boxes > 500);
    const kgBad = kg !== null && (!Number.isFinite(kg) || kg <= 0 || kg > 5000);
    const active = (boxes !== null && boxes > 0) || (kg !== null && kg > 0);
    return { p, boxes, kg, bad: boxesBad || kgBad, active, price: priceOf(p) };
  });
  const items = rows.filter((r) => r.active && !r.bad);
  const invalid = rows.filter((r) => r.bad);
  const totalBoxes = items.reduce((s, r) => s + (r.boxes || 0), 0);
  const totalKg = items.reduce((s, r) => s + (r.kg || 0), 0);
  const estimate =
    items.reduce(
      (s, r) => s + Math.round(lineAmount(r.price, r.kg || 0) * 100),
      0,
    ) / 100;
  const noPrice = items.filter(
    (r) => !Number.isFinite(r.price) || r.price <= 0,
  );
  const canSubmit =
    picked && items.length > 0 && !invalid.length && !noPrice.length && !busy;

  async function submit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    const editedPrices = Object.fromEntries(
      Object.entries(priceEdits)
        .filter(([, v]) => String(v).trim() !== "")
        .map(([id, v]) => [id, Number(String(v).replace(",", "."))])
        .filter(([, v]) => Number.isFinite(v) && v > 0),
    );
    const order = await createStaffOrder({
      customer: picked.phone,
      prices: editedPrices,
      items: items.map((r) => ({
        id: r.p.id,
        ...(r.boxes !== null ? { boxes: r.boxes } : {}),
        ...(r.kg !== null ? { kg: r.kg } : {}),
      })),
      deliveryDate,
      shift: shift || undefined,
      driver: driver || undefined,
      payment: payment || undefined,
      plan: picked.plan || "mayorista",
      notes,
    });
    if (order) {
      setCreated(order);
      setLines({});
      setPriceEdits({});
      setNotes("");
    }
  }

  return (
    <>
      <PageHead
        eyebrow="REPARTO · POLLITO CASERO"
        title="Cargar pedido."
        description="Cliente, cajas o kilos por producto, fecha y turno. Los kilos finales los pone la balanza."
      >
        <div className="head-actions">
          <button type="button" className="secondary" onClick={reset}>
            <RotateCcw size={15} /> Limpiar
          </button>
        </div>
      </PageHead>
      {created && (
        <div className="notice success qo-created" role="status">
          <Check size={18} />
          <span>
            Pedido <strong>{created.id}</strong> de {created.name} para el{" "}
            {created.deliveryDate?.split("-").reverse().join("/")}
            {created.shift
              ? ` (${shiftNames[created.shift].toLowerCase()})`
              : ""}
            {created.driver ? ` · ${created.driver}` : ""}.
          </span>
          <Link
            to={isAdmin ? "/operacion" : "/reparto"}
            className="secondary small"
          >
            Ver pedidos
          </Link>
          <button type="button" className="primary small" onClick={reset}>
            Otro pedido
          </button>
        </div>
      )}
      <form
        className="quick-order"
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(e);
        }}
      >
        <section className="panel qo-customer">
          <h2>
            <UserPlus size={17} /> Cliente
          </h2>
          <label className="qo-search">
            Buscar cliente
            <div className="search-field">
              <Search size={16} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Apodo, zona, razón social…"
                autoComplete="off"
                aria-label="Buscar cliente por nombre, zona o CUIT"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (matches[0]) pick(matches[0]);
                  }
                }}
              />
            </div>
            {matches.length > 0 && (
              <ul className="suggestions" aria-label="Clientes encontrados">
                {matches.map((c) => (
                  <li key={c.phone}>
                    <button type="button" onClick={() => pick(c)}>
                      <span>
                        <strong>{c.name}</strong>
                        <small>
                          {[
                            c.zone,
                            shiftNames[c.shift || ""] !== "—"
                              ? shiftNames[c.shift || ""]
                              : null,
                            c.truck || c.driver,
                            c.legalName !== c.name ? c.legalName : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          {c.summary?.balance > 0
                            ? ` · debe ${money(c.summary.balance)}`
                            : ""}
                          {c.status && c.status !== "ok"
                            ? ` · ${c.status}`
                            : ""}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
          {picked ? (
            <div className="qo-picked-card">
              <div>
                <strong>{picked.name}</strong>
                <small>
                  {[
                    picked.legalName !== picked.name ? picked.legalName : null,
                    picked.cuit ? "CUIT " + picked.cuit : "sin CUIT",
                    picked.zone,
                    picked.address,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                <small>
                  {picked.credit ? "Cuenta corriente" : "Paga al recibir"}
                </small>
                <div className="qo-balances" aria-label="Saldos del cliente">
                  <span
                    className={
                      "qo-balance " +
                      ((picked.summary?.balance || 0) > 0
                        ? "due"
                        : (picked.summary?.balance || 0) < 0
                          ? "favor"
                          : "")
                    }
                  >
                    <small>Saldo de cuenta</small>
                    <strong>
                      {(picked.summary?.balance || 0) < 0
                        ? `${money(-picked.summary.balance)} a favor`
                        : money(picked.summary?.balance || 0)}
                    </strong>
                  </span>
                  <span
                    className={
                      "qo-balance " + (picked.summary?.boxes > 0 ? "due" : "")
                    }
                  >
                    <small>Saldo de cajas</small>
                    <strong>
                      {picked.summary?.boxes || 0}{" "}
                      {picked.summary?.boxes === 1 ? "caja" : "cajas"}
                    </strong>
                  </span>
                </div>
              </div>
              <div className="qo-picked-actions">
                <button
                  type="button"
                  className="link-button"
                  onClick={repeatLast}
                >
                  Repetir último
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setPicked(null);
                    setLines({});
                  }}
                >
                  Cambiar
                </button>
              </div>
            </div>
          ) : (
            <p className="qo-hint">
              Escribí el apodo o la zona y elegí de la lista.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => setModal({ type: "new-customer" })}
              >
                ¿Cliente nuevo? Crealo acá
              </button>
            </p>
          )}
          <div className="qo-grid">
            <label>
              <CalendarDays size={14} /> Fecha de reparto
              <input
                type="date"
                value={deliveryDate}
                min={todayKey()}
                onChange={(e) => setDeliveryDate(e.target.value)}
                required
              />
            </label>
            <label>
              Turno
              <select value={shift} onChange={(e) => setShift(e.target.value)}>
                <option value="">Según el cliente</option>
                <option value="manana">Mañana</option>
                <option value="tarde">Tarde</option>
              </select>
            </label>
            <label>
              <Truck size={14} /> Camión
              <select
                value={driver}
                onChange={(e) => setDriver(e.target.value)}
              >
                <option value="">Asignar después</option>
                {drivers.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label>
              <Wallet size={14} /> Pago
              <select
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              >
                {picked?.credit && (
                  <option value="cuenta">{paymentNames.cuenta}</option>
                )}
                <option value="entrega">{paymentNames.entrega}</option>
                {config?.transfer && (
                  <option value="transferencia">
                    {paymentNames.transferencia}
                  </option>
                )}
              </select>
            </label>
            <label className="wide">
              Observaciones <small>(salen en el remito)</small>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength="500"
                autoComplete="off"
                placeholder="Pollo grande, dejar en el galpón…"
              />
            </label>
          </div>
        </section>

        <section className="panel qo-products">
          <h2>
            <Package size={17} /> Cajas y kilos por producto
          </h2>
          <div className="table-scroll">
            <table className="qo-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num qo-price">$/kg</th>
                  <th className="num qo-box">Cajas</th>
                  <th className="num qo-kg">Kilos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, price, bad, active }, i) => (
                  <tr
                    key={p.id}
                    className={(active ? "on" : "") + (bad ? " bad" : "")}
                  >
                    <td>
                      {p.name}
                      <small className="qo-price-mobile">
                        {Number.isFinite(price) && price > 0
                          ? money(price) + " / kg"
                          : "sin precio"}
                      </small>
                    </td>
                    <td
                      className={
                        "num qo-price " +
                        (priceEdits[p.id] !== undefined
                          ? "edited"
                          : picked?.prices?.[p.id]
                            ? "own"
                            : "")
                      }
                    >
                      {isAdmin && picked && editingPrice === p.id ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          autoFocus
                          className="qo-price-input"
                          aria-label={`Precio por kilo de ${p.name}`}
                          value={priceEdits[p.id] ?? String(price || "")}
                          onChange={(e) =>
                            setPriceEdits({
                              ...priceEdits,
                              [p.id]: e.target.value,
                            })
                          }
                          onBlur={() => setEditingPrice(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") {
                              e.preventDefault();
                              setEditingPrice(null);
                            }
                          }}
                        />
                      ) : isAdmin && picked ? (
                        <button
                          type="button"
                          className="qo-price-btn"
                          title="Cambiar el precio por kilo para este cliente"
                          aria-label={`Cambiar precio de ${p.name}`}
                          onClick={() => setEditingPrice(p.id)}
                        >
                          {Number.isFinite(price) && price > 0 ? (
                            money(price)
                          ) : (
                            <em className="qo-bad">sin precio</em>
                          )}
                          <Pencil size={11} />
                        </button>
                      ) : Number.isFinite(price) && price > 0 ? (
                        money(price)
                      ) : (
                        <em className="qo-bad">sin precio</em>
                      )}
                    </td>
                    <td className="num qo-box">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={lines[p.id]?.boxes ?? ""}
                        disabled={!picked}
                        aria-label={`Cajas de ${p.name}`}
                        aria-invalid={bad || undefined}
                        className={lines[p.id]?.kg ? "qo-off" : ""}
                        title="Se pesan en balanza: los kilos salen de la pesada"
                        onChange={(e) =>
                          setLines({
                            ...lines,
                            [p.id]: { boxes: e.target.value, kg: "" },
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.ctrlKey) {
                            e.preventDefault();
                            const inputs = [
                              ...document.querySelectorAll(
                                ".qo-box input:not(:disabled)",
                              ),
                            ];
                            const at = inputs.indexOf(e.currentTarget);
                            (inputs[at + 1] || inputs[0])?.focus();
                          }
                        }}
                      />
                    </td>
                    <td className="num qo-kg">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={lines[p.id]?.kg ?? ""}
                        disabled={!picked}
                        aria-label={`Kilos de ${p.name}`}
                        aria-invalid={bad || undefined}
                        className={lines[p.id]?.boxes ? "qo-off" : ""}
                        title="Pedido por peso: en la pesada se cargan bruto y neto"
                        onChange={(e) =>
                          setLines({
                            ...lines,
                            [p.id]: { kg: e.target.value, boxes: "" },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Cada producto va por <strong>cajas</strong> o por{" "}
            <strong>kilos</strong>, no los dos: al escribir en una columna se
            borra la otra. Las cajas se pesan después en balanza (la app
            descuenta la tara de cada cajón); lo pedido por kilos se pesa en
            bruto y neto. El precio siempre es por kilo.
          </p>
          {invalid.length > 0 && (
            <p className="form-error" role="alert">
              Revisá {invalid.map((r) => r.p.name.toLowerCase()).join(", ")}:
              cajas enteras (0 a 500) y kilos válidos.
            </p>
          )}
          {noPrice.length > 0 && (
            <p className="form-error" role="alert">
              {picked?.name} no tiene precio para{" "}
              {noPrice.map((r) => r.p.name.toLowerCase()).join(", ")}: cargalo
              en Clientes → Precios.
            </p>
          )}
        </section>

        <aside className="panel qo-summary">
          <h2>Resumen</h2>
          <dl>
            <div>
              <dt>Cajas a armar</dt>
              <dd>{totalBoxes}</dd>
            </div>
            <div>
              <dt>Kilos pedidos</dt>
              <dd>{totalKg ? kgText(totalKg) : "—"}</dd>
            </div>
            <div className="total">
              <dt>Estimado</dt>
              <dd>{estimate ? money(estimate) : "según balanza"}</dd>
            </div>
          </dl>
          {picked && items.length > 0 && (
            <p className="qo-confirm">
              <strong>{picked.name}</strong> ·{" "}
              {deliveryDate.split("-").reverse().join("/")}
              {shift || picked.shift
                ? ` · ${shiftNames[shift || picked.shift].toLowerCase()}`
                : ""}
              {driver ? ` · ${driver}` : ""} ·{" "}
              {paymentNames[
                payment || (picked.credit ? "cuenta" : "entrega")
              ]?.toLowerCase()}
            </p>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button className="primary full" disabled={!canSubmit}>
            {busy ? "Cargando…" : "Cargar pedido"} <ArrowRight size={16} />
          </button>
          <small className="muted">Ctrl + Enter también confirma.</small>
        </aside>
        {picked && items.length > 0 && (
          <div className="qo-bar" aria-hidden="true">
            <span>
              {totalBoxes ? `${totalBoxes} cj` : ""}
              {totalBoxes && totalKg ? " · " : ""}
              {totalKg ? kgText(totalKg) : ""}
              {estimate ? <strong> · {money(estimate)}</strong> : ""}
            </span>
            <button
              type="submit"
              className="primary"
              tabIndex={-1}
              disabled={!canSubmit}
            >
              Cargar pedido <ArrowRight size={15} />
            </button>
          </div>
        )}
      </form>
    </>
  );
}
