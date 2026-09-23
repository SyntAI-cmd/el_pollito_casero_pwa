import { api, post } from "./api.js";
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
  window.dispatchEvent(new CustomEvent("archive-status", { detail: message }));
export async function archivePdf(
  blob,
  { name, orders = [], kind = "documentos" },
) {
  if (!owner) return;
  const id = crypto.randomUUID(),
    who = owner;
  try {
    await items("put", { id, owner: who, blob, name, orders, kind });
  } catch {
    throw Error(
      "No se pudo conservar el documento en este dispositivo. Liberá espacio y reintentá.",
    );
  }
  notice("Documento conservado. Preparando envío al servidor…");
  void flushDocuments();
}
export async function flushDocuments() {
  if (working || !owner || !navigator.onLine) return;
  working = true;
  const who = owner;
  try {
    const session = await api("/session");
    const current =
      session &&
      `${session.role}:${session.username || session.driver || session.name}`;
    if (current !== who) return;
    for (const row of await items("getAll")) {
      if (owner !== who) break;
      if (row.owner !== who) continue;
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(row.blob);
      });
      await post("/documents", {
        name: row.name,
        orders: row.orders,
        kind: row.kind,
        base64,
      });
      await items("delete", row.id);
      notice(
        "Documento guardado en el servidor. Consultá su envío a Drive en Documentos.",
      );
    }
  } catch (e) {
    notice("Documento pendiente en este dispositivo: " + e.message);
  } finally {
    working = false;
  }
}
window.addEventListener("online", () => void flushDocuments());
setInterval(() => void flushDocuments(), 30000);
