import { useCallback, useEffect, useState } from "react";
import { api, subscribe } from "./api.js";

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const dmy = (key) => (key ? key.split("-").reverse().join("/") : "");

/** Cajones vigentes de un pedido. */
export const liveCrates = (o) => (o.crates || []).filter((c) => !c.voided);
/** Cajones esperados: la suma de cajas pedidas (lo pedido por kilo va aparte, como bultos). */
export const expectedCrates = (o) =>
  o.items.reduce((n, i) => n + (i.boxes || 0), 0);
/** Cajones pesados de los ítems pedidos por cajas (para comparar con expectedCrates). */
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
  const complete = crates.length >= expected && kgItemsDone;
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
  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const d = await api("/dia?fecha=" + date);
        setDay(d);
        setError("");
      } catch (e) {
        if (!silent) setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [date],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    let timer;
    const close = subscribe((type) => {
      if (type !== "orders") return;
      clearTimeout(timer);
      timer = setTimeout(() => load({ silent: true }), 300);
    });
    return () => {
      close();
      clearTimeout(timer);
    };
  }, [load]);
  return { day, loading, error, reload: load, setDay };
}
