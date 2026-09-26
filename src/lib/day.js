import { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribe } from "./api.js";
import { coalescedRefresh } from "./refresh.js";

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const dmy = (key) => (key ? key.split("-").reverse().join("/") : "");

/** Cajones vigentes de un pedido. */
export const liveCrates = (o) => (o.crates || []).filter((c) => !c.voided);
/** Cajones esperados: la suma de cajas pedidas (lo pedido por kilo va aparte, como bultos). */
export const expectedCrates = (o) =>
  o.items.reduce((n, i) => n + (i.boxes || 0), 0);
/**
 * Cuántas cajas retornables representan estas pesadas. Una pesada en bolsa vale 0, aunque
 * ocupe una fila: guarda el peso pero no agrega envases.
 */
export const cajasDe = (crates) =>
  crates.reduce((n, c) => n + (c.boxes === undefined ? 1 : c.boxes), 0);
/** Pesadas de los ítems pedidos por cajas (para comparar con expectedCrates). */
export const boxCrates = (o) => {
  const boxed = new Set(o.items.filter((i) => i.boxes).map((i) => i.id));
  return liveCrates(o).filter((c) => boxed.has(c.productId));
};
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const weighedKg = (o, productId) =>
  Math.round(
    liveCrates(o)
      .filter((c) => !productId || c.productId === productId)
      .reduce((s, c) => s + c.net, 0) * 100,
  ) / 100;
/** Estado de piso de un pedido: pendiente → pesando → pesado → cargado → en_camino → entregado. */
export function floorStatus(o) {
  if (o.status === "entregado") return "entregado";
  if (o.status === "en_camino") return "en_camino";
  const crates = liveCrates(o);
  if (!crates.length) return "pendiente";
  const expected = expectedCrates(o);
  const kgItemsDone = o.items
    .filter((i) => !i.boxes)
    .every((i) => crates.some((c) => c.productId === i.id));
  const complete = cajasDe(crates) >= expected && kgItemsDone;
  if (!complete) return "pesando";
  if (crates.every((c) => c.loadedAt)) return "cargado";
  return "pesado";
}
export const floorLabels = {
  pendiente: "Sin pesar",
  pesando: "Pesando",
  pesado: "Pesado",
  cargado: "Cargado",
  en_camino: "En camino",
  entregado: "Entregado",
};

/** Pedidos de una fecha con sus cajones; se actualiza en vivo con los eventos del servidor. */
export function useDay(date) {
  const [day, setDay] = useState({ date, orders: [], tare: 1.7 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refreshRef = useRef(null);
  const load = useCallback(() => refreshRef.current?.(), []);

  useEffect(() => {
    let active = true;
    let timer;
    const controller = new AbortController();
    setDay({ date, orders: [], tare: 1.7 });
    setLoading(true);
    setError("");
    const refresh = coalescedRefresh(async () => {
      if (!active) return;
      try {
        const d = await api("/dia?fecha=" + date, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(12000),
          ]),
        });
        if (active) {
          setDay(d);
          setError("");
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    });
    refreshRef.current = refresh;
    void refresh();
    // La consulta por fecha aplica todos los filtros del servidor, incluidos cancelación
    // y reasignación. Agrupa ráfagas de pesadas sin descargar el histórico completo.
    const close = subscribe((type) => {
      if (type !== "orders") return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    });
    const online = () => void refresh();
    window.addEventListener("online", online);
    return () => {
      active = false;
      controller.abort();
      refreshRef.current = null;
      clearTimeout(timer);
      close();
      window.removeEventListener("online", online);
    };
  }, [date]);

  return { day, loading, error, reload: load, setDay };
}
