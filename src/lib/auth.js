import { post, api } from "./api.js";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from "@simplewebauthn/browser";

/** ¿Este dispositivo puede usar huella, Face ID o PIN del equipo? */
export async function passkeyAvailable() {
  try {
    return (
      browserSupportsWebAuthn() && (await platformAuthenticatorIsAvailable())
    );
  } catch {
    return false;
  }
}

export async function passkeyLogin() {
  const { options, token } = await post("/auth/passkey/login/options", {});
  const response = await startAuthentication({ optionsJSON: options });
  return post("/auth/passkey/login/verify", { response, token });
}

export async function passkeyRegister(device) {
  const { options, token } = await post("/auth/passkey/register/options", {});
  const response = await startRegistration({ optionsJSON: options });
  return post("/auth/passkey/register/verify", { response, token, device });
}

export const passkeyRemove = (id) =>
  api("/auth/passkey/" + encodeURIComponent(id), { method: "DELETE" });

/** Carga Google Identity Services y renderiza el botón oficial en `el`. */
export function renderGoogleButton(el, clientId, onCredential) {
  if (!clientId || !el) return () => {};
  let cancelled = false;
  const init = () => {
    if (cancelled || !window.google?.accounts?.id) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (r) => onCredential(r.credential),
      ux_mode: "popup",
      itp_support: true,
    });
    window.google.accounts.id.renderButton(el, {
      theme: "outline",
      size: "large",
      width: el.clientWidth || 320,
      text: "continue_with",
      locale: "es-419",
      shape: "pill",
    });
  };
  if (window.google?.accounts?.id) init();
  else {
    let script = document.querySelector("script[data-gsi]");
    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.gsi = "1";
      document.head.appendChild(script);
    }
    script.addEventListener("load", init);
  }
  return () => {
    cancelled = true;
  };
}

export const deviceLabel = () => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone/iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac/.test(ua)) return "Mac";
  return "este dispositivo";
};
