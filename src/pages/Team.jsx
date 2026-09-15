import React, { useEffect, useState } from "react";
import { UserPlus, KeyRound, ShieldCheck, Truck, Check } from "lucide-react";
import { api, post, patch } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { dateText, timeText } from "../lib/format.js";
import { shiftNames } from "./Customers.jsx";
import Vehicles from "../components/Vehicles.jsx";

/** Usuarios del equipo: quién entra, con qué rol y con qué contraseña. Solo administración. */
/** Camiones / preventistas: quién reparte, con qué zonas y turno. */
function Drivers() {
  const { config, saveDriver, busy, customers } = useStore();
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const list = config?.driverList || [];
  const zones = [
    ...new Set(customers.map((c) => c.zone).filter(Boolean)),
  ].sort();
  const parseZones = (v) =>
    String(v || "")
      .split(/[,;\n]/)
      .map((z) => z.trim())
      .filter(Boolean);
  const Form = ({ d, onDone }) => (
    <form
      className="driver-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const ok = await saveDriver(d?.name || null, {
          ...(d ? {} : { name: f.name }),
          phone: f.phone,
          cuit: f.cuit,
          shift: f.shift,
          zones: parseZones(f.zones),
          ...(d ? { active: f.active === "on" } : {}),
        });
        if (ok) onDone();
      }}
    >
      {!d && (
        <label>
          Nombre
          <input
            name="name"
            required
            minLength="2"
            maxLength="60"
            autoComplete="off"
            placeholder="Nombre y apellido"
          />
        </label>
      )}
      <label>
        WhatsApp
        <input
          name="phone"
          type="tel"
          defaultValue={(d?.phone || "").replace(/^549/, "")}
          autoComplete="off"
          placeholder="263 4 55-1234"
        />
      </label>
      <label>
        CUIT
        <input
          name="cuit"
          inputMode="numeric"
          defaultValue={d?.cuit || ""}
          autoComplete="off"
          pattern="[0-9]{11}|"
        />
      </label>
      <label>
        Turno
        <select name="shift" defaultValue={d?.shift || ""}>
          <option value="">Ambos</option>
          <option value="manana">Mañana</option>
          <option value="tarde">Tarde</option>
        </select>
      </label>
      <label className="wide">
        Zonas <small>(separadas por coma)</small>
        <input
          name="zones"
          defaultValue={(d?.zones || []).join(", ")}
          list="zonas-camion"
          autoComplete="off"
          placeholder="Rivadavia, Junín, La Colonia"
        />
      </label>
      {d && (
        <label className="toggle">
          <input type="checkbox" name="active" defaultChecked={d.active} />{" "}
          Activo
        </label>
      )}
      <div className="actions-row">
        <button className="primary" disabled={busy}>
          <Check size={14} /> Guardar
        </button>
        <button type="button" className="link-button" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
  return (
    <section className="panel">
      <div className="section-line">
        <h2>
          <Truck size={18} /> Camiones y preventistas
        </h2>
        <button className="secondary small" onClick={() => setAdding(true)}>
          <UserPlus size={13} /> Agregar
        </button>
      </div>
      <datalist id="zonas-camion">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {adding && <Form onDone={() => setAdding(false)} />}
      <div className="table-scroll">
        <table className="customers drivers-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>WhatsApp</th>
              <th>CUIT</th>
              <th>Turno</th>
              <th>Zonas</th>
              <th>Clientes</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) =>
              editing === d.name ? (
                <tr key={d.name}>
                  <td colSpan="8">
                    <strong>{d.name}</strong>
                    <Form d={d} onDone={() => setEditing(null)} />
                  </td>
                </tr>
              ) : (
                <tr key={d.name} className={d.active ? "" : "inactive"}>
                  <td>
                    <strong>{d.name}</strong>
                  </td>
                  <td>{d.phone ? d.phone.replace(/^549/, "") : "—"}</td>
                  <td>{d.cuit || <span className="muted">pendiente</span>}</td>
                  <td>
                    {shiftNames[d.shift || ""] === "—"
                      ? "Ambos"
                      : shiftNames[d.shift]}
                  </td>
                  <td>
                    {d.zones.length ? (
                      d.zones.join(", ")
                    ) : (
                      <span className="muted">sin zonas</span>
                    )}
                  </td>
                  <td>
                    {
                      customers.filter((c) => (c.truck || c.driver) === d.name)
                        .length
                    }
                  </td>
                  <td>{d.active ? "Activo" : "Inactivo"}</td>
                  <td>
                    <button
                      className="secondary small"
                      onClick={() => setEditing(d.name)}
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
      <p className="demo-note">
        Cada camión tiene sus zonas y turno: los clientes de esas zonas le
        quedan preasignados al cargar pedidos. El usuario con el que entra el
        preventista se administra abajo.
      </p>
    </section>
  );
}

