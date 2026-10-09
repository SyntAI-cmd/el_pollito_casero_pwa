import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tags, Check, Loader2, Pencil, UserX, History } from "lucide-react";
import { api, post } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { money, normalize } from "../lib/format.js";
import { PageHead } from "../components/ui.jsx";
import SearchField from "../components/SearchField.jsx";
import { Link } from "../lib/router.jsx";

const ESPECIAL = { id: "especial", nombre: "Especiales" };
const SIN = { id: "", nombre: "Sin asignar" };
const fechaCorta = (d) =>
  d ? d.split("-").reverse().slice(0, 2).join("/") : "";
const newId = () =>
  crypto.randomUUID?.() ||
  `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Fila de precio de un cliente: actual → el que le corresponde. */
function PrecioChip({ f }) {
  const cambia = f.antes !== f.despues;
  return (
    <span
      className={
        "tf-chip" + (cambia ? " cambia" : "") + (f.nueva ? " nueva" : "")
      }
    >
      <span className="tf-chip-prod">{f.product}</span>{" "}
      {cambia ? (
        <>
          <s>{f.nueva ? "sin precio" : money(f.antes)}</s> →{" "}
          <strong>{money(f.despues)}</strong>
        </>
      ) : (
        money(f.despues)
      )}
    </span>
  );
}

/**
 * Listas de precios por cliente: cuatro listas de pollo entero (Mayorista, Preferencial, Comercial,
 * Minorista), especiales, y el trozado por mayor o por menor según lo que el cliente llevó en la
 * semana. Muestra qué precio tiene cada cliente y cuál le corresponde; aplicar lo escribe todo junto.
 */
export default function Tarifas() {
  const { session, notify, loadCustomers } = useStore();
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filtro, setFiltro] = useState("todas");
  const [query, setQuery] = useState("");
  const [editando, setEditando] = useState(false);
  const [draft, setDraft] = useState(null);
  const [confirmar, setConfirmar] = useState(false);
  const [fichasSel, setFichasSel] = useState(null);
  const [confirmarFichas, setConfirmarFichas] = useState(false);
  const [hecho, setHecho] = useState("");
  const lock = useRef(false);
  const opId = useRef(newId());

  const recibir = (tab) => {
    setT(tab);
    setFichasSel(
      (sel) =>
        sel ?? {
          eliminar: Object.fromEntries(
            tab.fichas.eliminar.map((e) => [e.phone, !e.dudoso]),
          ),
          sinPrecio: Object.fromEntries(
            tab.fichas.sinPrecio.map((e) => [e.phone, true]),
          ),
        },
    );
  };
  const cargar = () =>
    api("/tarifas")
      .then(recibir)
      .catch((e) => setError(e.message));
  useEffect(() => {
    cargar();
  }, []);

  async function guard(fn) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await cargar();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const listas = t ? [...t.config.listas, ESPECIAL, SIN] : [];
  const nombreLista = (id) =>
    listas.find((l) => l.id === (id || ""))?.nombre || "Sin asignar";
  const conteo = (id) =>
    t?.clientes.filter((c) => (c.tarifa || "") === id).length || 0;
  const visibles = useMemo(() => {
    if (!t) return [];
    const q = normalize(query);
    return t.clientes.filter(
      (c) =>
        (filtro === "todas" ||
          (filtro === "cambios"
            ? c.cambios > 0
            : (c.tarifa || "") === filtro)) &&
        (!q || normalize(c.name).includes(q)),
    );
  }, [t, filtro, query]);

  if (session?.role !== "admin")
    return (
      <p className="notice error" role="alert">
        Esta pantalla es solo para administración.
      </p>
    );
  if (!t)
    return error ? (
      <p className="notice error" role="alert">
        {error}
      </p>
    ) : (
      <div className="loading" aria-busy="true">
        Cargando listas…
      </div>
    );

  const cambiarCliente = (c, cambio) =>
    guard(async () => {
      const tab = await api(
        `/tarifas/clientes/${encodeURIComponent(c.phone)}`,
        {
          method: "PUT",
          body: JSON.stringify(cambio),
        },
      );
      recibir(tab);
      opId.current = newId();
    });

  const empezarEdicion = () => {
    setDraft({
      listas: Object.fromEntries(
        t.config.listas.map((l) => [
          l.id,
          { nombre: l.nombre, pollo: String(l.pollo) },
        ]),
      ),
      trozado: Object.fromEntries(
        Object.entries(t.config.trozado).map(([pid, e]) => [
          pid,
          {
            mayor: String(e.mayor),
            menor: String(e.menor),
            oferta: !!e.oferta,
          },
        ]),
      ),
      umbralKg: String(t.config.umbralKg),
      dias: String(t.config.dias),
    });
    setEditando(true);
  };
  const setLista = (id, campo, v) =>
    setDraft((d) => ({
      ...d,
      listas: { ...d.listas, [id]: { ...d.listas[id], [campo]: v } },
    }));
  const setTroz = (pid, campo, v) =>
    setDraft((d) => ({
      ...d,
      trozado: { ...d.trozado, [pid]: { ...d.trozado[pid], [campo]: v } },
    }));
  const guardarListas = (e) => {
    e.preventDefault();
    guard(async () => {
      const tab = await api("/tarifas/config", {
        method: "PUT",
        body: JSON.stringify({
          listas: Object.entries(draft.listas).map(([id, l]) => ({ id, ...l })),
          trozado: draft.trozado,
          umbralKg: Number(String(draft.umbralKg).replace(",", ".")),
          dias: Number(draft.dias),
        }),
      });
      recibir(tab);
      setEditando(false);
      opId.current = newId();
      notify("Listas guardadas. Los clientes cambian cuando apliques.");
    });
  };

  const aplicar = () =>
    guard(async () => {
      const r = await post("/tarifas/aplicar", {
        token: t.token,
        opId: opId.current,
      });
      opId.current = newId();
      setConfirmar(false);
      setHecho(
        `Listas aplicadas: ${r.update.changes} precios actualizados. Referencia del pollo: ${money(r.update.refAfter)}/kg.`,
      );
      await Promise.all([cargar(), loadCustomers?.()]);
      notify("Listas aplicadas.");
    });

  const elegidas = (k) =>
    Object.entries(fichasSel?.[k] || {})
      .filter(([, v]) => v)
      .map(([p]) => p);
  const aplicarFichas = () =>
    guard(async () => {
      const r = await post("/tarifas/fichas", {
        eliminar: elegidas("eliminar"),
        sinPrecio: elegidas("sinPrecio"),
      });
      setConfirmarFichas(false);
      setFichasSel(null);
      recibir(r.tablero);
      opId.current = newId();
      setHecho(
        `Fichas: ${r.eliminadas} eliminadas, ${r.archivadas} archivadas (tenían pedidos) y ${r.sinPrecio} marcadas sin precio.`,
      );
      await loadCustomers?.();
    });

  const res = t.resumen;
  const pendientes = res.precios > 0 || res.asignar > 0;
  const fichasPend = t.fichas.eliminar.length + t.fichas.sinPrecio.length;

  return (
    <div className="tarifas">
      <PageHead
        eyebrow="ADMINISTRACIÓN · PRECIOS"
        title="Listas de precios."
        description="Qué lista tiene cada cliente, qué precio paga hoy y cuál le corresponde. El pollo entero va por lista; el trozado, por mayor o por menor según lo que llevó en la semana."
      >
        <div className="head-actions">
          <Link to="/operacion/precios/actualizar" className="secondary">
            <History size={15} /> Aumentos e historial
          </Link>
        </div>
      </PageHead>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {hecho && (
        <p className="notice success" role="status">
          {hecho}
        </p>
      )}

      <section className="tf-listas" aria-label="Listas de pollo entero">
        {listas.map((l) => (
          <button
            key={l.id || "sin"}
            type="button"
            className={
              "tf-card" +
              (filtro === l.id ? " activa" : "") +
              (l.id === "" ? " sin" : "")
            }
            onClick={() => setFiltro(filtro === l.id ? "todas" : l.id)}
            aria-pressed={filtro === l.id}
          >
            <span className="tf-card-nombre">{l.nombre}</span>
            <span className={"tf-card-precio" + (l.pollo ? "" : " chico")}>
              {l.pollo
                ? `${money(l.pollo)}/kg`
                : l.id === "especial"
                  ? "Precio propio"
                  : "—"}
            </span>
            <span className="tf-card-n">
              {conteo(l.id)} {conteo(l.id) === 1 ? "cliente" : "clientes"}
            </span>
          </button>
        ))}
      </section>

      {pendientes && (
        <section className="panel tf-aplicar" aria-label="Aplicar listas">
          <h2>
            <Tags size={17} /> {res.precios} precios de {res.clientes} clientes
            para actualizar
          </h2>
          <p className="muted small">
            {res.asignar > 0 &&
              `${res.asignar} clientes toman la lista de la planilla del 09/10 al aplicar. `}
            {res.nuevas > 0 &&
              `${res.nuevas} precios son nuevos (pollo de especiales que no lo tenían). `}
            Solo cambian los productos que cada cliente ya tiene con precio. La
            referencia del pollo para los aumentos queda en{" "}
            {money(t.referenciaNueva)}/kg (lista Mayorista)
            {t.referencia !== null && t.referencia !== t.referenciaNueva
              ? `; hoy está en ${money(t.referencia)}/kg`
              : ""}
            . Los pedidos ya cargados no cambian. Se puede revertir desde el
            historial.
          </p>
          {!confirmar ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                setFiltro("cambios");
                setConfirmar(true);
              }}
            >
              Revisar y aplicar…
            </button>
          ) : (
            <div
              className="pu-confirm"
              role="alertdialog"
              aria-label="Confirmar listas"
            >
              <p>
                <strong>
                  Se van a cambiar {res.precios} precios de {res.clientes}{" "}
                  clientes.
                </strong>{" "}
                Abajo están filtrados los clientes con cambios: revisalos antes
                de confirmar.
              </p>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={aplicar}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}{" "}
                Confirmar y aplicar
              </button>{" "}
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setConfirmar(false)}
              >
                Volver
              </button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="section-line">
          <h2>Precios de las listas</h2>
          {!editando && (
            <button
              type="button"
              className="secondary small"
              onClick={empezarEdicion}
            >
              <Pencil size={13} /> Editar
            </button>
          )}
        </div>
        {!editando ? (
          <div className="tf-def">
            <div
              className="tf-grid"
              role="table"
              aria-label="Precios del trozado"
            >
              <div className="tf-grid-row tf-grid-head" role="row">
                <span role="columnheader">Corte</span>
                <span role="columnheader" className="num">
                  Por mayor
                </span>
                <span role="columnheader" className="num">
                  Por menor
                </span>
              </div>
              {t.config.productos.map((p) => {
                const e = t.config.trozado[p.id];
                return (
                  <div className="tf-grid-row" role="row" key={p.id}>
                    <span role="cell" className="tf-grid-name">
                      {p.name}
                      {e.oferta && <span className="tf-badge">Oferta</span>}
                    </span>
                    <span role="cell" className="num">
                      {money(e.mayor)}
                    </span>
                    <span
                      role="cell"
                      className={"num" + (e.oferta ? " tf-apagado" : "")}
                    >
                      {money(e.menor)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="muted small tf-nota">
              <strong>Oferta</strong>: todos los clientes pagan el precio por
              mayor. <strong>Regla del trozado</strong>: va por mayor el cliente
              que llevó {t.config.umbralKg} kg o más de trozado (todos los
              cortes juntos, sin el pollo entero) en los últimos {t.config.dias}{" "}
              días ({fechaCorta(t.periodo.desde)} al{" "}
              {fechaCorta(t.periodo.hasta)}); si no, por menor. A cada cliente
              se le puede fijar a mano.
              {!t.config.guardada &&
                " Son los valores de la planilla: quedan guardados al aplicar."}
            </p>
          </div>
        ) : (
          <form className="tf-edit" onSubmit={guardarListas}>
            <fieldset className="tf-fieldset">
              <legend>Pollo entero por lista</legend>
              {t.config.listas.map((l) => (
                <div key={l.id} className="tf-edit-lista">
                  <label>
                    <span className="tf-mini">Nombre</span>
                    <input
                      type="text"
                      value={draft.listas[l.id].nombre}
                      onChange={(e) => setLista(l.id, "nombre", e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="tf-mini">$ por kg</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draft.listas[l.id].pollo}
                      onChange={(e) => setLista(l.id, "pollo", e.target.value)}
                    />
                  </label>
                </div>
              ))}
            </fieldset>
            <fieldset className="tf-fieldset">
              <legend>Trozado</legend>
              {t.config.productos.map((p) => (
                <div key={p.id} className="tf-edit-corte">
                  <strong className="tf-edit-nombre">{p.name}</strong>
                  {[
                    ["mayor", "Por mayor"],
                    ["menor", "Por menor"],
                  ].map(([k, label]) => (
                    <label key={k}>
                      <span className="tf-mini">{label}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`${p.name} ${label.toLowerCase()}`}
                        value={draft.trozado[p.id][k]}
                        onChange={(e) => setTroz(p.id, k, e.target.value)}
                      />
                    </label>
                  ))}
                  <label className="pu-check tf-edit-oferta">
                    <input
                      type="checkbox"
                      checked={draft.trozado[p.id].oferta}
                      onChange={(e) =>
                        setTroz(p.id, "oferta", e.target.checked)
                      }
                    />
                    Oferta
                  </label>
                </div>
              ))}
            </fieldset>
            <fieldset className="tf-fieldset">
              <legend>Regla del trozado</legend>
              <div className="tf-edit-lista">
                <label>
                  <span className="tf-mini">Por mayor desde (kg)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.umbralKg}
                    onChange={(e) =>
                      setDraft({ ...draft, umbralKg: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span className="tf-mini">En los últimos (días)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.dias}
                    onChange={(e) =>
                      setDraft({ ...draft, dias: e.target.value })
                    }
                  />
                </label>
              </div>
            </fieldset>
            <div className="tf-edit-acciones">
              <button className="primary" disabled={busy}>
                Guardar listas
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditando(false)}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="panel">
        <div className="section-line">
          <h2>Clientes</h2>
          <span className="muted">
            {visibles.length} de {t.clientes.length}
          </span>
        </div>
        <div className="tf-filtros">
          <SearchField
            value={query}
            onChange={setQuery}
            label="Buscar cliente"
            placeholder="Buscar cliente"
            className="pu-search"
          />
          <div
            className="pill-filters"
            role="group"
            aria-label="Filtrar clientes"
          >
            {[
              ["todas", "Todas"],
              [
                "cambios",
                `Con cambios (${t.clientes.filter((c) => c.cambios).length})`,
              ],
              ...listas.map((l) => [l.id, l.nombre]),
            ].map(([id, nombre]) => (
              <button
                key={id || "sin"}
                type="button"
                className={"pill" + (filtro === id ? " active" : "")}
                onClick={() => setFiltro(id)}
              >
                {nombre}
              </button>
            ))}
          </div>
        </div>
        <ul className="tf-clientes">
          {visibles.map((c) => (
            <li
              key={c.phone}
              className={"tf-cliente" + (c.cambios ? " con-cambios" : "")}
            >
              <div className="tf-cliente-head">
                <strong>{c.name}</strong>
                {c.propuesta && (
                  <span className="tf-badge">de la planilla</span>
                )}
                {c.noPricing && (
                  <span className="tf-badge gris">sin precio en el remito</span>
                )}
                {c.grupo && <span className="tf-badge gris">{c.grupo}</span>}
              </div>
              <div className="tf-cliente-ctrl">
                <label>
                  <span className="tf-mini" aria-hidden="true">
                    Lista
                  </span>
                  <span className="sr-only">Lista de {c.name}</span>
                  <select
                    value={c.tarifa || ""}
                    disabled={busy}
                    onChange={(e) =>
                      cambiarCliente(c, { tarifa: e.target.value || null })
                    }
                  >
                    {listas.map((l) => (
                      <option key={l.id || "sin"} value={l.id}>
                        {l.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="tf-mini" aria-hidden="true">
                    Trozado
                  </span>
                  <span className="sr-only">Trozado de {c.name}</span>
                  <select
                    value={c.trozado}
                    disabled={busy}
                    onChange={(e) =>
                      cambiarCliente(c, { trozado: e.target.value })
                    }
                  >
                    <option value="auto">Automático</option>
                    <option value="mayor">Fijo por mayor</option>
                    <option value="menor">Fijo por menor</option>
                  </select>
                </label>
              </div>
              <p className="tf-resumen">
                {c.tarifa && c.tarifa !== "especial"
                  ? `Pollo ${money(t.config.listas.find((l) => l.id === c.tarifa)?.pollo)}`
                  : c.tarifa === "especial"
                    ? "Pollo con precio propio"
                    : "Sin lista"}
                {" · "}Trozado por <strong>{c.nivel}</strong>
                {c.trozado === "auto"
                  ? ` (${String(c.kg).replace(".", ",")} kg en ${t.config.dias} días)`
                  : " (fijo)"}
              </p>
              <div className="tf-precios">
                {c.filas.length ? (
                  c.filas.map((f) => <PrecioChip key={f.productId} f={f} />)
                ) : (
                  <span className="muted small">
                    Sin precios propios
                    {Object.keys(c.sugeridos).length
                      ? ` · al cargar un pedido toma los de su lista (pollo ${c.sugeridos.entero ? money(c.sugeridos.entero) : "—"})`
                      : ""}
                  </span>
                )}
              </div>
            </li>
          ))}
          {!visibles.length && (
            <li className="muted">Ningún cliente con ese filtro.</li>
          )}
        </ul>
      </section>

      {(fichasPend > 0 || t.fichas.noEncontrados.length > 0) && (
        <section className="panel">
          <h2>
            <UserX size={17} /> Depuración de fichas
          </h2>
          {t.fichas.eliminar.length > 0 && (
            <fieldset className="pu-products tf-fichas">
              <legend>
                Eliminar (las que tienen pedidos quedan archivadas con su
                historial)
              </legend>
              {t.fichas.eliminar.map((e) => (
                <label key={e.phone} className="pu-check">
                  <input
                    type="checkbox"
                    checked={!!fichasSel?.eliminar[e.phone]}
                    onChange={(ev) =>
                      setFichasSel({
                        ...fichasSel,
                        eliminar: {
                          ...fichasSel.eliminar,
                          [e.phone]: ev.target.checked,
                        },
                      })
                    }
                  />
                  {e.name}
                  {e.dudoso ? (
                    <small className="pu-bad"> · {e.dudoso}</small>
                  ) : e.pedidos ? (
                    <small className="muted"> · {e.pedidos} pedidos</small>
                  ) : null}
                </label>
              ))}
            </fieldset>
          )}
          {t.fichas.sinPrecio.length > 0 && (
            <fieldset className="pu-products tf-fichas">
              <legend>Sin precio en el remito (se cargan solo por kilo)</legend>
              {t.fichas.sinPrecio.map((e) => (
                <label key={e.phone} className="pu-check">
                  <input
                    type="checkbox"
                    checked={!!fichasSel?.sinPrecio[e.phone]}
                    onChange={(ev) =>
                      setFichasSel({
                        ...fichasSel,
                        sinPrecio: {
                          ...fichasSel.sinPrecio,
                          [e.phone]: ev.target.checked,
                        },
                      })
                    }
                  />
                  {e.name}
                  {e.grupo && <small className="muted"> · {e.grupo}</small>}
                </label>
              ))}
            </fieldset>
          )}
          {fichasPend > 0 &&
            (!confirmarFichas ? (
              <button
                type="button"
                className="secondary"
                disabled={
                  busy ||
                  (!elegidas("eliminar").length &&
                    !elegidas("sinPrecio").length)
                }
                onClick={() => setConfirmarFichas(true)}
              >
                Aplicar cambios de fichas…
              </button>
            ) : (
              <div
                className="pu-confirm"
                role="alertdialog"
                aria-label="Confirmar cambios de fichas"
              >
                <p>
                  <strong>
                    Se van a eliminar {elegidas("eliminar").length} fichas y
                    marcar {elegidas("sinPrecio").length} sin precio.
                  </strong>{" "}
                  Las fichas con pedidos o pagos no se borran: quedan archivadas
                  y conservan saldos e historial.
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={aplicarFichas}
                >
                  Confirmar
                </button>{" "}
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirmarFichas(false)}
                >
                  Volver
                </button>
              </div>
            ))}
          {t.fichas.noEncontrados.length > 0 && (
            <p className="muted small">
              De la planilla, sin ficha activa con ese nombre:{" "}
              {t.fichas.noEncontrados.join(", ")}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
