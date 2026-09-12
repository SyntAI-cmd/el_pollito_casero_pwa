/**
 * Notificaciones Web Push: avisos al cliente (repartidor asignado, salida, llegada)
 * y a administración (pedido nuevo) aunque la app esté cerrada.
 * Las claves VAPID se generan una vez y se guardan en data/vapid.json
 * (o se toman de VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
 */
import webpush from "web-push";
import { readFile, writeFile, mkdir } from "node:fs/promises";

export async function createPush({ store, contact, dbPath }) {
  let keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    keys = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
    };
  else if (dbPath === ":memory:") keys = webpush.generateVAPIDKeys();
  else {
    await mkdir("data", { recursive: true });
    try {
      keys = JSON.parse(await readFile("data/vapid.json", "utf8"));
    } catch {
      keys = webpush.generateVAPIDKeys();
      await writeFile("data/vapid.json", JSON.stringify(keys, null, 2));
    }
  }
  webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey);
  const enabled = process.env.PUSH !== "off";

  async function sendTo(subscriptions, payload) {
    if (!enabled) return;
    const body = JSON.stringify(payload);
    await Promise.all(
      subscriptions.map((s) =>
        webpush
          .sendNotification(s.subscription, body, { TTL: 60 * 60 })
          .catch((e) => {
            if (e.statusCode === 404 || e.statusCode === 410)
              store.push.delete(s.endpoint);
          }),
      ),
    );
  }
  return {
    publicKey: keys.publicKey,
    /** Aviso a un cliente (por teléfono normalizado). */
    toCustomer: (phone, payload) =>
      sendTo(store.push.forCustomer(phone), payload),
    /** Aviso a todas las sesiones de administración suscriptas. */
    toAdmins: (payload) => sendTo(store.push.forRole("admin"), payload),
    /** Aviso a un repartidor. */
    toDriver: (name, payload) => sendTo(store.push.forDriver(name), payload),
  };
}
