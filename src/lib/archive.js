/** El archivado automático fue retirado. Nunca se leen blobs ni se reintentan subidas. */
export function setArchiveOwner() {}
export async function archivePdf() {}
export async function flushDocuments() {}

/** Borra solamente la cola de PDFs retirada; no toca pedidos ni pesadas pendientes. */
export function cancelDocumentsQueue() {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(false);
    const request = indexedDB.open("pollito-documents", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("pending"))
        request.result.createObjectStore("pending", { keyPath: "id" });
    };
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains("pending")) {
        db.close();
        return resolve(true);
      }
      const tx = db.transaction("pending", "readwrite");
      tx.objectStore("pending").clear();
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        resolve(false);
      };
    };
  });
}
export const clearDocumentsQueue = cancelDocumentsQueue;
if (typeof window !== "undefined") {
  void cancelDocumentsQueue();
  window.cancelarColaDocumentos = cancelDocumentsQueue;
}
