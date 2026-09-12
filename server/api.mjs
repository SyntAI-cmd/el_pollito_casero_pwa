import { randomUUID } from "node:crypto";
import {
  products,
  localities,
  drivers,
  origin,
  statuses,
  plans,
  shippingByPlan,
  paymentMethods,
  priceOrder,
  normalizePhone,
  accountSummary,
  applyWeights,
  applyPayment,
} from "../domain.mjs";
import business from "../business.json" with { type: "json" };
import { geocode, reverse, enabled as geocodingEnabled } from "./geo.mjs";
import { estimate, inMendoza } from "./route.mjs";
import { ApiError, fail } from "./errors.mjs";
import { str, num, oneOf, bool, latLng, rateLimiter } from "./validate.mjs";
import {
  transferInfo,
  checkoutEnabled,
  createPreference,
  fetchPayment,
} from "./mercadopago.mjs";

export { ApiError };

const now = () => new Date().toISOString();
const hhmm = (iso) =>
  new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Mendoza",
  });
const kgOf = (o) => o.items.reduce((n, p) => n + p.kg, 0);
const ars = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
const isStaff = (s) => s && (s.role === "admin" || s.role === "repartidor");
const actorOf = (s) =>
  s?.role === "repartidor"
    ? s.driver
    : s?.role === "admin"
      ? "admin"
      : s?.name || "cliente";

/** PINs del equipo: STAFF_PINS={"admin":"…","Franco":"…"} o STAFF_PIN compartido (demo: 1234). */
function staffPins() {
  try {
    if (process.env.STAFF_PINS) return JSON.parse(process.env.STAFF_PINS);
  } catch {}
  const shared = process.env.STAFF_PIN || (business.demo ? "1234" : "");
  return shared
    ? Object.fromEntries(
        ["admin", ...drivers.map((d) => d.name)].map((k) => [k, shared]),
      )
    : {};
}

