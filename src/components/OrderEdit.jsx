import React, { useState } from "react";
import { Pencil, ArrowRight } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useFieldVisibility } from "../lib/media.js";
import { orderNumber, money, kgText } from "../lib/format.js";
import { shiftNames } from "../pages/Customers.jsx";

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
  const { products, config, customers, editOrder, busy, setModal, session } =
    useStore();
  const customer = customers.find((c) => c.phone === o.customer);
  const admin = session?.role === "admin";
  const drivers = config?.drivers || [];
  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      o.items.map((i) => [
        i.id,
        i.boxes
          ? { boxes: String(i.boxes), kg: "" }
          : { boxes: "", kg: String(i.ordered ?? i.kg ?? "") },
      ]),
    ),
  );
  const [label, setLabel] = useState(
    o.items.find((i) => i.id === "otro")?.name || "",
  );
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(o.items.map((i) => [i.id, String(i.price || "")])),
  );
  const [noPricing, setNoPricing] = useState(!!o.noPricing);
  const [notes, setNotes] = useState(o.notes || "");
  const [deliveryDate, setDeliveryDate] = useState(o.deliveryDate || "");
  const [shift, setShift] = useState(o.shift || "");
  const [driver, setDriver] = useState(o.driver || "");
  const [driver2, setDriver2] = useState(o.driver2 || "");
  const [error, setError] = useState("");

  const rows = products.map((p) => {
    const l = lines[p.id] || {};
    const boxes = String(l.boxes ?? "").trim() === "" ? null : parse(l.boxes);
    const kg = String(l.kg ?? "").trim() === "" ? null : parse(l.kg);
    const bad =
      (boxes !== null &&
        (!Number.isInteger(boxes) || boxes < 0 || boxes > 500)) ||
      (kg !== null && (!Number.isFinite(kg) || kg <= 0 || kg > 5000));
    const active = (boxes !== null && boxes > 0) || (kg !== null && kg > 0);
    const price = parse(
      prices[p.id] !== undefined ? prices[p.id] : customer?.prices?.[p.id],
    );
    const old = o.items.find((i) => i.id === p.id);
    return { p, boxes, kg, bad, active, price, old };
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
        Cambiá cajas o kilos por producto. Lo ya pesado conserva su pesada; el
        importe se calcula recién en la balanza.
      </p>
      <div className="table-scroll">
        <table className="qo-table edit-table">
          <thead>
            <tr>
              <th>Producto</th>
              {!noPricing && <th className="num col-price">$/kg</th>}
              <th className="num">Cajas</th>
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
                    <input
                      type="text"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Otro producto: ¿qué es?"
                      maxLength="60"
                      aria-label="Nombre del otro producto"
                    />
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
                        [p.id]: { boxes: e.target.value, kg: "" },
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
      <label className="toggle">
        <input
          type="checkbox"
          checked={noPricing}
          onChange={(e) => setNoPricing(e.target.checked)}
        />{" "}
        Sin precio ni saldo (cliente exclusivo): el remito sale solo con kilos y
        detalle
      </label>
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
          enteras (0 a 500) y kilos válidos.
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
          Escribí qué es el otro producto.
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
