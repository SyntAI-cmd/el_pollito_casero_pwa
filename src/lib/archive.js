import { api } from "./api.js";

let owner = "",
  working = false;

export function setArchiveOwner(session) {
  owner =
    session && ["admin", "repartidor"].includes(session.role)
      ? `${session.role}:${session.username || session.driver || session.name}`
      : "";
}

function database() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("pollito-documents", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("pending", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function items(action, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      "pending",
      action === "getAll" ? "readonly" : "readwrite",
    );
    const store = tx.objectStore("pending");
    const r = action === "clear" ? store.clear() : store[action](value);
    tx.oncomplete = () => {
      db.close();
      resolve(r.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

const notice = (message) =>
  typeof window !== "undefined" &&
  window.dispatchEvent(new CustomEvent("archive-status", { detail: message }));

/** Cancela y vacía completamente la cola de documentos pendientes en este dispositivo. */
export async function cancelDocumentsQueue() {
  try {
    await items("clear");
    console.info("Cola de documentos pendientes cancelada en este dispositivo.");
    return true;
  } catch (err) {
    console.warn("No se pudo limpiar la cola de documentos:", err);
    return false;
  }
}
export const clearDocumentsQueue = cancelDocumentsQueue;

/**
 * Conservación de documentos en segundo plano.
 * NOTA: Con la sección de Documentos retirada de producción, no se encolan subidas
 * en segundo plano para evitar bloqueos, consumos innecesarios o alertas repetitivas.
 * Los PDFs se generan, descargan y comparten normalmente de forma directa.
 */
export async function archivePdf(
  blob,
  { name, orders = [], kind = "documentos" } = {},
) {
  // Módulo de archivo desactivado por decisión operativa.
  return;
}

export async function flushDocuments() {
  if (working || !owner || (typeof navigator !== "undefined" && !navigator.onLine))
    return;
  working = true;
  const who = owner;
  try {
    const session = await api("/session");
    const current =
      session &&
      `${session.role}:${session.username || session.driver || session.name}`;
    if (current !== who) return;

    const rows = await items("getAll");
    for (const row of rows) {
      if (owner !== who) break;
      if (row.owner !== who) continue;
      if (row.status === "requires_attention") continue;

      await new Promise((resolve) => setTimeout(resolve, 50));

      try {
        const base64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1]);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(row.blob);
        });

        await api("/documents", {
          method: "POST",
          body: JSON.stringify({
            name: row.name,
            orders: row.orders,
            kind: row.kind,
            base64,
          }),
          signal: AbortSignal.timeout(60000),
        });

        await items("delete", row.id);
      } catch (docError) {
        const isPermanent =
          docError.status &&
          docError.status >= 400 &&
          docError.status < 500 &&
          docError.status !== 408 &&
          docError.status !== 429;

        if (isPermanent) {
          row.status = "requires_attention";
          row.error = docError.message || "Rechazado por el servidor";
          row.failedAt = new Date().toISOString();
          await items("put", row);
          continue;
        } else {
          // Error transitorio: no emitir toast invasivo en bucle continuo
          console.warn("Fallo transitorio en envío de documento:", docError.message);
          break;
        }
      }
    }
  } catch (e) {
    console.warn("Error en flushDocuments:", e.message);
  } finally {
    working = false;
  }
}

// Inicialización en navegador: limpiar cola trabada y exponer helper
if (typeof window !== "undefined") {
  // Cancelar inmediatamente cualquier documento pendiente que haya quedado encolado en el dispositivo
  setTimeout(() => {
    cancelDocumentsQueue().catch(() => {});
  }, 500);
  window.cancelarColaDocumentos = cancelDocumentsQueue;
}
