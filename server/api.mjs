import { randomUUID } from "node:crypto";
import {
  products,
  localities,
  drivers,
  origin,
  statuses,
  plans,
  shippingByPlan,
  priceOrder,
  normalizePhone,
  accountSummary,
  applyWeights,
  applyPayment,
} from "../domain.mjs";
import business from "../business.json" with { type: "json" };
import { geocode, reverse, enabled as geocodingEnabled } from "./geo.mjs";
import { estimate, inMendoza } from "./route.mjs";

const staffPin = process.env.STAFF_PIN || (business.demo ? "1234" : "");
const now = () => new Date().toISOString();
const hhmm = (iso) =>
  new Date(iso).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Mendoza",
  });
const kgOf = (o) => o.items.reduce((n, p) => n + p.kg, 0);

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new ApiError(status, message);
};

export function createApi({ store, events, push }) {
  const config = {
    products,
    localities,
    drivers: drivers.map((d) => d.name),
    origin,
    shipping: shippingByPlan,
    demo: !!business.demo,
    adminName: business.adminName,
    adminPhone: process.env.ADMIN_WHATSAPP || business.adminPhone,
    transferAlias: process.env.TRANSFER_ALIAS || "",
    staffAccess: !!staffPin,
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

  function ensureCustomer(phone, data) {
    const existing = store.customers.get(phone);
    const customer = existing || {
      phone,
      name: data.name.trim(),
      plan: plans.includes(data.plan) ? data.plan : "minorista",
      credit: !!business.demo,
      created: now(),
    };
    customer.name = data.name?.trim() || customer.name;
    if (data.address)
      customer.address = String(data.address).trim().slice(0, 250);
    if (data.localityId && localities.some((l) => l.id === data.localityId))
      customer.localityId = data.localityId;
    if (data.location && inMendoza(data.location))
      customer.location = { lat: data.location.lat, lng: data.location.lng };
    if (!existing && plans.includes(data.plan)) customer.plan = data.plan;
    customer.updated = now();
    return store.customers.save(customer);
  }

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

  function driverContact(o) {
    const d = drivers.find((d) => d.name === o.driver);
    return d ? { name: d.name, phone: d.phone } : null;
  }
  const decorate = (o) => ({ ...o, driverContact: driverContact(o) });

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
  const notifyDriver = (o, payload) =>
    o.driver &&
    push
      ?.toDriver(o.driver, { url: "/reparto", tag: o.id, ...payload })
      .catch(() => {});

  /** Recalcula la hora estimada de llegada desde la posición del repartidor (o el local). */
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
    if (b.payment === "transferencia" && !config.transferAlias)
      fail(
        400,
        "La transferencia aún no está configurada. Elegí pagar al recibir.",
      );
    if (typeof b.key !== "string" || !b.key || b.key.length > 80)
      fail(400, "Identificador de pedido inválido.");
    const previous = store.orders.byKey(b.key);
    if (previous) return { order: previous, session, created: false };
    const phone =
      session?.role === "cliente" ? session.phone : normalizePhone(b.phone);
    const location =
      b.location && inMendoza(b.location)
        ? { lat: Number(b.location.lat), lng: Number(b.location.lng) }
        : null;
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
    const habitualDriver = drivers.some((d) => d.name === customer.driver)
      ? customer.driver
      : "";
    const o = {
      ...priced,
      id: "PC-" + randomUUID().slice(0, 8).toUpperCase(),
      key: b.key,
      customer: phone,
      name: b.name.trim(),
      phone: b.phone.trim(),
      address: b.address.trim(),
      notes: String(b.notes || "").slice(0, 500),
      plan: b.plan,
      payment: b.payment,
      paid: false,
      status: "recibido",
      driver: habitualDriver,
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
        o.paid = true;
        o.paidAt = now();
        o.paidBy = "saldo a favor";
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
    events.orderChanged(o);
    if (o.createdBy === "cliente")
      notifyAdmins({
        title: `Pedido nuevo · ${o.name}`,
        body: `${o.id} · ${kgOf(o)} kg · ${o.locality.name} · ${o.payment === "cuenta" ? "a cuenta" : "cobrar al entregar"}`,
      });
    if (!o.destination && geocodingEnabled)
      geocode(store, o.address, o.locality)
        .catch(() => null)
        .then((destination) => {
          const current = store.orders.get(o.id);
          if (!current) return;
          current.destination = destination;
          store.orders.save(current);
          events.orderChanged(current);
        });
    return { order: o, session: nextSession, created: true };
  }

  /** Aplica cambios al pedido y devuelve tareas diferidas (avisos, ETA) para ejecutar tras guardar. */
  async function updateOrder(o, b, session) {
    const role = session.role;
    const staff = role === "admin" || role === "repartidor";
    const after = [];
    if (role === "cliente") {
      // El cliente solo puede cancelar mientras el pedido no se preparó.
      if (b.cancel !== true) fail(403, "No podés modificar este pedido.");
      if (o.status !== "recibido")
        fail(400, "El pedido ya está en preparación; escribinos por WhatsApp.");
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
    if (!staff) fail(403, "Sin permiso.");
    if (o.status === "cancelado")
      fail(400, "El pedido fue cancelado por el cliente.");
    if (b.driver !== undefined) {
      if (role !== "admin")
        fail(403, "Solo administración asigna repartidores.");
      if (!drivers.some((d) => d.name === b.driver) || o.status === "entregado")
        fail(400, "Asignación inválida.");
      if (o.driver !== b.driver) {
        o.driver = b.driver;
        after.push(() =>
          notifyCustomer(o, {
            title: `${o.driver} lleva tu pedido`,
            body: `Te avisamos cuando salga la camioneta con el pedido ${o.id}.`,
          }),
        );
        after.push(() =>
          notifyDriver(o, {
            title: `Pedido asignado · ${o.name}`,
            body: `${o.id} · ${kgOf(o)} kg · ${o.address}, ${o.locality?.name || ""}`,
          }),
        );
      }
    }
    if (b.paid === true) o.paid = true;
    if (b.status) {
      if (statuses.indexOf(b.status) !== statuses.indexOf(o.status) + 1)
        fail(400, "El pedido debe avanzar un estado por vez.");
      if (b.status === "preparando" && role !== "admin")
        fail(403, "Administración inicia la preparación.");
      if (b.status === "en_camino" && !o.driver)
        fail(400, "Asigná un repartidor primero.");
      if (b.status === "entregado") {
        if (o.payment !== "cuenta" && !o.paid)
          fail(400, "Registrá el cobro antes de completar la entrega.");
        if (!Number.isInteger(b.boxes) || b.boxes < 0 || b.boxes > 100)
          fail(400, "Ingresá entre 0 y 100 envases.");
        o.boxes = o.plan === "mayorista" ? b.boxes : 0;
        o.deliveredAt = now();
        o.deliveredBy =
          role === "repartidor" ? session.driver : o.driver || "admin";
        delete o.eta;
      }
      o.status = b.status;
      o.history.push({ status: b.status, at: now() });
      if (b.status === "preparando")
        after.push(() =>
          notifyCustomer(o, {
            title: "Estamos preparando tu pedido",
            body: `${o.id} · ${kgOf(o)} kg. Te avisamos cuando salga.`,
          }),
        );
      if (b.status === "en_camino") {
        o.departedAt = now();
        if (o.destination) {
          const from = o.location
            ? { lat: o.location.lat, lng: o.location.lng }
            : origin;
          o.eta = await estimate(from, o.destination);
        }
        after.push(() =>
          notifyCustomer(o, {
            title: `${o.driver} salió con tu pedido`,
            body: o.eta
              ? `Llega aproximadamente a las ${hhmm(o.eta.arrival)} (${o.eta.km} km).`
              : "Seguí el recorrido en el mapa.",
          }),
        );
      }
      if (b.status === "entregado")
        after.push(() =>
          notifyCustomer(o, {
            title: "Pedido entregado",
            body: `¡Gracias! ${o.id} llegó a destino.`,
          }),
        );
    }
    if (b.location) {
      const { lat, lng } = b.location;
      if (
        o.status !== "en_camino" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      )
        fail(400, "Ubicación no válida.");
      o.location = { lat, lng, at: now() };
      o.track = [...(o.track || []), [lat, lng]].slice(-200);
      const stale = !o.eta || Date.now() - new Date(o.eta.at) > 45000;
      if (stale && o.destination) after.push(() => refreshEta(o));
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
      Object.assign(o, applyWeights(o, b.weights));
      o.weighed = true;
      o.weighedAt = now();
      o.weighedBy = role === "repartidor" ? session.driver : "admin";
      after.push(() =>
        notifyCustomer(o, {
          title: "Pesamos tu pedido",
          body: `${o.id}: ${kgOf(o)} kg en balanza · total ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(o.total)}.`,
        }),
      );
    }
    if (b.returnBoxes !== undefined) {
      if (
        !Number.isInteger(b.returnBoxes) ||
        b.returnBoxes < 1 ||
        b.returnBoxes > o.boxes - o.returned ||
        o.status !== "entregado"
      )
        fail(400, "La devolución supera los envases pendientes.");
      o.returned += b.returnBoxes;
      o.returns = [
        ...(o.returns || []),
        { boxes: b.returnBoxes, at: now(), by: session.driver || "admin" },
      ];
    }
    return after;
  }

  /** Enrutador de la API. Devuelve { status, body, session? } o null si la ruta no existe. */
  return async function handle({ method, path, body, query, session }) {
    const json = (status, body, extra = {}) => ({ status, body, ...extra });
    if (path === "/api/config" && method === "GET")
      return json(200, { ...config, session: publicSession(session) });

    if (path === "/api/session") {
      if (method === "GET") return json(200, publicSession(session));
      if (method === "DELETE") {
        if (session) store.sessions.delete(session.id);
        return json(200, null, { session: null });
      }
      if (method === "POST") {
        const b = body;
        const phone = normalizePhone(b.phone);
        if (
          typeof b.name !== "string" ||
          b.name.trim().length < 2 ||
          b.name.length > 100
        )
          fail(400, "Ingresá tu nombre.");
        if (!phone)
          fail(400, "Ingresá un teléfono válido, con código de área.");
        const customer = ensureCustomer(phone, b);
        if (session) store.sessions.delete(session.id);
        const s = store.sessions.create({
          role: "cliente",
          phone,
          name: customer.name,
          plan: customer.plan,
        });
        return json(200, publicSession(s), { session: s });
      }
    }
    if (path === "/api/session/staff" && method === "POST") {
      const b = body;
      if (!staffPin)
        fail(403, "El acceso del equipo no está configurado en este servidor.");
      if (typeof b.pin !== "string" || b.pin !== staffPin)
        fail(401, "PIN incorrecto.");
      let s;
      if (b.role === "repartidor") {
        if (!drivers.some((d) => d.name === b.driver))
          fail(400, "Elegí tu nombre de repartidor.");
        s = {
          role: "repartidor",
          driver: b.driver,
          name: b.driver,
          phone: drivers.find((d) => d.name === b.driver).phone,
        };
      } else
        s = {
          role: "admin",
          name: business.adminName,
          phone: config.adminPhone,
        };
      if (session) store.sessions.delete(session.id);
      const created = store.sessions.create(s);
      return json(200, publicSession(created), { session: created });
    }

    if (path === "/api/me" && method === "GET") {
      if (!session || session.role !== "cliente") return json(200, null);
      const customer = store.customers.get(session.phone);
      return json(
        200,
        customer
          ? {
              ...customer,
              summary: accountSummary(
                store.orders.forCustomer(session.phone),
                customer,
              ),
            }
          : null,
      );
    }
    if (path === "/api/me" && method === "PATCH") {
      if (!session || session.role !== "cliente")
        fail(401, "Ingresá con tu teléfono.");
      const customer = ensureCustomer(session.phone, {
        ...body,
        name: body.name || session.name,
      });
      if (plans.includes(body.plan)) {
        customer.plan = body.plan;
        store.customers.save(customer);
      }
      return json(200, customer);
    }

    if (path === "/api/geo/reverse" && method === "GET") {
      const lat = Number(query.get("lat"));
      const lng = Number(query.get("lng"));
      if (!inMendoza({ lat, lng }))
        fail(
          400,
          "Esa ubicación está fuera de nuestra zona de reparto (Mendoza).",
        );
      const result = await reverse(store, lat, lng, localities).catch(
        () => null,
      );
      return json(200, result);
    }

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

    if (path === "/api/orders" && method === "GET")
      return json(200, visibleOrders(session).map(decorate));
    if (path === "/api/orders" && method === "POST") {
      if (session && session.role === "repartidor")
        fail(403, "Los repartidores no crean pedidos.");
      const { order, session: s, created } = createOrder(body, session);
      return json(
        created ? 201 : 200,
        decorate(order),
        s !== session ? { session: s } : {},
      );
    }
    if (path.startsWith("/api/orders/") && method === "PATCH") {
      if (!session) fail(401, "Ingresá para gestionar pedidos.");
      const o = store.orders.get(decodeURIComponent(path.split("/")[3]));
      if (!o || !canSee(session, o)) fail(404, "Pedido no encontrado.");
      const after = await updateOrder(o, body, session);
      store.orders.save(o);
      events.orderChanged(o);
      for (const task of after)
        Promise.resolve()
          .then(task)
          .catch(() => {});
      return json(200, decorate(o));
    }

    if (path === "/api/customers" && method === "GET") {
      if (!session || session.role === "cliente") fail(403, "Solo el equipo.");
      // El repartidor solo ve los clientes de su reparto (pedidos asignados o repartidor habitual).
      const mine =
        session.role === "repartidor"
          ? new Set(
              store.orders.forDriver(session.driver).map((o) => o.customer),
            )
          : null;
      const list = store.customers
        .all()
        .filter(
          (c) => !mine || mine.has(c.phone) || c.driver === session.driver,
        )
        .map((c) => ({
          ...c,
          summary: accountSummary(store.orders.forCustomer(c.phone), c),
        }))
        .sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
      return json(200, list);
    }
    if (path.startsWith("/api/customers/") && method === "PATCH") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      const c = store.customers.get(decodeURIComponent(path.split("/")[3]));
      if (!c) fail(404, "Cliente no encontrado.");
      if (plans.includes(body.plan)) c.plan = body.plan;
      if (typeof body.credit === "boolean") c.credit = body.credit;
      if (body.driver !== undefined) {
        if (body.driver !== "" && !drivers.some((d) => d.name === body.driver))
          fail(400, "Repartidor inválido.");
        c.driver = body.driver;
      }
      c.updated = now();
      store.customers.save(c);
      events.customerChanged(c);
      return json(200, c);
    }
    if (
      path.startsWith("/api/customers/") &&
      path.endsWith("/payments") &&
      method === "POST"
    ) {
      if (!session || session.role === "cliente")
        fail(403, "Solo el equipo registra pagos.");
      const phone = decodeURIComponent(path.split("/")[3]);
      const c = store.customers.get(phone);
      if (!c) fail(404, "Cliente no encontrado.");
      const customerOrders = store.orders.forCustomer(phone);
      if (
        session.role === "repartidor" &&
        !customerOrders.some((o) => o.driver === session.driver) &&
        c.driver !== session.driver
      )
        fail(403, "Solo podés cobrar a clientes de tu reparto.");
      const amount = Math.round(Number(body.amount) * 100) / 100;
      const method_ = ["efectivo", "transferencia"].includes(body.method)
        ? body.method
        : "efectivo";
      const { covered, leftover } = applyPayment(
        customerOrders,
        amount,
        c.creditBalance || 0,
      );
      const payment = {
        id: "PG-" + randomUUID().slice(0, 6).toUpperCase(),
        amount,
        method: method_,
        note: String(body.note || "").slice(0, 200),
        at: now(),
        by: session.role === "repartidor" ? session.driver : "admin",
        applied: covered.map((o) => o.id),
      };
      for (const o of covered) {
        o.paid = true;
        o.paidAt = payment.at;
        o.paidBy = payment.by;
        o.paymentId = payment.id;
        store.orders.save(o);
        events.orderChanged(o);
      }
      c.creditBalance = leftover;
      c.payments = [...(c.payments || []), payment];
      c.updated = now();
      store.customers.save(c);
      events.customerChanged(c);
      push
        ?.toCustomer(phone, {
          url: "/cuenta",
          tag: payment.id,
          title: "Pago registrado",
          body: `Recibimos ${new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(amount)} (${method_}). Gracias.`,
        })
        .catch(() => {});
      return json(201, {
        payment,
        customer: {
          ...c,
          summary: accountSummary(store.orders.forCustomer(phone), c),
        },
      });
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
          (c.session.role === "cliente" && c.session.phone === customer.phone)
        )
          send(c, "customer", { phone: customer.phone });
    },
  };
}
