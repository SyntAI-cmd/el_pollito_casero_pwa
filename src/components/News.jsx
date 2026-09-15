import React, { useCallback, useEffect, useState } from "react";
import { Megaphone, Pin, Archive, Send, Trash2 } from "lucide-react";
import { api, post, patch, del, subscribe } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { dateText, timeText } from "../lib/format.js";

/** Noticias y recordatorios del equipo: reemplazan los avisos sueltos del grupo de WhatsApp. */
export default function News({ compact = false }) {
  const { session, notify } = useStore();
  const [list, setList] = useState([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(!compact);
  const load = useCallback(
    () =>
      api("/news?limit=" + (compact ? 6 : 50))
        .then(setList)
        .catch(() => {}),
    [compact],
  );
  useEffect(() => {
    load();
    return subscribe((type) => type === "news" && load());
  }, [load]);
  const isAdmin = session?.role === "admin";
  const publish = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await post("/news", { text: text.trim() });
      setText("");
      load();
    } catch (err) {
      notify(err.message);
    }
  };
  if (compact && !list.length && !open)
    return (
      <button
        type="button"
        className="link-button news-toggle"
        onClick={() => setOpen(true)}
      >
        <Megaphone size={14} /> Publicar una noticia para el equipo
      </button>
    );
  return (
    <section className={"panel news " + (compact ? "compact" : "")}>
      <div className="section-line">
        <h2>
          <Megaphone size={17} /> Noticias del equipo
        </h2>
        <span className="muted">Lo que todos tienen que saber hoy</span>
      </div>
      <ul className="news-list">
        {list.map((n) => (
          <li key={n.id} className={n.pinned ? "pinned" : ""}>
            <p>{n.text}</p>
            <small>
              {n.by} · {dateText(n.at)} {timeText(n.at)}
              {isAdmin && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      patch("/news/" + n.id, { pinned: !n.pinned }).then(load)
                    }
                  >
                    <Pin size={11} /> {n.pinned ? "soltar" : "fijar"}
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      patch("/news/" + n.id, { archived: true }).then(load)
                    }
                  >
                    <Archive size={11} /> archivar
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          "¿Borrar esta noticia definitivamente? No se puede recuperar.",
                        )
                      )
                        del("/news/" + n.id)
                          .then(load)
                          .catch((err) => notify(err.message));
                    }}
                  >
                    <Trash2 size={11} /> borrar
                  </button>
                </>
              )}
            </small>
          </li>
        ))}
        {!list.length && <li className="muted">Sin noticias por ahora.</li>}
      </ul>
      <form className="news-form" onSubmit={publish}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength="1000"
          placeholder="Ej.: mañana no hay reparto a La Paz · Hernán pidió pollo grande"
          aria-label="Nueva noticia"
        />
        <button className="primary" disabled={!text.trim()}>
          <Send size={15} /> Publicar
        </button>
      </form>
    </section>
  );
}
