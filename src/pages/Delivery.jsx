import React from "react";
import { Truck, LogOut, ShieldCheck, Navigation, Map } from "lucide-react";
import { kgText, totalKg } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";
import { PageHead, EmptyState } from "../components/ui.jsx";
import OrderCard from "../components/OrderCard.jsx";
import PushToggle from "../components/PushToggle.jsx";

/** Vista del repartidor: solo sus entregas, con GPS, navegación, cobro y envases. */
export default function Delivery() {
  const { session, orders, logout, sharing, live, config } = useStore();
  if (session?.role !== "repartidor" && session?.role !== "admin")
    return (
      <>
        <PageHead
          title="Mis entregas."
          description="Acceso para repartidores de Pollito Casero."
        />
        <EmptyState
          icon={ShieldCheck}
          title="Ingresá con tu nombre y el PIN del equipo"
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
  const routeUrl =
    routeStops.length > 0
      ? `https://www.google.com/maps/dir/?api=1&origin=${config?.origin ? config.origin.lat + "," + config.origin.lng : ""}&destination=${encodeURIComponent(point(routeStops.at(-1)))}${
          routeStops.length > 1
            ? "&waypoints=" +
              encodeURIComponent(
                routeStops.slice(0, -1).slice(0, 9).map(point).join("|"),
              )
            : ""
        }&travelmode=driving`
      : null;
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
          <span className={"live-indicator " + (live ? "on" : "")}>
            <i /> {live ? "En vivo" : "Reconectando…"}
          </span>
          <PushToggle compact />
          <button className="link-button" onClick={logout}>
            <LogOut size={14} /> Salir
          </button>
        </div>
      </PageHead>
      {sharing && (
        <div className="notice sharing-notice">
          <Navigation size={18} /> Estás compartiendo tu ubicación para el
          pedido {sharing}. Se detiene al completar la entrega o al cerrar la
          app.
        </div>
      )}
      {routeStops.length > 0 && (
        <div className="notice route-summary">
          <Map size={18} />
          <span>
            {routeStops.length} {routeStops.length === 1 ? "parada" : "paradas"}
            {zones.length ? ` · ${zones.join(" · ")}` : ""} ·{" "}
            {kgText(routeStops.reduce((s, o) => s + totalKg(o), 0))}
          </span>
          <a
            className="secondary route-link"
            href={routeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Navigation size={15} /> Ruta completa en Google Maps
          </a>
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
    </>
  );
}
