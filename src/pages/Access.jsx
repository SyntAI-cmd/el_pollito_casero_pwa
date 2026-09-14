import React from "react";
import { ShieldCheck, ArrowRight, Lock, LogIn } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link } from "../lib/router.jsx";

/**
 * Ingreso del equipo: usuario y contraseña. El rol (administración o repartidor)
 * viene del usuario, así que la pantalla es una sola y rápida.
 */
export default function Access() {
  const { config, staffLogin, busy, formError, session, logout } = useStore();
  const inside = session && session.role !== "cliente";
  return (
    <div className="staff-login">
      <div className="staff-card">
        <div className="staff-head">
          <img src="/icon.svg" width="44" height="44" alt="" />
          <div>
            <span className="eyebrow">POLLITO CASERO · EQUIPO</span>
            <h1>{inside ? `Hola, ${session.name}.` : "Ingreso del equipo"}</h1>
          </div>
        </div>
        {inside ? (
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
              staffLogin({ username: f.username, password: f.password });
            }}
          >
            <label>
              Usuario
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck="false"
                required
                minLength="2"
                maxLength="40"
                placeholder="admin, franco, maxi…"
              />
            </label>
            <label>
              Contraseña
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength="1"
                maxLength="200"
                placeholder="••••••••"
              />
            </label>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              <LogIn size={16} /> {busy ? "Verificando…" : "Ingresar"}
            </button>
            <p className="staff-note">
              <Lock size={12} /> Cada ingreso queda registrado. Tras 6 intentos
              fallidos se bloquea un minuto.
            </p>
            {config?.demo && (
              <p className="staff-note">
                <ShieldCheck size={12} /> Demostración: <code>admin</code>,{" "}
                <code>franco</code> o <code>maxi</code> con contraseña{" "}
                <code>pollito2026</code>. Cambiala desde Operación → Equipo.
              </p>
            )}
          </form>
        )}
        {config?.mode === "equipo" && !inside && (
          <p className="staff-note">
            Esta app es de uso interno de El Pollito Casero. Los pedidos los
            cargan administración y los preventistas.
          </p>
        )}
        {session?.role === "cliente" && config?.mode !== "equipo" && (
          <p className="staff-note">
            Estás ingresado como cliente ({session.name}). Al entrar como equipo
            se cierra esa sesión en este dispositivo.
          </p>
        )}
      </div>
    </div>
  );
}
