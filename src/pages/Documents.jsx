import React, { useEffect, useState } from "react";
import { api, post } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { PageHead } from "../components/ui.jsx";
export default function Documents() {
  const { session } = useStore();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/documents")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  const labels = {
    pending: "Pendiente de Drive",
    uploading: "Subiendo a Drive",
    synced: "Guardado en Drive",
    error: "Error de subida",
  };
  return (
    <>
      <PageHead
        title="Documentos"
        description="Remitos, hojas y comprobantes con copia en el servidor y seguimiento de envío a Drive."
      />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data && !data.configured && (
        <p className="notice">
          Drive pendiente de conexión. Los archivos guardados en el servidor se
          enviarán cuando administración configure el acceso.
        </p>
      )}
      <section className="panel">
        <div className="section-line">
          <h2>{data?.pending || 0} pendientes</h2>
          {session?.role === "admin" && (
            <button
              className="secondary"
              disabled={busy || !data?.configured}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("/documents/retry", {});
                  await load();
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reintentar envíos
            </button>
          )}
        </div>
        {!data ? (
          <p>Cargando documentos…</p>
        ) : !data.documents.length ? (
          <p>No hay documentos archivados todavía.</p>
        ) : (
          <ul className="document-list">
            {data.documents.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <p>
                    {new Date(d.at).toLocaleString("es-AR")} ·{" "}
                    {labels[d.status]}
                  </p>
                  {d.error && <p className="red">{d.error}</p>}
                </div>
                <div className="actions-row">
                  <a
                    className="secondary"
                    href={`/api/documents/${d.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir copia
                  </a>
                  {d.url && (
                    <a
                      className="secondary"
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver en Drive
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
