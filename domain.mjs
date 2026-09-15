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
/** Repartidores iniciales (business.json); en producción viven en la tabla drivers. */
export const drivers = business.drivers;
/** Modo de la app: "completo" (portal de clientes + equipo) o "equipo" (solo administración y reparto). */
export const appMode = process.env.APP_MODE || business.mode || "completo";
/** Modo demostración (códigos y enlaces visibles, pedido de ejemplo): business.demo, o DEMO=1 / DEMO=0 por entorno. */
export const demo =
  process.env.DEMO === "1" || (process.env.DEMO !== "0" && !!business.demo);
/** N° de remito estilo talonario: punto de venta 0001 + correlativo de 8 dígitos (mismo formato que src/lib/remito.js). */
export const remitoNumber = (o) =>
  o.number
    ? `0001-${String(o.number).padStart(8, "0")}`
    : String(o.id || "").replace("PC-", "");
/** Tara por cajón (kg) que se descuenta del bruto en la balanza. */
export const defaultTare = Number(business.tare) || 1.7;
export const shifts = ["manana", "tarde"];
/** Datos fiscales impresos en el remito interno (business.json → fiscal). */
export const fiscal = business.fiscal || {};
export const origin = business.origin;
/** Kilos mínimos por modalidad: los precios mayorista/intermedio no son para una compra chica. */
export const planMinKg = business.planMinKg || {
  mayorista: 10,
  intermedio: 5,
  minorista: 0,
};
export const shippingByPlan = business.shipping || {
  mayorista: 0,
  intermedio: 1500,
  minorista: 1500,
};
export const statuses = ["recibido", "preparando", "en_camino", "entregado"];
/** Medios de pago por modalidad: efectivo al recibir, transferencia (alias/CVU), Mercado Pago online y cuenta corriente. */
export const paymentMethods = (plan) =>
  plan === "mayorista"
    ? ["cuenta", "entrega", "transferencia", "mercadopago"]
    : ["entrega", "transferencia", "mercadopago"];
export const roles = ["cliente", "admin", "repartidor"];

export const lineAmount = (price, kg) =>
  Math.round(Math.round(price * 100) * kg) / 100;
/**
 * Precio de lista de un producto para una modalidad. `lists` (opcional) son las listas editadas desde
 * Administración → Listas de precios ({productId: {mayorista, intermedio, minorista}}) y pisan business.json.
 */
export const productPrice = (product, plan, lists = null) => {
  const edited = lists?.[product.id]?.[plan];
  return Number.isFinite(Number(edited)) && Number(edited) > 0
    ? Number(edited)
    : product[planKey[plan]];
};
/** Productos con las listas editadas aplicadas (lo que ve el cliente en /api/config). */
export const withLists = (lists) =>
  !lists
    ? products
    : products.map((p) => ({
        ...p,
        wholesale: productPrice(p, "mayorista", lists),
        intermediate: productPrice(p, "intermedio", lists),
        retail: productPrice(p, "minorista", lists),
      }));
/** Valida listas editadas: precios de 1 a 1.000.000 por producto y modalidad; devuelve el objeto limpio. */
export function validateLists(input) {
  if (!input || typeof input !== "object") throw Error("Listas inválidas.");
  const out = {};
  for (const p of products) {
    const row = input[p.id];
    if (!row) continue;
    for (const plan of plans) {
      if (row[plan] === undefined || row[plan] === null || row[plan] === "")
        continue;
      const v = Math.round(Number(row[plan]) * 100) / 100;
      if (!Number.isFinite(v) || v <= 0 || v > 1000000)
        throw Error(`Precio inválido para ${p.name} (${plan}).`);
      (out[p.id] ||= {})[plan] = v;
    }
  }
  return out;
}

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

/**
 * Precia un pedido. `prices` (opcional) son los precios propios del cliente por producto: pisan la lista
 * de la modalidad. `staff` permite pedidos por cajas (kg pendientes de balanza) y sin teléfono de contacto.
 */
