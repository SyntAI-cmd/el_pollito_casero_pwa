import React, { useState } from "react";
import { ShieldCheck, Truck, Settings2, ArrowRight, Lock } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link, useRoute } from "../lib/router.jsx";

/**
 * Ingreso del equipo (administración y repartidores). Pantalla aparte, sin navegación
 * de clientes: no se enlaza desde ningún lugar de la app pública.
 */
export default function Access() {
  const { config, staffLogin, busy, formError, session, logout } = useStore();
  const { path } = useRoute();
  const [role, setRole] = useState(path === "/admin" ? "admin" : "repartidor");
  return (
    <div className="staff-login">
      <div className="staff-card">
        <div className="staff-head">
          <img src="/icon.svg" width="44" height="44" alt="" />
          <div>
            <span className="eyebrow">POLLITO CASERO · EQUIPO</span>
            <h1>
              {session && session.role !== "cliente"
                ? `Hola, ${session.name}.`
                : "Ingreso del equipo"}
            </h1>
          </div>
        </div>
        {session && session.role !== "cliente" ? (
          <div className="actions-row">
            <Link
              to={session.role === "admin" ? "/operacion" : "/reparto"}
              className="primary"
            >
              {session.role === "admin"
                ? "Ir a Operación"
                : "Ir a Mis entregas"}{" "}
              <ArrowRight size={16} />
            </Link>
            <button className="secondary" onClick={logout}>
              Cambiar de usuario
            </button>
          </div>
        ) : (
          <form
            className="access-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.target));
              staffLogin({ role, pin: f.pin, driver: f.driver });
            }}
          >
            <div className="role-switch" role="group" aria-label="Rol">
              <button
                type="button"
                className={role === "repartidor" ? "selected" : ""}
                aria-pressed={role === "repartidor"}
                onClick={() => setRole("repartidor")}
              >
                <Truck size={18} /> Repartidor
              </button>
              <button
                type="button"
                className={role === "admin" ? "selected" : ""}
                aria-pressed={role === "admin"}
                onClick={() => setRole("admin")}
              >
                <Settings2 size={18} /> Administración
              </button>
            </div>
            {role === "repartidor" && (
              <label>
                ¿Quién sos?
                <select name="driver" required defaultValue="">
                  <option value="" disabled>
                    Elegí tu nombre…
                  </option>
                  {(config?.drivers || []).map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              PIN {role === "admin" ? "de administración" : "personal"}
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                required
                minLength="4"
                maxLength="32"
                placeholder="••••"
              />
            </label>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              <ShieldCheck size={16} /> {busy ? "Verificando…" : "Ingresar"}
            </button>
            <p className="staff-note">
              <Lock size={12} /> Acceso registrado. Tras varios intentos
              fallidos el ingreso se bloquea un minuto.
              {config?.demo ? " Demostración: PIN 1234." : ""}
            </p>
          </form>
        )}
        {session?.role === "cliente" && (
          <p className="staff-note">
            Estás ingresado como cliente ({session.name}). Al entrar como equipo
            se cierra esa sesión en este dispositivo.
          </p>
        )}
      </div>
    </div>
  );
}
