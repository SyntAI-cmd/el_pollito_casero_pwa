import { api } from "./api.js";
let owner = "",
  working = false;
export function setArchiveOwner(session) {
  owner =
    session && ["admin", "repartidor"].includes(session.role)
      ? `${session.role}:${session.username || session.driver || session.name}`
      : "";
  if (owner) void flushDocuments();
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
    const r = tx.objectStore("pending")[action](value);
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

export async function archivePdf(
  blob,
  { name, orders = [], kind = "documentos" },
) {
  if (!owner) return;
  const id = crypto.randomUUID(),
    who = owner;
  try {
    await items("put", {
      id,
      owner: who,
      blob,
      name,
      orders,
      kind,
      status: "pending",
      created: new Date().toISOString(),
    });
  } catch {
    throw Error(
      "No se pudo conservar el documento en este dispositivo. Liberá espacio y reintentá.",
    );
  }
  notice("Documento conservado. Preparando envío al servidor…");
  void flushDocuments();
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
      // FIX: Ignorar documentos marcados con error permanente para no bloquear la cola
      if (row.status === "requires_attention") continue;

      // FIX: Aislar el hilo cediendo tiempo al event loop antes de procesar cada PDF pesado
      await new Promise((resolve) => setTimeout(resolve, 50));

      // FIX: Bloque try/catch robusto por cada documento en el bucle
      try {
        const base64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1]);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(row.blob);
        });

        // FIX: Presupuesto de tiempo aislado (60s) para PDFs sin interferir con timeout de pesadas
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
        notice(
          "Documento guardado en el servidor. Consultá su envío a Drive en Documentos.",
        );
      } catch (docError) {
        const isPermanent =
          docError.status &&
          docError.status >= 400 &&
          docError.status < 500 &&
          docError.status !== 408 &&
          docError.status !== 429;

        if (isPermanent) {
          // FIX: Error permanente (ej. 400): marcar como requires_attention y usar continue para no frenar los demás
          row.status = "requires_attention";
          row.error = docError.message || "Rechazado por el servidor";
          row.failedAt = new Date().toISOString();
          await items("put", row);
          notice(
            `Documento ${row.name || "pendiente"} requiere atención: ${docError.message}`,
          );
          continue;
        } else {
          // Fallo transitorio (red o servidor): detener el ciclo actual y esperar próximo reintento
          notice("Documento pendiente en este dispositivo: " + docError.message);
          break;
        }
      }
    }
  } catch (e) {
    notice("Documento pendiente en este dispositivo: " + e.message);
  } finally {
    working = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushDocuments());
  const docInterval = setInterval(() => void flushDocuments(), 30000);
  docInterval?.unref?.();
}
