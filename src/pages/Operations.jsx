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
} from "../lib/format.js";
import { routeSheet, receivables, today } from "../lib/report.js";
import { PageHead, EmptyState } from "../components/ui.jsx";
import OrderCard from "../components/OrderCard.jsx";
import RouteSheet from "../components/RouteSheet.jsx";
import CashClosure from "../components/CashClosure.jsx";

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
  } = useStore();
  const { path, query, navigate } = useRoute();
  const tab =
    {
      "/operacion/reparto": "reparto",
      "/operacion/clientes": "clientes",
      "/operacion/equipo": "equipo",
    }[path] || "pedidos";
  // Filtros del tablero en la URL: se comparten y sobreviven al botón atrás.
  const [showAll, setShowAll] = useState(query.get("todo") === "1");
  const [search, setSearch] = useState(query.get("q") || "");
  const [driverFilter, setDriverFilter] = useState(query.get("rep") || "");
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
  const [date, setDate] = useState(today());
  const [driver, setDriver] = useState("");
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
  const selectedDriver = driver || drivers[0] || "";
  const cancelled = orders.filter((o) => o.status === "cancelado");
  // Búsqueda operativa: número de pedido, cliente, teléfono, dirección o localidad; y por repartidor.
  const q = normalize(search.trim());
  const matches = (o) =>
    (!driverFilter || o.driver === driverFilter) &&
    (!q ||
      normalize(
        `${o.id} ${o.name} ${o.phone} ${o.customer} ${o.address} ${o.locality?.name || ""}`,
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
      "Pedidos por preparar.",
      "Recibidos, en preparación, en camino y entregados.",
    ],
    reparto: [
      "Reparto y rendición.",
      "Hoja de ruta por repartidor y efectivo a rendir.",
    ],
    clientes: [
      "Clientes.",
      "Modalidad, cuenta corriente y repartidor habitual.",
    ],
    equipo: ["Equipo.", "Quién entra, con qué rol y con qué contraseña."],
  };
  const sheet = routeSheet(orders, customers, { driver: selectedDriver, date });
  const printUrl = (params) =>
    "/imprimir?" + new URLSearchParams(params).toString();
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
              <Link
                to={printUrl({ tipo: "pedidos", fecha: today() })}
                className="secondary"
              >
                <Printer size={15} /> Hoja de pedidos
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
          <p className="board-hint">
            Los pedidos entran a <strong>Recibidos</strong>. Pesalos y pasalos a{" "}
            <strong>En preparación</strong>, asigná repartidor y tocá{" "}
            <strong>Iniciar reparto</strong>; el repartidor cobra y completa la
            entrega desde su app.
          </p>
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
              <option value="">Todos los repartidores</option>
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
              Historial completo
            </label>
          </div>
        </div>
      )}
      {tab === "pedidos" && (
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
                        {o.id} · {o.name} · {dateText(o.created)}
                      </p>
                    ))}
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}

      {tab === "reparto" && (
        <section className="panel route-panel">
          <div className="route-controls">
            <label>
              Repartidor
              <select
                value={selectedDriver}
                onChange={(e) => setDriver(e.target.value)}
                aria-label="Repartidor de la hoja de ruta"
              >
                {drivers.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label>
              Fecha
              <input
                type="date"
                value={date}
                max={today()}
                onChange={(e) => setDate(e.target.value || today())}
              />
            </label>
            <Link
              to={printUrl({
                tipo: "ruta",
                repartidor: selectedDriver,
                fecha: date,
              })}
              className="secondary"
            >
              <Printer size={15} /> Imprimir hoja de ruta
            </Link>
            <Link
              to={printUrl({ tipo: "pedidos", fecha: date })}
              className="secondary"
            >
              <Printer size={15} /> Imprimir pedidos del día
            </Link>
          </div>
          <RouteSheet sheet={sheet} />
          <CashClosure sheet={sheet} date={date} driver={selectedDriver} />
        </section>
      )}

      {tab === "clientes" && <Customers />}
      {tab === "equipo" && <Team />}
    </>
  );
}
