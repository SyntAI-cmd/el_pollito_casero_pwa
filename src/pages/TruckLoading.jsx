import React, { useMemo, useState } from "react";
import {
  Truck,
  Plus,
  Minus,
  CheckCheck,
  Lock,
  Printer,
  AlertTriangle,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute, Link } from "../lib/router.jsx";
import { kgText } from "../lib/format.js";
import RemitoActions from "../components/RemitoActions.jsx";
import { PageHead } from "../components/ui.jsx";
import {
  useDay,
  todayKey,
  dmy,
  liveCrates,
  boxCrates,
  expectedCrates,
  weighedKg,
  floorStatus,
  floorLabels,
} from "../lib/day.js";
import { send } from "../lib/outbox.js";
import { post } from "../lib/api.js";

/**
 * Carga del camión: un camión por pantalla, sus clientes con la cantidad de cajones pesados, y un
 * botón "+" por cada cajón que sube. El camión no se cierra con cajones sin pesar o sin cargar,
 * salvo que se escriba el motivo. Al cerrar, los pedidos salen a reparto y se imprimen los remitos.
 */
export default function TruckLoading() {
  const { session, config, notify } = useStore();
  const { query } = useRoute();
  const isAdmin = session?.role === "admin";
  const [date, setDate] = useState(query.get("fecha") || todayKey());
  const drivers = config?.drivers || [];
  const [driver, setDriver] = useState(
    isAdmin ? query.get("camion") || drivers[0] || "" : session?.driver || "",
  );
  const { day, loading, reload, setDay } = useDay(date);
  const [reason, setReason] = useState("");
  const [closing, setClosing] = useState(false);
  const [missing, setMissing] = useState(null);

  const orders = useMemo(
    () =>
      day.orders
        .filter((o) => o.driver === driver)
        .sort(
          (a, b) =>
            (a.locality?.name || "").localeCompare(b.locality?.name || "") ||
            a.name.localeCompare(b.name),
        ),
    [day.orders, driver],
  );
  const pendingOut = orders.filter(
    (o) => !["en_camino", "entregado"].includes(o.status),
  );
  const totals = orders.reduce(
    (t, o) => {
      const cs = liveCrates(o);
      t.crates += cs.length;
      t.loaded += cs.filter((c) => c.loadedAt).length;
      t.expected += expectedCrates(o);
      t.kg += weighedKg(o);
      return t;
    },
    { crates: 0, loaded: 0, expected: 0, kg: 0 },
  );

  async function load(o, count = 1) {
    const free = liveCrates(o)
      .filter((c) => !c.loadedAt)
      .slice(0, count);
    if (!free.length) return;
    setDay((d) => ({
      ...d,
      orders: d.orders.map((x) =>
        x.id === o.id
          ? {
              ...x,
              crates: x.crates.map((c) =>
                free.some((f) => f.id === c.id)
                  ? { ...c, loadedAt: new Date().toISOString() }
                  : c,
              ),
            }
          : x,
      ),
    }));
    for (const c of free)
      await send(`/crates/${c.id}/load`, {}).catch((e) => notify(e.message));
    reload({ silent: true });
  }
  async function unload(o) {
    const last = [...liveCrates(o)].reverse().find((c) => c.loadedAt);
    if (!last) return;
    await send(`/crates/${last.id}/unload`, {}).catch((e) => notify(e.message));
    reload({ silent: true });
  }
  async function closeTruck() {
    setClosing(true);
    try {
      const r = await post("/dia/cerrar-camion", { date, driver, reason });
      setMissing(null);
      setReason("");
      notify(
        `Camión de ${driver} cerrado: ${r.departed.length} pedidos en camino.`,
      );
      reload({ silent: true });
    } catch (e) {
      if (e.status === 409) {
        setMissing(e.message);
      } else notify(e.message);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="floor loading-page">
      <PageHead
        eyebrow="PISO · CARGA DEL CAMIÓN"
        title={driver ? `Camión de ${driver}.` : "Carga."}
        description={`${dmy(date)} · ${totals.loaded} de ${totals.crates} cajones arriba${orders.length ? ` · ${orders.length} pedido${orders.length === 1 ? "" : "s"}` : ""} · ${kgText(totals.kg)}`}
      >
        <div className="head-actions">
          {isAdmin && (
            <select
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              aria-label="Camión"
            >
              {drivers.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          )}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha"
          />
          {orders.length > 0 && (
            <RemitoActions
              orders={orders}
              date={date}
              driver={driver}
              actions={["open", "share"]}
              labels={{ open: "Remitos PDF" }}
            />
          )}
          {isAdmin && orders.length > 0 && (
            <Link
              to={`/imprimir?tipo=remitos&fecha=${date}&repartidor=${encodeURIComponent(driver)}`}
              className="secondary"
            >
              <Printer size={15} /> Talonario 10×15
            </Link>
          )}
        </div>
      </PageHead>
      {orders.length === 0 ? (
        <p className="muted">
          {loading
            ? "Cargando…"
            : `No hay pedidos de ${driver || "este camión"} para el ${dmy(date)}.`}
        </p>
      ) : (
        <section className="floor-list">
          {orders.map((o) => {
            const cs = liveCrates(o);
            const loaded = cs.filter((c) => c.loadedAt).length;
            const st = floorStatus(o);
            const expected = expectedCrates(o);
            const out = ["en_camino", "entregado"].includes(o.status);
            return (
              <article key={o.id} className={"floor-card static st-" + st}>
                <span className="floor-card-main">
                  <strong>{o.name}</strong>
                  <small>
                    {o.locality?.name || ""} ·{" "}
                    {o.items
                      .map(
                        (i) =>
                          `${i.boxes ? i.boxes + " cj " : ""}${i.name.toLowerCase()} ${kgText(i.kg)}`,
                      )
                      .join(", ")}
                    {boxCrates(o).length < expected && !out
                      ? ` · faltan pesar ${expected - boxCrates(o).length} cajones`
                      : ""}
                  </small>
                </span>
                <span className="floor-card-side load-controls">
                  <b
                    className={loaded === cs.length && cs.length ? "green" : ""}
                  >
                    {loaded}/{cs.length}
                  </b>
                  {!out && (
                    <>
                      <button
                        type="button"
                        className="secondary big"
                        aria-label={"Bajar un cajón de " + o.name}
                        disabled={!loaded}
                        onClick={() => unload(o)}
                      >
                        <Minus size={18} />
                      </button>
                      <button
                        type="button"
                        className="primary big"
                        aria-label={"Cargar un cajón de " + o.name}
                        disabled={loaded >= cs.length}
                        onClick={() => load(o, 1)}
                      >
                        <Plus size={20} />
                      </button>
                      <button
                        type="button"
                        className="link-button"
                        disabled={loaded >= cs.length}
                        onClick={() => load(o, cs.length)}
                      >
                        <CheckCheck size={14} /> todo
                      </button>
                    </>
                  )}
                  <em className={"chip st-" + st}>{floorLabels[st]}</em>
                </span>
              </article>
            );
          })}
        </section>
      )}
      {pendingOut.length > 0 && (
        <section className="panel close-truck">
          <h2>
            <Lock size={17} /> Cerrar camión y salir
          </h2>
          <p className="muted">
            {pendingOut.length}{" "}
            {pendingOut.length === 1 ? "pedido pasa" : "pedidos pasan"} a "en
            camino".{" "}
            {isAdmin
              ? "Después imprimí los remitos del recorrido."
              : "Tus entregas aparecen en Mis entregas."}
          </p>
          {missing && (
            <div className="notice error">
              <AlertTriangle size={16} /> {missing}
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motivo (obligatorio para cerrar igual)"
                maxLength="300"
                aria-label="Motivo"
              />
            </div>
          )}
          <button
            type="button"
            className="primary"
            disabled={closing || (missing && !reason.trim())}
            onClick={closeTruck}
          >
            <Truck size={16} />{" "}
            {closing
              ? "Cerrando…"
              : missing
                ? "Cerrar igual con ese motivo"
                : "Cerrar camión"}
          </button>
        </section>
      )}
    </div>
  );
}
