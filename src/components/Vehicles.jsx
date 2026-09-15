import React, { useEffect, useState } from "react";
import { Truck, Plus } from "lucide-react";
import { api, post, patch } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";

/** Formulario de un vehículo (fuera del componente padre para que las actualizaciones en vivo no lo remonten). */
function VehicleForm({ v, onDone, run, busy }) {
  return (
    <form
      className="driver-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const ok = await run(() =>
          v
            ? patch("/vehicles/" + v.id, {
                name: f.name,
                plate: f.plate,
                note: f.note,
                active: f.active === "on",
              })
            : post("/vehicles", { name: f.name, plate: f.plate, note: f.note }),
        );
        if (ok) onDone();
      }}
    >
      <label>
        Vehículo
        <input
          name="name"
          required
          minLength="2"
          maxLength="60"
          defaultValue={v?.name || ""}
          autoComplete="off"
          placeholder="Toyota Hino"
        />
      </label>
      <label>
        Patente
        <input
          name="plate"
          maxLength="12"
          defaultValue={v?.plate || ""}
          autoComplete="off"
          placeholder="A7234"
          style={{ textTransform: "uppercase" }}
        />
      </label>
      <label>
        Descripción
        <input
          name="note"
          maxLength="60"
          defaultValue={v?.note || ""}
          autoComplete="off"
          placeholder="Camión, camioneta nueva…"
        />
      </label>
      {v && (
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={v.active} />{" "}
          Activo
        </label>
      )}
      <div className="actions-row">
        <button className="primary" disabled={busy}>
          Guardar
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Flota: los vehículos con los que sale el reparto (nombre y patente). Solo administración. */
export default function Vehicles() {
  const { notify } = useStore();
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    api("/vehicles")
      .then(setList)
      .catch((e) => notify(e.message));
  useEffect(() => {
    load();
  }, []);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      notify(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="section-line">
        <h2>
          <Truck size={17} /> Vehículos
        </h2>
        <button
          className="secondary small"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          <Plus size={14} /> Agregar vehículo
        </button>
      </div>
      {adding && (
        <VehicleForm onDone={() => setAdding(false)} run={run} busy={busy} />
      )}
      {list.length === 0 && !adding ? (
        <p className="muted">
          Todavía no hay vehículos. Cargá cada camión (ej. "Toyota Hino A7234")
          para armar las salidas del día y ver la flota en el mapa.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="customers drivers-table">
            <thead>
              <tr>
                <th>Vehículo</th>
                <th>Patente</th>
                <th>Descripción</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) =>
                editing === v.id ? (
                  <tr key={v.id}>
                    <td colSpan="5">
                      <VehicleForm
                        v={v}
                        onDone={() => setEditing(null)}
                        run={run}
                        busy={busy}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={v.id} className={v.active ? "" : "inactive"}>
                    <td>
                      <strong>{v.name}</strong>
                    </td>
                    <td>{v.plate || "—"}</td>
                    <td>{v.note || "—"}</td>
                    <td>{v.active ? "Activo" : "De baja"}</td>
                    <td>
                      <button
                        className="secondary small"
                        onClick={() => setEditing(v.id)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Nombre corto de un vehículo para títulos y listas: "Toyota Hino A7234". */
export const vehicleLabel = (v) =>
  v
    ? `${v.name}${v.plate ? " " + v.plate : ""}${v.note ? " (" + v.note + ")" : ""}`
    : "";
