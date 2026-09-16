import React, { useEffect, useMemo, useState } from "react";
import {
  Scale,
  Check,
  Undo2,
  ArrowLeft,
  Package,
  WifiOff,
  CircleCheck,
  Search,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute } from "../lib/router.jsx";
import { kgText, money, normalize, orderNumber } from "../lib/format.js";
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
import { send, pending, onOutbox } from "../lib/outbox.js";

const fmt = (n) =>
  Number(n).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });

/**
 * Pesada: se elige el pedido de la nota del día, después el producto, y se carga el peso.
 *  - Se pesan las cajas juntas: cantidad de cajas y peso BRUTO total; la app descuenta la tara por
 *    caja (1,7 kg × cajas) y guarda el neto. El servidor crea un cajón por caja con el neto
 *    repartido, así la carga del camión y el remito siguen contando cajas.
 *  - Ítems pedidos por kilo: se pesan como bulto (bruto − una tara) y se comparan contra lo pedido.
 * Funciona sin señal: la pesada queda en el dispositivo y se envía sola al volver la conexión.
 */
const batchOf = (crate) => String(crate.id).split(":")[0];
export default function Weighing() {
  const { session, notify } = useStore();
  const { query, navigate } = useRoute();
  const [date, setDate] = useState(query.get("fecha") || todayKey());
  const { day, loading, error, reload, setDay } = useDay(date);
  const [selected, setSelected] = useState(query.get("pedido") || null);
  const [product, setProduct] = useState(null);
  const [gross, setGross] = useState("");
  const [boxes, setBoxes] = useState("");
  const [queued, setQueued] = useState(pending().length);
  useEffect(() => onOutbox((l) => setQueued(l.length)), []);
  const order = day.orders.find((o) => o.id === selected) || null;
  const tare = day.tare || 1.7;
  const back = session?.role === "admin" ? "/operacion" : "/reparto";

  // Pedidos de hoy en el orden en que se cargaron (N° de pedido), con búsqueda por cliente o N°.
  const [search, setSearch] = useState("");
  const q = normalize(search.trim());
  const list = useMemo(
    () =>
      day.orders
        .filter((o) => !["en_camino", "entregado"].includes(o.status))
        .filter(
          (o) =>
            !q ||
            normalize(
              `${orderNumber(o)} ${Number(o.number) || ""} ${o.name} ${o.driver || ""} ${o.driver2 || ""} ${o.locality?.name || ""}`,
            ).includes(q),
        )
        .map((o) => ({ o, st: floorStatus(o) }))
        .sort(
          (a, b) =>
            (a.o.number || 0) - (b.o.number || 0) ||
            a.o.created.localeCompare(b.o.created),
        ),
    [day.orders, q],
  );

  useEffect(() => {
    if (order && !product) {
      const next = order.items.find((i) =>
        i.boxes
          ? liveCrates(order).filter((c) => c.productId === i.id).length <
            i.boxes
          : !liveCrates(order).some((c) => c.productId === i.id),
      );
      setProduct((next || order.items[0])?.id || null);
    }
  }, [order?.id]);

  const g = Number(String(gross).replace(",", "."));
  const item = order?.items.find((i) => i.id === product);
  const done =
    order && product
      ? liveCrates(order).filter((c) => c.productId === product)
      : [];
  const kgDone = weighedKg(order || { crates: [] }, product);
  const remaining = item?.boxes ? Math.max(1, item.boxes - done.length) : 1;
  const nBoxes = Math.max(
    1,
    Math.min(500, Math.round(Number(boxes) || remaining)),
  );
  // Neto de la pesada: bruto total − tara por cada caja del lote.
  const tareTotal = Math.round(tare * nBoxes * 100) / 100;
  const net = !Number.isFinite(g)
    ? null
    : Math.round((g - tareTotal) * 100) / 100;
  // Cajones agrupados por lote para la lista (un lote de 30 cajas es una sola línea).
  const groups = useMemo(() => {
    const out = [];
    for (const c of done) {
      const key = batchOf(c);
      const last = out[out.length - 1];
      if (last && last.key === key) last.crates.push(c);
      else out.push({ key, crates: [c] });
    }
    return out;
  }, [done]);

  async function confirm() {
    if (!order || !product || !Number.isFinite(g) || net <= 0) return;
    const id = crypto.randomUUID();
    const count = nBoxes;
    const each = Math.round((net / count) * 100) / 100;
    const at = new Date().toISOString();
    // Optimista: se ven los cajones al instante, aunque no haya señal.
    const optimistic = Array.from({ length: count }, (_, i) => {
      const n =
        i === count - 1
          ? Math.round((net - each * (count - 1)) * 100) / 100
          : each;
      return {
        id: count === 1 ? id : `${id}:${i + 1}`,
        productId: product,
        gross: Math.round((n + tare) * 100) / 100,
        tare,
        net: n,
        at,
        pending: true,
      };
    });
    setDay((d) => ({
      ...d,
      orders: d.orders.map((o) =>
        o.id === order.id
          ? { ...o, crates: [...(o.crates || []), ...optimistic] }
          : o,
      ),
    }));
    setGross("");
    setBoxes("");
    const body = { id, productId: product, boxes: count, gross: g };
    const r = await send(`/orders/${order.id}/crates`, body).catch((e) => {
      notify(e.message);
      reload({ silent: true });
      return null;
    });
    if (r?.queued)
      notify("Sin señal: la pesada quedó guardada y se envía sola.");
    else if (r) reload({ silent: true });
  }
  async function undo(group) {
    const kg = group.crates.reduce((s, c) => s + c.net, 0);
    const what =
      group.crates.length === 1
        ? `el cajón de ${fmt(kg)} kg`
        : `el lote de ${group.crates.length} cajas (${fmt(kg)} kg)`;
    if (!window.confirm(`¿Anular ${what}?`)) return;
    try {
      await Promise.all(
        group.crates.map((c) =>
          send(
            `/crates/${c.id}`,
            { reason: "corrección en balanza" },
            { method: "DELETE" },
          ),
        ),
      );
      reload({ silent: true });
    } catch (e) {
      notify(e.message);
    }
  }
  const pad = (k) => {
    if (k === "⌫") return setGross((v) => v.slice(0, -1));
    if (k === "," && gross.includes(",")) return;
    setGross((v) => (v + k).slice(0, 7));
  };

  return (
    <div className="floor weighing">
      <PageHead
        eyebrow="PISO · PESADA"
        title={order ? order.name : "Pesada."}
        description={
          order
            ? `${order.driver || "Sin camión"} · ${order.locality?.name || ""} · tara ${fmt(tare)} kg por cajón`
            : `Elegí el pedido, indicá cuántas cajas van juntas y el peso bruto total: la app resta ${fmt(tare)} kg de tara por caja.`
        }
      >
        <div className="head-actions">
          {queued > 0 && (
            <span className="offline-pill">
              <WifiOff size={14} /> {queued} sin enviar
            </span>
          )}
          {order ? (
            <button
              className="secondary"
              onClick={() => {
                setSelected(null);
                setProduct(null);
                setGross("");
                navigate(
                  "/" +
                    (session?.role === "admin" ? "operacion" : "reparto") +
                    "/pesada?fecha=" +
                    date,
                  { replace: true, scroll: false },
                );
              }}
            >
              <ArrowLeft size={15} /> Otro pedido
            </button>
          ) : (
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Fecha de reparto"
            />
          )}
        </div>
      </PageHead>
      {error && <p className="notice error">{error}</p>}

      {!order && (
        <div className="search-field weigh-search">
          <Search size={16} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente o N° de pedido…"
            aria-label="Buscar pedido por cliente o número"
          />
        </div>
      )}
      {!order && (
        <section className="floor-list">
          {loading && !day.orders.length ? (
            <p className="muted">Cargando la nota del {dmy(date)}…</p>
          ) : list.length === 0 ? (
            <div className="floor-empty">
              <CircleCheck size={40} />
              <h2>
                {q
                  ? `Ningún pedido coincide con "${search.trim()}"`
                  : `Nada por pesar el ${dmy(date)}`}
              </h2>
              <p>
                {q
                  ? "Probá con otra parte del nombre o el número de pedido."
                  : "Los pedidos cargados para esa fecha ya salieron, o todavía no hay ninguno."}
              </p>
            </div>
          ) : (
            list.map(({ o, st }) => {
              const crates = expectedCrates(o)
                ? boxCrates(o).length
                : liveCrates(o).length;
              const expected = expectedCrates(o);
              return (
                <button
                  key={o.id}
                  type="button"
                  className={"floor-card st-" + st}
                  onClick={() => {
                    setSelected(o.id);
                    setProduct(null);
                  }}
                >
                  <span className="floor-card-main">
                    <strong>
                      <span className="floor-card-num">
                        N° {orderNumber(o)}
                      </span>{" "}
                      {o.name}
                    </strong>
                    <small>
                      {o.driver || "Sin camión"}
                      {o.driver2 ? ` + ${o.driver2}` : ""} ·{" "}
                      {o.locality?.name || ""} ·{" "}
                      {o.items
                        .map(
                          (i) =>
                            `${i.boxes ? i.boxes + " cj " : (i.ordered ?? i.kg) + " kg "}${i.name.toLowerCase()}`,
                        )
                        .join(", ")}
                    </small>
                  </span>
                  <span className="floor-card-side">
                    <b>
                      {expected
                        ? `${crates}/${expected} cj`
                        : `${crates} bulto${crates === 1 ? "" : "s"}`}
                    </b>
                    <small>{kgText(weighedKg(o))}</small>
                    <em className={"chip st-" + st}>{floorLabels[st]}</em>
                  </span>
                </button>
              );
            })
          )}
        </section>
      )}

      {order && (
        <section className="weigh-panel">
          <div
            className="weigh-products"
            role="tablist"
            aria-label="Producto a pesar"
          >
            {order.items.map((i) => {
              const n = liveCrates(order).filter(
                (c) => c.productId === i.id,
              ).length;
              const complete = i.boxes ? n >= i.boxes : n > 0;
              return (
                <button
                  key={i.id}
                  type="button"
                  role="tab"
                  aria-selected={product === i.id}
                  className={
                    "weigh-product " +
                    (product === i.id ? "active " : "") +
                    (complete ? "complete" : "")
                  }
                  onClick={() => setProduct(i.id)}
                >
                  <strong>{i.name}</strong>
                  <small>
                    {i.boxes
                      ? `${n} de ${i.boxes} cajas`
                      : `${kgText(weighedKg(order, i.id))} de ${kgText(i.ordered ?? i.kg)} pedidos`}
                  </small>
                  {complete && <Check size={16} />}
                </button>
              );
            })}
          </div>
          {item && (
            <div className="weigh-main">
              <div className="weigh-entry">
                <p className="weigh-counter">
                  <Package size={18} />
                  {item.boxes
                    ? done.length >= item.boxes
                      ? `Listo: ${done.length} de ${item.boxes} cajas · ${kgText(kgDone)} netos (si va otro cajón, pesalo igual)`
                      : `Cajón ${done.length + 1} de ${item.boxes} · ${kgText(kgDone)} acumulados`
                    : `Bulto ${done.length + 1} · ${kgText(kgDone)} de ${kgText(item.ordered ?? item.kg)} pedidos`}
                </p>
                {
                  <label className="weigh-boxes">
                    Cajas que van juntas
                    <span>
                      <button
                        type="button"
                        aria-label="Una caja menos"
                        onClick={() =>
                          setBoxes(String(Math.max(1, nBoxes - 1)))
                        }
                      >
                        −
                      </button>
                      <input
                        inputMode="numeric"
                        value={boxes === "" ? nBoxes : boxes}
                        onChange={(e) =>
                          setBoxes(e.target.value.replace(/[^\d]/g, ""))
                        }
                        onFocus={(e) => e.target.select()}
                        aria-label="Cantidad de cajas del lote"
                      />
                      <button
                        type="button"
                        aria-label="Una caja más"
                        onClick={() =>
                          setBoxes(String(Math.min(500, nBoxes + 1)))
                        }
                      >
                        +
                      </button>
                    </span>
                  </label>
                }
                <label className="weigh-gross">
                  {`Peso bruto total de ${nBoxes} ${nBoxes === 1 ? "caja" : "cajas"} (kg)`}
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={gross}
                    onChange={(e) => setGross(e.target.value.replace(".", ","))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        confirm();
                      }
                    }}
                    placeholder="0,0"
                    aria-label="Peso bruto en kilos"
                    autoFocus
                  />
                </label>
                <p
                  className={
                    "weigh-net " + (net !== null && net > 0 ? "ok" : "")
                  }
                >
                  <span>
                    − {fmt(tareTotal)} kg de tara ({nBoxes} × {fmt(tare)})
                    {nBoxes > 1 && net > 0
                      ? ` · ${fmt(net / nBoxes)} kg por caja · neto =`
                      : " · neto ="}
                  </span>
                  <strong>
                    {net !== null && gross !== "" ? fmt(net) : "–"} kg
                  </strong>
                  <small>
                    {item.price
                      ? `× ${money(item.price)} = ${net > 0 ? money(Math.round(net * item.price * 100) / 100) : "–"}`
                      : ""}
                  </small>
                </p>
                <div className="keypad" aria-hidden="true">
                  {[
                    "7",
                    "8",
                    "9",
                    "4",
                    "5",
                    "6",
                    "1",
                    "2",
                    "3",
                    ",",
                    "0",
                    "⌫",
                  ].map((k) => (
                    <button
                      key={k}
                      type="button"
                      tabIndex={-1}
                      onClick={() => pad(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="primary weigh-confirm"
                  disabled={!(net > 0)}
                  onClick={confirm}
                >
                  <Scale size={20} />{" "}
                  {nBoxes > 1 ? `Confirmar ${nBoxes} cajas` : "Confirmar cajón"}
                </button>
              </div>
              <ul className="weigh-log" aria-label="Cajones pesados">
                {[...groups].reverse().map((gr) => {
                  const kg = gr.crates.reduce((s, c) => s + c.net, 0);
                  const pendingSend = gr.crates.some((c) => c.pending);
                  const loaded = gr.crates.filter((c) => c.loadedAt).length;
                  const first =
                    done.findIndex((c) => c.id === gr.crates[0].id) + 1;
                  const last = first + gr.crates.length - 1;
                  return (
                    <li key={gr.key} className={pendingSend ? "pending" : ""}>
                      <span>
                        {gr.crates.length === 1
                          ? `#${first} · bruto ${fmt(gr.crates[0].gross)} → `
                          : `#${first}–${last} · lote de ${gr.crates.length} cajas · `}
                        <strong>{fmt(kg)} kg</strong>
                        {gr.crates.length > 1
                          ? ` (${fmt(kg / gr.crates.length)} c/u)`
                          : ""}
                        {loaded
                          ? loaded === gr.crates.length
                            ? " · cargado"
                            : ` · ${loaded} cargados`
                          : ""}
                        {pendingSend ? " · enviando…" : ""}
                      </span>
                      {!loaded && !pendingSend && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => undo(gr)}
                        >
                          <Undo2 size={13} /> anular
                        </button>
                      )}
                    </li>
                  );
                })}
                {!done.length && (
                  <li className="muted">
                    Todavía no hay cajones de {item.name.toLowerCase()}.
                  </li>
                )}
              </ul>
            </div>
          )}
          <p className="weigh-total">
            Pedido: <strong>{kgText(weighedKg(order))}</strong> netos ·{" "}
            <strong>{money(order.total)}</strong>
            {" · "}
            <em className={"chip st-" + floorStatus(order)}>
              {floorLabels[floorStatus(order)]}
            </em>
          </p>
        </section>
      )}
    </div>
  );
}
