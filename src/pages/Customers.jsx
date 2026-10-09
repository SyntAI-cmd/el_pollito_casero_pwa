import React, { useEffect, useMemo, useState } from "react";
import {
  UserPlus,
  Tags,
  Tag,
  ScrollText,
  FileText,
  SlidersHorizontal,
  Wallet,
  AlertTriangle,
  MessageCircle,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import SearchField from "../components/SearchField.jsx";
import { useIsMobile } from "../lib/media.js";
import { CajasChip } from "../components/CajasBox.jsx";
import ImportCustomers from "../components/ImportCustomers.jsx";
import { money, normalize, waLink } from "../lib/format.js";
import { Link } from "../lib/router.jsx";
import { DOC_MODES, docModeOf, docModeFlags } from "../lib/docMode.js";

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
  const emptyFilters = {
    zone: "",
    shift: "",
    truck: "",
    status: "",
    balance: "",
    boxes: "",
  };
  const [filters, setFilters] = useState(emptyFilters);
  const [draft, setDraft] = useState(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const { zone, shift, truck, status, balance, boxes } = filters;
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const changeDraft = (key) => (e) =>
    setDraft((v) => ({ ...v, [key]: e.target.value }));
  const clearFilters = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
  };
  const filterNames = {
    zone: "Zona",
    shift: "Turno",
    truck: "Preventista",
    status: "Estado",
    balance: "Dinero",
    boxes: "Cajas",
  };
  const filterValues = {
    debt: "Con deuda",
    zero: "Sin deuda (saldo 0)",
    credit: "Saldo a favor",
    pending: "Con cajas pendientes",
    clear: "Sin cajas pendientes",
    ...shiftNames,
    ...statusNames,
  };
  const mobile = useIsMobile();
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
        (!balance ||
          (balance === "debt"
            ? c.summary.balance > 0
            : balance === "zero"
              ? c.summary.balance === 0
              : c.summary.balance < 0)) &&
        (!boxes ||
          (boxes === "pending" ? c.summary.boxes > 0 : c.summary.boxes <= 0)) &&
        (!nq ||
          normalize(
            `${c.name} ${c.alias || ""} ${c.legalName || ""} ${c.cuit || ""} ${c.contactPhone || ""} ${c.zone || ""} ${c.code || ""} ${c.branch || ""}`,
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
      <p className="customers-count">
        <strong>{customers.length} fichas</strong>
        {pending ? <span> · {pending} por revisar</span> : null}
      </p>
      <div className="board-filters customers-filters">
        <SearchField
          value={q}
          onChange={setQ}
          label="Buscar clientes"
          placeholder="Nombre, CUIT, teléfono o zona"
        />
        <button
          type="button"
          className={"secondary filters-toggle" + (activeFilters ? " on" : "")}
          aria-expanded={showFilters}
          onClick={() => {
            setDraft(filters);
            setShowFilters((v) => !v);
          }}
        >
          <SlidersHorizontal size={15} /> Filtros
          {activeFilters ? <b>{activeFilters}</b> : null}
        </button>
        <div className={"filters-panel" + (showFilters ? " open" : "")}>
          <select
            value={draft.zone}
            onChange={changeDraft("zone")}
            aria-label="Zona"
          >
            <option value="">Todas las zonas</option>
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
          <select
            value={draft.shift}
            onChange={changeDraft("shift")}
            aria-label="Turno"
          >
            <option value="">Mañana y tarde</option>
            <option value="manana">Mañana</option>
            <option value="tarde">Tarde</option>
          </select>
          <select
            value={draft.truck}
            onChange={changeDraft("truck")}
            aria-label="Preventista"
          >
            <option value="">Todos los preventistas</option>
            {drivers.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select
            value={draft.status}
            onChange={changeDraft("status")}
            aria-label="Estado"
          >
            <option value="">Todos los estados</option>
            {Object.entries(statusNames).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
          <select
            aria-label="Saldo monetario"
            value={draft.balance}
            onChange={changeDraft("balance")}
          >
            <option value="">Todos los saldos monetarios</option>
            <option value="debt">Con deuda</option>
            <option value="zero">Sin deuda (saldo 0)</option>
            <option value="credit">Saldo a favor</option>
          </select>
          <select
            aria-label="Saldo de cajas"
            value={draft.boxes}
            onChange={changeDraft("boxes")}
          >
            <option value="">Todas las cajas</option>
            <option value="pending">Con cajas pendientes</option>
            <option value="clear">Sin cajas pendientes</option>
          </select>
          <div className="ui-panel-actions">
            <button type="button" className="secondary" onClick={clearFilters}>
              Limpiar
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                setFilters(draft);
                setShowFilters(false);
              }}
            >
              Aplicar filtros
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => setShowFilters(false)}
            >
              Cerrar filtros
            </button>
          </div>
        </div>
        <button
          className="primary"
          onClick={() => setModal({ type: "new-customer" })}
        >
          <UserPlus size={15} /> Nuevo cliente
        </button>
        {session?.role === "admin" && <ImportCustomers />}
        {session?.role === "admin" && (
          <Link to="/operacion/tarifas" className="secondary">
            Listas de precios
          </Link>
        )}
      </div>
      <div className="active-filter-list" aria-label="Filtros activos">
        {Object.entries(filters)
          .filter(([, v]) => v)
          .map(([key, value]) => (
            <button
              type="button"
              className="filter-chip"
              key={key}
              onClick={() => setFilters((v) => ({ ...v, [key]: "" }))}
              aria-label={`Quitar ${filterNames[key]}`}
            >
              {filterNames[key]}: {filterValues[value] || value} ×
            </button>
          ))}
        <span role="status">
          {list.length} de {customers.length} clientes
        </span>
      </div>
      {list.length === 0 ? (
        <p className="muted">Ningún cliente coincide con el filtro.</p>
      ) : mobile ? (
        <ul className="customer-cards">
          {list.map((c) => {
            const st = c.status || "ok";
            const alDia = c.summary.balance === 0 && c.summary.boxes === 0;
            return (
              <li key={c.phone} className={"customer-card status-" + st}>
                <div className="cc-top">
                  <h3>
                    {c.name}{" "}
                    {c.branch && (
                      <span className="ui-tag sucursal">{c.branch}</span>
                    )}
                  </h3>
                  {alDia ? (
                    <span className="al-dia">Al día</span>
                  ) : (
                    <strong className={c.summary.balance > 0 ? "red" : "green"}>
                      {c.summary.balance === 0
                        ? "—"
                        : c.summary.balance > 0
                          ? money(c.summary.balance)
                          : `${money(-c.summary.balance)} a favor`}
                    </strong>
                  )}
                </div>
                {c.legalName && c.legalName !== c.name && (
                  <p className="muted small">{c.legalName}</p>
                )}
                <p className="cc-meta">
                  {[
                    c.zone,
                    shiftNames[c.shift || ""] !== "—"
                      ? shiftNames[c.shift || ""]
                      : null,
                    c.truck || c.driver,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Sin zona"}
                </p>
                <div className="cc-tags">
                  <CajasChip customer={c} />
                  {st !== "ok" && (
                    <span className={"status-pill " + st}>
                      {statusNames[st]}
                    </span>
                  )}
                </div>
                <div className="cc-actions">
                  <button
                    type="button"
                    className="secondary cc-main"
                    onClick={() => setModal({ type: "saldos", customer: c })}
                  >
                    <Wallet size={15} /> Saldos
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setModal({ type: "ficha", customer: c })}
                  >
                    <FileText size={15} /> Ficha
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setModal({ type: "prices", customer: c })}
                  >
                    <Tag size={15} /> Precios
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="table-scroll">
          <table className="customers gc-customers">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Zona y preventista</th>
                <th className="num">Pollo $/kg</th>
                <th className="num">Saldo</th>
                <th className="num">Envases</th>
                <th>Estado</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
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
                      {c.branch && (
                        <span className="ui-tag sucursal">
                          Sucursal · {c.branch}
                        </span>
                      )}
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
                      {c.zone || <span className="muted">Sin zona</span>}
                      {shiftNames[c.shift || ""] !== "—" ? (
                        <small> · {shiftNames[c.shift || ""]}</small>
                      ) : null}
                      <br />
                      <small>{c.truck || c.driver || "Sin asignar"}</small>
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
                    <td className="row-actions cust-actions">
                      <button
                        type="button"
                        className="secondary small"
                        title="Ver y corregir el saldo de cuenta y el de cajas"
                        onClick={() =>
                          setModal({ type: "saldos", customer: c })
                        }
                      >
                        <Wallet size={14} /> Saldos
                      </button>
                      {c.summary.balance > 0 && (
                        <button
                          type="button"
                          className="primary small"
                          disabled={busy}
                          onClick={() =>
                            setModal({ type: "account-payment", customer: c })
                          }
                        >
                          Cobrar
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-action"
                        title="Ficha"
                        aria-label={"Ficha de " + c.name}
                        onClick={() => setModal({ type: "ficha", customer: c })}
                      >
                        <FileText size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action"
                        title="Precios"
                        aria-label={"Precios de " + c.name}
                        onClick={() =>
                          setModal({ type: "prices", customer: c })
                        }
                      >
                        <Tag size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-action"
                        title="Extracto de cuenta"
                        aria-label={"Extracto de " + c.name}
                        onClick={() =>
                          setModal({ type: "statement", customer: c })
                        }
                      >
                        <ScrollText size={16} />
                      </button>
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
        Object.assign(f, docModeFlags(f.docMode || "completo"));
        delete f.docMode;
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
        <label className="wide">
          Remito
          <select name="docMode" defaultValue={docModeOf(c)}>
            {Object.entries(DOC_MODES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
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
