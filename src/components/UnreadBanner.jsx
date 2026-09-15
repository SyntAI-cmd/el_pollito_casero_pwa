import React from "react";
import { MessageSquare, BellOff } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { pushPermission } from "../lib/push.js";

/** Cartel grande en la pantalla de inicio cuando hay mensajes del chat sin leer. */
export default function UnreadBanner() {
  const { unreadTotal, session } = useStore();
  if (!session || session.role === "cliente" || !unreadTotal) return null;
  const perm = pushPermission?.() || "default";
  return (
    <button
      type="button"
      className="unread-banner"
      onClick={() => window.dispatchEvent(new CustomEvent("pollito:open-chat"))}
    >
      <MessageSquare size={22} />
      <span>
        <strong>
          {unreadTotal}{" "}
          {unreadTotal === 1 ? "mensaje nuevo" : "mensajes nuevos"} en el chat
        </strong>
        <small>
          Tocá para abrirlo.
          {perm !== "granted" ? (
            <>
              {" "}
              <BellOff size={12} /> Activá los avisos (campana, arriba) para
              recibirlos en el teléfono.
            </>
          ) : null}
        </small>
      </span>
    </button>
  );
}
