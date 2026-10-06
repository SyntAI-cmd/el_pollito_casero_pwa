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
import { money, orderNumber, labels } from "../lib/format.js";
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
  paidMethod: "medio de pago",
  payment: "forma de pago",
  notes: "observaciones",
  loaded: "cargado",
  returned: "cajas devueltas",
  amount: "monto",
  delta: "diferencia",
  boxesDelta: "cajas",
  note: "nota",
  reason: "motivo",
  motivo: "motivo",
  entregados: "entregados",
  salteados: "salteados",
  cobrados: "marcados cobrados",
  vehicleId: "vehículo",
  zone: "zona",
  name: "nombre",
  address: "dirección",
  gross: "bruto",
  tare: "tara",
  net: "neto",
  kg: "kilos",
  productId: "producto",
  kind: "tipo",
  date: "fecha",
  method: "medio",
  active: "activo",
};

/** Qué hizo, en palabras: "Entregó el pedido", "Subió un comprobante"… */
const ACCIONES = {
  "order.create": "Cargó un pedido",
  "order.edit": "Editó el pedido",
  "order.delete": "Borró el pedido",
  "order.delivered": "Entregó el pedido",
  "order.assign": "Asignó el preventista",
  "order.deliver.batch": "Marcó entregados en lote",
  "order.deliver.undo": "Desmarcó una entrega",
  "crate.add": "Pesó un cajón",
  "crate.create": "Pesó un cajón",
  "crate.void": "Anuló una pesada",
  "customer.create": "Creó un cliente",
  "customer.update": "Modificó un cliente",
  "customer.ficha": "Editó la ficha del cliente",
  "customer.saldos": "Corrigió saldos",
  "customer.import": "Importó clientes",
  "boxes.return": "Registró cajas devueltas",
  "cash.close": "Cerró la caja",
  "payment.mercadopago": "Cobro por Mercado Pago",
  "receipt.add": "Subió un comprobante",
  "receipt.update": "Modificó un comprobante",
  "receipt.void": "Anuló un comprobante",
  "receipt.download": "Descargó un comprobante",
  "truck.close": "Cerró la carga del camión",
  "trip.create": "Armó una salida",
  "trip.update": "Modificó una salida",
  "trip.delete": "Borró una salida",
  "session.staff_login": "Ingresó",
  "session.login": "Ingresó",
  "session.logout": "Salió",
  "auth.denegado": "Intento sin permiso",
  "staff.create": "Creó un usuario",
  "staff.update": "Modificó un usuario",
  "driver.create": "Agregó un preventista",
  "driver.update": "Modificó un preventista",
  "vehicle.create": "Agregó un vehículo",
  "vehicle.update": "Modificó un vehículo",
  "product.create": "Agregó un producto",
  "settings.tare": "Cambió la tara",
  "news.create": "Publicó una novedad",
  "news.delete": "Borró una novedad",
};
function accionLegible(m) {
  // Lo que quedó después de cada cambio, más el detalle de los registros que no traen cambios.
  const d = {
    ...(m.detalle || {}),
    ...Object.fromEntries(
      Object.entries(m.cambios || {}).map(([k, [, despues]]) => [k, despues]),
    ),
  };
  if (
    m.accion === "order.edit" &&
    (d.driver !== undefined || d.driver2 !== undefined)
  )
    return "Cambió los preventistas";
  if (m.accion === "order.update") {
    if (d.status === "entregado") return "Entregó el pedido";
    if (d.status) return `Pasó el pedido a «${labels[d.status] || d.status}»`;
    if (d.paid === true) return "Registró el cobro";
    if (d.paid === false) return "Anuló el cobro";
    if (d.driver !== undefined || d.driver2 !== undefined)
      return "Cambió los preventistas";
    if (d.loaded !== undefined)
      return d.loaded ? "Marcó cargado" : "Desmarcó cargado";
    return "Modificó el pedido";
  }
  return ACCIONES[m.accion] || m.accion;
}

/** Color de cada categoría, para encontrarla rápido en la lista. */
const TONO = {
  Entregas: "ok",
  Cobros: "ok",
  Saldos: "warn",
  Cajas: "warn",
  Pedidos: "info",
  Asignaciones: "info",
  Pesadas: "info",
  "Carga y salidas": "info",
};
const tono = (c) => "mov-tono-" + (TONO[c] || "base");

/** Valor de un dato del detalle que puede venir como lista u objeto. */
const valorDetalle = (campo, v) =>
  Array.isArray(v)
    ? v
        .map((x) =>
          x && typeof x === "object" ? JSON.stringify(x) : String(x),
        )
        .join(", ") || "—"
    : v && typeof v === "object"
      ? JSON.stringify(v)
      : valor(campo, v);
