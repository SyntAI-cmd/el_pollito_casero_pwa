import React, { useEffect, useRef, useState } from "react";
import {
  Phone,
  ArrowRight,
  ShieldCheck,
  Truck,
  Leaf,
  Mail,
  Fingerprint,
  ArrowLeft,
  Link2,
  Check,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute, Link } from "../lib/router.jsx";
import { passkeyAvailable, renderGoogleButton } from "../lib/auth.js";
import PhoneVerify from "../components/PhoneVerify.jsx";

/**
 * Ingreso del cliente, sin contraseñas obligatorias:
 * Google · email (contraseña o enlace de acceso) · huella / Face ID / PIN del dispositivo · celular.
 */
export default function Login() {
  const {
    consumeMagicLink,
    emailLogin,
    emailRegister,
    googleLogin,
    requestMagicLink,
    loginWithPasskey,
    busy,
    profile,
    session,
    formError,
    config,
    setFormError,
  } = useStore();
  const { query, navigate } = useRoute();
  const volver = query.get("volver") || "";
  const redirect =
    volver.startsWith("/") && !volver.startsWith("//") ? volver : "/pedidos";
  const magicToken =
    query.get("enlace") && query.get("enlace") !== "vencido"
      ? query.get("enlace")
      : null;
  const [mode, setMode] = useState(null); // null | "email" | "celular"
  const [emailTab, setEmailTab] = useState("ingresar"); // ingresar | crear | enlace
  const [magic, setMagic] = useState(null);
  const [passkeys, setPasskeys] = useState(false);
  const googleRef = useRef();
  useEffect(() => {
    if (session?.role === "cliente") navigate(redirect, { replace: true });
  }, [session]);
  useEffect(() => {
    passkeyAvailable().then(setPasskeys);
  }, []);
  useEffect(() => {
    if (!mode)
      return renderGoogleButton(
        googleRef.current,
        config?.googleClientId,
        (credential) => googleLogin(credential, { redirect }),
      );
  }, [mode, config?.googleClientId]);
  useEffect(() => setFormError(""), [mode, emailTab]);
  const expired = query.get("enlace") === "vencido";

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
          <img
            className="login-wordmark"
            src="/brand/logo-texto.png"
            width="1200"
            height="362"
            alt="El Pollito Casero · Venta por mayor y menor"
          />
        </Link>
        {expired && !mode && (
          <p className="notice error login-notice">
            El enlace de acceso venció o ya se usó. Pedí uno nuevo.
          </p>
        )}

        {!mode && magicToken && (
          <>
            <h2>Un toque más y entrás</h2>
            <p>
              Confirmá que sos vos quien abrió el enlace. Vale 15 minutos y una
              sola vez.
            </p>
            <div className="login-options">
              <button
                className="login-option primary-option"
                type="button"
                disabled={busy}
                onClick={() =>
                  consumeMagicLink(magicToken, { redirect: "/pedidos" })
                }
              >
                <Link2 size={18} />{" "}
                {busy ? "Ingresando…" : "Entrar a mi cuenta"}
              </button>
            </div>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
          </>
        )}
        {!mode && !magicToken && (
          <>
            <h2>Ingresá o registrate para continuar</h2>
            <p>
              Elegí cómo entrar. Con cualquiera de estas opciones quedás
              registrado la primera vez.
            </p>
            <div className="login-options">
              {config?.googleClientId ? (
                <div className="google-slot" ref={googleRef} />
              ) : (
                <button
                  className="login-option disabled"
                  type="button"
                  title="Todavía no disponible"
                  disabled
                >
                  <GoogleG /> Continuar con Google <small>próximamente</small>
                </button>
              )}
              <button
                className="login-option"
                type="button"
                onClick={() => setMode("email")}
              >
                <Mail size={18} /> Continuar con email
              </button>
              {passkeys && (
                <button
                  className="login-option"
                  type="button"
                  onClick={() => loginWithPasskey({ redirect })}
                  disabled={busy}
                >
                  <Fingerprint size={18} /> Huella, Face ID o PIN del
                  dispositivo
                </button>
              )}
              {config?.phoneLogin !== false && (
                <button
                  className="login-option primary-option"
                  type="button"
                  onClick={() => setMode("celular")}
                >
                  <Phone size={18} /> Continuar con celular
                </button>
              )}
            </div>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <p className="login-foot">
              <Link to="/">Ver el catálogo sin ingresar</Link>
            </p>
          </>
        )}

        {mode === "celular" && (
          <>
            <button
              className="link-button back"
              type="button"
              onClick={() => setMode(null)}
            >
              <ArrowLeft size={14} /> Otras opciones
            </button>
            <h2>Con tu celular</h2>
            <p>Te mandamos un código por WhatsApp y entrás. Sin contraseña.</p>
            <PhoneVerify
              initialName={profile.name || ""}
              initialPhone={profile.phone || ""}
              redirect={redirect}
            />
          </>
        )}

        {mode === "email" && (
          <>
            <button
              className="link-button back"
              type="button"
              onClick={() => setMode(null)}
            >
              <ArrowLeft size={14} /> Otras opciones
            </button>
            <h2>Con tu email</h2>
            <div className="login-tabs" role="tablist">
              {[
                ["ingresar", "Ingresar"],
                ["crear", "Crear cuenta"],
                ["enlace", "Enlace de acceso"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={emailTab === id}
                  className={emailTab === id ? "active" : ""}
                  onClick={() => setEmailTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {emailTab !== "enlace" ? (
              <form
                className="login-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = Object.fromEntries(new FormData(e.target));
                  if (emailTab === "crear") emailRegister(f, { redirect });
                  else emailLogin(f, { redirect });
                }}
              >
                {emailTab === "crear" && (
                  <label>
                    Nombre y apellido
                    <input
                      name="name"
                      autoComplete="name"
                      defaultValue={profile.name || ""}
                      required
                      minLength="2"
                      maxLength="100"
                    />
                  </label>
                )}
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    required
                    maxLength="160"
                    placeholder="vos@ejemplo.com"
                  />
                </label>
                <label>
                  Contraseña
                  <input
                    name="password"
                    type="password"
                    autoComplete={
                      emailTab === "crear" ? "new-password" : "current-password"
                    }
                    required
                    minLength="8"
                    maxLength="200"
                    placeholder={
                      emailTab === "crear"
                        ? "Mínimo 8 caracteres"
                        : "Tu contraseña"
                    }
                  />
                </label>
                {formError && (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                )}
                <button className="primary full login-cta" disabled={busy}>
                  {busy
                    ? "Un momento…"
                    : emailTab === "crear"
                      ? "Crear mi cuenta"
                      : "Ingresar"}{" "}
                  <ArrowRight size={17} />
                </button>
                {emailTab === "ingresar" && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setEmailTab("enlace")}
                  >
                    <Link2 size={14} /> ¿Sin contraseña? Recibí un enlace de
                    acceso por email
                  </button>
                )}
              </form>
            ) : (
              <form
                className="login-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = Object.fromEntries(new FormData(e.target));
                  const r = await requestMagicLink(f);
                  if (r) setMagic({ email: f.email, ...r });
                }}
              >
                <p>
                  Te mandamos un enlace temporal (15 minutos, un solo uso). Lo
                  tocás y entrás, sin contraseña.
                </p>
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    required
                    maxLength="160"
                    placeholder="vos@ejemplo.com"
                  />
                </label>
                <label>
                  Nombre <small>(si es tu primera vez)</small>
                  <input
                    name="name"
                    autoComplete="name"
                    defaultValue={profile.name || ""}
                    maxLength="100"
                  />
                </label>
                {formError && (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                )}
                {magic ? (
                  <div className="magic-sent">
                    <Check size={18} />
                    <div>
                      <strong>
                        {magic.sent
                          ? `Enviado a ${magic.email}`
                          : "Enlace generado"}
                      </strong>
                      <p>
                        {magic.sent
                          ? "Revisá tu bandeja de entrada (y spam). Vale 15 minutos."
                          : "El envío de emails todavía no está habilitado."}
                      </p>
                      {magic.demoLink && (
                        <a className="primary magic-demo" href={magic.demoLink}>
                          Abrir el enlace de demostración{" "}
                          <ArrowRight size={15} />
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <button className="primary full login-cta" disabled={busy}>
                    <Mail size={17} />{" "}
                    {busy ? "Enviando…" : "Enviarme el enlace"}
                  </button>
                )}
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.3 0 11.6-2.1 15.5-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-4.1-13.5-9.7l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
