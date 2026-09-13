import React, { useState } from "react";
import { Phone, ArrowRight, ArrowLeft, KeyRound } from "lucide-react";
import { useStore } from "../lib/store.jsx";

const phonePattern = "[+0-9 \\(\\)\\-]{8,25}";

/**
 * Verificación del celular en dos pasos: se pide un código por WhatsApp y se confirma.
 * Sirve para ingresar (sin sesión) y para vincular el WhatsApp a una cuenta ya abierta.
 */
export default function PhoneVerify({
  initialName = "",
  initialPhone = "",
  askName = true,
  redirect,
  message,
  onDone,
  compact = false,
}) {
  const { requestPhoneCode, verifyPhone, busy, formError, config } = useStore();
  const [step, setStep] = useState("phone"); // phone | code
  const [data, setData] = useState({ name: initialName, phone: initialPhone });
  const [sent, setSent] = useState(null);
  if (config && !config.phoneLogin)
    return (
      <p className="notice">
        El ingreso por celular no está habilitado en este servidor. Ingresá con
        tu email.
      </p>
    );
  if (step === "code")
    return (
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const code = new FormData(e.target).get("code");
          const s = await verifyPhone({ ...data, code }, { redirect, message });
          if (s) onDone?.(s);
        }}
      >
        {!compact && (
          <button
            className="link-button back"
            type="button"
            onClick={() => setStep("phone")}
          >
            <ArrowLeft size={14} /> Cambiar número
          </button>
        )}
        <p>
          {sent?.sent
            ? `Te mandamos un código de 6 cifras por WhatsApp al +54 ${data.phone}. Vale 10 minutos.`
            : `Código para +54 ${data.phone}. Vale 10 minutos.`}
        </p>
        {sent?.demoCode && (
          <p className="demo-note demo-code">
            Demostración · el código es <code>{sent.demoCode}</code>
          </p>
        )}
        <label>
          Código
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength="6"
            required
            autoFocus
            placeholder="000000"
            defaultValue={sent?.demoCode || ""}
          />
        </label>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <button className="primary full login-cta" disabled={busy}>
          <KeyRound size={17} /> {busy ? "Verificando…" : "Confirmar código"}
        </button>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={async () => {
            const r = await requestPhoneCode(data);
            if (r) setSent(r);
          }}
        >
          Reenviar código
        </button>
      </form>
    );
  return (
    <form
      className="login-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const next = { name: f.name || initialName, phone: f.phone };
        setData(next);
        const r = await requestPhoneCode(next);
        if (r) {
          setSent(r);
          setStep("code");
        }
      }}
    >
      {askName && (
        <label>
          Nombre y apellido
          <input
            name="name"
            autoComplete="name"
            defaultValue={initialName}
            required
            minLength="2"
            maxLength="100"
            placeholder="Como te conocemos"
          />
        </label>
      )}
      <label>
        WhatsApp
        <div className="phone-field">
          <span>+54</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            defaultValue={initialPhone}
            required
            pattern={phonePattern}
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
        <Phone size={17} /> {busy ? "Enviando…" : "Recibir código por WhatsApp"}{" "}
        <ArrowRight size={17} />
      </button>
    </form>
  );
}
