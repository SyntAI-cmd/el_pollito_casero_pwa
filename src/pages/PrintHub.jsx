import React, { useCallback, useEffect, useState } from "react";
import { Printer, FileText, Truck, ClipboardList, Ticket } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link } from "../lib/router.jsx";
import { api, put } from "../lib/api.js";
import { PageHead } from "../components/ui.jsx";
import RemitoActions from "../components/RemitoActions.jsx";
import HojaActions from "../components/HojaActions.jsx";
import { vehicleLabel } from "../components/Vehicles.jsx";
import { todayKey, dmy } from "../lib/day.js";

/**
 * Imprimir (solo administración): hoja de pedidos, hoja de ruta · rendición por preventista
 * (exige vehículo asignado), tickets y remitos. El vehículo de cada preventista se elige acá y
 * queda guardado como salida del día.
 */
export default function PrintHub() {
  const { orders, config, session, notify, reload } = useStore();
  useEffect(() => {
    reload();
  }, [reload]);
  const [date, setDate] = useState(todayKey());
  const [vehicles, setVehicles] = useState([]);
  const [trips, setTrips] = useState([]);
  const day = orders.filter(
    (o) =>
      (o.deliveryDate || o.created.slice(0, 10)) === date &&
      o.status !== "cancelado",
  );
  const drivers = (config?.drivers || []).filter((d) =>
    day.some((o) => o.driver === d || o.driver2 === d),
  );
  const loadTrips = useCallback(
    () =>
      api("/salidas?fecha=" + date)
        .then(setTrips)
        .catch(() => setTrips([])),
    [date],
  );
  useEffect(() => {
    api("/vehicles")
      .then((v) => setVehicles(v.filter((x) => x.active)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadTrips();
  }, [loadTrips]);
  const tripOf = (d) => trips.find((t) => t.drivers.includes(d));
  async function setVehicle(d, vehicleId) {
    try {
      const current = tripOf(d);
      const t = await put("/salidas", {
        date,
        vehicleId,
        drivers: current ? [...new Set([...current.drivers, d])] : [d],
        departure: current?.departure || "",
      });
      setTrips((list) => [...list.filter((x) => x.id !== t.id), t]);
    } catch (e) {
      notify(e.message);
    }
  }
  if (session?.role !== "admin") return null;
  return (
    <div className="floor print-hub">
      <PageHead
        eyebrow="IMPRIMIR"
        title={`${dmy(date)}.`}
        description={`${day.length} ${day.length === 1 ? "pedido" : "pedidos"} para esta fecha`}
      >
        <div className="head-actions">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha"
          />
        </div>
      </PageHead>
      <div className="print-hub-grid">
        <section className="panel">
          <h2>
            <ClipboardList size={17} /> Hoja de pedidos
          </h2>
          <p className="muted">
            Control general del día: todos los pedidos en una tabla, con kg,
            precio, importe, observación en blanco y casillero de cargado.
          </p>
          <div className="actions-row">
            <Link
              to={`/imprimir?tipo=pedidos&fecha=${date}`}
              className="primary"
            >
              <Printer size={15} /> Imprimir
            </Link>
            <a
              className="secondary"
              href={`/api/export/consolidado?fecha=${date}`}
            >
              Excel del día
            </a>
          </div>
        </section>
        <section className="panel">
          <h2>
            <Truck size={17} /> Hoja de ruta · rendición
          </h2>
          <p className="muted">
            Una por preventista, con saldo actual y saldo de cajas de cada
            cliente. Elegí el vehículo antes de generarla.
          </p>
          <div className="hub-routes">
            {drivers.map((d) => {
              const trip = tripOf(d);
              const vehicle = vehicles.find((v) => v.id === trip?.vehicleId);
              return (
                <div key={d} className="hub-route">
                  <b>{d}</b>
                  <select
                    value={trip?.vehicleId || ""}
                    onChange={(e) => e.target.value && setVehicle(d, e.target.value)}
                    aria-label={"Vehículo de " + d}
                  >
                    <option value="">Vehículo…</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {vehicleLabel(v)}
                      </option>
                    ))}
                  </select>
                  <HojaActions
                    orders={day.filter((o) => o.driver === d || o.driver2 === d)}
                    date={date}
                    drivers={[d]}
                    vehicle={vehicle ? vehicleLabel(vehicle) : ""}
                    actions={["open", "share"]}
                    small
                    label="Abrir PDF"
                  />
                </div>
              );
            })}
            {!drivers.length && (
              <span className="muted">Sin pedidos asignados.</span>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>
            <Ticket size={17} /> Tickets
          </h2>
          <p className="muted">
            Uno por pedido para la comandera (80 mm): cliente, zona, productos
            con cajas o kilos, totales y línea de cargado.
          </p>
          <div className="actions-row">
            <Link
              to={`/imprimir?tipo=tickets&fecha=${date}&repartidor=todos`}
              className="primary"
            >
              <Printer size={15} /> Imprimir tickets
            </Link>
            {drivers.map((d) => (
              <Link
                key={d}
                to={`/imprimir?tipo=tickets&fecha=${date}&repartidor=${encodeURIComponent(d)}`}
                className="link-button"
              >
                {d}
              </Link>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>
            <FileText size={17} /> Remitos
          </h2>
          <p className="muted">
            Original y duplicado de cada pedido, en un solo PDF.
          </p>
          <div className="actions-row">
            <RemitoActions
              orders={day}
              date={date}
              actions={["open", "download"]}
              labels={{ open: "Imprimir remitos", download: "PDF" }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
