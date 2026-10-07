import React, { useState } from "react";
import { Pencil, ArrowRight, Plus } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useFieldVisibility } from "../lib/media.js";
import { orderNumber, money, kgText } from "../lib/format.js";
import { shiftNames } from "../pages/Customers.jsx";
import { DOC_MODES, docModeOf, docModeFlags } from "../lib/docMode.js";

const parse = (v) =>
  Number(
    String(v ?? "")
      .trim()
      .replace(",", "."),
  );

/**
 * Edición de un pedido ya cargado (equipo): cajas o kilos por producto, renglón libre "otro",
 * precio por kilo, observaciones, fecha, turno y preventistas. Los renglones ya pesados conservan
 * su pesada; los que se quitan pierden sus cajones. Nada vale hasta pasar por la balanza.
 */
export default function OrderEdit({ order: o }) {
  const ensureFieldVisible = useFieldVisibility();
  const {
    products,
    config,
    customers,
    editOrder,
    createProduct,
    notify,
    busy,
    setModal,
    session,
  } = useStore();
  const customer = customers.find((c) => c.phone === o.customer);
  const admin = session?.role === "admin";
  const drivers = config?.drivers || [];
  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      o.items.map((i) => [
        i.id,
        i.boxes
          ? { boxes: String(i.boxes), units: "", kg: "" }
          : i.units
            ? { boxes: "", units: String(i.units), kg: "" }
            : { boxes: "", units: "", kg: String(i.ordered ?? i.kg ?? "") },
      ]),
    ),
  );
  const [label, setLabel] = useState(
    o.items.find((i) => i.id === "otro")?.name || "",
  );
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(o.items.map((i) => [i.id, String(i.price || "")])),
  );
  const [docMode, setDocMode] = useState(docModeOf(o));
  const { noPricing, noBalance } = docModeFlags(docMode);
  const [saveDocMode, setSaveDocMode] = useState(false);
  const fichaMode = customer ? docModeOf(customer) : docMode;
  const [notes, setNotes] = useState(o.notes || "");
  const [deliveryDate, setDeliveryDate] = useState(o.deliveryDate || "");
  const [shift, setShift] = useState(o.shift || "");
  const [driver, setDriver] = useState(o.driver || "");
  const [driver2, setDriver2] = useState(o.driver2 || "");
  const [error, setError] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);
  const otroPesado = o.items.some((i) => i.id === "otro" && i.weighed);
  /** "Otro" con nombre → producto nuevo del catálogo; lo cargado en "Otro" pasa a su renglón. */
  async function addOtherProduct() {
    const name = label.trim();
    if (name.length < 2 || addingProduct || otroPesado) return;
    setAddingProduct(true);
    try {
      const p = await createProduct(name);
      const move = (m) => {
        if (m.otro === undefined) return m;
        const { otro, ...rest } = m;
        return { ...rest, [p.id]: rest[p.id] ?? otro };
      };
      setLines(move);
      setPrices(move);
      setLabel("");
      notify(`${p.name} ya está en los productos.`);
    } catch (e) {
      notify(e.message);
    } finally {
      setAddingProduct(false);
    }
  }

  const rows = products.map((p) => {
    const l = lines[p.id] || {};
    const boxes = String(l.boxes ?? "").trim() === "" ? null : parse(l.boxes);
    const units = String(l.units ?? "").trim() === "" ? null : parse(l.units);
    const kg = String(l.kg ?? "").trim() === "" ? null : parse(l.kg);
    const bad =
      (boxes !== null &&
        (!Number.isInteger(boxes) || boxes < 0 || boxes > 500)) ||
      (units !== null &&
        (!Number.isInteger(units) || units < 0 || units > 5000)) ||
      (kg !== null && (!Number.isFinite(kg) || kg <= 0 || kg > 5000));
    const active =
      (boxes !== null && boxes > 0) ||
      (units !== null && units > 0) ||
      (kg !== null && kg > 0);
    const price = parse(
      prices[p.id] !== undefined ? prices[p.id] : customer?.prices?.[p.id],
    );
    const old = o.items.find((i) => i.id === p.id);
    return { p, boxes, units, kg, bad, active, price, old };
  });
  const items = rows.filter((r) => r.active && !r.bad);
  const invalid = rows.filter((r) => r.bad);
  const noPrice = noPricing
    ? []
    : items.filter((r) => !Number.isFinite(r.price) || r.price <= 0);
  const otroSinNombre = items.some(
    (r) => r.p.id === "otro" && label.trim().length < 2,
  );
  const canSubmit =
    items.length > 0 &&
    !invalid.length &&
    !noPrice.length &&
    !otroSinNombre &&
    !busy;

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    const ok = await editOrder(o, {
      items: items.map((r) => ({
        id: r.p.id,
        ...(r.boxes !== null ? { boxes: r.boxes } : {}),
        ...(r.units ? { units: r.units } : {}),
        ...(r.kg !== null ? { kg: r.kg } : {}),
        ...(r.p.id === "otro" ? { label: label.trim() } : {}),
      })),
      prices: noPricing
        ? {}
        : Object.fromEntries(
            items
              .map((r) => [r.p.id, r.price])
              .filter(([, v]) => Number.isFinite(v) && v > 0),
          ),
      noPricing,
      noBalance,
      saveDocMode: saveDocMode && docMode !== fichaMode,
      notes,
      deliveryDate: deliveryDate || undefined,
      shift,
      driver,
      driver2: driver2 && driver2 !== driver ? driver2 : "",
    });
    if (ok) setModal(null);
  }

  return (
    <form onSubmit={submit} className="order-edit">
      <span className="eyebrow">EDITAR PEDIDO</span>
      <h2>
        N° {orderNumber(o)} · {o.name}
      </h2>
      <p className="muted">
        Cambiá cajas, unidades o kilos por producto. Lo ya pesado conserva su
        pesada; el importe se calcula recién en la balanza.
      </p>
      <div className="table-scroll">
        <table className="qo-table edit-table">
          <thead>
            <tr>
              <th>Producto</th>
              {!noPricing && <th className="num col-price">$/kg</th>}
              <th className="num">Cajas</th>
              <th className="num">Unid.</th>
              <th className="num">Kilos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, active, bad, old, price }) => (
              <tr
                key={p.id}
                className={(active ? "on" : "") + (bad ? " bad" : "")}
              >
                <td>
                  {p.id === "otro" ? (
                    <span className="qo-other-row">
                      <input
                        type="text"
                        className="qo-other"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !otroPesado) {
                            e.preventDefault();
                            void addOtherProduct();
                          }
                        }}
                        placeholder="Producto nuevo: escribí el nombre"
                        maxLength="60"
                        aria-label="Nombre del producto nuevo"
                      />
                      {!otroPesado && (
                        <button
                          type="button"
                          className="secondary small"
                          disabled={label.trim().length < 2 || addingProduct}
                          onClick={() => void addOtherProduct()}
                        >
                          <Plus size={14} /> Agregar
                        </button>
                      )}
                    </span>
                  ) : (
                    p.name
                  )}
                  {old?.weighed && (
                    <small className="muted"> · pesado {kgText(old.kg)}</small>
                  )}
                  {!noPricing && (
                    <small className="muted price-mobile">
                      {" "}
                      ·{" "}
                      {Number.isFinite(price) && price > 0
                        ? money(price) + "/kg"
                        : "sin precio"}
                    </small>
                  )}
                </td>
                {!noPricing && (
                  <td className="num col-price">
                    <input
                      type="text"
                      inputMode="decimal"
                      onFocus={ensureFieldVisible}
                      value={prices[p.id] ?? customer?.prices?.[p.id] ?? ""}
                      onChange={(e) =>
                        setPrices({ ...prices, [p.id]: e.target.value })
                      }
                      aria-label={`Precio por kilo de ${p.name}`}
                      placeholder="sin precio"
                    />
                  </td>
                )}
                <td className="num">
                  <input
                    type="text"
                    inputMode="numeric"
                    onFocus={ensureFieldVisible}
                    value={lines[p.id]?.boxes ?? ""}
                    aria-label={`Cajas de ${p.name}`}
                    onChange={(e) =>
                      setLines({
                        ...lines,
                        [p.id]: { boxes: e.target.value, units: "", kg: "" },
                      })
                    }
                  />
                </td>
                <td className="num">
                  <input
                    type="text"
                    inputMode="numeric"
                    onFocus={ensureFieldVisible}
                    value={lines[p.id]?.units ?? ""}
                    aria-label={`Unidades de ${p.name}`}
                    title="Pollos o piezas contadas: los kilos salen de la balanza"
                    onChange={(e) =>
                      setLines({
                        ...lines,
                        [p.id]: { units: e.target.value, boxes: "", kg: "" },
                      })
                    }
                  />
                </td>
                <td className="num">
                  <input
                    type="text"
                    inputMode="decimal"
                    onFocus={ensureFieldVisible}
                    value={lines[p.id]?.kg ?? ""}
                    aria-label={`Kilos de ${p.name}`}
                    onChange={(e) =>
                      setLines({
                        ...lines,
                        [p.id]: { kg: e.target.value, boxes: "", units: "" },
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label>
        Remito
        <select value={docMode} onChange={(e) => setDocMode(e.target.value)}>
          {Object.entries(DOC_MODES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      {customer && docMode !== fichaMode && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={saveDocMode}
            onChange={(e) => setSaveDocMode(e.target.checked)}
          />{" "}
          Guardarlo también en la ficha de {customer.alias || customer.name}{" "}
          (hoy dice “{DOC_MODES[fichaMode]}”)
        </label>
      )}
      <div className="qo-grid">
        <label>
          Fecha de reparto
          <input
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </label>
        <label>
          Turno
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="">Sin turno</option>
            {Object.entries(shiftNames).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {admin && (
          <>
            <label>
              Preventista
              <select
                value={driver}
                onChange={(e) => setDriver(e.target.value)}
              >
                <option value="">Sin asignar</option>
                {drivers.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label>
              Segundo preventista
              <select
                value={driver2}
                onChange={(e) => setDriver2(e.target.value)}
              >
                <option value="">Ninguno</option>
                {drivers
                  .filter((d) => d !== driver)
                  .map((d) => (
                    <option key={d}>{d}</option>
                  ))}
              </select>
            </label>
          </>
        )}
        <label className="wide">
          Observaciones <small>(salen en el remito)</small>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength="500"
          />
        </label>
      </div>
      {invalid.length > 0 && (
        <p className="form-error" role="alert">
          Revisá {invalid.map((r) => r.p.name.toLowerCase()).join(", ")}: cajas
          enteras (0 a 500), unidades enteras y kilos válidos.
        </p>
      )}
      {noPrice.length > 0 && (
        <p className="form-error" role="alert">
          Falta el precio de{" "}
          {noPrice.map((r) => r.p.name.toLowerCase()).join(", ")}.
        </p>
      )}
      {otroSinNombre && (
        <p className="form-error" role="alert">
          Escribí el nombre del producto nuevo y tocá Agregar.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">
        {o.weighed
          ? `Importe actual según balanza: ${money(o.total)}.`
          : "El importe se calcula en la pesada."}
      </p>
      <button className="primary full" disabled={!canSubmit}>
        <Pencil size={15} /> {busy ? "Guardando…" : "Guardar cambios"}{" "}
        <ArrowRight size={15} />
      </button>
    </form>
  );
}
