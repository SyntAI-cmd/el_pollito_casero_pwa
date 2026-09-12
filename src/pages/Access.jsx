import React, { useState } from "react";
import { ShieldCheck, Truck, Settings2, ArrowRight } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link, useRoute } from "../lib/router.jsx";
import { PageHead } from "../components/ui.jsx";

/** Ingreso del equipo (administración y repartidores) con PIN compartido. */
export default function Access() {
  const { config, staffLogin, busy, formError, session, logout } = useStore();
  const { path } = useRoute();
  const [role, setRole] = useState(path === "/admin" ? "admin" : "repartidor");
  if (session && session.role !== "cliente")
    return (
      <>
        <PageHead
          eyebrow="EQUIPO"
          title={`Ya estás adentro, ${session.name}.`}
          description={
            session.role === "admin"
              ? "Panel de operación habilitado."
              : "Tus entregas te esperan."
          }
        />
        <div className="actions-row">
          <Link
            to={session.role === "admin" ? "/operacion" : "/reparto"}
            className="primary"
          >
            {session.role === "admin" ? "Ir a Operación" : "Ir a Mis entregas"}{" "}
            <ArrowRight size={16} />
          </Link>
          <button className="secondary" onClick={logout}>
            Cambiar de usuario
          </button>
        </div>
      </>
    );
  return (
    <>
      <PageHead
        eyebrow="EQUIPO"
        title={
          path === "/admin"
            ? "Ingreso de Pollito Casero."
            : "Acceso del equipo."
        }
        description="Para administración y repartidores de Pollito Casero. Si sos cliente, volvé al catálogo: no necesitás clave."
      />
      <form
        className="access-form panel"
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
          PIN del equipo
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            required
            minLength="4"
            maxLength="12"
            placeholder="••••"
          />
        </label>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <button
          className="primary full"
          disabled={busy || !config?.staffAccess}
        >
          <ShieldCheck size={16} /> {busy ? "Verificando…" : "Ingresar"}
        </button>
        {!config?.staffAccess && (
          <p className="demo-note">
            El acceso del equipo no está configurado en este servidor
            (STAFF_PIN).
          </p>
        )}
        {config?.demo && (
          <p className="demo-note">Demostración: el PIN es 1234.</p>
        )}
      </form>
    </>
  );
}
