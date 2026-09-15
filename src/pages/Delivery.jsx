import React from "react";
import {
  Truck,
  LogOut,
  ShieldCheck,
  Navigation,
  Map,
  Wallet,
  Package,
} from "lucide-react";
import { kgText, totalKg, money } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";
import { PageHead, EmptyState } from "../components/ui.jsx";
import OrderCard from "../components/OrderCard.jsx";
import News from "../components/News.jsx";
import TruckLocation from "../components/TruckLocation.jsx";

/** Vista del repartidor: solo sus entregas, con GPS, navegación, cobro y envases. */
export default function Delivery() {
  const {
    session,
    orders,
    logout,
    sharing,
    live,
    config,
    customers,
    setModal,
    busy,
  } = useStore();
  const accounts = customers
    .filter((c) => (c.summary?.balance || 0) > 0 || (c.summary?.boxes || 0) > 0)
    .sort(
      (a, b) =>
        (b.mine === true) - (a.mine === true) ||
        (b.summary?.balance || 0) - (a.summary?.balance || 0),
    );
  if (session?.role !== "repartidor" && session?.role !== "admin")
    return (
      <>
        <PageHead
          title="Mis entregas."
          description="Acceso para repartidores de Pollito Casero."
        />
        <EmptyState
          icon={ShieldCheck}
          title="Ingresá con tu usuario y contraseña"
          to="/acceso"
          action="Ir al acceso del equipo"
        />
      </>
    );
  const mine = orders;
  const byZone = (a, b) =>
    (a.locality?.name || "").localeCompare(b.locality?.name || "") ||
    a.created.localeCompare(b.created);
  const ready = mine.filter((o) => o.status === "preparando").sort(byZone);
  const onRoute = mine.filter((o) => o.status === "en_camino").sort(byZone);
  const routeStops = [...onRoute, ...ready];
  const point = (o) =>
    o.destination
      ? `${o.destination.lat},${o.destination.lng}`
      : `${o.address}, ${o.locality?.name || ""}, Mendoza, Argentina`;
  // Google Maps admite 10 puntos por enlace: la ruta se divide en tramos consecutivos.
  const legs = [];
  for (let i = 0; i < routeStops.length; i += 10) {
    const stops = routeStops.slice(i, i + 10);
    const from =
      i === 0
        ? config?.origin
          ? config.origin.lat + "," + config.origin.lng
          : ""
        : point(routeStops[i - 1]);
    legs.push({
      from: i + 1,
      to: i + stops.length,
      url: `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(point(stops.at(-1)))}${
        stops.length > 1
          ? "&waypoints=" +
            encodeURIComponent(stops.slice(0, -1).map(point).join("|"))
          : ""
      }&travelmode=driving`,
    });
  }
  const zones = [
    ...new Set(routeStops.map((o) => o.locality?.name).filter(Boolean)),
  ];
  const done = mine.filter(
    (o) =>
      o.status === "entregado" &&
      (Date.now() - new Date(o.created) < 2 * 86400000 || o.boxes > o.returned),
  );
  return (
    <>
      <PageHead
        eyebrow="REPARTO"
        title={`Hoy sale ${session.name}.`}
        description="Tus entregas, en orden. Compartí tu GPS cuando salgas para que el cliente te vea llegar."
      >
        <div className="head-actions">
          <TruckLocation />
          <span className={"live-indicator " + (live ? "on" : "")}>
            <i /> {live ? "En vivo" : "Reconectando…"}
          </span>
        </div>
      </PageHead>
      {sharing && (
        <div className="notice sharing-notice">
          <Navigation size={18} /> Estás compartiendo tu ubicación para el
          pedido {sharing}. Se detiene al completar la entrega o al cerrar la
          app.
        </div>
      )}
      <News compact />
      {routeStops.length > 0 && (
        <div className="notice route-summary">
          <Map size={18} />
          <span>
            {routeStops.length} {routeStops.length === 1 ? "parada" : "paradas"}
            {zones.length ? ` · ${zones.join(" · ")}` : ""} ·{" "}
            {kgText(routeStops.reduce((s, o) => s + totalKg(o), 0))}
          </span>
          {legs.map((leg) => (
            <a
              key={leg.from}
              className="secondary route-link"
              href={leg.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Navigation size={15} />{" "}
              {legs.length === 1
                ? "Ruta completa en Google Maps"
                : `Tramo ${leg.from}–${leg.to} en Google Maps`}
            </a>
          ))}
        </div>
      )}
      {ready.length + onRoute.length + done.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Sin entregas asignadas"
          text="Cuando administración te asigne un pedido va a aparecer acá al instante."
        />
      ) : (
        <div className="delivery-sections">
          {onRoute.length > 0 && (
            <section aria-labelledby="en-camino">
              <h2 id="en-camino">En camino</h2>
              {onRoute.map((o) => (
                <OrderCard key={o.id} order={o} role={session.role} />
              ))}
            </section>
          )}
          {ready.length > 0 && (
            <section aria-labelledby="para-salir">
              <h2 id="para-salir">Listos para salir</h2>
              {ready.map((o) => (
                <OrderCard key={o.id} order={o} role={session.role} />
              ))}
            </section>
          )}
          {done.length > 0 && (
            <section aria-labelledby="entregados">
              <h2 id="entregados">Entregados</h2>
              {done.map((o) => (
                <OrderCard key={o.id} order={o} role={session.role} />
              ))}
            </section>
          )}
        </div>
      )}
      <section
        className="panel accounts-panel"
        aria-labelledby="clientes-reparto"
      >
        <div className="section-line">
          <h2 id="clientes-reparto">Clientes con saldo o envases</h2>
          <span className="muted">Primero los de mi reparto</span>
        </div>
        {accounts.length === 0 ? (
          <p className="muted">
            Ningún cliente tuyo tiene saldo ni envases pendientes.
          </p>
        ) : (
          <ul className="accounts-list">
            {accounts.map((c) => (
              <li key={c.phone}>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {c.address ? c.address + " · " : ""}
                    {c.summary.balance > 0
                      ? `Debe ${money(c.summary.balance)}`
                      : "Sin saldo"}{" "}
                    · {c.summary.boxes}{" "}
                    {c.summary.boxes === 1 ? "envase" : "envases"}
                  </small>
                </div>
                <div className="accounts-actions">
                  {c.summary.balance > 0 && (
                    <button
                      className="secondary small"
                      disabled={busy}
                      onClick={() =>
                        setModal({ type: "account-payment", customer: c })
                      }
                    >
                      <Wallet size={14} /> Cobrar
                    </button>
                  )}
                  {c.summary.boxes > 0 && (
                    <button
                      className="secondary small"
                      disabled={busy}
                      onClick={() =>
                        setModal({ type: "boxes-return", customer: c })
                      }
                    >
                      <Package size={14} /> Recibir envases
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
