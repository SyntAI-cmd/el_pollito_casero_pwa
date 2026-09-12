import React, { lazy, Suspense, useState } from "react";
import {
  MapPin,
  Wallet,
  MessageCircle,
  ArrowUpRight,
  Navigation,
  Package,
  Clock,
  X,
  RefreshCw,
  Truck,
  Scale,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute, Link } from "../lib/router.jsx";
import {
  money,
  labels,
  kgText,
  timeText,
  paymentLabel,
  localityText,
  isActive,
  totalKg,
} from "../lib/format.js";
import {
  PageHead,
  EmptyState,
  StatusBadge,
  Timeline,
} from "../components/ui.jsx";
import PushToggle from "../components/PushToggle.jsx";

const LiveMap = lazy(() => import("../Map.jsx"));

export default function Tracking() {
  const { query } = useRoute();
  const {
    orders,
    session,
    config,
    contact,
    activeOrder,
    update,
    live,
    setModal,
    repeat,
  } = useStore();
  const [eta, setEta] = useState(null);
  const active = activeOrder(query.get("pedido"));
  const others = orders.filter((o) => o.id !== active?.id && isActive(o));

  if (!session)
    return (
      <>
        <PageHead
          eyebrow="DE NUESTRA PUERTA A LA TUYA"
          title="Tu pedido, paso a paso."
          description="Ingresá con tu teléfono para ver tus pedidos."
        />
        <EmptyState
          icon={Package}
          title="Todavía no te identificaste"
          text="Con tu nombre y tu WhatsApp recuperás tus pedidos en cualquier dispositivo."
        />
        <div className="actions-row">
          <button
            className="primary"
            onClick={() => setModal({ type: "login" })}
          >
            Ingresar con mi teléfono
          </button>
          <Link to="/" className="secondary">
            Ver el catálogo
          </Link>
        </div>
      </>
    );
  if (!active)
    return (
      <>
        <PageHead
          eyebrow="DE NUESTRA PUERTA A LA TUYA"
          title="Tu pedido, paso a paso."
          description="Acá vas a ver cómo viene tu entrega."
        />
        <EmptyState
          title="Todavía no tenés pedidos"
          to="/"
          action="Armar mi primer pedido"
        />
      </>
    );

  const canCancel = session.role === "cliente" && active.status === "recibido";
  // ETA: la del cliente (ruta OSRM desde el GPS del repartidor) o la calculada por el servidor al salir.
  const liveEta =
    eta && active.status === "en_camino" && active.location
      ? {
          minutes: eta.minutes,
          km: eta.km,
          arrival: new Date(Date.now() + eta.minutes * 60000),
        }
      : null;
  const serverEta =
    active.eta && active.status === "en_camino"
      ? {
          minutes: active.eta.minutes,
          km: active.eta.km,
          arrival: new Date(active.eta.arrival),
        }
      : null;
  const showEta = liveEta || serverEta;
  const arrivalText = (d) =>
    d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <PageHead
        eyebrow="DE NUESTRA PUERTA A LA TUYA"
        title="Tu pedido, paso a paso."
        description="Acá podés ver cómo viene tu entrega."
      />
      <div className="tracking-title">
        <div>
          <strong>{active.id}</strong>
          <StatusBadge status={active.status} />
        </div>
        <span className={"live-indicator " + (live ? "on" : "")}>
          <i /> {live ? "Actualización en vivo" : "Reconectando…"}
        </span>
      </div>
      {active.status === "en_camino" && showEta && (
        <div className="eta-banner" role="status">
          <Truck size={20} />
          <div>
            <strong>
              {active.driver} salió
              {active.departedAt
                ? ` a las ${timeText(active.departedAt)}`
                : ""}{" "}
              · llega aprox. a las {arrivalText(showEta.arrival)}
            </strong>
            <p>
              {Number(showEta.km).toFixed(1)} km por recorrer ·{" "}
              {showEta.minutes < 1
                ? "menos de 1 min"
                : `${showEta.minutes} min`}
              . La hora se actualiza con el GPS de la camioneta.
            </p>
          </div>
        </div>
      )}
      {active.status !== "en_camino" && active.driver && isActive(active) && (
        <div className="notice driver-notice">
          <Truck size={18} /> Tu pedido lo lleva{" "}
          <strong>{active.driver}</strong>. Te avisamos cuando salga la
          camioneta y a qué hora llega.
        </div>
      )}
      {session.role === "cliente" && isActive(active) && <PushToggle />}
      <div className="tracking-grid">
        <section className="map-card">
          <Suspense
            fallback={<div className="map-loading">Cargando mapa…</div>}
          >
            <LiveMap order={active} origin={config?.origin} onRoute={setEta} />
          </Suspense>
          <div className="map-caption">
            {showEta ? (
              <>
                <Clock size={16} />
                <span>
                  Llega aprox. a las{" "}
                  <strong>{arrivalText(showEta.arrival)}</strong> ·{" "}
                  {showEta.minutes < 1
                    ? "menos de 1 min"
                    : `${showEta.minutes} min`}{" "}
                  · {Number(showEta.km).toFixed(1)} km
                  {active.location
                    ? ` · GPS de ${timeText(active.location.at)}`
                    : " · estimado desde el local"}
                </span>
              </>
            ) : (
              <>
                <Navigation size={16} />
                <span>
                  {active.status === "entregado"
                    ? "Pedido entregado."
                    : active.location
                      ? `Ubicación de ${active.driver} actualizada a las ${timeText(active.location.at)}`
                      : active.status === "en_camino"
                        ? "Tu repartidor todavía no compartió su ubicación."
                        : active.destination
                          ? "Vas a ver al repartidor en el mapa cuando salga."
                          : active.destination === null
                            ? "Tu domicilio no se pudo ubicar en el mapa; el repartidor va con la dirección escrita."
                            : "Ubicando tu domicilio en el mapa…"}
                </span>
              </>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Así viene tu pedido</h2>
          <Timeline order={active} />
          <div className="driver">
            <span className="avatar">
              {active.driver ? active.driver[0] : "PC"}
            </span>
            <div>
              <strong>{active.driver || "Por asignar"}</strong>
              <p>
                {active.driver
                  ? "Tu repartidor"
                  : "Administración asignará el reparto"}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label={
                active.driver
                  ? `Escribir a ${active.driver} por WhatsApp`
                  : "Repartidor sin asignar"
              }
              disabled={!active.driverContact}
              onClick={() => contact("driver", active)}
            >
              <MessageCircle size={22} />
            </button>
          </div>
          <button
            className="secondary full"
            onClick={() => contact("admin", active)}
          >
            Hablar con {config?.adminName || "administración"}{" "}
            <ArrowUpRight size={15} />
          </button>
          {canCancel && (
            <button
              className="link-button danger"
              onClick={() => setModal({ type: "cancel", order: active })}
            >
              <X size={14} /> Cancelar este pedido
            </button>
          )}
        </section>
      </div>
      <section className="panel order-detail">
        <div>
          <h2>Detalle de entrega</h2>
          <p>
            <MapPin size={17} />
            {active.address}, {localityText(active)}
          </p>
          <p>
            <Wallet size={17} />
            {paymentLabel(active)} ·{" "}
            {active.paid
              ? "Pagado"
              : active.payment === "cuenta"
                ? "A cuenta"
                : "Pendiente"}
          </p>
          {active.notes && <p className="notes">“{active.notes}”</p>}
          {active.plan === "mayorista" && active.status === "entregado" && (
            <p>
              <Package size={17} />
              {active.boxes
                ? `${active.boxes} envases entregados · ${active.boxes - active.returned} pendientes`
                : "Sin envases en este pedido"}
            </p>
          )}
        </div>
        <div>
          {active.items.map((p) => (
            <p key={p.id}>
              {p.name} · {kgText(p.kg)}
              {p.weighed && p.ordered !== p.kg ? (
                <small> (pediste {kgText(p.ordered)})</small>
              ) : (
                ""
              )}{" "}
              <strong>{money(p.lineTotal ?? p.price * p.kg)}</strong>
            </p>
          ))}
          {active.weighed && (
            <p className="weighed-note">
              <Scale size={14} /> Pesado en balanza · el total refleja los kilos
              reales.
            </p>
          )}
          {active.shipping > 0 && (
            <p>
              Envío <strong>{money(active.shipping)}</strong>
            </p>
          )}
          <p className="total">
            Total <strong>{money(active.total)}</strong>
          </p>
          {active.status === "entregado" && session.role === "cliente" && (
            <button className="secondary" onClick={() => repeat(active)}>
              <RefreshCw size={15} /> Repetir este pedido
            </button>
          )}
        </div>
      </section>
      {others.length > 0 && (
        <section className="panel">
          <h2>Otros pedidos en curso</h2>
          <div className="order-chips">
            {others.map((o) => (
              <Link
                key={o.id}
                to={"/seguimiento?pedido=" + o.id}
                className="order-chip"
              >
                <strong>{o.id}</strong> <span>{labels[o.status]}</span>{" "}
                <small>{kgText(totalKg(o))}</small>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
