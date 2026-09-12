import React, { useEffect } from "react";
import { Phone, ArrowRight, ShieldCheck, Truck, Leaf } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute, Link } from "../lib/router.jsx";

/**
 * Ingreso del cliente: pantalla completa, sin contraseñas.
 * Se identifica por su WhatsApp; el mismo con el que hizo o hará sus pedidos.
 */
export default function Login() {
  const { login, busy, profile, session, formError } = useStore();
  const { query, navigate } = useRoute();
  const redirect =
    query.get("volver") && query.get("volver").startsWith("/")
      ? query.get("volver")
      : "/pedidos";
  useEffect(() => {
    if (session?.role === "cliente") navigate(redirect, { replace: true });
  }, [session]);
  return (
    <div className="login-page">
      <aside className="login-visual" aria-hidden="true">
        <img src="/images/pollo.webp" width="1440" height="960" alt="" />
        <div className="login-visual-copy">
          <span className="eyebrow">POLLITO CASERO · SAN MARTÍN, MENDOZA</span>
          <h1>
            Pollo fresco,
            <br />
            <em>a tu puerta.</em>
          </h1>
          <ul>
            <li>
              <Leaf size={16} /> Faena del día, por kilo
            </li>
            <li>
              <Truck size={16} /> Seguí la camioneta en el mapa
            </li>
            <li>
              <ShieldCheck size={16} /> Pagás al recibir, por transferencia o a
              cuenta
            </li>
          </ul>
        </div>
      </aside>
      <main className="login-main" id="contenido">
        <Link to="/" className="brand login-brand">
          <img src="/icon.svg" width="40" height="40" alt="" />
          <span>
            pollito<em>casero</em>
          </span>
        </Link>
        <h2>Ingresá o registrate para continuar</h2>
        <p>
          Con tu nombre y tu WhatsApp. Sin contraseñas: te reconocemos por el
          número con el que pedís.
        </p>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            login(Object.fromEntries(new FormData(e.target)), { redirect });
          }}
        >
          <label>
            Nombre y apellido
            <input
              name="name"
              autoComplete="name"
              defaultValue={profile.name || ""}
              required
              minLength="2"
              maxLength="100"
              placeholder="Como te conocemos"
            />
          </label>
          <label>
            WhatsApp
            <div className="phone-field">
              <span>+54</span>
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                defaultValue={profile.phone || ""}
                required
                pattern="[+0-9 \(\)\-]{8,25}"
                placeholder="263 4 55-1234"
              />
            </div>
            <small>Con código de área, sin 0 ni 15.</small>
          </label>
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button className="primary full login-cta" disabled={busy}>
            <Phone size={17} />{" "}
            {busy ? "Ingresando…" : "Continuar con mi celular"}{" "}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="login-foot">
          ¿Primera vez? Con este paso ya quedás registrado.{" "}
          <Link to="/">Ver el catálogo sin ingresar</Link>
        </p>
        <p className="demo-note">
          En producción confirmamos el número con un código por WhatsApp.
        </p>
      </main>
    </div>
  );
}
