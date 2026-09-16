import { post } from "./api.js";

export const pushSupported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  window.isSecureContext;

export const pushPermission = () =>
  pushSupported() ? Notification.permission : "unsupported";

const toKey = (base64) => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Pide permiso, se suscribe en el navegador y registra la suscripción en el servidor. */
export async function enablePush(publicKey) {
  if (!pushSupported()) throw Error("Este navegador no admite avisos.");
  if (!publicKey) throw Error("El servidor no tiene configurados los avisos.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw Error(
      "No diste permiso para los avisos. Podés activarlos desde la configuración del navegador.",
    );
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKey(publicKey),
    }));
  await post("/push/subscribe", { subscription: subscription.toJSON() });
  return subscription;
}

/**
 * Con permiso ya concedido, deja la suscripción registrada para la sesión actual: la vuelve a
 * crear si no existe (al salir se borra) y la asocia al usuario que acaba de entrar.
 */
export async function syncPush(publicKey) {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    if (!publicKey) return false;
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKey(publicKey),
    });
  }
  await post("/push/subscribe", { subscription: subscription.toJSON() }).catch(
    () => {},
  );
  return true;
}

export async function disablePush() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await post(
    "/push/subscribe",
    { endpoint: subscription.endpoint },
    "DELETE",
  ).catch(() => {});
  await subscription.unsubscribe();
}