export default function Team() {
  const { config, notify, session } = useStore();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState("repartidor");
  const [resetting, setResetting] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = () =>
    api("/staff")
      .then(setUsers)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const run = async (fn, ok) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      if (ok) notify(ok);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="team">
      <Drivers />
      <Vehicles />
      <section className="panel">
        <div className="section-line">
          <h2>Usuarios del equipo</h2>
          <span className="muted">
            Administración maneja todo; el repartidor solo sus entregas
          </span>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="table-scroll">
          <table className="customers team-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Último ingreso</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.active ? "" : "inactive"}>
                  <td>
                    <code>{u.username}</code>
                    {u.id === session.staffId ? <small> · vos</small> : ""}
                  </td>
                  {editing === u.id ? (
                    <td colSpan="2">
                      <form
                        className="inline-form edit-user"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = Object.fromEntries(new FormData(e.target));
                          if (
                            await run(
                              () =>
                                patch("/staff/" + u.id, {
                                  name: f.name,
                                  role: f.role,
                                  driver:
                                    f.role === "repartidor"
                                      ? f.driver
                                      : undefined,
                                }),
                              "Usuario actualizado; si cambió el rol, sus sesiones se cerraron.",
                            )
                          )
                            setEditing(null);
                        }}
                      >
                        <input
                          name="name"
                          defaultValue={u.name}
                          required
                          minLength="2"
                          maxLength="80"
                          aria-label="Nombre"
                        />
                        <select
                          name="role"
                          defaultValue={u.role}
                          aria-label="Rol"
                          disabled={u.id === session.staffId}
                          onChange={(e) => {
                            const d = e.target.form.elements.driver;
                            if (d) d.disabled = e.target.value !== "repartidor";
                          }}
                        >
                          <option value="admin">Administración</option>
                          <option value="repartidor">Repartidor</option>
                        </select>
                        <select
                          name="driver"
                          defaultValue={u.driver || ""}
                          aria-label="Repartidor que representa"
                          disabled={u.role !== "repartidor"}
                          required
                        >
                          <option value="" disabled>
                            Repartidor…
                          </option>
                          {(config?.drivers || []).map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                        <button className="primary small" disabled={busy}>
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          className="link-button small"
                          onClick={() => setEditing(null)}
                        >
                          Cancelar
                        </button>
                      </form>
                    </td>
                  ) : (
                    <>
                      <td>
                        <button
                          type="button"
                          className="link-button edit-link"
                          title="Editar nombre, rol o repartidor"
                          onClick={() => setEditing(u.id)}
                        >
                          {u.name}
                        </button>
                      </td>
                      <td>
                        {u.role === "admin" ? (
                          <span className="role-pill admin">
                            <ShieldCheck size={13} /> Administración
                          </span>
                        ) : (
                          <span className="role-pill">
                            <Truck size={13} /> Repartidor · {u.driver}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                  <td>
                    {u.last_login
                      ? `${dateText(u.last_login)} ${timeText(u.last_login)}`
                      : "Nunca"}
                  </td>
                  <td>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={u.active}
                        disabled={busy || u.id === session.staffId}
                        onChange={(e) =>
                          run(
                            () =>
                              patch("/staff/" + u.id, {
                                active: e.target.checked,
                              }),
                            e.target.checked
                              ? "Usuario activado."
                              : "Usuario desactivado; sus sesiones se cerraron.",
                          )
                        }
                      />
                      {u.active ? "Activo" : "Sin acceso"}
                    </label>
                  </td>
                  <td>
                    {resetting === u.id ? (
                      <form
                        className="inline-form"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const pw = new FormData(e.target).get("password");
                          if (
                            await run(
                              () => patch("/staff/" + u.id, { password: pw }),
                              "Contraseña cambiada.",
                            )
                          )
                            setResetting(null);
                        }}
                      >
                        <input
                          name="password"
                          type="password"
                          minLength="8"
                          required
                          placeholder="Nueva contraseña"
                          autoComplete="new-password"
                        />
                        <button className="primary small" disabled={busy}>
                          <Check size={14} />
                        </button>
                      </form>
                    ) : (
                      <button
                        className="secondary small"
                        onClick={() => setResetting(u.id)}
                      >
                        <KeyRound size={13} /> Contraseña
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <div className="section-line">
          <h2>
            <UserPlus size={18} /> Nuevo usuario
          </h2>
        </div>
        <form
          className="team-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.target));
            if (
              await run(
                () => post("/staff", { ...f, role }),
                `Usuario ${f.username} creado.`,
              )
            )
              e.target.reset();
          }}
        >
          <div className="role-switch" role="group" aria-label="Rol">
            <button
              type="button"
              className={role === "repartidor" ? "selected" : ""}
              aria-pressed={role === "repartidor"}
              onClick={() => setRole("repartidor")}
            >
              <Truck size={16} /> Repartidor
            </button>
            <button
              type="button"
              className={role === "admin" ? "selected" : ""}
              aria-pressed={role === "admin"}
              onClick={() => setRole("admin")}
            >
              <ShieldCheck size={16} /> Administración
            </button>
          </div>
          <label>
            Usuario <small>(para ingresar)</small>
            <input
              name="username"
              required
              minLength="2"
              maxLength="40"
              pattern="[A-Za-z0-9._-]+"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="ej. lucas"
            />
          </label>
          <label>
            Nombre
            <input
              name="name"
              autoComplete="off"
              required
              minLength="2"
              maxLength="80"
              placeholder="Nombre y apellido"
            />
          </label>
          {role === "repartidor" && (
            <label>
              Repartidor que representa
              <select name="driver" required defaultValue="">
                <option value="" disabled>
                  Elegí…
                </option>
                {(config?.drivers || []).map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Contraseña inicial
            <input
              name="password"
              type="password"
              required
              minLength="8"
              maxLength="200"
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres"
            />
          </label>
          <button className="primary" disabled={busy}>
            <UserPlus size={16} /> Crear usuario
          </button>
        </form>
        <p className="demo-note">
          Tocá el nombre de un usuario para editar su nombre, rol o repartidor.
          Cambiar el rol o desactivar a alguien cierra sus sesiones al instante.
        </p>
      </section>
    </div>
  );
}
