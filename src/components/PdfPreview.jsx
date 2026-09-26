import React, { useEffect, useState } from "react";
import { FileDown, Printer, Share2, Loader2 } from "lucide-react";
import { downloadBlob, openBlob, sharePdf } from "../lib/pdf.js";

const canShareFiles = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.canShare === "function" &&
  navigator.canShare({
    files: [new File(["x"], "x.pdf", { type: "application/pdf" })],
  });

/**
 * Vista previa de un PDF generado en el navegador, con Descargar / Imprimir / Compartir.
 * `generate` devuelve el blob; se vuelve a generar cuando cambia `deps`. Si el visor
 * incrustado no está disponible (celulares), quedan los botones.
 */
export default function PdfPreview({
  generate,
  fileName,
  shareText,
  deps = [],
  summary,
  children,
}) {
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setBlob(null);
    setError("");
    generate(controller.signal)
      .then((b) => alive && setBlob(b))
      .catch(
        (e) => alive && setError(e?.message || "No se pudo generar el PDF."),
      );
    return () => {
      alive = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (!blob) return setUrl("");
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  const run = async (action) => {
    if (!blob) return;
    setBusy(action);
    try {
      if (action === "download") downloadBlob(blob, fileName);
      else if (action === "open") openBlob(blob, fileName);
      else
        await sharePdf(blob, fileName, {
          title: fileName.replace(/\.pdf$/, "").replace(/_/g, " "),
          text: shareText,
        });
    } catch (e) {
      setError(e.message || "No se pudo abrir el PDF.");
    } finally {
      setBusy("");
    }
  };
  const Icon = ({ action, fallback: F }) =>
    busy === action ? <Loader2 size={15} className="spin" /> : <F size={15} />;
  return (
    <div className="pdf-preview">
      <div className="print-toolbar">
        <div className="pdf-preview-info">
          {children}
          {summary && <span className="muted">{summary}</span>}
        </div>
        <div className="actions-row">
          <button
            type="button"
            className="secondary"
            disabled={!blob || !!busy}
            onClick={() => run("download")}
            title="Descargar el PDF"
          >
            <Icon action="download" fallback={FileDown} /> Descargar
          </button>
          {canShareFiles() && (
            <button
              type="button"
              className="secondary"
              disabled={!blob || !!busy}
              onClick={() => run("share")}
              title="Enviar por WhatsApp u otra app"
            >
              <Icon action="share" fallback={Share2} /> Compartir
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={!blob || !!busy}
            onClick={() => run("open")}
            title="Abrir el PDF para imprimirlo"
          >
            <Icon action="open" fallback={Printer} /> Imprimir
          </button>
        </div>
      </div>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : !url ? (
        <p className="muted pdf-preview-loading" aria-live="polite">
          <Loader2 size={16} className="spin" /> Generando el PDF…
        </p>
      ) : (
        <object
          className="pdf-preview-frame"
          data={url}
          type="application/pdf"
          aria-label={fileName}
        >
          <p className="muted">
            Este navegador no muestra el PDF acá. Usá <b>Descargar</b> o{" "}
            <b>Imprimir</b> para abrirlo.
          </p>
        </object>
      )}
    </div>
  );
}
