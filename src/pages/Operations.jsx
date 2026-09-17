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
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link, useRoute } from "../lib/router.jsx";
import Team from "./Team.jsx";
import Customers from "./Customers.jsx";
import News from "../components/News.jsx";
import { money, normalize, orderNumber } from "../lib/format.js";
import { receivables } from "../lib/report.js";
import { todayKey } from "../lib/day.js";
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
  const matches = (o) =>
    (!driverFilter ||
      o.driver === driverFilter ||
      o.driver2 === driverFilter) &&
    (!dateFilter || dayOf(o) === dateFilter) &&
    (!shiftFilter || (o.shift || "") === shiftFilter) &&
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
    boxes: orders.reduce((s, o) => s + (o.boxes || 0) - (o.returned || 0), 0),
  };
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
        <div className="stats">
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
                className={"link-button small" + (dateFilter ? "" : " active")}
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
          </div>
        </div>
      )}
      {tab === "pedidos" && (
        <section className="panel">
          <OrdersList
            orders={[...orders]
              .filter(
                (o) => matches(o) && (showAll || o.status !== "cancelado"),
              )
              .filter(
                (o) =>
                  showAll ||
                  o.status !== "entregado" ||
                  recent([o], "entregado").length,
              )
              .sort(
                (a, b) =>
                  (a.deliveryDate || "").localeCompare(b.deliveryDate || "") ||
                  (a.number || 0) - (b.number || 0),
              )}
            role="admin"
          />
        </section>
      )}
      {tab === "clientes" && <Customers />}
      {tab === "equipo" && <Team />}
    </>
  );
}