export function createApi({
  store,
  events,
  push,
  base = "http://localhost:5173",
}) {
  const pins = staffPins();
  const loginLimit = rateLimiter({ limit: 10, windowMs: 60000 });
  const staffLimit = rateLimiter({ limit: 6, windowMs: 60000 });
  const config = {
    products,
    localities,
    drivers: drivers.map((d) => d.name),
    origin,
    shipping: shippingByPlan,
    demo: !!business.demo,
    adminName: business.adminName,
    adminPhone: process.env.ADMIN_WHATSAPP || business.adminPhone,
    transfer: transferInfo(),
    mercadopago: checkoutEnabled(),
    staffAccess: Object.keys(pins).length > 0,
    pushKey: push?.publicKey || null,
  };
  const publicSession = (s) =>
    s
      ? {
          role: s.role,
          name: s.name,
          phone: s.phone,
          driver: s.driver || null,
          plan: s.plan || null,
        }
      : null;
  const publicConfig = (session) => ({
    ...config,
    // El cliente no necesita saber cómo entra el equipo.
    staffAccess: isStaff(session) || undefined,
    session: publicSession(session),
  });

  function ensureCustomer(phone, data) {
    const existing = store.customers.get(phone);
    const customer = existing || {
      phone,
      name: data.name.trim(),
      plan: plans.includes(data.plan) ? data.plan : "minorista",
      credit: !!business.demo,
      creditBalance: 0,
      created: now(),
    };
    if (data.name)
      customer.name = String(data.name).trim().slice(0, 100) || customer.name;
    if (data.address)
      customer.address = String(data.address).trim().slice(0, 250);
    if (data.localityId && localities.some((l) => l.id === data.localityId))
      customer.localityId = data.localityId;
    if (data.location && inMendoza(data.location))
      customer.location = { lat: data.location.lat, lng: data.location.lng };
    if (!existing && plans.includes(data.plan)) customer.plan = data.plan;
    return store.customers.save(customer);
  }
  const withSummary = (c) => ({
    ...c,
    summary: accountSummary(store.orders.forCustomer(c.phone), c),
  });

  function visibleOrders(session) {
    if (!session) return [];
    if (session.role === "admin") return store.orders.all();
    if (session.role === "repartidor")
      return store.orders.forDriver(session.driver);
    return store.orders.forCustomer(session.phone);
  }
  const canSee = (session, o) =>
    session &&
    (session.role === "admin" ||
      (session.role === "repartidor" && o.driver === session.driver) ||
      (session.role === "cliente" && o.customer === session.phone));
  const driverCustomers = (session) => {
    const mine = new Set(
      store.orders.forDriver(session.driver).map((o) => o.customer),
    );
    return store.customers
      .all()
      .filter((c) => mine.has(c.phone) || c.driver === session.driver);
  };
  const driverServes = (session, phone) =>
    session.role === "admin" ||
    driverCustomers(session).some((c) => c.phone === phone);

  const driverContact = (o) => {
    const d = drivers.find((d) => d.name === o.driver);
    return d ? { name: d.name, phone: d.phone } : null;
  };
  /** Lo que ve cada rol de un pedido: el cliente no recibe datos internos. */
  const view = (o, session) => {
    const out = { ...o, driverContact: driverContact(o) };
    if (session?.role === "cliente") {
      delete out.createdBy;
      delete out.key;
    }
    if (session?.role === "repartidor") delete out.key;
    return out;
  };

  const notifyCustomer = (o, payload) =>
    push
      ?.toCustomer(o.customer, {
        url: "/seguimiento?pedido=" + o.id,
        tag: o.id,
        ...payload,
      })
      .catch(() => {});
  const notifyAdmins = (payload) =>
    push?.toAdmins({ url: "/operacion", ...payload }).catch(() => {});
  const notifyDriver = (name, payload) =>
    name &&
    push?.toDriver(name, { url: "/reparto", ...payload }).catch(() => {});

  async function refreshEta(o) {
    if (!o.destination || o.status !== "en_camino") return null;
    const from = o.location
      ? { lat: o.location.lat, lng: o.location.lng }
      : origin;
    const eta = await estimate(from, o.destination);
    const current = store.orders.get(o.id);
    if (!current || current.status !== "en_camino") return eta;
    current.eta = eta;
    store.orders.save(current);
    events.orderChanged(current);
    return eta;
  }

  function createOrder(b, session) {
    const priced = priceOrder(b);
    if (b.payment === "transferencia" && !config.transfer)
      fail(
        400,
        "La transferencia todavía no está habilitada. Elegí efectivo al recibir.",
      );
    if (b.payment === "mercadopago" && !config.mercadopago)
      fail(400, "El pago online no está habilitado. Elegí otro medio.");
    const key = str(b.key, { min: 1, max: 80, name: "identificador" });
    const previous = store.orders.byKey(key);
    if (previous) return { order: previous, session, created: false };
    const phone =
      session?.role === "cliente" ? session.phone : normalizePhone(b.phone);
    const location =
      b.location && inMendoza(b.location)
        ? { lat: Number(b.location.lat), lng: Number(b.location.lng) }
        : null;
    return store.transaction(() => {
      const customer = ensureCustomer(phone, { ...b, plan: b.plan, location });
      if (b.payment === "cuenta" && !customer.credit)
        fail(
          400,
          "Tu cuenta corriente todavía no fue habilitada por administración. Elegí otro medio de pago.",
        );
      let nextSession = session;
      if (!session)
        nextSession = store.sessions.create({
          role: "cliente",
          phone,
          name: customer.name,
          plan: customer.plan,
        });
      const o = {
        ...priced,
        id: "PC-" + randomUUID().slice(0, 8).toUpperCase(),
        key,
        customer: phone,
        name: b.name.trim(),
        phone: b.phone.trim(),
        address: b.address.trim(),
        notes: String(b.notes || "").slice(0, 500),
        plan: b.plan,
        payment: b.payment,
        paid: false,
        status: "recibido",
        driver: drivers.some((d) => d.name === customer.driver)
          ? customer.driver
          : "",
        boxes: 0,
        returned: 0,
        created: now(),
        createdBy: session?.role === "admin" ? "admin" : "cliente",
        history: [{ status: "recibido", at: now() }],
      };
      if (o.payment === "cuenta" && customer.creditBalance > 0) {
        const credit = Math.round(customer.creditBalance * 100);
        const cents = Math.round(o.total * 100);
        if (credit >= cents) {
          Object.assign(o, {
            paid: true,
            paidAt: now(),
            paidBy: "saldo a favor",
          });
          customer.creditBalance = (credit - cents) / 100;
          store.customers.save(customer);
        }
      }
      if (location)
        o.destination = {
          ...location,
          label: "Ubicación marcada por el cliente",
          precise: true,
          source: "cliente",
        };
      else if (!geocodingEnabled) o.destination = null;
      store.orders.save(o);
      store.audit.log(nextSession, "order.create", "order", o.id, {
        total: o.total,
        plan: o.plan,
        payment: o.payment,
      });
      return { order: o, session: nextSession, created: true };
    });
  }
  function afterCreate(o) {
    events.orderChanged(o);
    if (o.createdBy === "cliente")
      notifyAdmins({
        title: `Pedido nuevo · ${o.name}`,
        body: `${o.id} · ${kgOf(o)} kg · ${o.locality.name} · ${o.payment === "cuenta" ? "a cuenta" : o.payment === "entrega" ? "efectivo al entregar" : o.payment}`,
      });
    if (o.driver)
      notifyDriver(o.driver, {
        title: `Pedido asignado · ${o.name}`,
        body: `${o.id} · ${kgOf(o)} kg · ${o.address}`,
        tag: o.id,
      });
    if (o.destination === undefined && geocodingEnabled)
      geocode(store, o.address, o.locality)
        .catch(() => null)
        .then((destination) => {
          const current = store.orders.get(o.id);
          if (!current) return;
          current.destination = destination;
          store.orders.save(current);
          events.orderChanged(current);
        });
  }

  /** Aplica cambios a un pedido según el rol. Devuelve tareas diferidas (avisos, ETA). */
  async function updateOrder(o, b, session) {
    const role = session.role;
    const after = [];
    if (role === "cliente") {
      if (b.cancel === true) {
        if (o.status !== "recibido")
          fail(
            400,
            "El pedido ya está en preparación; escribinos por WhatsApp.",
          );
        o.cancelled = true;
        o.status = "cancelado";
        o.history.push({ status: "cancelado", at: now() });
        after.push(() =>
          notifyAdmins({
            title: `Pedido cancelado · ${o.name}`,
            body: `${o.id} fue cancelado por el cliente.`,
          }),
        );
        return after;
      }
      if (b.transfer) {
        if (o.payment !== "transferencia")
          fail(400, "Este pedido no se paga por transferencia.");
        o.transfer = {
          reportedAt: now(),
          reference: str(b.transfer.reference, {
            max: 60,
            name: "referencia",
            optional: true,
          }),
        };
        after.push(() =>
          notifyAdmins({
            title: `Transferencia informada · ${o.name}`,
            body: `${o.id} · ${ars(o.total)}. Verificá el ingreso y confirmá el cobro.`,
          }),
        );
        return after;
      }
      fail(403, "No podés modificar este pedido.");
    }
    if (!isStaff(session)) fail(403, "Sin permiso.");
    if (o.status === "cancelado")
      fail(400, "El pedido fue cancelado por el cliente.");
    if (b.driver !== undefined) {
      if (role !== "admin")
        fail(403, "Solo administración asigna repartidores.");
      const driver = oneOf(b.driver, config.drivers, "repartidor");
      if (o.status === "entregado") fail(400, "El pedido ya fue entregado.");
      if (o.driver !== driver) {
        o.driver = driver;
        after.push(() =>
          notifyCustomer(o, {
            title: `${o.driver} lleva tu pedido`,
            body: `Te avisamos cuando salga la camioneta con el pedido ${o.id}.`,
          }),
        );
        after.push(() =>
          notifyDriver(o.driver, {
            title: `Pedido asignado · ${o.name}`,
            body: `${o.id} · ${kgOf(o)} kg · ${o.address}, ${o.locality?.name || ""}`,
            tag: o.id,
          }),
        );
      }
    }
    if (b.paid === true && !o.paid) {
      Object.assign(o, { paid: true, paidAt: now(), paidBy: actorOf(session) });
      if (b.paidMethod)
        o.paidMethod = oneOf(
          b.paidMethod,
          ["efectivo", "transferencia", "mercadopago"],
          "medio",
        );
    }
    if (b.status) {
      const next = oneOf(b.status, statuses, "estado");
      if (statuses.indexOf(next) !== statuses.indexOf(o.status) + 1)
        fail(400, "El pedido debe avanzar un estado por vez.");
      if (next === "preparando" && role !== "admin")
        fail(403, "Administración inicia la preparación.");
      if (next === "en_camino" && !o.driver)
        fail(400, "Asigná un repartidor primero.");
      if (
        next === "en_camino" &&
        role === "repartidor" &&
        o.driver !== session.driver
      )
        fail(403, "Ese pedido no es tuyo.");
      if (next === "entregado") {
        if (o.payment !== "cuenta" && !o.paid)
          fail(400, "Registrá el cobro antes de completar la entrega.");
        const boxes = num(b.boxes ?? 0, {
          min: 0,
          max: 100,
          integer: true,
          name: "envases",
        });
        o.boxes = o.plan === "mayorista" ? boxes : 0;
        o.deliveredAt = now();
        o.deliveredBy =
          role === "repartidor" ? session.driver : o.driver || "admin";
        delete o.eta;
      }
      o.status = next;
      o.history.push({ status: next, at: now() });
      if (next === "preparando")
        after.push(() =>
          notifyCustomer(o, {
            title: "Estamos preparando tu pedido",
            body: `${o.id} · ${kgOf(o)} kg. Te avisamos cuando salga.`,
          }),
        );
      if (next === "en_camino") {
        o.departedAt = now();
        if (o.destination)
          o.eta = await estimate(
            o.location ? { lat: o.location.lat, lng: o.location.lng } : origin,
            o.destination,
          );
        after.push(() =>
          notifyCustomer(o, {
            title: `${o.driver} salió con tu pedido`,
            body: o.eta
              ? `Llega aproximadamente a las ${hhmm(o.eta.arrival)} (${o.eta.km} km).`
              : "Seguí el recorrido en el mapa.",
          }),
        );
      }
      if (next === "entregado")
        after.push(() =>
          notifyCustomer(o, {
            title: "Pedido entregado",
            body: `¡Gracias! ${o.id} llegó a destino.`,
          }),
        );
    }
    if (b.location) {
      const { lat, lng } = latLng(b.location);
      if (o.status !== "en_camino") fail(400, "El pedido no está en camino.");
      if (role === "repartidor" && o.driver !== session.driver)
        fail(403, "Ese pedido no es tuyo.");
      o.location = { lat, lng, at: now() };
      o.track = [...(o.track || []), [lat, lng]].slice(-200);
      if ((!o.eta || Date.now() - new Date(o.eta.at) > 45000) && o.destination)
        after.push(() => refreshEta(o));
    }
    if (b.weights !== undefined) {
      if (o.status === "recibido" && role !== "admin")
        fail(403, "El pesaje se carga desde administración.");
      if (o.status === "entregado" && role !== "admin")
        fail(400, "El pedido ya fue entregado.");
      if (o.paid && o.payment !== "cuenta")
        fail(
          400,
          "El pedido ya fue cobrado; pedile a administración que corrija el importe.",
        );
      Object.assign(o, applyWeights(o, b.weights), {
        weighed: true,
        weighedAt: now(),
        weighedBy: actorOf(session),
      });
      after.push(() =>
        notifyCustomer(o, {
          title: "Pesamos tu pedido",
          body: `${o.id}: ${kgOf(o)} kg en balanza · total ${ars(o.total)}.`,
        }),
      );
    }
    if (b.returnBoxes !== undefined) {
      const n = num(b.returnBoxes, {
        min: 1,
        max: 1000,
        integer: true,
        name: "envases",
      });
      if (n > o.boxes - o.returned || o.status !== "entregado")
        fail(400, "La devolución supera los envases pendientes.");
      o.returned += n;
      o.returns = [
        ...(o.returns || []),
        { boxes: n, at: now(), by: actorOf(session) },
      ];
    }
    return after;
  }

  /** Devolución de envases por cliente: se descuenta de los pedidos con envases pendientes, del más viejo al más nuevo. */
  function returnCustomerBoxes(customer, count, session) {
    return store.transaction(() => {
      let remaining = count;
      const touched = [];
      const pending = store.orders
        .forCustomer(customer.phone)
        .filter((o) => o.status === "entregado" && o.boxes > o.returned)
        .sort((a, b) => a.created.localeCompare(b.created));
      for (const o of pending) {
        if (!remaining) break;
        const take = Math.min(remaining, o.boxes - o.returned);
        o.returned += take;
        o.returns = [
          ...(o.returns || []),
          { boxes: take, at: now(), by: actorOf(session) },
        ];
        store.orders.save(o);
        touched.push(o);
        remaining -= take;
      }
      if (remaining > 0)
        fail(
          400,
          `El cliente tiene ${count - remaining} envases pendientes, no ${count}.`,
        );
      store.audit.log(session, "boxes.return", "customer", customer.phone, {
        boxes: count,
        orders: touched.map((o) => o.id),
      });
      return touched;
    });
  }

  function registerPayment(customer, body, session) {
    const amount = num(body.amount, {
      min: 1,
      max: 100000000,
      name: "importe",
    });
    const method = oneOf(
      body.method || "efectivo",
      ["efectivo", "transferencia", "mercadopago"],
      "medio",
    );
    const note = str(body.note, { max: 200, name: "nota", optional: true });
    return store.transaction(() => {
      const customerOrders = store.orders.forCustomer(customer.phone);
      const { covered, leftover } = applyPayment(
        customerOrders,
        amount,
        customer.creditBalance || 0,
      );
      const payment = {
        id: "PG-" + randomUUID().slice(0, 6).toUpperCase(),
        amount,
        method,
        note,
        at: now(),
        by: actorOf(session),
        applied: covered.map((o) => o.id),
      };
      for (const o of covered) {
        Object.assign(o, {
          paid: true,
          paidAt: payment.at,
          paidBy: payment.by,
          paymentId: payment.id,
        });
        store.orders.save(o);
      }
      customer.creditBalance = leftover;
      store.customers.save(customer);
      store.payments.add(customer.phone, payment);
      store.audit.log(
        session,
        "payment.register",
        "customer",
        customer.phone,
        payment,
      );
      return { payment, covered };
    });
  }

  const threadFor = (session, requested) => {
    if (session.role === "repartidor") return `repartidor:${session.driver}`;
    if (session.role === "admin") {
      const t = str(requested, { min: 1, max: 80, name: "conversación" });
      if (!t.startsWith("repartidor:") || !config.drivers.includes(t.slice(11)))
        fail(400, "Conversación inválida.");
      return t;
    }
    fail(403, "El chat interno es del equipo.");
  };

  /** Enrutador. Devuelve { status, body, session? } o null si la ruta no existe. */
  return async function handle({ method, path, body, query, session, ip }) {
    const json = (status, body, extra = {}) => ({ status, body, ...extra });

    if (path === "/api/health" && method === "GET")
      return json(200, { ...store.health(), at: now() });
    if (path === "/api/config" && method === "GET")
      return json(200, publicConfig(session));

    // ---- Sesiones ----
    if (path === "/api/session") {
      if (method === "GET") return json(200, publicSession(session));
      if (method === "DELETE") {
        if (session) {
          store.sessions.delete(session.id);
          store.audit.log(session, "session.logout", "session", session.id);
        }
        return json(200, null, { session: null });
      }
      if (method === "POST") {
        loginLimit(ip);
        const name = str(body.name, { min: 2, max: 100, name: "el nombre" });
        const phone = normalizePhone(body.phone);
        if (!phone)
          fail(400, "Ingresá un teléfono válido, con código de área.");
        const customer = ensureCustomer(phone, { ...body, name });
        if (session) store.sessions.delete(session.id);
        const s = store.sessions.create({
          role: "cliente",
          phone,
          name: customer.name,
          plan: customer.plan,
        });
        store.audit.log(s, "session.login", "customer", phone);
        return json(200, publicSession(s), { session: s });
      }
    }
    if (path === "/api/session/staff" && method === "POST") {
      staffLimit(ip);
      if (!config.staffAccess)
        fail(403, "El acceso del equipo no está configurado en este servidor.");
      const role = oneOf(body.role || "admin", ["admin", "repartidor"], "rol");
      const who =
        role === "admin"
          ? "admin"
          : oneOf(body.driver, config.drivers, "repartidor");
      const pin = str(body.pin, { min: 4, max: 32, name: "el PIN" });
      if (!pins[who] || pins[who] !== pin) {
        store.audit.log(null, "session.staff_denied", "staff", who, { ip });
        fail(401, "PIN incorrecto.");
      }
      const data =
        role === "repartidor"
          ? {
              role,
              driver: who,
              name: who,
              phone: drivers.find((d) => d.name === who).phone,
            }
          : {
              role: "admin",
              name: business.adminName,
              phone: config.adminPhone,
            };
      if (session) store.sessions.delete(session.id);
      const s = store.sessions.create(data);
      store.audit.log(s, "session.staff_login", "staff", who, { ip });
      return json(200, publicSession(s), { session: s });
    }

    // ---- Cliente ----
    if (path === "/api/me" && method === "GET") {
      if (!session || session.role !== "cliente") return json(200, null);
      const c = store.customers.get(session.phone);
      return json(200, c ? withSummary(c) : null);
    }
    if (path === "/api/me" && method === "PATCH") {
      if (!session || session.role !== "cliente")
        fail(401, "Ingresá con tu teléfono.");
      const c = ensureCustomer(session.phone, {
        ...body,
        name: body.name || session.name,
      });
      if (plans.includes(body.plan)) {
        c.plan = body.plan;
        store.customers.save(c);
      }
      return json(200, withSummary(c));
    }
    if (path === "/api/geo/reverse" && method === "GET") {
      const point = {
        lat: Number(query.get("lat")),
        lng: Number(query.get("lng")),
      };
      if (!inMendoza(point))
        fail(
          400,
          "Esa ubicación está fuera de nuestra zona de reparto (Mendoza).",
        );
      return json(
        200,
        await reverse(store, point.lat, point.lng, localities).catch(
          () => null,
        ),
      );
    }

    // ---- Push ----
    if (path === "/api/push/subscribe" && method === "POST") {
      if (!session) fail(401, "Ingresá para activar los avisos.");
      const sub = body.subscription;
      if (
        !sub ||
        typeof sub.endpoint !== "string" ||
        !sub.endpoint.startsWith("https://") ||
        !sub.keys?.p256dh
      )
        fail(400, "Suscripción inválida.");
      store.push.save(session, sub);
      return json(200, { ok: true });
    }
    if (path === "/api/push/subscribe" && method === "DELETE") {
      if (typeof body.endpoint === "string") store.push.delete(body.endpoint);
      return json(200, { ok: true });
    }

    // ---- Pedidos ----
    if (path === "/api/orders" && method === "GET")
      return json(
        200,
        visibleOrders(session).map((o) => view(o, session)),
      );
    if (path === "/api/orders" && method === "POST") {
      if (session?.role === "repartidor")
        fail(403, "Los repartidores no crean pedidos.");
      const { order, session: s, created } = createOrder(body, session);
      if (created) afterCreate(order);
      return json(
        created ? 201 : 200,
        view(order, s),
        s !== session ? { session: s } : {},
      );
    }
    const orderMatch = path.match(/^\/api\/orders\/([^/]+)(?:\/(mp))?$/);
    if (orderMatch && method === "PATCH" && !orderMatch[2]) {
      if (!session) fail(401, "Ingresá para gestionar pedidos.");
      const o = store.orders.get(decodeURIComponent(orderMatch[1]));
      if (!o || !canSee(session, o)) fail(404, "Pedido no encontrado.");
      const before = {
        status: o.status,
        paid: o.paid,
        driver: o.driver,
        total: o.total,
      };
      const after = await updateOrder(o, body, session);
      store.transaction(() => {
        store.orders.save(o);
        store.audit.log(session, "order.update", "order", o.id, {
          before,
          after: {
            status: o.status,
            paid: o.paid,
            driver: o.driver,
            total: o.total,
          },
          keys: Object.keys(body),
        });
      });
      events.orderChanged(o);
      for (const task of after)
        Promise.resolve()
          .then(task)
          .catch(() => {});
      return json(200, view(o, session));
    }
    if (orderMatch && orderMatch[2] === "mp" && method === "POST") {
      // Enlace de pago online (Checkout Pro) para el propio pedido.
      if (!session) fail(401, "Ingresá para pagar.");
      const o = store.orders.get(decodeURIComponent(orderMatch[1]));
      if (!o || !canSee(session, o)) fail(404, "Pedido no encontrado.");
      if (o.paid) fail(400, "El pedido ya está pagado.");
      if (!config.mercadopago) fail(400, "El pago online no está habilitado.");
      const pref = await createPreference(o, { base });
      o.mp = { preferenceId: pref.id, createdAt: now() };
      store.orders.save(o);
      return json(200, { url: pref.initPoint });
    }
    if (path === "/api/mp/webhook" && method === "POST") {
      // Notificación de Mercado Pago: se verifica el pago contra su API antes de marcar nada.
      const paymentId =
        body?.data?.id || query.get("data.id") || query.get("id");
      if (!paymentId || (body?.type && body.type !== "payment"))
        return json(200, { ignored: true });
      const pmt = await fetchPayment(paymentId).catch(() => null);
      if (!pmt?.orderId) return json(200, { ignored: true });
      const o = store.orders.get(pmt.orderId);
      if (o && pmt.approved && !o.paid && Math.abs(pmt.amount - o.total) < 1) {
        Object.assign(o, {
          paid: true,
          paidAt: now(),
          paidBy: "mercadopago",
          paidMethod: "mercadopago",
          paymentId: "MP-" + pmt.id,
        });
        store.orders.save(o);
        store.audit.log(null, "payment.mercadopago", "order", o.id, pmt);
        events.orderChanged(o);
        notifyAdmins({
          title: `Pago online acreditado · ${o.name}`,
          body: `${o.id} · ${ars(o.total)} por Mercado Pago.`,
        });
      }
      return json(200, { ok: true });
    }

    // ---- Clientes (equipo) ----
    if (path === "/api/customers" && method === "GET") {
      if (!isStaff(session)) fail(403, "Solo el equipo.");
      const list = (
        session.role === "admin"
          ? store.customers.all()
          : driverCustomers(session)
      ).map(withSummary);
      if (session.role === "repartidor")
        for (const c of list) delete c.payments;
      return json(200, list);
    }
    const customerMatch = path.match(
      /^\/api\/customers\/([^/]+)(?:\/(payments|boxes))?$/,
    );
    if (customerMatch) {
      if (!isStaff(session)) fail(403, "Solo el equipo.");
      const phone = decodeURIComponent(customerMatch[1]);
      const c = store.customers.get(phone);
      if (!c || !driverServes(session, phone))
        fail(404, "Cliente no encontrado.");
      const sub = customerMatch[2];
      if (!sub && method === "PATCH") {
        if (session.role !== "admin") fail(403, "Solo administración.");
        if (body.plan !== undefined)
          c.plan = oneOf(body.plan, plans, "modalidad");
        if (body.credit !== undefined) c.credit = bool(body.credit, "crédito");
        if (body.driver !== undefined)
          c.driver =
            body.driver === ""
              ? ""
              : oneOf(body.driver, config.drivers, "repartidor");
        store.customers.save(c);
        store.audit.log(session, "customer.update", "customer", phone, body);
        events.customerChanged(c);
        return json(200, withSummary(c));
      }
      if (sub === "payments" && method === "POST") {
        const { payment, covered } = registerPayment(c, body, session);
        for (const o of covered) events.orderChanged(o);
        events.customerChanged(c);
        push
          ?.toCustomer(phone, {
            url: "/cuenta",
            tag: payment.id,
            title: "Pago registrado",
            body: `Recibimos ${ars(payment.amount)} (${payment.method}). Gracias.`,
          })
          .catch(() => {});
        return json(201, {
          payment,
          customer: withSummary(store.customers.get(phone)),
        });
      }
      if (sub === "boxes" && method === "POST") {
        const count = num(body.boxes, {
          min: 1,
          max: 1000,
          integer: true,
          name: "envases",
        });
        const touched = returnCustomerBoxes(c, count, session);
        for (const o of touched) events.orderChanged(o);
        events.customerChanged(c);
        return json(200, {
          returned: count,
          orders: touched.map((o) => o.id),
          customer: withSummary(store.customers.get(phone)),
        });
      }
    }

    // ---- Chat interno administración ↔ repartidor ----
    if (path === "/api/messages" && method === "GET") {
      if (!isStaff(session)) fail(403, "El chat interno es del equipo.");
      if (session.role === "admin" && !query.get("thread"))
        return json(200, {
          threads: config.drivers.map((d) => `repartidor:${d}`),
          unread: store.messages.unreadFor("admin"),
        });
      const thread = threadFor(session, query.get("thread"));
      if (query.get("read") === "1")
        store.messages.markRead(thread, session.role);
      return json(200, {
        thread,
        messages: store.messages.list(thread),
        unread: store.messages.unreadFor(session.role),
      });
    }
    if (path === "/api/messages" && method === "POST") {
      if (!isStaff(session)) fail(403, "El chat interno es del equipo.");
      const thread = threadFor(session, body.thread);
      const text = str(body.text, { min: 1, max: 1000, name: "el mensaje" });
      const message = store.messages.add(
        thread,
        {
          role: session.role,
          name: session.role === "admin" ? business.adminName : session.driver,
        },
        text,
      );
      events.messageAdded(message, thread.slice(11));
      if (session.role === "admin")
        notifyDriver(thread.slice(11), {
          title: `${business.adminName}: ${text.slice(0, 60)}`,
          body: "Mensaje de administración",
          tag: "chat",
        });
      else
        notifyAdmins({
          title: `${session.driver}: ${text.slice(0, 60)}`,
          body: "Mensaje del reparto",
          tag: "chat",
        });
      return json(201, message);
    }
    return null;
  };
}

