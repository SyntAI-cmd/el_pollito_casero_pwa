import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Users,
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
import HojaActions from "../components/HojaActions.jsx";
import { PageHead } from "../components/ui.jsx";
import {
  useDay,
  todayKey,
  dmy,
  liveCrates,
  boxCrates,
  cajasDe,
  expectedCrates,
  weighedKg,
  floorStatus,
  floorLabels,
} from "../lib/day.js";
import { send } from "../lib/outbox.js";
import { api, post, put, subscribe } from "../lib/api.js";
import { vehicleLabel } from "../components/Vehicles.jsx";

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
  // Flota: vehículos y salidas del día (vehículo + preventistas + hora). Si no hay vehículos
  // cargados en Equipo, la pantalla sigue funcionando por preventista como antes.
  const [vehicles, setVehicles] = useState([]);
  const [trips, setTrips] = useState([]);
  const [vehicleId, setVehicleId] = useState(query.get("vehiculo") || "");
  const loadTrips = useCallback(
    () =>
      api("/salidas?fecha=" + date)
        .then(setTrips)
        .catch(() => {}),
    [date],
  );
  useEffect(() => {
    api("/vehicles")
      .then((v) => setVehicles(v.filter((x) => x.active)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadTrips();
    return subscribe((type) => type === "fleet" && loadTrips());
  }, [loadTrips]);
  // Vehículo inicial: el que ya tiene salida con este preventista, si no el primero.
  useEffect(() => {
    if (vehicleId || !vehicles.length) return;
    const mine = trips.find((t) => t.drivers.includes(driver));
    setVehicleId(mine?.vehicleId || vehicles[0].id);
  }, [vehicles, trips, driver, vehicleId]);
  const vehicle = vehicles.find((v) => v.id === vehicleId) || null;
  const trip = vehicle ? trips.find((t) => t.vehicleId === vehicle.id) : null;
  const byVehicle = !!vehicle;
  // Tripulación: los preventistas de la salida; sin salida armada, el preventista elegido.
  const crew = byVehicle
    ? trip?.drivers || (driver ? [driver] : [])
    : driver
      ? [driver]
      : [];
  async function saveTrip(patchBody) {
    if (!vehicle) return;
    try {
      const t = await put("/salidas", {
        date,
        vehicleId: vehicle.id,
        drivers: crew,
        departure: trip?.departure || "",
        ...patchBody,
      });
      setTrips((list) => [...list.filter((x) => x.id !== t.id), t]);
    } catch (e) {
      notify(e.message);
    }
  }
  const toggleCrew = (name) =>
    saveTrip({
      drivers: crew.includes(name)
        ? crew.filter((d) => d !== name)
        : [...crew, name],
    });
  const [reason, setReason] = useState("");
  const [closing, setClosing] = useState(false);
  const [missing, setMissing] = useState(null);

  const orders = useMemo(
    () =>
      day.orders
        .filter((o) => crew.includes(o.driver))
        .sort(
          (a, b) =>
            (a.locality?.name || "").localeCompare(b.locality?.name || "") ||
            a.name.localeCompare(b.name),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day.orders, crew.join("|")],
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

  // Cajones marcados desde esta pantalla y todavía no confirmados por el servidor: evita que un
  // refresco (propio o del canal en vivo) pise el estado optimista y el contador "salte".
  const pendingLoad = useRef(new Map()); // crateId -> loadedAt
  const pendingUnload = useRef(new Set());
  const inflight = useRef(0);
  const latestDay = useRef(day);
  latestDay.current = day;
  useEffect(() => {
    if (!pendingLoad.current.size && !pendingUnload.current.size) return;
    setDay((d) => {
      let changed = false;
      const orders = d.orders.map((o) => {
        if (!o.crates?.length) return o;
        const crates = o.crates.map((c) => {
          if (pendingLoad.current.has(c.id) && !c.loadedAt) {
            changed = true;
            return { ...c, loadedAt: pendingLoad.current.get(c.id) };
          }
          if (pendingUnload.current.has(c.id) && c.loadedAt) {
            changed = true;
            return { ...c, loadedAt: null };
          }
          return c;
        });
        return changed ? { ...o, crates } : o;
      });
      return changed ? { ...d, orders } : d;
    });
  }, [day, setDay]);
  /** Ejecuta una llamada al servidor; cuando no queda ninguna en vuelo, refresca una sola vez. */
  async function sync(fn) {
    inflight.current++;
    try {
      await fn();
    } catch (e) {
      notify(e.message);
    } finally {
      if (--inflight.current === 0) {
        await reload({ silent: true });
        pendingLoad.current.clear();
        pendingUnload.current.clear();
      }
    }
  }
  function load(o, count = 1) {
    const current = latestDay.current.orders.find((x) => x.id === o.id) || o;
    const free = liveCrates(current)
      .filter((c) => !c.loadedAt && !pendingLoad.current.has(c.id))
      .slice(0, count);
    if (!free.length) return;
    const at = new Date().toISOString();
    for (const c of free) {
      pendingUnload.current.delete(c.id);
      pendingLoad.current.set(c.id, at);
    }
    setDay((d) => ({
      ...d,
      orders: d.orders.map((x) =>
        x.id === o.id
          ? {
              ...x,
              crates: x.crates.map((c) =>
                free.some((f) => f.id === c.id) ? { ...c, loadedAt: at } : c,
              ),
            }
          : x,
      ),
    }));
    sync(async () => {
      for (const c of free) await send(`/crates/${c.id}/load`, {});
    });
  }
  function unload(o) {
    const current = latestDay.current.orders.find((x) => x.id === o.id) || o;
    const last = [...liveCrates(current)]
      .reverse()
      .find((c) => c.loadedAt && !pendingUnload.current.has(c.id));
    if (!last) return;
    pendingLoad.current.delete(last.id);
    pendingUnload.current.add(last.id);
    setDay((d) => ({
      ...d,
      orders: d.orders.map((x) =>
        x.id === o.id
          ? {
              ...x,
              crates: x.crates.map((c) =>
                c.id === last.id ? { ...c, loadedAt: null } : c,
              ),
            }
          : x,
      ),
    }));
    sync(() => send(`/crates/${last.id}/unload`, {}));
  }
  async function closeTruck() {
    setClosing(true);
    try {
      // Cierra el camión de cada preventista que va en el vehículo (los que tengan pedidos por salir).
      const names = crew.filter((d) => pendingOut.some((o) => o.driver === d));
      let departed = 0;
      const blocked = [];
      for (const d of names) {
        try {
          const r = await post("/dia/cerrar-camion", {
            date,
            driver: d,
            reason,
          });
          departed += r.departed.length;
        } catch (e) {
          if (e.status === 409) blocked.push(e.message);
          else throw e;
        }
      }
      if (blocked.length) {
        setMissing(blocked.join(" "));
        if (departed)
          notify(`${departed} pedidos en camino; otros quedaron pendientes.`);
        return;
      }
      if (trip && !trip.departedAt) await post(`/salidas/${trip.id}/salir`, {});
      setMissing(null);
      setReason("");
      notify(
        `${byVehicle ? vehicleLabel(vehicle) : "Camión de " + driver} cerrado: ${departed} pedidos en camino.`,
      );
      reload({ silent: true });
      loadTrips();
    } catch (e) {
      notify(e.message);
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="floor loading-page">
      <PageHead
        eyebrow="PISO · CARGA DEL CAMIÓN"
        title={
          byVehicle
            ? `${vehicleLabel(vehicle)}.`
            : driver
              ? `Camión de ${driver}.`
              : "Carga."
        }
        description={`${dmy(date)}${byVehicle ? ` · ${crew.length ? crew.join(", ") : "sin preventistas"}${trip?.departure ? ` · sale ${trip.departure}` : ""}` : ""} · ${totals.loaded} de ${totals.crates} cajones arriba${orders.length ? ` · ${orders.length} pedido${orders.length === 1 ? "" : "s"}` : ""} · ${kgText(totals.kg)}`}
      >
        <div className="head-actions">
          {vehicles.length > 0 ? (
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              aria-label="Vehículo"
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {vehicleLabel(v)}
                </option>
              ))}
            </select>
          ) : (
            isAdmin && (
              <select
                value={driver}
                onChange={(e) => setDriver(e.target.value)}
                aria-label="Camión"
              >
                {drivers.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            )
          )}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha"
          />
          {isAdmin && orders.length > 0 && (
            <RemitoActions
              orders={orders}
              date={date}
              driver={byVehicle ? vehicleLabel(vehicle) : driver}
              actions={["open", "share"]}
              labels={{ open: "Remitos PDF" }}
            />
          )}
          {isAdmin && orders.length > 0 && (
            <HojaActions
              orders={orders}
              date={date}
              drivers={crew}
              vehicle={byVehicle ? vehicleLabel(vehicle) : ""}
              actions={["open", "share"]}
            />
          )}
          {isAdmin && orders.length > 0 && (
            <Link
              to={`/imprimir?tipo=remitos&fecha=${date}&repartidor=${encodeURIComponent(driver)}`}
              className="secondary"
            >
              <Printer size={15} /> Ver remitos
            </Link>
          )}
        </div>
      </PageHead>
      {byVehicle && (
        <section className="panel trip-crew">
          <div className="section-line">
            <h2>
              <Users size={16} /> Quiénes van (dos por vehículo) y a qué hora
            </h2>
            <label className="trip-departure">
              Hora de salida
              <input
                type="time"
                value={trip?.departure || ""}
                onChange={(e) => saveTrip({ departure: e.target.value })}
                aria-label="Hora de salida"
              />
            </label>
          </div>
          <div className="crew-chips" role="group" aria-label="Preventistas">
            {drivers.map((d) => {
              const on = crew.includes(d);
              const elsewhere = trips.find(
                (t) => t.vehicleId !== vehicle.id && t.drivers.includes(d),
              );
              return (
                <button
                  key={d}
                  type="button"
                  className={"chip-toggle " + (on ? "on" : "")}
                  aria-pressed={on}
                  disabled={!on && crew.length >= 2}
                  title={
                    elsewhere
                      ? `Hoy va en ${vehicleLabel(elsewhere.vehicle)}`
                      : ""
                  }
                  onClick={() => toggleCrew(d)}
                >
                  {on ? <CheckCheck size={13} /> : <Plus size={13} />} {d}
                  {elsewhere && !on ? (
                    <small> · {vehicleLabel(elsewhere.vehicle)}</small>
                  ) : null}
                </button>
              );
            })}
          </div>
          {!trip && (
            <p className="muted">
              Tocá un preventista o poné la hora para armar la salida de{" "}
              {vehicleLabel(vehicle)}; administración la ve en <b>Flota</b> con
              la ubicación en vivo.
            </p>
          )}
        </section>
      )}
      {orders.length === 0 ? (
        <p className="muted">
          {loading
            ? "Cargando…"
            : `No hay pedidos de ${byVehicle ? crew.join(", ") || "este vehículo" : driver || "este camión"} para el ${dmy(date)}.`}
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
                          `${i.boxes ? i.boxes + " cj " : ""}${i.name.toLowerCase()} ${i.kg > 0 ? kgText(i.kg) : i.boxes ? "(sin pesar)" : kgText(i.kg)}`,
                      )
                      .join(", ")}
                    {cajasDe(boxCrates(o)) < expected && !out
                      ? ` · faltan pesar ${expected - cajasDe(boxCrates(o))} cajones`
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
