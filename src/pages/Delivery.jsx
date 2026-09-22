import React, { useEffect, useState } from "react";
import {
  Truck,
  ShieldCheck,
  Package,
  Wallet,
  Scale,
  ArrowRight,
  MapPin,
  FileText,
} from "lucide-react";
import { kgText, totalKg, money, orderNumber, labels } from "../lib/format.js";
import { useStore } from "../lib/store.jsx";
import { PageHead, EmptyState, StatusBadge } from "../components/ui.jsx";
import News from "../components/News.jsx";
import UnreadBanner from "../components/UnreadBanner.jsx";

/** Cajas pedidas y kilos pesados de un pedido, para el resumen de la tarjeta. */
const boxesOf = (o) => o.items.reduce((s, i) => s + (i.boxes || 0), 0);

/**
 * Mis entregas: la lista del día del preventista, pensada para el celular.
 * La acción principal de cada tarjeta es "Ver pedido": abre la ficha completa sin tocar nada.
 */
export default function Delivery() {
  const { session, orders, live, customers, setModal, busy, reload } =
    useStore();
  const [filter, setFilter] = useState("pendientes");
  useEffect(() => {
    reload();
  }, [reload]);

  if (session?.role !== "repartidor" && session?.role !== "admin")
    return (
      <>
        <PageHead
          title="Mis entregas."
          description="Acceso para preventistas de Pollito Casero."
        />
        <EmptyState
          icon={ShieldCheck}
          title="Ingresá con tu usuario y contraseña"
          to="/admin"
          action="Ir al acceso del equipo"
        />
      </>
    );

  const byZone = (a, b) =>
    (a.locality?.name || "").localeCompare(b.locality?.name || "") ||
    (a.number || 0) - (b.number || 0);
  const mine = orders.filter((o) => o.status !== "cancelado");
  const ready = mine.filter((o) => o.status === "preparando").sort(byZone);
  const onRoute = mine.filter((o) => o.status === "en_camino").sort(byZone);
  const pending = mine
    .filter((o) => ["recibido", "preparando", "en_camino"].includes(o.status))
    .sort(byZone);
  const done = mine
    .filter(
      (o) =>
        o.status === "entregado" &&
        (Date.now() - new Date(o.created) < 2 * 86400000 ||
          o.boxes > o.returned),
    )
    .sort(byZone);
  const groups = {
    pendientes: pending,
    camino: onRoute,
    entregadas: done,
  };
  const list = groups[filter] || pending;
  const kgToday = pending.reduce((s, o) => s + totalKg(o), 0);
  const cobrado = done
    .filter((o) => o.paid)
    .reduce((s, o) => s + (o.total || 0), 0);
  const accounts = customers
    .filter((c) => (c.summary?.balance || 0) > 0 || (c.summary?.boxes || 0) > 0)
    .sort((a, b) => (b.summary?.balance || 0) - (a.summary?.balance || 0))
    .slice(0, 6);

  return (
    <>
      <PageHead
        eyebrow="REPARTO"
        title={`Hola, ${session.name.split(" ")[0]}.`}
        description="Tus entregas de hoy, en orden."
      >
        <div className="head-actions">
          <span className={"live-indicator " + (live ? "on" : "")}>
            <i /> {live ? "En vivo" : "Reconectando…"}
          </span>
        </div>
      </PageHead>
      <UnreadBanner />

      <section className="hero-card" aria-label="Resumen del día">
        <div className="hero-metric">
          <small>Entregas pendientes</small>
          <strong>{pending.length}</strong>
          <span>
            {done.length} {done.length === 1 ? "entregada" : "entregadas"}
          </span>
        </div>
        <div className="hero-side">
          <div>
            <small>Kilos a repartir</small>
            <b>{kgToday ? kgText(kgToday) : "A pesar"}</b>
          </div>
          <div>
            <small>Cobrado hoy</small>
            <b>{money(cobrado)}</b>
          </div>
        </div>
      </section>

      <div className="pill-filters" role="group" aria-label="Filtrar entregas">
        {[
          ["pendientes", "Para entregar", pending.length],
          ["camino", "En camino", onRoute.length],
          ["entregadas", "Entregadas", done.length],
        ].map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            className={"pill" + (filter === id ? " active" : "")}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label} <span>{n}</span>
          </button>
        ))}
      </div>

      <News compact />

      {list.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={
            filter === "entregadas"
              ? "Todavía no entregaste pedidos"
              : "Sin entregas por ahora"
          }
          text="Cuando administración te asigne un pedido aparece acá al instante."
        />
      ) : (
        <ul className="delivery-list">
          {list.map((o) => {
            const cajas = boxesOf(o);
            return (
              <li key={o.id} className={"delivery-card st-" + o.status}>
                <div className="dc-top">
                  <span className="dc-num">N° {orderNumber(o)}</span>
                  <StatusBadge status={o.status} />
                </div>
                <h3>{o.name}</h3>
                <p className="dc-where">
                  <MapPin size={14} />
                  {[o.zone || o.locality?.name, o.address]
                    .filter(Boolean)
                    .join(" · ") || "Sin dirección"}
                </p>
                <div className="dc-facts">
                  <span>
                    <Package size={14} />
                    {cajas
                      ? `${cajas} ${cajas === 1 ? "caja" : "cajas"}`
                      : "Por kilo"}
                  </span>
                  <span>
                    <Scale size={14} />
                    {o.weighed ? kgText(totalKg(o)) : "A pesar"}
                  </span>
                  <span className={o.paid ? "green" : ""}>
                    <Wallet size={14} />
                    {o.noPricing
                      ? "Sin precio"
                      : o.weighed
                        ? `${money(o.total)}${o.paid ? " · cobrado" : o.payment === "cuenta" ? " · a cuenta" : ""}`
                        : "A pesar"}
                  </span>
                </div>
                <button
                  type="button"
                  className="primary full dc-open"
                  disabled={busy}
                  onClick={() => setModal({ type: "order-detail", order: o })}
                >
                  <FileText size={17} /> Ver pedido <ArrowRight size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {accounts.length > 0 && (
        <section className="panel accounts-panel">
          <div className="section-line">
            <h2>Clientes con saldo o envases</h2>
          </div>
          <ul className="accounts-list">
            {accounts.map((c) => (
              <li key={c.phone}>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {c.summary.balance > 0
                      ? `Debe ${money(c.summary.balance)}`
                      : "Sin saldo"}
                    {c.summary.boxes
                      ? ` · ${c.summary.boxes} ${c.summary.boxes === 1 ? "envase" : "envases"}`
                      : ""}
                  </small>
                </div>
                <div className="accounts-actions">
                  <button
                    type="button"
                    className="secondary small"
                    disabled={busy}
                    onClick={() => setModal({ type: "saldos", customer: c })}
                  >
                    <Wallet size={14} /> Saldos
                  </button>
                  {c.summary.boxes > 0 && (
                    <button
                      type="button"
                      className="secondary small"
                      disabled={busy}
                      onClick={() =>
                        setModal({ type: "boxes-return", customer: c })
                      }
                    >
                      <Package size={14} /> Envases
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
