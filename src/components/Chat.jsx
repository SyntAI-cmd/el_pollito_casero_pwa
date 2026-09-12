import React, { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { timeText, dateText } from "../lib/format.js";

/** Chat interno administración ↔ repartidor (panel lateral). */
export default function Chat() {
  const {
    session,
    config,
    chat,
    openChat,
    closeChat,
    sendMessage,
    unreadTotal,
    busy,
  } = useStore();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const listRef = useRef();
  const admin = session?.role === "admin";
  const drivers = config?.drivers || [];
  const currentDriver = chat.thread ? chat.thread.slice(11) : null;

  useEffect(() => {
    if (open)
      openChat(admin ? chat.thread || `repartidor:${drivers[0]}` : undefined);
    else closeChat();
  }, [open]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.messages, open]);
  if (!session || session.role === "cliente") return null;

  const submit = async (e) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (await sendMessage(t)) setText("");
  };
  let lastDay = "";
  return (
    <>
      <button
        className={"chat-fab " + (unreadTotal ? "has-unread" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Chat interno"
      >
        <MessageSquare size={20} />
        <span>
          {admin
            ? "Chat con reparto"
            : `Chat con ${config?.adminName || "administración"}`}
        </span>
        {unreadTotal > 0 && <b className="chat-badge">{unreadTotal}</b>}
      </button>
      {open && (
        <section className="chat-panel" aria-label="Chat interno">
          <header>
            <strong>
              {admin
                ? "Chat interno"
                : `Chat con ${config?.adminName || "administración"}`}
            </strong>
            <button
              className="icon-button"
              aria-label="Cerrar chat"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          {admin && (
            <div className="chat-tabs" role="tablist" aria-label="Repartidor">
              {drivers.map((d) => (
                <button
                  key={d}
                  role="tab"
                  aria-selected={currentDriver === d}
                  className={currentDriver === d ? "active" : ""}
                  onClick={() => openChat(`repartidor:${d}`)}
                >
                  {d}
                  {chat.unread?.[`repartidor:${d}`] ? (
                    <b className="chat-badge">
                      {chat.unread[`repartidor:${d}`]}
                    </b>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          <div className="chat-list" ref={listRef}>
            {chat.messages.length === 0 && (
              <p className="muted">
                Sin mensajes todavía. Escribí para coordinar la entrega.
              </p>
            )}
            {chat.messages.map((m) => {
              const day = dateText(m.at);
              const showDay = day !== lastDay;
              lastDay = day;
              const mine = m.fromRole === session.role;
              return (
                <React.Fragment key={m.id}>
                  {showDay && <div className="chat-day">{day}</div>}
                  <div className={"chat-msg " + (mine ? "mine" : "")}>
                    {!mine && <small>{m.fromName}</small>}
                    <p>{m.text}</p>
                    <time>{timeText(m.at)}</time>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <form className="chat-form" onSubmit={submit}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                admin
                  ? `Mensaje para ${currentDriver || "el repartidor"}…`
                  : "Mensaje para administración…"
              }
              maxLength="1000"
              aria-label="Mensaje"
            />
            <button
              className="primary"
              disabled={busy || !text.trim()}
              aria-label="Enviar"
            >
              <Send size={16} />
            </button>
          </form>
        </section>
      )}
    </>
  );
}