const PLATA = new Set(["balance", "total", "amount", "delta"]);
const valor = (campo, v) =>
  v === null || v === undefined || v === ""
    ? "—"
    : campo === "status"
      ? labels[v] || v
      : PLATA.has(campo)
        ? money(v)
        : typeof v === "boolean"
          ? v
            ? "sí"
            : "no"
          : String(v);

/** Todos los cambios en una línea: "saldo: 100.000 → 90.000 · cajas: 4 → 2" */
const resumenCambios = (m) =>
  Object.entries(m.cambios || {})
    .map(
      ([campo, [antes, despues]]) =>
        `${NOMBRES[campo] || campo}: ${valor(campo, antes)} → ${valor(campo, despues)}`,
    )
    .join(" · ");

export default function Movimientos() {
  const { session, orders, customers } = useStore();
  const [dia, setDia] = useState(todayKey());
  const [filtros, setFiltros] = useState({ categoria: "", actor: "" });
  const [borrador, setBorrador] = useState({ categoria: "", actor: "" });
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState({ movimientos: [], siguiente: null });
  const [facetas, setFacetas] = useState({ categorias: [], actores: [] });
  const [conteo, setConteo] = useState({});
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
        if (!cursor) setConteo(r.conteo || {});
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
  /** "Pedido N° 00381 · Almacén Don José" en lugar del identificador interno. */
  const sobreQue = (m) => {
    if (!m.entidadId) return "";
    if (m.entidad === "order") {
      const o = orders.find((x) => x.id === m.entidadId);
      return o
        ? `Pedido N° ${orderNumber(o)} · ${o.name}`
        : `Pedido ${m.entidadId}`;
    }
    if (m.entidad === "customer") {
      const c = customers.find((x) => x.phone === m.entidadId);
      return `Cliente ${c ? c.name : m.entidadId}`;
    }
    return m.entidadId;
  };
  const categoriasDelDia = Object.entries(conteo).sort((a, b) => b[1] - a[1]);
  const totalDelDia = categoriasDelDia.reduce((s, [, n]) => s + n, 0);

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

        {totalDelDia > 0 && (
          <div
            className="mov-resumen"
            role="group"
            aria-label="Movimientos del día por categoría"
          >
            <button
              type="button"
              className={"pill" + (!filtros.categoria ? " active" : "")}
              aria-pressed={!filtros.categoria}
              onClick={() => setFiltros((f) => ({ ...f, categoria: "" }))}
            >
              Todos <span>{totalDelDia}</span>
            </button>
            {categoriasDelDia.map(([c, n]) => (
              <button
                key={c}
                type="button"
                className={
                  "pill " + tono(c) + (filtros.categoria === c ? " active" : "")
                }
                aria-pressed={filtros.categoria === c}
                onClick={() =>
                  setFiltros((f) => ({
                    ...f,
                    categoria: f.categoria === c ? "" : c,
                  }))
                }
              >
                {c} <span>{n}</span>
              </button>
            ))}
          </div>
        )}

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
                      <span className={"mov-cat " + tono(m.categoria)}>
                        {m.categoria}
                      </span>
                      <strong>
                        {m.actor || "Sistema"} · {accionLegible(m)}
                      </strong>
                      <small>
                        {sobreQue(m)}
                        {m.resultado !== "ok" ? " · intento rechazado" : ""}
                        {m.historico ? " · registro anterior, sin detalle" : ""}
                      </small>
                      {m.cambios && Object.keys(m.cambios).length > 0 && (
                        <small className="mov-cambios">
                          {resumenCambios(m)}
                        </small>
                      )}
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
                        <dt>Categoría</dt>
                        <dd>{m.categoria}</dd>
                        <dt>Acción</dt>
                        <dd>
                          {accionLegible(m)}{" "}
                          <span className="muted">({m.accion})</span>
                        </dd>
                        {m.entidadId && (
                          <>
                            <dt>Sobre</dt>
                            <dd>{sobreQue(m)}</dd>
                          </>
                        )}
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
                        {Object.entries(m.detalle || {})
                          .filter(([campo]) => !(m.cambios || {})[campo])
                          .map(([campo, v]) => (
                            <React.Fragment key={"d-" + campo}>
                              <dt>{NOMBRES[campo] || campo}</dt>
                              <dd>{valorDetalle(campo, v)}</dd>
                            </React.Fragment>
                          ))}
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