export function priceOrder(
  input,
  {
    enforceMin = true,
    prices = null,
    staff = false,
    locality: forced,
    lists = null,
  } = {},
) {
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
    if (!p || ids.has(item.id))
      throw Error("Elegí productos válidos, sin repetir.");
    // Pedido por cajas (equipo): los kilos los pone la balanza; hasta entonces la línea vale 0.
    const boxes = staff && item.boxes !== undefined ? Number(item.boxes) : null;
    if (
      boxes !== null &&
      (!Number.isFinite(boxes) ||
        boxes < 0 ||
        boxes > 500 ||
        !Number.isInteger(boxes))
    )
      throw Error("Las cajas deben ser un número entero (0 a 500).");
    const kg =
      item.kg === undefined || item.kg === null || item.kg === ""
        ? 0
        : Number(item.kg);
    if (boxes === null || kg > 0) {
      if (
        !Number.isFinite(kg) ||
        kg < (staff ? 0.05 : 1) ||
        kg > (staff ? 5000 : 1000) ||
        (!staff && !Number.isInteger(kg * 2))
      )
        throw Error(
          staff
            ? "Los kilos deben ser un número válido (hasta 5000 kg)."
            : "La cantidad debe ser de 1 a 1000 kg, en pasos de 0,5 kg.",
        );
    }
    if (boxes === null && kg <= 0) throw Error("Indicá cajas o kilos.");
    const own =
      prices && Number.isFinite(Number(prices[p.id]))
        ? Number(prices[p.id])
        : null;
    const price = own ?? productPrice(p, input.plan, lists);
    if (!Number.isFinite(price) || price <= 0)
      throw Error(`El precio de ${p.name} está pendiente para este cliente.`);
    ids.add(item.id);
    return {
      id: p.id,
      name: p.name,
      kg,
      ...(boxes !== null ? { boxes } : {}),
      price,
      ownPrice: own !== null,
      lineTotal: lineAmount(price, kg),
    };
  });
  const kg = items.reduce((n, p) => n + p.kg, 0);
  if (enforceMin && !staff && kg < (planMinKg[input.plan] || 0))
    throw Error(
      `La modalidad ${input.plan} es a partir de ${planMinKg[input.plan]} kg. Para menos, elegí minorista.`,
    );
  // Para el equipo, la cuenta corriente depende de la ficha (crédito habilitado), no de la modalidad de precios.
  const allowed = staff
    ? ["cuenta", "entrega", "transferencia", "mercadopago"]
    : paymentMethods(input.plan);
  if (!allowed.includes(input.payment))
    throw Error("Medio de pago no disponible para esta modalidad.");
  if (
    typeof input.address !== "string" ||
    (!staff && input.address.trim().length < 8) ||
    input.address.length > 250
  )
    throw Error("Ingresá una dirección completa.");
  if (
    typeof input.name !== "string" ||
    input.name.trim().length < 2 ||
    input.name.length > 100
  )
    throw Error("Ingresá tu nombre.");
  const phone = String(input.phone || "").trim();
  if (
    (!staff || phone) &&
    (!/^[+\d ()-]{8,25}$/.test(phone) || !normalizePhone(phone))
  )
    throw Error("Ingresá un teléfono válido, con código de área.");
  const locality = forced || localities.find((l) => l.id === input.localityId);
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
 * `weights` es { [productId]: kg } con hasta dos decimales, de 0,05 a 5000 kg.
 */
/** Cambia el precio por kilo de uno o más renglones de un pedido y recalcula importes (administración). */
export function applyPrices(order, prices) {
  if (!prices || typeof prices !== "object")
    throw Error("Indicá los precios nuevos.");
  const items = order.items.map((item) => {
    if (!(item.id in prices)) return item;
    const price = Math.round(Number(prices[item.id]) * 100) / 100;
    if (!Number.isFinite(price) || price <= 0 || price > 1000000)
      throw Error(`Precio inválido para ${item.name}.`);
    return {
      ...item,
      price,
      ownPrice: true,
      lineTotal: lineAmount(price, item.kg),
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

export function applyWeights(order, weights) {
  if (!weights || typeof weights !== "object")
    throw Error("Ingresá los kilos pesados.");
  const items = order.items.map((item) => {
    if (!(item.id in weights)) return item;
    const kg = Math.round(Number(weights[item.id]) * 100) / 100;
    if (!Number.isFinite(kg) || kg < 0.05 || kg > 5000)
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
