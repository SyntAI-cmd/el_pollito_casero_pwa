import React, { useState } from "react";
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
import { money, planNames, dateText, waLink } from "../lib/format.js";
import { routeSheet, today } from "../lib/report.js";
import { PageHead, EmptyState } from "../components/ui.jsx";
import OrderCard from "../components/OrderCard.jsx";
import RouteSheet from "../components/RouteSheet.jsx";

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
  const { path } = useRoute();
  const tab =
    {
      "/operacion/reparto": "reparto",
      "/operacion/clientes": "clientes",
      "/operacion/equipo": "equipo",
    }[path] || "pedidos";
  const [showAll, setShowAll] = useState(false);
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
          title="Ingresá con el PIN del equipo"
          to="/admin"
          action="Ir al acceso de administración"
        />
      </>
    );
  const drivers = config?.drivers || [];
  const selectedDriver = driver || drivers[0] || "";
  const cancelled = orders.filter((o) => o.status === "cancelado");
  const recent = (list) =>
    showAll
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
    unpaid: orders
      .filter((o) => !o.paid && o.status !== "cancelado")
      .reduce((s, o) => s + o.total, 0),
    boxes: orders.reduce((s, o) => s + (o.boxes || 0) - (o.returned || 0), 0),
  };
  const sheet = routeSheet(orders, customers, { driver: selectedDriver, date });
  const printUrl = (params) =>
    "/imprimir?" + new URLSearchParams(params).toString();
  return (
    <>
      <PageHead
        eyebrow="OPERACIÓN · POLLITO CASERO"
        title="Todo listo para salir."
        description="Pedidos, repartos, cobros y clientes en un solo lugar."
      >
        <div className="head-actions">
          <span className={"live-indicator " + (live ? "on" : "")}>
            <i /> {live ? "En vivo" : "Reconectando…"}
          </span>
          <Link
            to={printUrl({ tipo: "pedidos", fecha: today() })}
            className="secondary"
          >
            <Printer size={15} /> Hoja de pedidos
          </Link>
        </div>
      </PageHead>
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
      {tab === "pedidos" && (
        <div className="board-toolbar">
          <p className="board-hint">
            Los pedidos entran a <strong>Recibidos</strong>. Pesalos y pasalos a{" "}
            <strong>En preparación</strong>, asigná repartidor y tocá{" "}
            <strong>Iniciar reparto</strong>; el repartidor cobra y completa la
            entrega desde su app.
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />{" "}
            Ver historial completo
          </label>
        </div>
      )}
      {tab === "pedidos" && (
        <div className="board">
          {columns.map(([status, title, hint]) => {
            const list = recent(orders.filter((o) => o.status === status));
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
        </section>
      )}

      {tab === "clientes" && (
        <section className="panel">
          <div className="section-line">
            <h2>Clientes</h2>
            <span className="muted">
              Modalidad, cuenta corriente y repartidor habitual
            </span>
          </div>
          {customers.length === 0 ? (
            <p className="muted">
              Los clientes aparecen acá con su primer pedido.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="customers">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>WhatsApp</th>
                    <th>Modalidad</th>
                    <th>Cuenta corriente</th>
                    <th>Repartidor habitual</th>
                    <th>Saldo</th>
                    <th>Envases</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.phone}>
                      <td>
                        <strong>{c.name}</strong>
                        <br />
                        <small>
                          {c.address
                            ? `${c.address} · ${config?.localities?.find((l) => l.id === c.localityId)?.name || ""}`
                            : "Sin dirección"}
                        </small>
                      </td>
                      <td>
                        <a
                          href={waLink(
                            c.phone,
                            `Hola ${c.name.split(" ")[0]}, te escribo de Pollito Casero.`,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          +{c.phone}
                        </a>
                      </td>
                      <td>
                        <select
                          value={c.plan}
                          disabled={busy}
                          aria-label={"Modalidad de " + c.name}
                          onChange={(e) =>
                            updateCustomer(c, { plan: e.target.value })
                          }
                        >
                          {Object.entries(planNames).map(([v, n]) => (
                            <option key={v} value={v}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <label className="toggle">
                          <input
                            type="checkbox"
                            checked={!!c.credit}
                            disabled={busy}
                            onChange={(e) =>
                              updateCustomer(c, { credit: e.target.checked })
                            }
                          />
                          {c.credit ? "Habilitada" : "No habilitada"}
                        </label>
                      </td>
                      <td>
                        <select
                          value={c.driver || ""}
                          disabled={busy}
                          aria-label={"Repartidor habitual de " + c.name}
                          onChange={(e) =>
                            updateCustomer(c, { driver: e.target.value })
                          }
                        >
                          <option value="">Sin asignar</option>
                          {drivers.map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                      </td>
                      <td
                        className={
                          c.summary.balance > 0
                            ? "red"
                            : c.summary.balance < 0
                              ? "green"
                              : ""
                        }
                      >
                        {money(Math.abs(c.summary.balance))}
                        {c.summary.balance < 0 ? <small> a favor</small> : ""}
                      </td>
                      <td>{c.summary.boxes}</td>
                      <td>
                        {c.summary.balance > 0 && (
                          <button
                            className="secondary small"
                            disabled={busy}
                            onClick={() =>
                              setModal({ type: "account-payment", customer: c })
                            }
                          >
                            Cobrar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="demo-note">
            Los pedidos nuevos de un cliente con repartidor habitual salen ya
            asignados; podés cambiarlo en cada pedido.
          </p>
        </section>
      )}
      {tab === "equipo" && <Team />}
    </>
  );
}
