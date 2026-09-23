/**
 * Auditoría: qué se registra y cómo (PC-003).
 *
 * Un solo historial, el que ya existía (`audit_log`), con más columnas. No se crea un registro
 * paralelo. Lo que se guarda por evento:
 *
 *   instante UTC · actor estable + nombre visible + rol · acción · categoría · entidad e ID
 *   · campos cambiados con antes/después · motivo · operación de origen · resultado
 *
 * Nada de contraseñas, tokens ni imágenes: solo pasa lo que está en la lista permitida.
 */

/** Categoría legible a partir de la acción, para la pantalla de Movimientos (PC-014). */
const CATEGORIAS = [
  [/^crate\./, "Pesadas"],
  [/^customer\.saldos$/, "Saldos"],
  [/^boxes\./, "Cajas"],
  [/^price|prices$/, "Precios"],
  [/^order\.(assign|driver)/, "Asignaciones"],
  [/^order\.deliver/, "Entregas"],
  [/^order\./, "Pedidos"],
  [/^payment\.|^cash\./, "Cobros"],
  [/^document\.|^receipt\./, "Documentos"],
  [/^session\.|^auth\./, "Accesos"],
  [/^customer\./, "Clientes"],
  [/^driver\.|^vehicle\.|^news\.|^settings\./, "Configuración"],
];
export const categoriaDe = (accion) =>
  CATEGORIAS.find(([re]) => re.test(accion))?.[1] || "Otros";

/**
 * Campos que pueden viajar al historial. Todo lo demás se descarta: es la forma de no guardar
 * nunca una contraseña, un token o una foto aunque alguien los mande en el cuerpo del pedido.
 */
const PERMITIDOS = new Set([
  // pedido
  "status",
  "driver",
  "driver2",
  "vehicleId",
  "deliveryDate",
  "shift",
  "zone",
  "notes",
  "payment",
  "paid",
  "paidMethod",
  "total",
  "subtotal",
  "shipping",
  "number",
  "noPricing",
  "items",
  "removed",
  "loaded",
  "boxes",
  "returned",
  "departedAt",
  "deliveredAt",
  "deliveredBy",
  "reason",
  "motivo",
  // cliente y cuenta
  "name",
  "alias",
  "legalName",
  "cuit",
  "code",
  "branch",
  "contactPhone",
  "address",
  "localityId",
  "plan",
  "credit",
  "creditBalance",
  "status",
  "balance",
  "boxesAdjust",
  "amount",
  "delta",
  "boxesDelta",
  "note",
  // pesada
  "productId",
  "gross",
  "tare",
  "net",
  "crateId",
  "kg",
  "ordered",
  "unidades",
  // documentos
  "kind",
  "file",
  "bytes",
  "orders",
  "driveId",
  // varios
  "date",
  "active",
  "sort",
  "plate",
  "method",
  "ip",
]);
/** Nombres que nunca se guardan, ni aunque estén en la lista de arriba por error. */
const PROHIBIDOS =
  /pass|clave|token|secret|authorization|cookie|image|base64|photo|foto|firma/i;

const MAX_TEXTO = 400;

/** Deja un valor en algo chico y seguro de guardar. */
function limpiarValor(v, prof = 0) {
  if (v === null || v === undefined) return v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string")
    return v.length > MAX_TEXTO ? v.slice(0, MAX_TEXTO) + "…" : v;
  if (prof >= 2) return undefined;
  if (Array.isArray(v))
    return v.slice(0, 40).map((x) => limpiarValor(x, prof + 1));
  if (typeof v === "object") return limpiar(v, prof + 1);
  return undefined;
}

/** Filtra un objeto por la lista permitida. Devuelve undefined si no queda nada. */
export function limpiar(obj, prof = 0) {
  if (!obj || typeof obj !== "object") return undefined;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PROHIBIDOS.test(k)) continue;
    if (prof === 0 && !PERMITIDOS.has(k)) continue;
    const limpio = limpiarValor(v, prof);
    if (limpio !== undefined) out[k] = limpio;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Compara antes y después y devuelve solo lo que cambió, como { campo: [antes, después] }.
 * Sirve para el resumen "usuario corrigió saldo: 100.000 → 90.000" de PC-014.
 */
export function cambios(antes, despues) {
  const a = limpiar(antes) || {};
  const d = limpiar(despues) || {};
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(d)])) {
    const x = a[k],
      y = d[k];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    out[k] = [x ?? null, y ?? null];
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Identidad del actor. El id sale de la sesión autenticada, nunca del nombre escrito:
 * dos personas pueden llamarse igual. Los registros viejos no tienen id y se quedan sin él;
 * no se inventa uno a partir del nombre.
 */
export function actorDe(session) {
  if (!session) return { id: null, nombre: null, rol: "sistema" };
  const id =
    session.staffId != null
      ? `staff:${session.staffId}`
      : session.accountId
        ? `account:${session.accountId}`
        : session.phone
          ? `cliente:${session.phone}`
          : null;
  const nombre =
    session.role === "repartidor"
      ? session.driver || session.name
      : session.name || session.driver || session.phone || null;
  return { id, nombre: nombre || null, rol: session.role || "sistema" };
}
