let active = false;

/** Aísla el motor de PDF y libera toda su memoria al terminar, fallar o cancelar. */
export function renderPdf(kind, props, { signal } = {}) {
  if (signal?.aborted)
    return Promise.reject(new DOMException("Cancelado", "AbortError"));
  if (active)
    return Promise.reject(
      Error("Ya se está preparando un PDF. Esperá a que termine."),
    );
  active = true;
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    let settled = false;
    const finish = (error, blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker?.terminate();
      active = false;
      if (error) reject(error);
      else resolve(blob);
    };
    const cancel = () => finish(new DOMException("Cancelado", "AbortError"));
    try {
      worker = new Worker(new URL("./pdf.worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) =>
        finish(data.error ? Error(data.error) : null, data.blob);
      worker.onerror = () =>
        finish(
          Error("No se pudo preparar el PDF. Reintentá con menos pedidos."),
        );
      timer = setTimeout(
        () =>
          finish(
            Error(
              "El documento tardó demasiado. Elegí menos pedidos y reintentá.",
            ),
          ),
        60000,
      );
      signal?.addEventListener("abort", cancel, { once: true });
      worker.postMessage({ kind, props });
    } catch (error) {
      finish(error);
    }
  });
}
