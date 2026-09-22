import React, { useEffect, useMemo, useState } from "react";
import {
  Search,
  UserPlus,
  Tags,
  Tag,
  FileText,
  Wallet,
  AlertTriangle,
  MessageCircle,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import ImportCustomers from "../components/ImportCustomers.jsx";
import { money, normalize, waLink } from "../lib/format.js";
import { Link } from "../lib/router.jsx";

export const shiftNames = { manana: "Mañana", tarde: "Tarde", "": "—" };
export const statusNames = {
  ok: "Completa",
  incompleto: "Sin CUIT",
  revisar: "Revisar",
  inactivo: "Inactivo",
};

/**
 * Fichas de clientes al estilo GC: apodo, razón social, CUIT, zona, turno, camión, precio propio
 * del pollo, saldo y envases. Desde acá se edita la ficha, los precios y se cobra.
 */
export default function Customers() {
  const { customers, config, setModal, busy, session } = useStore();
  const [q, setQ] = useState("");
  // La búsqueda se aplica 250 ms después de dejar de tipear: con 150 fichas no traba la pantalla.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const [zone, setZone] = useState("");
  const [shift, setShift] = useState("");
  const [truck, setTruck] = useState("");
  const [status, setStatus] = useState("");
  const zones = useMemo(
    () => [...new Set(customers.map((c) => c.zone).filter(Boolean))].sort(),
    [customers],
  );
  const drivers = config?.drivers || [];
  const nq = normalize(query.trim());
  const list = customers
    .filter(
      (c) =>
        (!zone || c.zone === zone) &&
        (!shift || (c.shift || "") === shift) &&
        (!truck || (c.truck || c.driver || "") === truck) &&
        (!status || (c.status || "ok") === status) &&
        (!nq ||
          normalize(
            `${c.name} ${c.alias || ""} ${c.legalName || ""} ${c.cuit || ""} ${c.contactPhone || ""} ${c.zone || ""} ${c.code || ""}`,
          ).includes(nq)),
    )
    .sort(
      (a, b) =>
        (a.zone || "zz").localeCompare(b.zone || "zz") ||
        a.name.localeCompare(b.name),
    );
  const pending = customers.filter((c) =>
    ["revisar", "incompleto"].includes(c.status),
  ).length;
  return (
    <section className="panel customers-panel">
      <div className="section-line">
        <h2>Clientes</h2>
        <span className="muted">
          {customers.length} fichas
          {pending ? ` · ${pending} por revisar` : ""}
        </span>
      </div>
      <div className="board-filters customers-filters">
        <div className="search-field">
          <Search size={16} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Apodo, razón social, CUIT, teléfono…"
            aria-label="Buscar clientes"
          />
        </div>
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          aria-label="Zona"
        >
          <option value="">Todas las zonas</option>
          {zones.map((z) => (
            <option key={z}>{z}</option>
          ))}
        </select>
        <select
          value={shift}
          onChange={(e) => setShift(e.target.value)}
          aria-label="Turno"
        >
          <option value="">Mañana y tarde</option>
          <option value="manana">Mañana</option>
          <option value="tarde">Tarde</option>
        </select>
        <select
          value={truck}
          onChange={(e) => setTruck(e.target.value)}
          aria-label="Preventista"
        >
          <option value="">Todos los preventistas</option>
          {drivers.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          {Object.entries(statusNames).map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
        <button
          className="primary"
          onClick={() => setModal({ type: "new-customer" })}
        >
          <UserPlus size={15} /> Nuevo cliente
        </button>
        {session?.role === "admin" && <ImportCustomers />}
      </div>
      {list.length === 0 ? (
        <p className="muted">Ningún cliente coincide con el filtro.</p>
      ) : (
        <div className="table-scroll">
          <table className="customers gc-customers">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Zona · Turno</th>
                <th>Camión</th>
                <th className="num">Pollo $/kg</th>
                <th className="num">Saldo</th>
                <th className="num">Envases</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const st = c.status || "ok";
                const pollo = c.prices?.entero;
                return (
                  <tr key={c.phone} className={"status-" + st}>
                    <td>
                      <button
                        type="button"
                        className="customer-name"
                        title="Ver y cargar saldo y cajas"
                        onClick={() =>
                          setModal({ type: "saldos", customer: c })
                        }
                      >
                        <strong>{c.name}</strong>
                      </button>
                      {c.branch && <small className="pill">Sucursal</small>}
                      <br />
                      <small>
                        {c.legalName && c.legalName !== c.name
                          ? c.legalName
                          : ""}
                        {c.cuit ? ` · CUIT ${c.cuit}` : ""}
                        {c.contactPhone ? (
                          <>
                            {" · "}
                            <a
                              href={waLink(
                                c.contactPhone,
                                `Hola ${c.name}, te escribo de Pollito Casero.`,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <MessageCircle size={11} />{" "}
                              {c.contactPhone.replace(/^549/, "")}
                            </a>
                          </>
                        ) : (
                          " · sin teléfono"
                        )}
                      </small>
                    </td>
                    <td>
                      {c.zone || <span className="muted">—</span>}
                      <br />
                      <small>{shiftNames[c.shift || ""]}</small>
                    </td>
                    <td>
                      {c.truck || c.driver || (
                        <span className="muted">Sin asignar</span>
                      )}
                    </td>
                    <td className="num">
                      {pollo ? (
                        money(pollo)
                      ) : (
                        <span
                          className="muted"
                          title="Sin precio propio: usa la lista de la modalidad"
                        >
                          lista
                        </span>
                      )}
                    </td>
                    <td
                      className={
                        "num " +
                        (c.summary.balance > 0
                          ? "red"
                          : c.summary.balance < 0
                            ? "green"
                            : "")
                      }
                    >
                      {/* Sin deuda ni cajas: se lee de un vistazo que está al día. */}
                      {c.summary.balance === 0 && c.summary.boxes === 0 ? (
                        <span className="al-dia">Al día</span>
                      ) : (
                        <>
                          {money(Math.abs(c.summary.balance))}
                          {c.summary.balance < 0 ? <small> a favor</small> : ""}
                        </>
                      )}
                    </td>
                    <td className="num">{c.summary.boxes || ""}</td>
                    <td>
                      <span className={"status-pill " + st}>
                        {st !== "ok" && <AlertTriangle size={11} />}{" "}
                        {statusNames[st]}
                      </span>
                    </td>
                    <td className="row-actions">
                      <button
                        className="link-button small"
                        onClick={() => setModal({ type: "ficha", customer: c })}
                      >
                        <FileText size={13} /> Ficha
                      </button>
                      <button
                        className="link-button small"
                        onClick={() =>
                          setModal({ type: "prices", customer: c })
                        }
                      >
                        <Tag size={13} /> Precios
                      </button>
                      <button
                        className="link-button small"
                        onClick={() =>
                          setModal({ type: "statement", customer: c })
                        }
                      >
                        Extracto
                      </button>
                      <button
                        className="link-button small"
                        title="Corregir a mano el saldo de cuenta y el de cajas"
                        onClick={() =>
                          setModal({ type: "saldos", customer: c })
                        }
                      >
                        Saldos
                      </button>
                      {c.summary.balance > 0 && (
                        <button
                          className="secondary small"
                          disabled={busy}
                          onClick={() =>
                            setModal({ type: "account-payment", customer: c })
                          }
                        >
                          <Wallet size={13} /> Cobrar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Ficha editable (alta y edición). */
export function FichaForm({ customer, onSubmit, submitting }) {
  const { config, localities } = useStore();
  const c = customer || {};
  const drivers = config?.drivers || [];
  return (
    <form
      className="ficha-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        f.credit = f.credit === "on";
        f.noPricing = f.noPricing === "on";
        onSubmit(f);
      }}
    >
      <div className="qo-grid">
        <label>
          Apodo / cómo lo llaman
          <input
            name="alias"
            defaultValue={c.alias || c.name || ""}
            required
            minLength="2"
            maxLength="80"
            autoComplete="off"
          />
        </label>
        <label>
          Nombre para remitos
          <input
            name="name"
            defaultValue={c.name || ""}
            required
            minLength="2"
            maxLength="100"
            autoComplete="off"
          />
        </label>
        <label className="wide">
          Razón social <small>(como factura GC)</small>
          <input
            name="legalName"
            defaultValue={c.legalName || ""}
            maxLength="120"
            autoComplete="off"
          />
        </label>
        <label>
          CUIT <small>(11 dígitos; puede quedar pendiente)</small>
          <input
            name="cuit"
            defaultValue={c.cuit || ""}
            inputMode="numeric"
            pattern="[0-9]{11}|"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Código GC
          <input
            name="code"
            defaultValue={c.code || ""}
            maxLength="30"
            autoComplete="off"
          />
        </label>
        <label>
          WhatsApp de contacto
          <input
            name="contactPhone"
            type="tel"
            defaultValue={(c.contactPhone || "").replace(/^549/, "")}
            placeholder="263 4 55-1234"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Sucursal <small>(si es una boca de un cliente)</small>
          <input
            name="branch"
            defaultValue={c.branch || ""}
            maxLength="80"
            autoComplete="off"
          />
        </label>
        <label className="wide">
          Dirección
          <input
            name="address"
            defaultValue={c.address || ""}
            maxLength="250"
            autoComplete="off"
          />
        </label>
        <label>
          Localidad
          <select name="localityId" defaultValue={c.localityId || ""}>
            <option value="">—</option>
            {localities.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Zona de reparto
          <input
            name="zone"
            defaultValue={c.zone || ""}
            maxLength="60"
            list="zonas"
            autoComplete="off"
          />
        </label>
        <label>
          Turno
          <select name="shift" defaultValue={c.shift || ""}>
            <option value="">—</option>
            <option value="manana">Mañana</option>
            <option value="tarde">Tarde</option>
          </select>
        </label>
        <label>
          Camión / preventista
          <select name="truck" defaultValue={c.truck || c.driver || ""}>
            <option value="">Sin asignar</option>
            {drivers.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Modalidad de precios
          <select name="plan" defaultValue={c.plan || "mayorista"}>
            <option value="mayorista">Mayorista</option>
            <option value="intermedio">Intermedio</option>
            <option value="minorista">Minorista</option>
          </select>
        </label>
        <label>
          Estado
          <select name="status" defaultValue={c.status || "ok"}>
            {Object.entries(statusNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle wide">
          <input
            type="checkbox"
            name="credit"
            defaultChecked={c.credit !== false}
          />{" "}
          Cuenta corriente habilitada
        </label>
        <label className="toggle wide">
          <input
            type="checkbox"
            name="noPricing"
            defaultChecked={!!c.noPricing}
          />{" "}
          Cliente exclusivo: sin precio ni saldo (el remito sale solo con kilos
          y detalle)
        </label>
        <label className="wide">
          Notas
          <textarea
            name="notes"
            defaultValue={c.notes || ""}
            maxLength="500"
            rows="2"
          />
        </label>
      </div>
      <button className="primary full" disabled={submitting}>
        {customer ? "Guardar ficha" : "Crear cliente"}
      </button>
    </form>
  );
}
