export const money = (n) =>
  !Number.isFinite(n)
    ? "A confirmar"
    : new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(n);

export const kgText = (n) =>
  `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(n)} kg`;

export const labels = {
  recibido: "Pedido recibido",
  preparando: "En preparación",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};
export const stages = ["recibido", "preparando", "en_camino", "entregado"];
export const stageHints = [
  "Ya recibimos tu pedido.",
  "Estamos armando tus productos.",
  "Tu repartidor salió a entregar.",
  "Tu pedido llegó a destino.",
];

export const planKey = {
  mayorista: "wholesale",
  intermedio: "intermediate",
  minorista: "retail",
};
export const planNames = {
  mayorista: "Mayorista",
  intermedio: "Intermedio",
  minorista: "Minorista",
};
export const productPrice = (product, plan) => product[planKey[plan]];
export const lineAmount = (price, kg) =>
  Math.round(Math.round(price * 100) * kg) / 100;

export const paymentLabel = (o) =>
  o.payment === "cuenta"
    ? "Cuenta corriente"
    : o.payment === "entrega"
      ? "Pago al recibir"
      : "Transferencia";

export const totalKg = (o) => o.items.reduce((n, p) => n + p.kg, 0);
export const localityText = (o) =>
  o.locality ? `${o.locality.name}, Mendoza` : "";
export const dateText = (iso) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
export const timeText = (iso) =>
  new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });

export const normalize = (s) =>
  String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export const waLink = (phone, text) =>
  `https://wa.me/${String(phone).replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

export const isActive = (o) =>
  o.status !== "entregado" && o.status !== "cancelado";
