import React, { useEffect, useState } from "react";
import {
  Settings2,
  Users,
  ClipboardList,
  Plus,
  LogOut,
  ShieldCheck,
  Wallet,
  Package,
  Truck,
  Printer,
  SlidersHorizontal,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link, useRoute } from "../lib/router.jsx";
import Team from "./Team.jsx";
import Customers from "./Customers.jsx";
import News from "../components/News.jsx";
import { money, normalize, orderNumber, orderShift } from "../lib/format.js";
import { receivables } from "../lib/report.js";
import { todayKey, dmy } from "../lib/day.js";
import { PageHead, EmptyState } from "../components/ui.jsx";
import OrdersList from "../components/OrdersList.jsx";

export default function Operations() {
  const {
    session,
    orders,
    customers,
    logout,
    updateCustomer,
    busy,
    config,
    live,
    setModal,
    reload,
  } = useStore();
  const { path, query, navigate } = useRoute();
  const tab =
    {
      "/operacion/clientes": "clientes",
      "/operacion/equipo": "equipo",
    }[path] || "pedidos";
  // Filtros del tablero en la URL: se comparten y sobreviven al botón atrás.
  const [showAll, setShowAll] = useState(query.get("todo") === "1");
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState(query.get("q") || "");
  const [driverFilter, setDriverFilter] = useState(query.get("rep") || "");
  // Fecha de reparto (hoy por defecto; vacío = todas) y turno.
  const [dateFilter, setDateFilter] = useState(
    query.has("fecha")
      ? query.get("fecha") === "todas"
        ? ""
        : query.get("fecha")
      : todayKey(),
  );
  const [shiftFilter, setShiftFilter] = useState(query.get("turno") || "");
  // Datos frescos cada vez que se entra a Pedidos (además del canal en vivo).
  useEffect(() => {
    reload();
  }, [tab, reload]);
  useEffect(() => {
    if (path !== "/operacion") return;
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (driverFilter) params.set("rep", driverFilter);
    if (dateFilter !== todayKey()) params.set("fecha", dateFilter || "todas");
    if (shiftFilter) params.set("turno", shiftFilter);
    if (showAll) params.set("todo", "1");
    const next = params.toString();
    if (next !== location.search.replace(/^\?/, ""))
      navigate("/operacion" + (next ? "?" + next : ""), {
        replace: true,
        scroll: false,
      });
  }, [search, driverFilter, dateFilter, shiftFilter, showAll, path]);
  if (session?.role !== "admin")
    return (
      <>
        <PageHead
          title="Panel de operación."
          description="Acceso reservado a Pollito Casero."
        />
        <EmptyState
          icon={ShieldCheck}
          title="Ingresá con tu usuario y contraseña del equipo"
          to="/admin"
          action="Ir al acceso de administración"
        />
      </>
    );
  const drivers = config?.drivers || [];
  // Búsqueda operativa: número de pedido, cliente, teléfono, dirección o localidad; y por repartidor.
  const q = normalize(search.trim());
  const dayOf = (o) => o.deliveryDate || (o.created || "").slice(0, 10);
  // Turno del pedido; si no tiene, el habitual de la ficha del cliente.
  const shiftOf = (o) => orderShift(o, customers);
  // Pedidos abiertos que quedan fuera de la fecha elegida (p. ej. cargados para mañana).
  const activeFilters =
    (dateFilter && dateFilter !== todayKey() ? 1 : 0) +
    (shiftFilter ? 1 : 0) +
    (driverFilter ? 1 : 0) +
    (showAll ? 1 : 0);
  const otherDates = dateFilter
    ? Object.entries(
        orders
          .filter(
            (o) =>
              ["recibido", "preparando", "en_camino"].includes(o.status) &&
              dayOf(o) !== dateFilter,
          )
          .reduce((m, o) => ((m[dayOf(o)] = (m[dayOf(o)] || 0) + 1), m), {}),
      )
        .map(([date, n]) => ({ date, n }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const matches = (o) =>
    (!driverFilter ||
      o.driver === driverFilter ||
      o.driver2 === driverFilter) &&
    (!dateFilter || dayOf(o) === dateFilter) &&
    (!shiftFilter || shiftOf(o) === shiftFilter) &&
    (!q ||
      normalize(
        `${o.id} ${orderNumber(o)} ${o.name} ${o.phone} ${o.customer} ${o.address} ${o.locality?.name || ""}`,
      ).includes(q));
  // Los pedidos abiertos se ven siempre; el filtro de antigüedad solo recorta los entregados.
  const recent = (list, status) =>
    showAll || status !== "entregado" || q
      ? list
      : list.filter(
          (o) =>
            Date.now() - new Date(o.created) < 3 * 86400000 ||
            (o.payment === "cuenta" && !o.paid) ||
            o.boxes > o.returned,
        );
  const totals = {
    open: orders.filter((o) =>
      ["recibido", "preparando", "en_camino"].includes(o.status),
    ).length,
    unpaid: receivables(orders, customers).total,
    boxes: customers.reduce((s, c) => s + (c.summary?.boxes || 0), 0),
  };
  const visibles = [...orders]
    .filter((o) => matches(o) && (showAll || o.status !== "cancelado"))
    .filter(
      (o) =>
        showAll || o.status !== "entregado" || recent([o], "entregado").length,
    )
    .sort(
      (a, b) =>
        (a.deliveryDate || "").localeCompare(b.deliveryDate || "") ||
        (a.number || 0) - (b.number || 0),
    );
  const limpiar = () => {
    setSearch("");
    setDateFilter(todayKey());
    setShiftFilter("");
    setDriverFilter("");
    setShowAll(false);
  };
  // Filtros puestos, cada uno con su "quitar": se ve qué está recortando la lista.
  const puestos = [
    dateFilter && dateFilter !== todayKey()
      ? ["Fecha", dmy(dateFilter), () => setDateFilter(todayKey())]
      : null,
    !dateFilter ? ["Fecha", "todas", () => setDateFilter(todayKey())] : null,
    shiftFilter
      ? [
          "Turno",
          shiftFilter === "manana" ? "Mañana" : "Tarde",
          () => setShiftFilter(""),
        ]
      : null,
    driverFilter
      ? ["Preventista", driverFilter, () => setDriverFilter("")]
      : null,
    showAll
      ? ["Incluye", "entregados y anteriores", () => setShowAll(false)]
      : null,
  ].filter(Boolean);
  const heads = {
    pedidos: [
      "Pedidos.",
      "Todos los pedidos con su estado; marcá Cargado cuando suben al camión.",
    ],
    clientes: [
      "Clientes.",
      "Modalidad, cuenta corriente y repartidor habitual.",
    ],
    equipo: ["Equipo.", "Quién entra, con qué rol y con qué contraseña."],
  };
  return (
    <>
      <PageHead
        eyebrow="OPERACIÓN · POLLITO CASERO"
        title={heads[tab][0]}
        description={heads[tab][1]}
      >
        <div className="head-actions">
          <span className={"live-indicator " + (live ? "on" : "")}>
            <i /> {live ? "En vivo" : "Reconectando…"}
          </span>
          {tab === "pedidos" && (
            <>
              <Link to="/operacion/nuevo" className="primary">
                <Plus size={15} /> Cargar pedido
              </Link>
              <Link to="/operacion/imprimir" className="secondary">
                <Printer size={15} /> Imprimir
              </Link>
            </>
          )}
        </div>
      </PageHead>
      {tab === "pedidos" && (
        <div className="stats stats-strip">
          <div>
            <ClipboardList size={18} />
            <strong>{totals.open}</strong>
            <span>pedidos abiertos</span>
          </div>
          <div>
            <Wallet size={18} />
            <strong>{money(totals.unpaid)}</strong>
            <span>por cobrar</span>
          </div>
          <div>
            <Package size={18} />
            <strong>{totals.boxes}</strong>
            <span>envases en la calle</span>
          </div>
          <div>
            <Users size={18} />
            <strong>{customers.length}</strong>
            <span>clientes</span>
          </div>
        </div>
      )}
      {tab === "pedidos" && <News compact />}
      {tab === "pedidos" && (
        <div className="board-toolbar">
          <div className="board-filters">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pedido, cliente, teléfono o dirección…"
              aria-label="Buscar pedidos"
            />
            <button
              type="button"
              className={
                "secondary filters-toggle" + (activeFilters ? " on" : "")
              }
              aria-expanded={showFilters}
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal size={15} /> Filtros
              {activeFilters ? <b>{activeFilters}</b> : null}
            </button>
            <div className={"filters-panel" + (showFilters ? " open" : "")}>
              <span className="date-filter">
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  aria-label="Fecha de reparto"
                />
                {dateFilter && dateFilter !== todayKey() && (
                  <button
                    type="button"
                    className="link-button small"
                    onClick={() => setDateFilter(todayKey())}
                  >
                    Hoy
                  </button>
                )}
                <button
                  type="button"
                  className={
                    "link-button small" + (dateFilter ? "" : " active")
                  }
                  onClick={() => setDateFilter(dateFilter ? "" : todayKey())}
                  title="Ver todas las fechas"
                >
                  {dateFilter ? "Todas las fechas" : "Solo hoy"}
                </button>
              </span>
              <select
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                aria-label="Filtrar por turno"
              >
                <option value="">Mañana y tarde</option>
                <option value="manana">Turno mañana</option>
                <option value="tarde">Turno tarde</option>
              </select>
              <select
                value={driverFilter}
                onChange={(e) => setDriverFilter(e.target.value)}
                aria-label="Filtrar por repartidor"
              >
                <option value="">Todos los preventistas</option>
                {drivers.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />{" "}
                Ver entregados y anteriores
              </label>
              <div className="ui-panel-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setDateFilter("");
                    setShiftFilter("");
                    setDriverFilter("");
                    setShowAll(false);
                  }}
                >
                  Limpiar filtros
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setShowFilters(false)}
                >
                  Aplicar filtros
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {tab === "pedidos" && (
        <div className="active-filter-list" aria-label="Filtros activos">
          {puestos.map(([nombre, valor, quitar]) => (
            <button
              type="button"
              className="filter-chip"
              key={nombre + valor}
              onClick={quitar}
              aria-label={`Quitar el filtro ${nombre}: ${valor}`}
            >
              {nombre}: {valor} ×
            </button>
          ))}
          <span role="status">
            {visibles.length} de {orders.length} pedidos
            {search.trim() ? ` con “${search.trim()}”` : ""}
          </span>
        </div>
      )}
      {tab === "pedidos" && dateFilter && otherDates.length > 0 && (
        <p className="notice other-dates">
          Con esta fecha no se ven {otherDates.reduce((n, d) => n + d.n, 0)}{" "}
          pedidos abiertos de otros días:{" "}
          {otherDates.map((d, i) => (
            <React.Fragment key={d.date}>
              {i > 0 ? " · " : ""}
              <button
                type="button"
                className="link-button"
                onClick={() => setDateFilter(d.date)}
              >
                {dmy(d.date)} ({d.n})
              </button>
            </React.Fragment>
          ))}
          {" · "}
          <button
            type="button"
            className="link-button"
            onClick={() => setDateFilter("")}
          >
            ver todas las fechas
          </button>
        </p>
      )}
      {tab === "pedidos" && (
        <section className="panel">
          {visibles.length === 0 ? (
            <div className="ui-empty">
              <ClipboardList size={26} />
              <strong>Ningún pedido coincide</strong>
              <p>
                Probá con otra fecha, otro turno o limpiá los filtros para ver
                todo.
              </p>
              {(activeFilters > 0 || search.trim()) && (
                <button type="button" className="secondary" onClick={limpiar}>
                  Limpiar búsqueda y filtros
                </button>
              )}
            </div>
          ) : (
            <OrdersList orders={visibles} role="admin" />
          )}
        </section>
      )}
      {tab === "clientes" && <Customers />}
      {tab === "equipo" && <Team />}
    </>
  );
}