/** Suscriptores de eventos en tiempo real (Server-Sent Events). */
export function createEvents() {
  const clients = new Set();
  const send = (client, event, data) =>
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const sees = (session, o) =>
    session.role === "admin" ||
    (session.role === "repartidor" && o.driver === session.driver) ||
    (session.role === "cliente" && o.customer === session.phone);
  return {
    subscribe(res, session) {
      const client = { res, session };
      clients.add(client);
      send(client, "hello", { at: now() });
      const ping = setInterval(() => res.write(": ping\n\n"), 25000);
      res.on("close", () => {
        clearInterval(ping);
        clients.delete(client);
      });
    },
    orderChanged(o) {
      for (const c of clients)
        if (sees(c.session, o))
          send(c, "orders", { id: o.id, status: o.status });
    },
    customerChanged(customer) {
      for (const c of clients)
        if (
          c.session.role === "admin" ||
          c.session.role === "repartidor" ||
          (c.session.role === "cliente" && c.session.phone === customer.phone)
        )
          send(c, "customer", { phone: customer.phone });
    },
    messageAdded(message, driver) {
      for (const c of clients)
        if (
          c.session.role === "admin" ||
          (c.session.role === "repartidor" && c.session.driver === driver)
        )
          send(c, "message", { thread: message.thread, id: message.id });
    },
  };
}
