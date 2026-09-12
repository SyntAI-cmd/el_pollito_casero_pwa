/**
 * Cobros con Mercado Pago.
 *
 * 1. Transferencia (alias/CVU): sin credenciales. El cliente ve los datos, transfiere desde
 *    su app y avisa "ya transferí"; administración confirma al ver el dinero.
 * 2. Checkout Pro (pago online con tarjeta/dinero en cuenta): requiere MP_ACCESS_TOKEN.
 *    Se crea una preferencia por pedido y el webhook marca el pedido como pagado.
 *    Documentación: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro
 */
import business from "../business.json" with { type: "json" };

const token = process.env.MP_ACCESS_TOKEN || "";
const api = "https://api.mercadopago.com";

export const transferInfo = () => {
  const alias = process.env.TRANSFER_ALIAS || business.transfer?.alias || "";
  if (!alias) return null;
  return {
    alias,
    cvu: process.env.TRANSFER_CVU || business.transfer?.cvu || "",
    holder:
      process.env.TRANSFER_HOLDER ||
      business.transfer?.holder ||
      business.adminName ||
      "",
    bank: business.transfer?.bank || "Mercado Pago",
  };
};
export const checkoutEnabled = () => !!token;

/** Crea la preferencia de Checkout Pro para un pedido y devuelve el enlace de pago. */
export async function createPreference(order, { base, payerEmail } = {}) {
  if (!token)
    throw Error("Mercado Pago online no está configurado (MP_ACCESS_TOKEN).");
  const body = {
    external_reference: order.id,
    items: order.items.map((i) => ({
      id: i.id,
      title: `${i.name} · ${i.kg} kg`,
      quantity: 1,
      unit_price: Math.round(i.lineTotal * 100) / 100,
      currency_id: "ARS",
    })),
    ...(order.shipping > 0
      ? { shipments: { cost: order.shipping, mode: "not_specified" } }
      : {}),
    payer: payerEmail ? { email: payerEmail } : undefined,
    back_urls: {
      success: `${base}/seguimiento?pedido=${order.id}&mp=ok`,
      pending: `${base}/seguimiento?pedido=${order.id}&mp=pendiente`,
      failure: `${base}/seguimiento?pedido=${order.id}&mp=error`,
    },
    auto_return: "approved",
    notification_url: base.startsWith("https://")
      ? `${base}/api/mp/webhook`
      : undefined,
    statement_descriptor: "POLLITO CASERO",
    metadata: { order_id: order.id },
  };
  const r = await fetch(`${api}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": `pref-${order.id}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(data.message || "Mercado Pago rechazó la preferencia.");
  return {
    id: data.id,
    initPoint: data.init_point,
    sandboxInitPoint: data.sandbox_init_point,
  };
}

/** Consulta un pago por id y devuelve { orderId, approved, amount, status }. */
export async function fetchPayment(paymentId) {
  if (!token) throw Error("MP_ACCESS_TOKEN no configurado.");
  const r = await fetch(`${api}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error("No se pudo consultar el pago en Mercado Pago.");
  const pmt = await r.json();
  return {
    id: String(pmt.id),
    orderId: pmt.external_reference || pmt.metadata?.order_id || null,
    approved: pmt.status === "approved",
    status: pmt.status,
    amount: pmt.transaction_amount,
    method: pmt.payment_type_id,
  };
}
