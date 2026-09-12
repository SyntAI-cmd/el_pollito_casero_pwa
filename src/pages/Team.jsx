import React, { useEffect, useState } from "react";
import { UserPlus, KeyRound, ShieldCheck, Truck, Check } from "lucide-react";
import { api, post, patch } from "../lib/api.js";
import { useStore } from "../lib/store.jsx";
import { dateText, timeText } from "../lib/format.js";

/** Usuarios del equipo: quién entra, con qué rol y con qué contraseña. Solo administración. */
export default function Team() {
  const { config, notify, session } = useStore();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState("repartidor");
  const [resetting, setResetting] = useState(null);
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
                  <td>{u.name}</td>
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
              placeholder="ej. lucas"
            />
          </label>
          <label>
            Nombre
            <input
              name="name"
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
          Los repartidores disponibles se definen en la configuración del
          negocio (business.json → drivers). Un usuario desactivado pierde el
          acceso al instante.
        </p>
      </section>
    </div>
  );
}
