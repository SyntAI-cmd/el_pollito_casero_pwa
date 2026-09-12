import { existsSync } from "node:fs";
import business from "./business.json" with { type: "json" };

export const plans = ["mayorista", "intermedio", "minorista"];
export const planKey = {
  mayorista: "wholesale",
  intermedio: "intermediate",
  minorista: "retail",
};
// La foto de cada corte se toma de business.json o, si existe, de public/images/<id>.webp.
export const products = business.products.map((p) => ({
  ...p,
  image:
    p.image ||
    (existsSync(`public/images/${p.id}.webp`) ? `/images/${p.id}.webp` : null),
  ...business.prices[p.id],
  unit: "Por kg",
}));
export const localities = business.localities;
export const drivers = business.drivers;
export const origin = business.origin;
export const shippingByPlan = business.shipping || {
  mayorista: 0,
  intermedio: 1500,
  minorista: 1500,
};
export const statuses = ["recibido", "preparando", "en_camino", "entregado"];
export const roles = ["cliente", "admin", "repartidor"];

export const lineAmount = (price, kg) =>
  Math.round(Math.round(price * 100) * kg) / 100;
export const productPrice = (product, plan) => product[planKey[plan]];

/** Teléfono argentino normalizado a formato internacional sin símbolos (para WhatsApp e identidad). */
export function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) {
    d = d.slice(2);
    if (d.startsWith("9")) d = d.slice(1);
  }
  if (d.startsWith("0")) d = d.slice(1);
  // Quita el "15" de celulares escritos como (263) 15 503-7286.
  if (d.length === 12 && /^\d{2,4}15/.test(d))
    d = d.replace(/^(\d{2,4})15/, "$1");
  if (d.length < 10 || d.length > 11) return null;
  return "549" + d;
}

export function priceOrder(input) {
  if (!plans.includes(input.plan)) throw Error("Elegí una modalidad válida.");
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > products.length
  )
    throw Error("Agregá al menos un producto.");
  const ids = new Set();
  const items = input.items.map((item) => {
    const p = products.find((p) => p.id === item.id);
    if (
      !p ||
      ids.has(item.id) ||
      !Number.isFinite(item.kg) ||
      item.kg < 1 ||
      item.kg > 1000 ||
      !Number.isInteger(item.kg * 2)
    )
      throw Error("La cantidad debe ser de 1 a 1000 kg, en pasos de 0,5 kg.");
    const price = productPrice(p, input.plan);
    if (!Number.isFinite(price) || price <= 0)
      throw Error(`El precio de ${p.name} está pendiente para esta modalidad.`);
    ids.add(item.id);
    return {
      id: p.id,
      name: p.name,
      kg: item.kg,
      price,
      lineTotal: lineAmount(price, item.kg),
    };
  });
  const allowed =
    input.plan === "mayorista"
      ? ["cuenta", "entrega", "transferencia"]
      : ["entrega", "transferencia"];
  if (!allowed.includes(input.payment))
    throw Error("Medio de pago no disponible para esta modalidad.");
  if (
    typeof input.address !== "string" ||
    input.address.trim().length < 8 ||
    input.address.length > 250
  )
    throw Error("Ingresá una dirección completa.");
  if (
    typeof input.name !== "string" ||
    input.name.trim().length < 2 ||
    input.name.length > 100
  )
    throw Error("Ingresá tu nombre.");
  if (
    typeof input.phone !== "string" ||
    !/^[+\d ()-]{8,25}$/.test(input.phone) ||
    !normalizePhone(input.phone)
  )
    throw Error("Ingresá un teléfono válido, con código de área.");
  const locality = localities.find((l) => l.id === input.localityId);
  if (!locality) throw Error("Elegí una localidad de la lista de Mendoza.");
  const subtotal =
    items.reduce((n, p) => n + Math.round(p.lineTotal * 100), 0) / 100;
  const shipping = shippingByPlan[input.plan];
  return {
    items,
    subtotal,
    shipping,
    total: (Math.round(subtotal * 100) + shipping * 100) / 100,
    locality: { ...locality },
  };
}

/** Saldo de cuenta corriente y envases pendientes de un conjunto de pedidos. */
export function accountSummary(orders, customer = {}) {
  const valid = orders.filter((o) => o.status !== "cancelado");
  const credit = valid.filter((o) => o.payment === "cuenta" && !o.paid);
  const owed = credit.reduce((s, o) => s + Math.round(o.total * 100), 0);
  const favor = Math.round((customer.creditBalance || 0) * 100);
  return {
    balance: (owed - favor) / 100,
    owed: owed / 100,
    creditBalance: favor / 100,
    pendingOrders: credit.length,
    boxes: valid.reduce((s, o) => s + (o.boxes || 0) - (o.returned || 0), 0),
  };
}

/**
 * Aplica el peso real de balanza a las líneas de un pedido y recalcula importes.
 * `weights` es { [productId]: kg } con hasta dos decimales, de 0,05 a 1000 kg.
 */
export function applyWeights(order, weights) {
  if (!weights || typeof weights !== "object")
    throw Error("Ingresá los kilos pesados.");
  const items = order.items.map((item) => {
    if (!(item.id in weights)) return item;
    const kg = Math.round(Number(weights[item.id]) * 100) / 100;
    if (!Number.isFinite(kg) || kg < 0.05 || kg > 1000)
      throw Error(`Peso inválido para ${item.name}.`);
    return {
      ...item,
      ordered: item.ordered ?? item.kg,
      kg,
      lineTotal: lineAmount(item.price, kg),
      weighed: true,
    };
  });
  const subtotal =
    items.reduce((n, p) => n + Math.round(p.lineTotal * 100), 0) / 100;
  return {
    items,
    subtotal,
    total:
      (Math.round(subtotal * 100) + Math.round((order.shipping || 0) * 100)) /
      100,
  };
}

/**
 * Aplica un pago de cuenta corriente a los pedidos a cuenta impagos, del más viejo al más nuevo.
 * Devuelve los pedidos cubiertos y el sobrante, que queda como saldo a favor del cliente.
 */
export function applyPayment(orders, amount, previousCredit = 0) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000)
    throw Error("Ingresá un importe válido.");
  let remaining = Math.round((amount + previousCredit) * 100);
  const covered = [];
  const pending = orders
    .filter(
      (o) => o.payment === "cuenta" && !o.paid && o.status !== "cancelado",
    )
    .sort((a, b) => a.created.localeCompare(b.created));
  for (const o of pending) {
    const cents = Math.round(o.total * 100);
    if (cents > remaining) break;
    remaining -= cents;
    covered.push(o);
  }
  return { covered, leftover: remaining / 100 };
}
