/**
 * Identidad de clientes y equipo.
 *
 * Clientes: cuenta por email (contraseña o enlace mágico), Google (ID token) o
 * passkey (huella / Face ID / PIN del dispositivo, WebAuthn). Cualquiera de esas
 * vías crea la misma cuenta; el teléfono se asocia al primer pedido.
 * Equipo: usuario y contraseña con rol (admin o repartidor) administrados por administración.
 */
import { scrypt, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import business from "../business.json" with { type: "json" };
import { demo } from "../domain.mjs";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, salt, hex] = stored.split("$");
  const key = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export const validEmail = (e) =>
  typeof e === "string" &&
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim()) &&
  e.length <= 160;
export const passwordOk = (p) =>
  typeof p === "string" && p.length >= 8 && p.length <= 200;

/** Envío del enlace mágico. Con SMTP_URL usa nodemailer; sin él, lo deja en el log (y en demo lo devuelve). */
export async function sendMagicLink(email, link) {
  if (process.env.SMTP_URL) {
    const { createTransport } = await import("nodemailer");
    const transport = createTransport(process.env.SMTP_URL);
    await transport.sendMail({
      from:
        process.env.MAIL_FROM ||
        `Pollito Casero <no-reply@${new URL(link).hostname}>`,
      to: email,
      subject: "Tu acceso a Pollito Casero",
      text: `Entrá a Pollito Casero con este enlace (vale 15 minutos y una sola vez):\n\n${link}\n\nSi no lo pediste, ignorá este mensaje.`,
      html: `<p>Entrá a <strong>Pollito Casero</strong> con este enlace (vale 15 minutos y una sola vez):</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#c9262e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">Ingresar</a></p><p style="color:#666;font-size:12px">${link}</p>`,
    });
    return { sent: true };
  }
  console.log(
    new Date().toISOString(),
    `Enlace de acceso para ${email}: ${link}`,
  );
  return { sent: false, demoLink: demo ? link : undefined };
}

/**
 * Código de verificación por WhatsApp (WhatsApp Business Cloud API, plantilla de autenticación).
 * Sin WHATSAPP_TOKEN / WHATSAPP_PHONE_ID el código se registra en el log; en demo además se
 * devuelve para mostrarlo en pantalla. Fuera de demo, sin proveedor, el ingreso por celular se apaga.
 */
export const otpConfigured = () =>
  !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
export const phoneLoginEnabled = () => otpConfigured() || !!demo;
export const newOtpCode = () =>
  String(randomBytes(4).readUInt32BE(0) % 1000000).padStart(6, "0");
export async function sendOtp(phone, code) {
  if (otpConfigured()) {
    const r = await fetch(
      `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.WHATSAPP_TOKEN,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: process.env.WHATSAPP_OTP_TEMPLATE || "codigo_de_acceso",
            language: { code: process.env.WHATSAPP_OTP_LANG || "es_AR" },
            components: [
              { type: "body", parameters: [{ type: "text", text: code }] },
              {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [{ type: "text", text: code }],
              },
            ],
          },
        }),
      },
    );
    if (!r.ok) throw Error("No pudimos enviar el código por WhatsApp.");
    return { sent: true };
  }
  if (!demo)
    throw Error(
      "El ingreso por celular no está habilitado. Ingresá con tu email.",
    );
  console.log(new Date().toISOString(), `Código para +${phone}: ${code}`);
  return { sent: false, demoCode: code };
}

/** Verifica un ID token de Google Identity Services contra el endpoint tokeninfo. */
export async function verifyGoogleToken(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId)
    throw Error(
      "El ingreso con Google no está configurado (GOOGLE_CLIENT_ID).",
    );
  const r = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) throw Error("Google no reconoció la credencial.");
  const t = await r.json();
  if (
    t.aud !== clientId ||
    !["accounts.google.com", "https://accounts.google.com"].includes(t.iss)
  )
    throw Error("Credencial de Google inválida.");
  if (t.email_verified !== "true" && t.email_verified !== true)
    throw Error("El email de Google no está verificado.");
  return { sub: t.sub, email: t.email, name: t.name || t.email.split("@")[0] };
}

/** Passkeys (WebAuthn) sobre @simplewebauthn/server. */
export function createPasskeys({ base }) {
  const url = new URL(base);
  const rpID = url.hostname;
  const origin = url.origin;
  const rpName = business.adminName ? `Pollito Casero` : "Pollito Casero";
  return {
    enabled: true,
    async registrationOptions(account, existing) {
      return generateRegistrationOptions({
        rpName,
        rpID,
        userName: account.email || account.phone || account.id,
        userDisplayName: account.name,
        userID: new TextEncoder().encode(account.id),
        attestationType: "none",
        excludeCredentials: existing.map((k) => ({
          id: k.id,
          transports: k.transports,
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });
    },
    async verifyRegistration(response, expectedChallenge) {
      const { verified, registrationInfo } = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
      if (!verified || !registrationInfo)
        throw Error("No se pudo registrar la llave de acceso.");
      const { credential, credentialDeviceType } = registrationInfo;
      return {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter,
        transports: credential.transports || [],
        device: credentialDeviceType,
      };
    },
    async authenticationOptions() {
      return generateAuthenticationOptions({
        rpID,
        userVerification: "preferred",
        allowCredentials: [],
      });
    },
    async verifyAuthentication(response, expectedChallenge, passkey) {
      const { verified, authenticationInfo } =
        await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: {
            id: passkey.id,
            publicKey: new Uint8Array(
              Buffer.from(passkey.publicKey, "base64url"),
            ),
            counter: passkey.counter,
            transports: passkey.transports,
          },
        });
      if (!verified) throw Error("La llave de acceso no coincide.");
      return authenticationInfo.newCounter;
    },
  };
}

/** Usuarios del equipo iniciales: admin y un usuario por repartidor. */
export async function seedStaff(store, drivers, log) {
  if (store.staff.count() > 0) return;
  const demoPassword =
    process.env.ADMIN_PASSWORD || (demo ? "pollito2026" : null);
  if (!demoPassword) {
    log.warn?.(
      "Sin usuarios del equipo: definí ADMIN_PASSWORD para crear el administrador inicial.",
    );
    return;
  }
  const hash = await hashPassword(demoPassword);
  store.staff.create({
    username: "admin",
    name: business.adminName || "Administración",
    role: "admin",
    passwordHash: hash,
  });
  const username = (name) =>
    String(name)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .trim()
      .split(/\s+/)[0];
  const used = new Set(["admin"]);
  const created = [];
  for (const d of drivers) {
    let u = username(d.name);
    let n = 2;
    while (used.has(u)) u = username(d.name) + n++;
    used.add(u);
    store.staff.create({
      username: u,
      name: d.name,
      role: "repartidor",
      driver: d.name,
      passwordHash: hash,
    });
    created.push(u);
  }
  log.info?.(
    `Usuarios del equipo creados: admin y ${created.join(", ")} (${process.env.ADMIN_PASSWORD ? "contraseña de ADMIN_PASSWORD" : "contraseña de demostración pollito2026"}).`,
  );
}

export const newId = () => randomUUID();
