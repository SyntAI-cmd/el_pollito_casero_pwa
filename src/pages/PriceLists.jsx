import React, { useEffect, useState } from "react";
import { Tags, Save, RotateCcw } from "lucide-react";
import { api } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { money, planNames } from "../lib/format.js";
import { PageHead } from "../components/ui.jsx";

const PLANS = ["mayorista", "intermedio", "minorista"];
const KEY = {
  mayorista: "wholesale",
  intermedio: "intermediate",
  minorista: "retail",
};

/**
 * Listas de precios por modalidad. El precio base es el pollo entero mayorista; el resto se carga a mano.
 * Lo que se guarda acá pisa business.json y rige para los pedidos nuevos; los precios propios de cada
 * cliente (Clientes → Precios) pisan a su vez la lista.
 */
export default function PriceLists() {
  const { session, notify, refreshConfig } = useStore();
  const [products, setProducts] = useState([]);
  const [lists, setLists] = useState({});
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admin = session?.role === "admin";
  const load = () =>
    api("/precios/listas")
      .then((r) => {
        setProducts(r.products);
        setLists(r.lists);
        setDraft({});
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const current = (p, plan) =>
    draft[p.id]?.[plan] ?? String(p[KEY[plan]] ?? "");
  const dirty = Object.keys(draft).length > 0;
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = {};
      for (const p of products)
        for (const plan of PLANS) {
          const v = Number(String(current(p, plan)).replace(",", "."));
          if (!Number.isFinite(v) || v <= 0)
            throw Error(`Revisá el precio de ${p.name} (${planNames[plan]}).`);
          (next[p.id] ||= {})[plan] = v;
        }
      await api("/precios/listas", {
        method: "PUT",
        body: JSON.stringify({ lists: next }),
      });
      await refreshConfig();
      await load();
      notify("Listas de precios guardadas.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="price-lists">
      <PageHead
        eyebrow="ADMINISTRACIÓN · LISTAS"
        title="Listas de precios."
        description="Precio por kilo según la modalidad del cliente. El precio base es el pollo entero mayorista; los precios propios de cada cliente pisan la lista."
      >
        {admin && (
          <div className="head-actions">
            <button
              type="button"
              className="secondary"
              disabled={!dirty || busy}
              onClick={() => setDraft({})}
            >
              <RotateCcw size={15} /> Deshacer
            </button>
            <button
              type="button"
              className="primary"
              disabled={!dirty || busy}
              onClick={save}
            >
              <Save size={15} /> Guardar listas
            </button>
          </div>
        )}
      </PageHead>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <form className="panel" onSubmit={save}>
        <div className="section-line">
          <h2>
            <Tags size={17} /> Precio por kilo
          </h2>
          <span className="muted">
            {Object.keys(lists).length
              ? "Listas editadas desde la app"
              : "Listas de business.json (todavía sin editar)"}
          </span>
        </div>
        <div className="table-scroll">
          <table className="customers lists-table">
            <thead>
              <tr>
                <th>Producto</th>
                {PLANS.map((plan) => (
                  <th key={plan} className="num">
                    {planNames[plan]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    {p.id === "entero" && (
                      <small className="muted"> · precio base</small>
                    )}
                  </td>
                  {PLANS.map((plan) => (
                    <td key={plan} className="num">
                      {admin ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          className={
                            draft[p.id]?.[plan] !== undefined ? "edited" : ""
                          }
                          value={current(p, plan)}
                          aria-label={`${planNames[plan]} de ${p.name}`}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [p.id]: {
                                ...(draft[p.id] || {}),
                                [plan]: e.target.value,
                              },
                            })
                          }
                        />
                      ) : (
                        money(p[KEY[plan]])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {admin && (
          <p className="muted small">
            Los cambios rigen para los pedidos que se carguen a partir de ahora;
            los ya cargados mantienen su precio (se corrigen desde el pedido con
            "Precios"). Enter o "Guardar listas" para confirmar.
          </p>
        )}
        <button type="submit" hidden disabled={!dirty || busy} />
      </form>
    </div>
  );
}
