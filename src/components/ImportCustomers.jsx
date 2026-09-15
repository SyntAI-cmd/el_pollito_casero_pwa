import React, { useState } from "react";
import { FileSpreadsheet, Upload, Loader2 } from "lucide-react";
import { post } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";

/** Importar clientes desde un Excel (.xlsx) con una fila por cliente; hay plantilla para descargar. */
export default function ImportCustomers() {
  const { notify, loadCustomers } = useStore();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  return (
    <span className="import-customers">
      <a className="link-button" href="/api/customers/plantilla">
        <FileSpreadsheet size={13} /> Plantilla
      </a>
      <label
        className={"secondary small receipt-button " + (busy ? "busy" : "")}
      >
        {busy ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}{" "}
        {busy ? "Importando…" : "Importar Excel"}
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            try {
              const data = await new Promise((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = () => rej(Error("No se pudo leer el archivo."));
                r.readAsDataURL(file);
              });
              const r = await post("/customers/importar", { file: data });
              setResult(r);
              notify(
                `Importado: ${r.created} nuevos, ${r.updated} actualizados${r.errors.length ? `, ${r.errors.length} con error` : ""}.`,
              );
              await loadCustomers();
            } catch (err) {
              notify(err.message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {result?.errors?.length ? (
        <small className="muted"> {result.errors.join(" · ")}</small>
      ) : null}
    </span>
  );
}
