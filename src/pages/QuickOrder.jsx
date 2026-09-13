import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  UserPlus,
  Check,
  ArrowRight,
  Truck,
  Wallet,
  RotateCcw,
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

const phonePattern = "[+0-9 \\(\\)\\-]{8,25}";
const empty = {
  name: "",
  phone: "",
  address: "",
  localityId: "",
  notes: "",
  plan: "minorista",
  payment: "entrega",
  driver: "",
  credit: false,
};

/**
 * Carga telefónica en una sola pantalla: cliente (buscado o nuevo), kilos por producto
 * directamente en la tabla, medio de pago y repartidor. Enter en los kilos salta al siguiente;
 * Ctrl+Enter confirma. Nada de catálogo ni carrito: es la herramienta rápida de administración.
 */
export default function QuickOrder() {
  const { config, customers, createStaffOrder, busy, formError, localities } =
    useStore();
  const [form, setForm] = useState(empty);
  const [kg, setKg] = useState({});
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null); // ficha elegida
  const [created, setCreated] = useState(null);
  const searchRef = useRef();
  const products = config?.products || [];
  const drivers = config?.drivers || [];
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    return customers
      .filter(
        (c) =>
          normalize(c.name).includes(q) ||
          c.phone.includes(q.replace(/\D/g, "") || "#"),
      )
      .slice(0, 6);
  }, [query, customers]);

  function pick(c) {
    setPicked(c);
    setQuery("");
    set({
      name: c.name,
      phone: c.phone.replace(/^549/, ""),
      address: c.address || "",
      localityId: c.localityId || "",
      plan: c.plan,
      payment: c.plan === "mayorista" && c.credit ? "cuenta" : "entrega",
      driver: c.driver || "",
      credit: !!c.credit,
    });
    setTimeout(() => document.querySelector(".qo-kg input")?.focus(), 0);
  }
  function reset() {
    setForm(empty);
    setKg({});
    setPicked(null);
    setCreated(null);
    setQuery("");
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  // Kilos escritos con coma o punto; solo las líneas válidas (1–1000 kg, pasos de 0,5) suman dinero.
  const parseKg = (v) =>
    Number(
      String(v ?? "")
        .trim()
        .replace(",", "."),
    );
  const validKg = (n) =>
    Number.isFinite(n) && n >= 1 && n <= 1000 && Number.isInteger(n * 2);
  const rows = products.map((p) => {
    const raw = kg[p.id] ?? "";
    const n = parseKg(raw);
    const price = productPrice(p, form.plan);
    const filled = String(raw).trim() !== "";
    return {
      p,
      raw,
      kg: n,
      price,
      filled,
      valid: filled && validKg(n) && Number.isFinite(price),
    };
  });
  const lines = rows.filter((l) => l.valid);
  const invalid = rows.filter((l) => l.filled && !l.valid);
  const totalKg = lines.reduce((s, l) => s + l.kg, 0);
  const subtotal =
    lines.reduce((s, l) => s + Math.round(lineAmount(l.price, l.kg) * 100), 0) /
    100;
  const shipping = totalKg ? (config?.shipping?.[form.plan] ?? 0) : 0;
  const total = subtotal + shipping;
  const badKg = invalid.length > 0;
  const minKg = config?.planMinKg?.[form.plan] || 0;
  const underMin = totalKg > 0 && totalKg < minKg;
  const methods = (
    form.plan === "mayorista"
      ? ["cuenta", "entrega", "transferencia", "mercadopago"]
      : ["entrega", "transferencia", "mercadopago"]
  ).filter(
    (m) =>
      (m !== "transferencia" || config?.transfer) &&
      (m !== "mercadopago" || config?.mercadopago) &&
      (m !== "cuenta" || form.credit || !picked),
  );

  async function submit(e) {
    e?.preventDefault();
    if (!lines.length || badKg || underMin) return;
    const order = await createStaffOrder({
      ...form,
      payment: methods.includes(form.payment) ? form.payment : methods[0],
      items: lines.map((l) => ({ id: l.p.id, kg: l.kg })),
    });
    if (order) {
      setCreated(order);
      setKg({});
    }
  }

  return (
    <>
      <PageHead
        eyebrow="OPERACIÓN · POLLITO CASERO"
        title="Cargar pedido."
        description="Pedido telefónico en una sola pantalla: cliente, kilos y listo."
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
            Pedido <strong>{created.id}</strong> cargado para {created.name} ·{" "}
            {money(created.total)}
            {created.driver ? ` · asignado a ${created.driver}` : ""}.
          </span>
          <Link to="/operacion" className="secondary small">
            Ver en Pedidos
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
                placeholder="Nombre o WhatsApp…"
                autoComplete="off"
                aria-label="Buscar cliente por nombre o WhatsApp"
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
                          +{c.phone} · {planNames[c.plan]}
                          {c.address ? ` · ${c.address}` : ""}
                          {c.summary?.balance > 0
                            ? ` · debe ${money(c.summary.balance)}`
                            : ""}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
          {picked && (
            <p className="qo-picked">
              <Check size={14} /> {picked.name} · {planNames[picked.plan]}
              {picked.credit && picked.plan === "mayorista"
                ? " · cuenta corriente"
                : ""}
              {picked.summary?.balance > 0
                ? ` · saldo ${money(picked.summary.balance)}`
                : ""}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setPicked(null);
                  set({
                    name: "",
                    phone: "",
                    address: "",
                    localityId: "",
                    driver: "",
                    credit: false,
                  });
                  setTimeout(() => searchRef.current?.focus(), 0);
                }}
              >
                cambiar
              </button>
            </p>
          )}
          <div className="qo-grid">
            <label>
              Nombre
              <input
                name="name"
                autoComplete="off"
                required
                minLength="2"
                maxLength="100"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Cliente nuevo"
              />
            </label>
            <label>
              WhatsApp
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                spellCheck={false}
                required
                pattern={phonePattern}
                value={form.phone}
                onChange={(e) => set({ phone: e.target.value })}
                placeholder="263 4 55-1234"
              />
            </label>
            <label className="wide">
              Dirección
              <input
                name="address"
                autoComplete="off"
                required
                minLength="8"
                maxLength="250"
                value={form.address}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="Calle y número"
              />
            </label>
            <label>
              Localidad
              <select
                name="localityId"
                required
                value={form.localityId}
                onChange={(e) => set({ localityId: e.target.value })}
              >
                <option value="" disabled>
                  Elegí…
                </option>
                {localities.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Modalidad
              <select
                name="plan"
                value={form.plan}
                onChange={(e) => set({ plan: e.target.value })}
              >
                {Object.entries(planNames).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              Indicaciones <small>(opcional)</small>
              <input
                name="notes"
                autoComplete="off"
                maxLength="500"
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder="Portón verde, tocar bocina…"
              />
            </label>
          </div>
        </section>

        <section className="panel qo-products">
          <h2>Kilos por producto</h2>
          <div className="table-scroll">
            <table className="qo-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num qo-price">$/kg</th>
                  <th className="num qo-kg">Kilos</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, price, raw, kg: q, valid, filled }, i) => {
                  const bad = filled && !valid;
                  return (
                    <tr
                      key={p.id}
                      className={(valid ? "on" : "") + (bad ? " bad" : "")}
                    >
                      <td>
                        {p.name}
                        <small className="qo-price-mobile">
                          {Number.isFinite(price) ? money(price) + " / kg" : ""}
                        </small>
                      </td>
                      <td className="num qo-price">
                        {Number.isFinite(price) ? money(price) : "—"}
                      </td>
                      <td className="num qo-kg">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={raw}
                          disabled={!Number.isFinite(price)}
                          aria-label={`Kilos de ${p.name}`}
                          aria-invalid={bad || undefined}
                          onChange={(e) =>
                            setKg({ ...kg, [p.id]: e.target.value })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.ctrlKey) {
                              e.preventDefault();
                              const inputs = [
                                ...document.querySelectorAll(".qo-kg input"),
                              ];
                              (inputs[i + 1] || inputs[0])?.focus();
                            }
                          }}
                        />
                      </td>
                      <td className="num">
                        {valid ? (
                          money(lineAmount(price, q))
                        ) : bad ? (
                          <em className="qo-bad">1 a 1000 kg, de a 0,5</em>
                        ) : (
                          ""
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {badKg && (
            <p className="form-error" role="alert">
              Revisá {invalid.map((l) => l.p.name.toLowerCase()).join(", ")}:
              los kilos van de 1 a 1000, en pasos de 0,5.
            </p>
          )}
          {underMin && (
            <p className="form-error" role="alert">
              La modalidad {form.plan} es a partir de {minKg} kg (llevás{" "}
              {kgText(totalKg)}). Sumá kilos o pasá a minorista.
            </p>
          )}
        </section>

        <aside className="panel qo-summary">
          <h2>Resumen</h2>
          <dl>
            <div>
              <dt>{lines.length} productos</dt>
              <dd>{kgText(totalKg)}</dd>
            </div>
            <div>
              <dt>Subtotal</dt>
              <dd>{money(subtotal)}</dd>
            </div>
            <div>
              <dt>Envío</dt>
              <dd>{shipping ? money(shipping) : "Sin cargo"}</dd>
            </div>
            <div className="total">
              <dt>Total</dt>
              <dd>{money(total)}</dd>
            </div>
          </dl>
          <label>
            <Wallet size={14} /> Pago
            <select
              name="payment"
              value={methods.includes(form.payment) ? form.payment : methods[0]}
              onChange={(e) => set({ payment: e.target.value })}
            >
              {methods.map((m) => (
                <option key={m} value={m}>
                  {paymentNames[m]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <Truck size={14} /> Repartidor
            <select
              name="driver"
              value={form.driver}
              onChange={(e) => set({ driver: e.target.value })}
            >
              <option value="">Asignar después</option>
              {drivers.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          {lines.length > 0 && form.name && (
            <p className="qo-confirm">
              Para <strong>{form.name}</strong> · {kgText(totalKg)} ·{" "}
              {money(total)} ·{" "}
              {paymentNames[
                methods.includes(form.payment) ? form.payment : methods[0]
              ]?.toLowerCase()}
              {form.driver ? ` · ${form.driver}` : ""}
            </p>
          )}
          <button
            className="primary full"
            disabled={busy || !lines.length || badKg || underMin}
          >
            {busy ? "Cargando…" : "Cargar pedido"} <ArrowRight size={16} />
          </button>
          <small className="muted">Ctrl + Enter también confirma.</small>
        </aside>
        {lines.length > 0 && (
          <div className="qo-bar" aria-hidden="true">
            <span>
              {kgText(totalKg)} · <strong>{money(total)}</strong>
            </span>
            <button
              type="submit"
              className="primary"
              tabIndex={-1}
              disabled={busy || badKg || underMin}
            >
              Cargar pedido <ArrowRight size={15} />
            </button>
          </div>
        )}
      </form>
    </>
  );
}
