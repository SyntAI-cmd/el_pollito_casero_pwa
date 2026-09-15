import React, { useMemo } from "react";
import { useState } from "react";
import {
  FileSpreadsheet,
  Printer,
  Scale,
  Truck,
  Package,
  Megaphone,
  Trash2,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link, useRoute } from "../lib/router.jsx";
import { kgText, money } from "../lib/format.js";
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
  plural,
} from "../lib/day.js";
import News from "../components/News.jsx";

/**
 * Nota del día: lo que antes era la hoja amarilla. Todos los pedidos de la fecha, agrupados por
 * camión, con totales por producto para faena (cajas y kilos pedidos vs. pesados) y el estado de
 * cada uno. Desde acá se va a pesar, a cargar, se imprimen remitos y se baja el consolidado.
 */
export default function DaySheet() {
  const { config, session, deleteOrder } = useStore();
  const { query } = useRoute();
  const [date, setDate] = useState(query.get("fecha") || todayKey());
  const { day, loading, error } = useDay(date);
  const products = config?.products || [];

  const byProduct = useMemo(() => {
    const map = {};
    for (const o of day.orders)
      for (const i of o.items) {
        const p = (map[i.id] ||= {
          name: i.name,
          boxes: 0,
          kgOrdered: 0,
          kgWeighed: 0,
          crates: 0,
        });
        p.boxes += i.boxes || 0;
        p.kgOrdered += i.boxes ? 0 : (i.ordered ?? i.kg);
        p.kgWeighed += weighedKg(o, i.id);
        p.crates += liveCrates(o).filter((c) => c.productId === i.id).length;
      }
    return products.map((p) => map[p.id]).filter(Boolean);
  }, [day.orders, products]);

  const byDriver = useMemo(() => {
    const groups = {};
    for (const o of day.orders)
      (groups[o.driver || "Sin camión"] ||= []).push(o);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [day.orders]);
  const totals = {
    orders: day.orders.length,
    boxes: day.orders.reduce((s, o) => s + expectedCrates(o), 0),
    crates: day.orders.reduce((s, o) => s + boxCrates(o).length, 0),
    kg: day.orders.reduce((s, o) => s + weighedKg(o), 0),
    amount: day.orders.reduce((s, o) => s + o.total, 0),
  };

  return (
    <div className="floor day-sheet">
      <PageHead
        eyebrow="PISO · NOTA DEL DÍA"
        title={`Reparto del ${dmy(date)}.`}
        description={`${plural(totals.orders, "pedido", "pedidos")} · ${totals.crates} de ${totals.boxes} cajones pesados · ${kgText(totals.kg)} · ${money(totals.amount)}`}
      >
        <div className="head-actions">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha de reparto"
          />
          <Link to={`/operacion/pesada?fecha=${date}`} className="primary">
            <Scale size={15} /> Pesar
          </Link>
          <Link to={`/operacion/carga?fecha=${date}`} className="secondary">
            <Truck size={15} /> Cargar camiones
          </Link>
          <a
            className="secondary"
            href={`/api/export/consolidado?fecha=${date}`}
          >
            <FileSpreadsheet size={15} /> Excel
          </a>
          <Link
            to={`/imprimir?tipo=pedidos&fecha=${date}`}
            className="secondary"
          >
            <Printer size={15} /> Nota
          </Link>
        </div>
      </PageHead>
      {error && <p className="notice error">{error}</p>}
      <News compact />
      <section className="panel">
        <div className="section-line">
          <h2>
            <Package size={17} /> Para faena
          </h2>
          <span className="muted">
            Cajas y kilos pedidos por producto, y lo ya pesado
          </span>
        </div>
        {byProduct.length === 0 ? (
          <p className="muted">
            {loading
              ? "Cargando…"
              : "Todavía no hay pedidos cargados para esta fecha."}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="customers day-products">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Cajas pedidas</th>
                  <th className="num">Kilos pedidos</th>
                  <th className="num">Cajones pesados</th>
                  <th className="num">Kilos pesados</th>
                </tr>
              </thead>
              <tbody>
                {byProduct.map((p) => (
                  <tr key={p.name}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td className="num">{p.boxes || "—"}</td>
                    <td className="num">
                      {p.kgOrdered ? kgText(p.kgOrdered) : "—"}
                    </td>
                    <td className="num">{p.crates}</td>
                    <td className="num">
                      <strong>{kgText(p.kgWeighed)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {byDriver.map(([driver, list]) => (
        <section className="panel" key={driver}>
          <div className="section-line">
            <h2>
              <Truck size={17} /> {driver}
            </h2>
            <span className="muted">
              {plural(list.length, "pedido", "pedidos")} ·{" "}
              {list.reduce((s, o) => s + boxCrates(o).length, 0)}/
              {list.reduce((s, o) => s + expectedCrates(o), 0)} cajones ·{" "}
              {kgText(list.reduce((s, o) => s + weighedKg(o), 0))}
              {" · "}
              <Link
                to={`/imprimir?tipo=remitos&fecha=${date}&repartidor=${encodeURIComponent(driver)}`}
              >
                Imprimir remitos
              </Link>
              {" · "}
              <Link
                to={`/imprimir?tipo=ruta&fecha=${date}&repartidor=${encodeURIComponent(driver)}`}
              >
                Hoja de ruta
              </Link>
            </span>
          </div>
          <div className="table-scroll">
            <table className="customers day-orders">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Pedido</th>
                  <th className="num">Cajones</th>
                  <th className="num">Kilos</th>
                  <th className="num">Importe</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list
                  .sort(
                    (a, b) =>
                      (a.locality?.name || "").localeCompare(
                        b.locality?.name || "",
                      ) || a.name.localeCompare(b.name),
                  )
                  .map((o) => {
                    const st = floorStatus(o);
                    return (
                      <tr key={o.id} className={"st-" + st}>
                        <td>
                          <strong>{o.name}</strong>
                          <br />
                          <small>
                            {o.locality?.name || ""}
                            {o.notes ? ` · “${o.notes}”` : ""}
                          </small>
                        </td>
                        <td>
                          <small>{o.id}</small>
                          <br />
                          {o.items
                            .map(
                              (i) =>
                                `${i.boxes ? i.boxes + " cj " : (i.ordered ?? i.kg) + " kg "}${i.name.toLowerCase()}`,
                            )
                            .join(", ")}
                        </td>
                        <td className="num">
                          {expectedCrates(o)
                            ? `${boxCrates(o).length} / ${expectedCrates(o)}`
                            : liveCrates(o).length
                              ? `${liveCrates(o).length} bulto${liveCrates(o).length === 1 ? "" : "s"}`
                              : "—"}
                        </td>
                        <td className="num">{kgText(weighedKg(o))}</td>
                        <td className="num">{money(o.total)}</td>
                        <td>
                          <em className={"chip st-" + st}>{floorLabels[st]}</em>
                        </td>
                        <td className="row-actions">
                          {!["en_camino", "entregado"].includes(o.status) && (
                            <Link
                              to={`/operacion/pesada?fecha=${date}&pedido=${o.id}`}
                              className="link-button small"
                            >
                              <Scale size={13} /> Pesar
                            </Link>
                          )}
                          <Link
                            to={`/imprimir?tipo=remito&pedido=${o.id}`}
                            className="link-button small"
                          >
                            <Printer size={13} /> Remito
                          </Link>
                          {session?.role === "admin" && (
                            <button
                              type="button"
                              className="link-button small danger"
                              onClick={() => {
                                const reason = window.prompt(
                                  `¿Eliminar el pedido ${o.id} de ${o.name}? Se borra con sus cajones.
Motivo (opcional):`,
                                );
                                if (reason !== null) deleteOrder(o, reason);
                              }}
                            >
                              <Trash2 size={13} /> Borrar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
