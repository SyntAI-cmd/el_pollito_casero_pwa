import React from "react";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useStore } from "../lib/store.jsx";

const copy = {
  cliente:
    "Te avisamos cuando se asigne el repartidor, cuando salga la camioneta y a qué hora llega, aunque cierres la app.",
  admin:
    "Recibí cada pedido nuevo y las cancelaciones en este dispositivo, aunque la app esté cerrada.",
  repartidor: "Te avisamos cuando te asignen una entrega.",
};

/** Tarjeta o botón para activar los avisos push según el permiso del navegador. */
export default function PushToggle({ compact = false }) {
  const { pushState, enableNotifications, config, session, busy } = useStore();
  if (!session || !config?.pushKey || pushState === "unsupported") return null;
  if (pushState === "granted")
    return compact ? (
      <span
        className="push-chip on"
        title="Avisos activados en este dispositivo"
      >
        <BellRing size={14} /> Avisos activos
      </span>
    ) : null;
  if (pushState === "denied")
    return compact ? (
      <span className="push-chip" title="Bloqueaste los avisos en el navegador">
        <BellOff size={14} /> Avisos bloqueados
      </span>
    ) : (
      <p className="demo-note">
        <BellOff size={13} /> Los avisos están bloqueados en este navegador.
        Habilitalos desde la configuración del sitio para enterarte cuando salga
        tu pedido.
      </p>
    );
  if (compact)
    return (
      <button
        className="secondary push-button"
        onClick={enableNotifications}
        disabled={busy}
      >
        <Bell size={15} /> Activar avisos
      </button>
    );
  return (
    <section className="push-card" aria-labelledby="push-title">
      <Bell size={22} />
      <div>
        <h3 id="push-title">Enterate sin mirar la app</h3>
        <p>{copy[session.role]}</p>
      </div>
      <button className="primary" onClick={enableNotifications} disabled={busy}>
        Activar avisos
      </button>
    </section>
  );
}
