import React, { useCallback, useEffect, useState } from "react";
import {
  History,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { PageHead, EmptyState } from "../components/ui.jsx";
import { money } from "../lib/format.js";
import { todayKey } from "../lib/day.js";

/**
 * Movimientos: quién cambió qué, cuándo y por qué (PC-014).
 *
 * Arranca en el día de hoy. Los filtros se combinan y la lista se trae de a páginas: no se baja
 * el historial entero al navegador. Las fechas se muestran en hora de Mendoza.
 */
const ZONA = "America/Argentina/Mendoza";
const fechaHora = (iso) =>
  new Date(iso).toLocaleString("es-AR", {
    timeZone: ZONA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Límites del día comercial de Mendoza, en instantes UTC. */
function limitesDelDia(dia) {
  const [a, m, d] = dia.split("-").map(Number);
  // Mendoza es UTC−3 todo el año.
  const desde = new Date(Date.UTC(a, m - 1, d, 3, 0, 0));
  const hasta = new Date(Date.UTC(a, m - 1, d + 1, 2, 59, 59, 999));
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

/** Los campos que la gente entiende, con su nombre de siempre. */
const NOMBRES = {
  balance: "saldo",
  boxes: "cajas",
  status: "estado",
  driver: "preventista",
  driver2: "segundo preventista",
  total: "importe",
  paid: "cobrado",
  plan: "modalidad",
  credit: "cuenta corriente",
  deliveryDate: "fecha de reparto",
  shift: "turno",
};
const PLATA = new Set(["balance", "total", "amount", "delta"]);
const valor = (campo, v) =>
  v === null || v === undefined
    ? "—"
    : PLATA.has(campo)
      ? money(v)
      : typeof v === "boolean"
        ? v
          ? "sí"
          : "no"
        : String(v);

/** "Mauro corrigió saldo de cliente: 100.000 → 90.000" */
function resumen(m) {
  const quien = m.actor || "Sistema";
  const que = m.categoria.toLowerCase();
  const cambios = Object.entries(m.cambios || {});
  if (!cambios.length) return `${quien} · ${m.accion}`;
  const partes = cambios
    .slice(0, 2)
    .map(
      ([campo, [antes, despues]]) =>
        `${NOMBRES[campo] || campo}: ${valor(campo, antes)} → ${valor(campo, despues)}`,
    );
  return `${quien} cambió ${que} · ${partes.join(" · ")}`;
}

export default function Movimientos() {
  const { session } = useStore();
  const [dia, setDia] = useState(todayKey());
  const [filtros, setFiltros] = useState({ categoria: "", actor: "" });
  const [borrador, setBorrador] = useState({ categoria: "", actor: "" });
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState({ movimientos: [], siguiente: null });
  const [facetas, setFacetas] = useState({ categorias: [], actores: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState(null);

  const consultar = useCallback(
    async (cursor) => {
      setCargando(true);
      setError("");
      try {
        const { desde, hasta } = limitesDelDia(dia);
        const p = new URLSearchParams({ desde, hasta, limite: "50" });
        if (filtros.categoria) p.set("categoria", filtros.categoria);
        if (filtros.actor) p.set("actor", filtros.actor);
        if (cursor) p.set("cursor", cursor);
        const r = await api("/movimientos?" + p);
        setFacetas(r.facetas || { categorias: [], actores: [] });
        setDatos((prev) =>
          cursor
            ? {
                movimientos: [...prev.movimientos, ...r.movimientos],
                siguiente: r.siguiente,
              }
            : r,
        );
      } catch (e) {
        setError(e.message);
      } finally {
        setCargando(false);
      }
    },
    [dia, filtros],
  );
  useEffect(() => {
    consultar();
  }, [consultar]);

  if (session?.role !== "admin")
    return (
      <>
        <PageHead
          title="Movimientos."
          description="Historial de cambios de la operación."
        />
        <EmptyState
          icon={AlertTriangle}
          title="Los movimientos los consulta administración"
        />
      </>
    );

  const activos = Object.entries(filtros).filter(([, v]) => v);
  const nombreActor = (id) =>
    facetas.actores.find((a) => a.id === id)?.nombre || id;

  return (
    <>
      <PageHead
        title="Movimientos."
        description="Quién cambió qué, cuándo y por qué. Hora de Mendoza."
      />
      <section className="panel">
        <div className="ui-filterbar">
          <label className="filters-fecha">
            Día
            <input
              type="date"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              aria-label="Día de los movimientos"
            />
          </label>
          <div className="filters-wrap">
            <button
              type="button"
              className={
                "secondary filters-toggle" + (activos.length ? " on" : "")
              }
              aria-expanded={abierto}
              onClick={() => {
                setBorrador(filtros);
                setAbierto((v) => !v);
              }}
            >
              <SlidersHorizontal size={15} /> Filtros
              {activos.length ? <b>{activos.length}</b> : null}
            </button>
            <div className={"filters-panel" + (abierto ? " open" : "")}>
              <label>
                Categoría
                <select
                  value={borrador.categoria}
                  onChange={(e) =>
                    setBorrador((b) => ({ ...b, categoria: e.target.value }))
                  }
                >
                  <option value="">Todas</option>
                  {facetas.categorias.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Usuario
                <select
                  value={borrador.actor}
                  onChange={(e) =>
                    setBorrador((b) => ({ ...b, actor: e.target.value }))
                  }
                >
                  <option value="">Todos</option>
                  {facetas.actores.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre} ({a.rol})
                    </option>
                  ))}
                </select>
              </label>
              <div className="ui-panel-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setBorrador({ categoria: "", actor: "" });
                    setFiltros({ categoria: "", actor: "" });
                  }}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setFiltros(borrador);
                    setAbierto(false);
                  }}
                >
                  Aplicar filtros
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="active-filter-list" aria-label="Filtros activos">
          {activos.map(([clave, v]) => (
            <button
              type="button"
              className="filter-chip"
              key={clave}
              onClick={() => setFiltros((f) => ({ ...f, [clave]: "" }))}
              aria-label={`Quitar el filtro ${clave}`}
            >
              {clave === "actor" ? nombreActor(v) : v} ×
            </button>
          ))}
          <span role="status">
            {datos.movimientos.length} movimiento
            {datos.movimientos.length === 1 ? "" : "s"}
            {datos.siguiente ? " (hay más)" : ""}
          </span>
        </div>

        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {cargando && !datos.movimientos.length ? (
          <p className="muted">Buscando movimientos…</p>
        ) : datos.movimientos.length === 0 ? (
          <div className="ui-empty">
            <History size={26} />
            <strong>Sin movimientos ese día</strong>
            <p>Probá con otra fecha o sacá los filtros.</p>
          </div>
        ) : (
          <ul className="movimientos">
            {datos.movimientos.map((m) => {
              const abiertoEste = detalle === m.id;
              return (
                <li
                  key={m.id}
                  className={m.resultado !== "ok" ? "rechazado" : ""}
                >
                  <button
                    type="button"
                    className="mov-cabecera"
                    aria-expanded={abiertoEste}
                    onClick={() => setDetalle(abiertoEste ? null : m.id)}
                  >
                    <span className="mov-hora">{fechaHora(m.at)}</span>
                    <span className="mov-que">
                      <strong>{resumen(m)}</strong>
                      <small>
                        {m.categoria}
                        {m.entidadId ? ` · ${m.entidadId}` : ""}
                        {m.resultado !== "ok" ? " · intento rechazado" : ""}
                        {m.historico ? " · registro anterior, sin detalle" : ""}
                      </small>
                    </span>
                    {abiertoEste ? (
                      <ChevronUp size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>
                  {abiertoEste && (
                    <div className="mov-detalle">
                      <dl>
                        <dt>Usuario</dt>
                        <dd>
                          {m.actor || "—"} ({m.rol})
                          {m.historico ? " · sin identificador" : ""}
                        </dd>
                        <dt>Acción</dt>
                        <dd>{m.accion}</dd>
                        {m.motivo && (
                          <>
                            <dt>Motivo</dt>
                            <dd>{m.motivo}</dd>
                          </>
                        )}
                        {Object.entries(m.cambios || {}).map(
                          ([campo, [antes, despues]]) => (
                            <React.Fragment key={campo}>
                              <dt>{NOMBRES[campo] || campo}</dt>
                              <dd>
                                {valor(campo, antes)} → {valor(campo, despues)}
                              </dd>
                            </React.Fragment>
                          ),
                        )}
                      </dl>
                      {m.historico && (
                        <p className="muted small">
                          Este movimiento es anterior al registro detallado: se
                          conserva su autor, pero no tiene antes y después.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {datos.siguiente && (
          <button
            type="button"
            className="secondary full"
            disabled={cargando}
            onClick={() => consultar(datos.siguiente)}
          >
            Ver más movimientos
          </button>
        )}
      </section>
    </>
  );
}
