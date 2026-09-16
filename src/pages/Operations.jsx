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
import {
  money,
  planNames,
  dateText,
  waLink,
  normalize,
  orderNumber,
} from "../lib/format.js";
import { receivables } from "../lib/report.js";
import { PageHead, EmptyState } from "../components/ui.jsx";
import OrderCard from "../components/OrderCard.jsx";
import OrdersList from "../components/OrdersList.jsx";
import RemitoActions from "../components/RemitoActions.jsx";
import { mapsRouteLegs, copyText } from "../lib/maps.js";

const columns = [
  ["recibido", "Recibidos", "Nuevos pedidos para preparar."],
  ["preparando", "En preparación", "Pesá, armá y asigná repartidor."],
  ["en_camino", "En camino", "Cobros y entregas en curso."],
  ["entregado", "Entregados", "Envases y pagos pendientes."],
];

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
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem("pedidos-vista") || "lista";
    } catch {
      return "lista";
    }
  });
  const chooseView = (v) => {
    setView(v);
    try {
      localStorage.setItem("pedidos-vista", v);
    } catch {}
  };
  const [driverFilter, setDriverFilter] = useState(query.get("rep") || "");
  // Datos frescos cada vez que se entra a Pedidos (además del canal en vivo).
  useEffect(() => {
    reload();
  }, [tab, reload]);
  useEffect(() => {
    if (path !== "/operacion") return;
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (driverFilter) params.set("rep", driverFilter);
    if (showAll) params.set("todo", "1");
    const next = params.toString();
    if (next !== location.search.replace(/^\?/, ""))
      navigate("/operacion" + (next ? "?" + next : ""), {
        replace: true,
        scroll: false,
      });
  }, [search, driverFilter, showAll, path]);
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
  const cancelled = orders.filter((o) => o.status === "cancelado");
  // Búsqueda operativa: número de pedido, cliente, teléfono, dirección o localidad; y por repartidor.
  const q = normalize(search.trim());
  const matches = (o) =>
    (!driverFilter || o.driver === driverFilter) &&
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
          <div className="view-toggle" role="group" aria-label="Vista">
            <button
              type="button"
              className={view === "lista" ? "active" : ""}
              onClick={() => chooseView("lista")}
            >
              Lista
            </button>
            <button
              type="button"
              className={view === "tarjetas" ? "active" : ""}
              onClick={() => chooseView("tarjetas")}
            >
              Tarjetas
            </button>
          </div>
          <div className="board-filters">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pedido, cliente, teléfono o dirección…"
              aria-label="Buscar pedidos"
            />
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
      {tab === "pedidos" && view === "lista" && (
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
                  (a.driver || "").localeCompare(b.driver || "") ||
                  (a.number || 0) - (b.number || 0),
              )}
            role="admin"
          />
        </section>
      )}
      {tab === "pedidos" && view === "tarjetas" && (
        <div className="board">
          {columns.map(([status, title, hint]) => {
            const list = recent(
              orders.filter((o) => o.status === status && matches(o)),
              status,
            );
            return (
              <section
                className={"board-column status-" + status}
                key={status}
                aria-labelledby={"col-" + status}
              >
                <header>
                  <h2 id={"col-" + status}>
                    {title} <span className="count">{list.length}</span>
                  </h2>
                  <p>{hint}</p>
                </header>
                {list.length === 0 ? (
                  <p className="board-empty">Nada por acá.</p>
                ) : (
                  list.map((o) => (
                    <OrderCard key={o.id} order={o} role="admin" />
                  ))
                )}
                {status === "entregado" && cancelled.length > 0 && (
                  <details className="cancelled-list">
                    <summary>{cancelled.length} cancelados</summary>
                    {cancelled.map((o) => (
                      <p key={o.id}>
                        N° {orderNumber(o)} · {o.name} · {dateText(o.created)}
                      </p>
                    ))}
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

      {tab === "clientes" && <Customers />}
      {tab === "equipo" && <Team />}
    </>
  );
}
