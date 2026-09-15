import { post, api } from "./api.js";

/**
 * Fotos de comprobantes desde el celular: se achican en el dispositivo (lado mayor ≤ 1600 px,
 * JPEG 0,82) para que pesen ~150–400 KB y viajen en base64 al servidor.
 */
const MAX_SIDE = 1600;

export function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * k);
      canvas.height = Math.round(img.height * k);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(Error("No se pudo leer la foto."));
    };
    img.src = url;
  });
}

/** Sube la foto de un comprobante de un pedido. `kind`: transferencia | cheque | firma | efectivo | otro. */
export async function uploadReceipt(
  orderId,
  file,
  { kind, amount, note } = {},
) {
  const image = await shrinkImage(file);
  return post(`/orders/${orderId}/comprobantes`, { kind, image, amount, note });
}

export const receiptsOf = (orderId) => api(`/orders/${orderId}/comprobantes`);
export const receiptImage = (id) => `/api/comprobantes/${id}/imagen`;

export const receiptKinds = {
  transferencia: "Transferencia",
  cheque: "Cheque",
  firma: "Remito firmado",
  efectivo: "Efectivo",
  otro: "Otro",
};
export const methodNames = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  mercadopago: "Mercado Pago",
  mixto: "Mixto",
};
