import { randomUUID } from "node:crypto";
import {
  products,
  localities,
  drivers,
  origin,
  statuses,
  plans,
  planMinKg,
  shippingByPlan,
  priceOrder,
  normalizePhone,
  accountSummary,
  applyWeights,
  applyPrices,
  applyPayment,
  withLists,
} from "../domain.mjs";
import business from "../business.json" with { type: "json" };
import {
  geocode,
  reverse,
  search,
  enabled as geocodingEnabled,
} from "./geo.mjs";
import { estimate, inMendoza } from "./route.mjs";
import { ApiError, fail } from "./errors.mjs";
import { createFloor } from "./floor.mjs";
import { createFleet } from "./fleet.mjs";
import { appMode, defaultTare, shifts, fiscal, demo } from "../domain.mjs";
import { str, num, oneOf, bool, latLng, rateLimiter } from "./validate.mjs";
import {
  transferInfo,
  checkoutEnabled,
  createPreference,
  fetchPayment,
} from "./mercadopago.mjs";
import {
  hashPassword,
  verifyPassword,
  validEmail,
  passwordOk,
  sendMagicLink,
  verifyGoogleToken,
  createPasskeys,
  sendOtp,
  newOtpCode,
  phoneLoginEnabled,
} from "./auth.mjs";

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
// Hash de relleno para que un usuario inexistente tarde lo mismo que una contraseña incorrecta.
const DUMMY_HASH = await hashPassword("relleno-" + Math.random());
const actorOf = (s) =>
  s?.role === "repartidor"
    ? s.driver
    : s?.role === "admin"
      ? s.name || "admin"
      : s?.name || "cliente";

export function createApi({
  store,
  events,
  push,
  base = "http://localhost:5173",
}) {
  // Intentos de ingreso por minuto y por IP (LOGIN_LIMIT permite subirlo en pruebas).
  const attempts = Number(process.env.LOGIN_LIMIT) || 0;
  const loginLimit = rateLimiter({ limit: attempts || 10, windowMs: 60000 });
  const staffLimit = rateLimiter({ limit: attempts || 6, windowMs: 60000 });
  // Escrituras anónimas y consultas al geocodificador: tope por IP para que nadie agote la cola ni cree pedidos en masa.
  const orderLimit = rateLimiter({ limit: attempts || 20, windowMs: 60000 });
  const geoLimit = rateLimiter({ limit: attempts || 30, windowMs: 60000 });
  const OTP_SENDS = 3; // códigos por teléfono cada 15 minutos
  const passkeys = createPasskeys({ base });
  // Repartidores: tabla drivers (sembrada desde business.json); nombres activos para validar.
  const driverNames = () =>
    store.drivers
      .all()
      .filter((d) => d.active)
      .map((d) => d.name);
  const driverByName = (name) => store.drivers.get(name);
  const priceLists = () => store.settings.get("priceLists", null);
  const config = {
    get products() {
      return withLists(priceLists());
    },
    localities,
    get drivers() {
      return driverNames();
    },
    get driverList() {
      return store.drivers.all();
    },
    get tare() {
      return Number(store.settings.get("tare", defaultTare)) || defaultTare;
    },
    mode: appMode,
    shifts,
    fiscal,
    origin,
    shipping: shippingByPlan,
    planMinKg,
    demo: !!demo,
    adminName: business.adminName,
    adminPhone: process.env.ADMIN_WHATSAPP || business.adminPhone,
    transfer: transferInfo(),
    mercadopago: checkoutEnabled(),
    pushKey: push?.publicKey || null,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    magicLinks: true,
    passkeys: true,
    phoneLogin: phoneLoginEnabled(),
  };
  // Cambios simultáneos sobre un mismo pedido se aplican de a uno (cada uno relee el pedido).
  const orderLocks = new Map();
  const withOrderLock = (id, fn) => {
    const previous = orderLocks.get(id) || Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.catch(() => {});
    orderLocks.set(id, settled);
    settled.then(() => {
      if (orderLocks.get(id) === settled) orderLocks.delete(id);
    });
    return run;
  };
  const publicSession = (s) =>
    s
      ? {
          role: s.role,
          name: s.name,
          phone: s.phone,
          driver: s.driver || null,
          plan: s.plan || null,
          account: !!s.accountId,
          staff: !!s.staffId,
          staffId: s.staffId || null,
          verified: !!s.phone,
        }
      : null;
  const publicConfig = (session) => ({
    ...config,
    drivers: config.drivers,
    driverList: config.driverList,
    tare: config.tare,
    session: publicSession(session),
  });
  const portalClosed = () =>
    fail(
      404,
      "El portal de clientes está desactivado. El equipo ingresa por /admin.",
    );

  function ensureCustomer(phone, data, { trusted = true } = {}) {
    const existing = store.customers.get(phone);
    // Un teléfono sin verificar no puede pisar nombre, dirección ni ubicación de una ficha existente.
    if (existing && !trusted) return existing;
    const customer = existing || {
      phone,
      name: String(data.name || "Cliente").trim(),
      plan: plans.includes(data.plan) ? data.plan : "minorista",
      credit: !!demo,
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

  /** Abre sesión de cliente para una cuenta (email, Google o passkey). */
  function sessionForAccount(account, current) {
    if (current) store.sessions.delete(current.id);
    const customer = account.phone ? store.customers.get(account.phone) : null;
    account.lastLogin = now();
    store.accounts.save(account);
    const s = store.sessions.create({
      role: "cliente",
      accountId: account.id,
      phone: account.phone || null,
      name: account.name,
      plan: customer?.plan || null,
    });
    store.audit.log(s, "session.login", "account", account.id, {
      via: "cuenta",
    });
    return s;
  }
  function findOrCreateAccount({ email, name, googleSub }) {
    let account =
      (googleSub && store.accounts.byGoogle(googleSub)) ||
      (email && store.accounts.byEmail(email)) ||
      null;
    if (!account) account = store.accounts.create({ email, name, googleSub });
    else if (googleSub && !account.googleSub) {
      account.googleSub = googleSub;
      store.accounts.save(account);
    }
    return account;
  }

  /**
   * Un cliente ve los pedidos de su teléfono solo si lo verificó; si no, únicamente los que
   * creó con su cuenta o desde esta misma sesión.
   */
  function visibleOrders(session) {
    if (!session) return [];
    if (session.role === "admin") return store.orders.all();
    if (session.role === "repartidor")
      return store.orders.forDriver(session.driver);
    if (session.phone) return store.orders.forCustomer(session.phone);
    const mine = [
      ...(session.accountId ? store.orders.forAccount(session.accountId) : []),
      ...store.orders.forSession(session.id),
    ];
    return mine
      .filter((o, i) => mine.findIndex((x) => x.id === o.id) === i)
      .sort((a, b) => b.created.localeCompare(a.created));
  }
  const ownsOrder = (session, o) =>
    (!!session.phone && o.customer === session.phone) ||
    (!!session.accountId && o.accountId === session.accountId) ||
    o.sessionId === session.id;
  const canSee = (session, o) =>
    session &&
    (session.role === "admin" ||
      (session.role === "repartidor" && o.driver === session.driver) ||
      (session.role === "cliente" && ownsOrder(session, o)));
  /** Vincula un teléfono verificado a la sesión (y a su cuenta, si la tiene). */
  function attachPhone(session, phone, name) {
    // Si la ficha ya existe se respeta su nombre; si no, se crea con el de la sesión.
    const customer = ensureCustomer(
      phone,
      store.customers.get(phone) ? {} : { name: name || session.name },
    );
    store.sessions.update(session.id, { phone, plan: customer.plan });
    if (session.accountId) {
      const account = store.accounts.get(session.accountId);
      if (account && account.phone !== phone) {
        account.phone = phone;
        store.accounts.save(account);
      }
    }
    return { ...session, phone, plan: customer.plan, name: customer.name };
  }
  /**
   * Los clientes son de la empresa: todo el equipo ve y opera la lista completa (un cliente que
   * carga un preventista queda visible para los demás). "Mis clientes" de un repartidor es solo
   * una marca (`mine`) para ordenar y resaltar en su pantalla: los de sus pedidos, su camión o sus zonas.
   */
  const servedBy = (session) => {
    if (session.role !== "repartidor") return () => true;
    const mine = new Set(
      store.orders.forDriver(session.driver).map((o) => o.customer),
    );
    const me = store.drivers.get(session.driver);
    const zones = new Set((me?.zones || []).map((z) => z.toLowerCase()));
    return (c) =>
      mine.has(c.phone) ||
      c.driver === session.driver ||
      c.truck === session.driver ||
      (c.zone && zones.has(String(c.zone).toLowerCase()));
  };
  const driverServes = (session) => isStaff(session);

  const driverContact = (o) => {
    const d = o.driver ? driverByName(o.driver) : null;
    return d ? { name: d.name, phone: d.phone } : null;
  };
  /** Lo que ve cada rol de un pedido: el cliente no recibe datos internos. */
  const view = (o, session) => {
    const out = { ...o, driverContact: driverContact(o) };
    if (isStaff(session)) out.crates = store.crates.forOrder(o.id);
    if (session?.role !== "admin") {
      delete out.key;
      delete out.accountId;
      delete out.sessionId;
      if (session?.role === "cliente") delete out.createdBy;
    }
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
    // Administración carga lo que el cliente pidió por teléfono; el mínimo por modalidad es para el autoservicio.
    const priced = priceOrder(b, {
      enforceMin: session?.role !== "admin",
      lists: priceLists(),
    });
    if (b.payment === "transferencia" && !config.transfer)
      fail(
        400,
        "La transferencia todavía no está habilitada. Elegí efectivo al recibir.",
      );
    if (b.payment === "mercadopago" && !config.mercadopago)
      fail(400, "El pago online no está habilitado. Elegí otro medio.");
    const phone =
      session?.role === "cliente" && session.phone
        ? session.phone
        : normalizePhone(b.phone);
    if (!phone) fail(400, "Ingresá un WhatsApp válido, con código de área.");
    // La clave de idempotencia se acota al teléfono: reutilizarla no devuelve pedidos ajenos.
    const key = `${phone}:${str(b.key, { min: 1, max: 80, name: "identificador" })}`;
    const previous = store.orders.byKey(key);
    if (previous) {
      if (
        session?.role === "admin" ||
        (session && ownsOrder(session, previous))
      )
        return { order: previous, session, created: false };
      fail(409, "Ese pedido ya fue registrado. Actualizá la página.");
    }
    const trusted =
      session?.role === "admin" ||
      (session?.role === "cliente" && session.phone === phone);
    const location =
      b.location && inMendoza(b.location)
        ? { lat: Number(b.location.lat), lng: Number(b.location.lng) }
        : null;
    return store.transaction(() => {
      const customer = ensureCustomer(
        phone,
        { ...b, plan: b.plan, location },
        { trusted },
      );
      if (b.payment === "cuenta" && !customer.credit)
        fail(
          400,
          "Tu cuenta corriente todavía no fue habilitada por administración. Elegí otro medio de pago.",
        );
      // Un cliente con historial pide con la modalidad que administración le asignó.
      if (
        session?.role !== "admin" &&
        plans.indexOf(b.plan) < plans.indexOf(customer.plan) &&
        store.orders.countFor(phone) > 0
      )
        fail(
          400,
          `Tu modalidad es ${customer.plan}. Si querés pasar a ${b.plan}, escribinos por WhatsApp y la habilitamos.`,
        );
      // Sin teléfono verificado la sesión queda sin teléfono: solo ve los pedidos que creó.
      let nextSession = session;
      if (!session)
        nextSession = store.sessions.create({
          role: "cliente",
          phone: null,
          name: String(b.name || customer.name)
            .trim()
            .slice(0, 100),
          plan: plans.includes(b.plan) ? b.plan : customer.plan,
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
        accountId:
          nextSession.role === "cliente" ? nextSession.accountId || null : null,
        sessionId: nextSession.role === "cliente" ? nextSession.id : null,
        driver:
          session?.role === "admin" && driverNames().includes(b.driver)
            ? b.driver
            : driverNames().includes(customer.driver)
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
        // Lo ya pagado (saldo a favor, pago registrado u online) vuelve como saldo a favor.
        if (o.paid && !o.refunded) {
          const customer = store.customers.get(o.customer);
          if (customer) {
            customer.creditBalance =
              Math.round(((customer.creditBalance || 0) + o.total) * 100) / 100;
            store.customers.save(customer);
            o.refunded = { amount: o.total, at: now(), to: "saldo a favor" };
            after.push(() => events.customerChanged(customer));
          }
        }
        after.push(() =>
          notifyAdmins({
            title: `Pedido cancelado · ${o.name}`,
            body: `${o.id} fue cancelado por el cliente.${o.refunded ? " " + ars(o.total) + " quedaron como saldo a favor." : ""}`,
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
      if (o.payment === "cuenta")
        fail(
          400,
          "Los pedidos a cuenta se cobran desde la cuenta corriente del cliente (Registrar pago), así queda en el extracto.",
        );
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
            body: `Gracias. ${o.id} llegó a destino.`,
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
      store.orders.addTrack(o.id, lat, lng, o.location.at);
      if ((!o.eta || Date.now() - new Date(o.eta.at) > 45000) && o.destination)
        after.push(() => refreshEta(o));
    }
    if (b.prices !== undefined) {
      if (role !== "admin") fail(403, "Solo administración cambia precios.");
      if (o.paid && o.payment !== "cuenta")
        fail(
          400,
          "El pedido ya fue cobrado; registrá la diferencia como pago.",
        );
      const before = Math.round(o.total * 100);
      Object.assign(o, applyPrices(o, b.prices));
      o.repriced = { at: now(), by: actorOf(session) };
      const diff = Math.round(o.total * 100) - before;
      const customer = store.customers.get(o.customer);
      if (customer) {
        if (o.paid && diff !== 0) {
          customer.creditBalance =
            Math.round((customer.creditBalance || 0) * 100 - diff) / 100;
          o.adjustments = [
            ...(o.adjustments || []),
            {
              amount: diff / 100,
              at: now(),
              by: actorOf(session),
              reason: "precio",
            },
          ];
        }
        // Opcional: el precio nuevo queda como precio propio del cliente para los próximos pedidos.
        if (b.savePrices === true)
          for (const [pid, price] of Object.entries(b.prices))
            if (o.items.some((i) => i.id === pid))
              store.prices.set(
                customer.phone,
                pid,
                Number(price),
                actorOf(session),
              );
        if (o.paid && diff !== 0) store.customers.save(customer);
        if ((o.paid && diff !== 0) || b.savePrices === true)
          after.push(() => events.customerChanged(customer));
      }
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
      const before = Math.round(o.total * 100);
      Object.assign(o, applyWeights(o, b.weights), {
        weighed: true,
        weighedAt: now(),
        weighedBy: actorOf(session),
      });
      // Pedido a cuenta ya pagado: la diferencia de peso queda como deuda o saldo a favor, no se pierde.
      const diff = Math.round(o.total * 100) - before;
      if (o.paid && diff !== 0) {
        const customer = store.customers.get(o.customer);
        if (customer) {
          customer.creditBalance =
            Math.round((customer.creditBalance || 0) * 100 - diff) / 100;
          store.customers.save(customer);
          o.adjustments = [
            ...(o.adjustments || []),
            {
              amount: diff / 100,
              at: now(),
              by: actorOf(session),
              reason: "peso",
            },
          ];
          after.push(() => events.customerChanged(customer));
        }
      }
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

  const floor = createFloor({
    store,
    events,
    config,
    isStaff,
    actorOf,
    view,
    withOrderLock,
    driverNames,
  });

  const fleet = createFleet({ store, events, isStaff, actorOf, driverNames });

  /** Enrutador. Devuelve { status, body, session?, redirect? } o null si la ruta no existe. */
  return async function handle({ method, path, body, query, session, ip }) {
    const json = (status, body, extra = {}) => ({ status, body, ...extra });
    const fromFloor = await floor({ method, path, body, query, session, ip });
    if (fromFloor) return fromFloor;
    const fromFleet = await fleet({ method, path, body, query, session, ip });
    if (fromFleet) return fromFleet;
    // Modo equipo: sin cuentas de clientes, sin pedidos anónimos, sin ingreso por celular.
    if (
      appMode === "equipo" &&
      !isStaff(session) &&
      (path.startsWith("/api/auth/") ||
        path === "/api/me" ||
        (path === "/api/orders" && method !== "GET") ||
        (path === "/api/session" && method === "POST") ||
        path.startsWith("/api/geo/") ||
        path === "/api/push/subscribe")
    )
      portalClosed();

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
      if (method === "POST")
        fail(
          410,
          "El ingreso por celular ahora se confirma con un código: usá /api/auth/phone.",
        );
    }
    // Ingreso o vinculación de celular con código de un solo uso (WhatsApp).
    if (path === "/api/auth/phone" && method === "POST") {
      loginLimit(ip);
      if (!config.phoneLogin)
        fail(
          400,
          "El ingreso por celular no está habilitado. Ingresá con tu email.",
        );
      const phone = normalizePhone(body.phone);
      if (!phone) fail(400, "Ingresá un teléfono válido, con código de área.");
      const name = str(body.name, {
        max: 100,
        name: "el nombre",
        optional: true,
      });
      const previous = store.tokens.peek("otp:" + phone, "otp");
      const sends = previous?.payload?.sends || [];
      const recent = sends.filter((t) => Date.now() - t < 15 * 60000);
      if (recent.length >= OTP_SENDS)
        fail(
          429,
          "Ya te mandamos varios códigos. Revisá WhatsApp o esperá 15 minutos.",
        );
      const code = newOtpCode();
      const result = await sendOtp(phone, code);
      store.tokens.put(
        "otp:" + phone,
        "otp",
        phone,
        {
          hash: await hashPassword(code),
          name,
          attempts: 0,
          sends: [...recent, Date.now()],
        },
        10 * 60000,
      );
      store.audit.log(session, "auth.otp_sent", "customer", phone, {
        sent: result.sent,
        ip,
      });
      return json(200, {
        sent: result.sent,
        demoCode: result.demoCode || null,
      });
    }
    if (path === "/api/auth/phone/verify" && method === "POST") {
      loginLimit(ip);
      const phone = normalizePhone(body.phone);
      const code = str(body.code, { min: 4, max: 8, name: "el código" });
      if (isStaff(session))
        fail(
          400,
          "Estás ingresado como equipo. Cerrá esa sesión antes de verificar un celular de cliente.",
        );
      const pending = phone && store.tokens.peek("otp:" + phone, "otp");
      if (!pending) fail(400, "El código venció. Pedí uno nuevo.");
      if (pending.payload.attempts >= 5) {
        store.tokens.remove("otp:" + phone);
        fail(400, "Demasiados intentos. Pedí un código nuevo.");
      }
      if (!(await verifyPassword(code, pending.payload.hash))) {
        store.tokens.setPayload("otp:" + phone, {
          ...pending.payload,
          attempts: pending.payload.attempts + 1,
        });
        store.audit.log(session, "auth.otp_denied", "customer", phone, { ip });
        fail(401, "Código incorrecto.");
      }
      store.tokens.remove("otp:" + phone);
      const name =
        str(body.name, { max: 100, name: "el nombre", optional: true }) ||
        pending.payload.name ||
        session?.name ||
        "";
      let s;
      if (session?.role === "cliente") {
        // Sesión existente (cuenta o invitado): se le vincula el teléfono verificado.
        s = attachPhone(session, phone, name);
      } else {
        if (session) store.sessions.delete(session.id);
        const customer = ensureCustomer(phone, { name: name || "Cliente" });
        s = store.sessions.create({
          role: "cliente",
          phone,
          name: customer.name,
          plan: customer.plan,
        });
      }
      store.audit.log(s, "session.login", "customer", phone, {
        via: "celular",
        verified: true,
      });
      return json(200, publicSession(s), { session: s });
    }
    if (path === "/api/session/staff" && method === "POST") {
      staffLimit(ip);
      const username = str(body.username, {
        min: 2,
        max: 40,
        name: "el usuario",
      }).toLowerCase();
      const password = str(body.password, {
        min: 1,
        max: 200,
        name: "la contraseña",
      });
      const user = store.staff.byUsername(username);
      const ok = await verifyPassword(
        password,
        user?.password_hash || DUMMY_HASH,
      );
      if (!user || !user.active || !ok) {
        store.audit.log(null, "session.staff_denied", "staff", username, {
          ip,
        });
        fail(401, "Usuario o contraseña incorrectos.");
      }
      const driverInfo =
        user.role === "repartidor" ? driverByName(user.driver) : null;
      if (user.role === "repartidor" && !driverInfo)
        fail(
          403,
          "Este usuario no tiene un repartidor asignado. Pedile a administración que lo configure.",
        );
      const data =
        user.role === "repartidor"
          ? {
              role: "repartidor",
              staffId: user.id,
              driver: user.driver,
              name: user.name,
              phone: driverInfo.phone,
            }
          : {
              role: "admin",
              staffId: user.id,
              name: user.name,
              phone: config.adminPhone,
            };
      if (session) store.sessions.delete(session.id);
      const s = store.sessions.create(data);
      store.staff.touch(user.id);
      store.audit.log(s, "session.staff_login", "staff", username, { ip });
      return json(200, publicSession(s), { session: s });
    }

    // ---- Cuentas de clientes: email + contraseña, enlace mágico, Google, passkeys ----
    if (path === "/api/auth/register" && method === "POST") {
      loginLimit(ip);
      const name = str(body.name, { min: 2, max: 100, name: "el nombre" });
      const email = str(body.email, {
        min: 5,
        max: 160,
        name: "el email",
      }).toLowerCase();
      if (!validEmail(email)) fail(400, "Ingresá un email válido.");
      if (!passwordOk(body.password))
        fail(400, "La contraseña debe tener al menos 8 caracteres.");
      if (store.accounts.byEmail(email))
        fail(
          409,
          "Ese email ya tiene cuenta. Ingresá con tu contraseña, con Google o pedí un enlace de acceso; desde Mi cuenta podés crear una contraseña.",
        );
      const account = store.accounts.create({ email, name });
      account.passwordHash = await hashPassword(body.password);
      store.accounts.save(account);
      const s = sessionForAccount(account, session);
      return json(201, publicSession(s), { session: s });
    }
    // Crear o cambiar la contraseña de la cuenta con la que ya se ingresó (Google, enlace o passkey).
    if (path === "/api/auth/password" && method === "POST") {
      if (!session?.accountId) fail(401, "Ingresá con tu cuenta.");
      const account = store.accounts.get(session.accountId);
      if (!account) fail(401, "Ingresá con tu cuenta.");
      if (!passwordOk(body.password))
        fail(400, "La contraseña debe tener al menos 8 caracteres.");
      if (
        account.passwordHash &&
        !(await verifyPassword(
          String(body.current || ""),
          account.passwordHash,
        ))
      )
        fail(401, "La contraseña actual no coincide.");
      account.passwordHash = await hashPassword(body.password);
      store.accounts.save(account);
      store.audit.log(session, "auth.password_set", "account", account.id);
      return json(200, { ok: true });
    }
    if (path === "/api/auth/login" && method === "POST") {
      loginLimit(ip);
      const email = str(body.email, {
        min: 5,
        max: 160,
        name: "el email",
      }).toLowerCase();
      const account = store.accounts.byEmail(email);
      if (
        !account ||
        !account.passwordHash ||
        !(await verifyPassword(
          String(body.password || ""),
          account.passwordHash,
        ))
      ) {
        store.audit.log(null, "session.denied", "account", email, { ip });
        fail(401, "Email o contraseña incorrectos.");
      }
      const s = sessionForAccount(account, session);
      return json(200, publicSession(s), { session: s });
    }
    if (path === "/api/auth/magic" && method === "POST") {
      loginLimit(ip);
      const email = str(body.email, {
        min: 5,
        max: 160,
        name: "el email",
      }).toLowerCase();
      if (!validEmail(email)) fail(400, "Ingresá un email válido.");
      const name = str(body.name, {
        max: 100,
        name: "el nombre",
        optional: true,
      });
      const token = store.tokens.create("magic", email, { name }, 15 * 60000);
      const link = `${base}/api/auth/magic/${token}`;
      let result;
      try {
        result = await sendMagicLink(email, link);
      } catch (e) {
        store.audit.log(null, "auth.magic_failed", "account", email, {
          error: e.message,
        });
        fail(500, "No pudimos enviar el email. Probá con otro método.");
      }
      store.audit.log(null, "auth.magic_sent", "account", email, {
        sent: result.sent,
      });
      return json(200, {
        sent: result.sent,
        demoLink: result.demoLink || null,
      });
    }
    if (path.startsWith("/api/auth/magic/") && method === "GET") {
      // Los antivirus y previsualizadores de correo abren los enlaces: acá solo se mira el token.
      const token = path.slice("/api/auth/magic/".length);
      if (!store.tokens.peek(token, "magic"))
        return { status: 302, redirect: "/ingresar?enlace=vencido" };
      return {
        status: 302,
        redirect: "/ingresar?enlace=" + encodeURIComponent(token),
      };
    }
    if (path === "/api/auth/magic/consume" && method === "POST") {
      loginLimit(ip);
      const t = store.tokens.consume(
        str(body.token, { min: 20, max: 200, name: "el enlace" }),
        "magic",
      );
      if (!t)
        fail(400, "El enlace de acceso venció o ya se usó. Pedí uno nuevo.");
      const account = findOrCreateAccount({
        email: t.subject,
        name: t.payload?.name || t.subject.split("@")[0],
      });
      const s = sessionForAccount(account, session);
      return json(200, publicSession(s), { session: s });
    }
    if (path === "/api/auth/google" && method === "POST") {
      loginLimit(ip);
      const g = await verifyGoogleToken(
        str(body.credential, { min: 20, max: 4000, name: "la credencial" }),
      );
      const account = findOrCreateAccount({
        email: g.email,
        name: g.name,
        googleSub: g.sub,
      });
      const s = sessionForAccount(account, session);
      return json(200, publicSession(s), { session: s });
    }
    if (path === "/api/auth/passkey/register/options" && method === "POST") {
      if (!session?.accountId)
        fail(
          401,
          "Ingresá con tu cuenta (email o Google) para activar la huella o Face ID.",
        );
      const account = store.accounts.get(session.accountId);
      const options = await passkeys.registrationOptions(
        account,
        store.passkeys.forAccount(account.id),
      );
      const token = store.tokens.create(
        "webauthn-reg",
        account.id,
        { challenge: options.challenge },
        5 * 60000,
      );
      return json(200, { options, token });
    }
    if (path === "/api/auth/passkey/register/verify" && method === "POST") {
      if (!session?.accountId) fail(401, "Ingresá con tu cuenta.");
      const pending = store.tokens.consume(
        String(body.token || ""),
        "webauthn-reg",
      );
      if (!pending || pending.subject !== session.accountId)
        fail(400, "El registro venció. Probá de nuevo.");
      const key = await passkeys.verifyRegistration(
        body.response,
        pending.payload.challenge,
      );
      store.passkeys.add({
        ...key,
        accountId: session.accountId,
        device:
          str(body.device, { max: 60, optional: true, name: "dispositivo" }) ||
          key.device,
      });
      store.audit.log(
        session,
        "auth.passkey_added",
        "account",
        session.accountId,
      );
      return json(201, {
        ok: true,
        passkeys: store.passkeys.forAccount(session.accountId).length,
      });
    }
    if (path === "/api/auth/passkey/login/options" && method === "POST") {
      loginLimit(ip);
      const options = await passkeys.authenticationOptions();
      const token = store.tokens.create(
        "webauthn-auth",
        null,
        { challenge: options.challenge },
        5 * 60000,
      );
      return json(200, { options, token });
    }
    if (path === "/api/auth/passkey/login/verify" && method === "POST") {
      loginLimit(ip);
      const pending = store.tokens.consume(
        String(body.token || ""),
        "webauthn-auth",
      );
      if (!pending) fail(400, "El ingreso venció. Probá de nuevo.");
      const key = store.passkeys.get(String(body.response?.id || ""));
      if (!key) fail(401, "Esa llave de acceso no está registrada.");
      const counter = await passkeys.verifyAuthentication(
        body.response,
        pending.payload.challenge,
        key,
      );
      store.passkeys.used(key.id, counter);
      const account = store.accounts.get(key.accountId);
      const s = sessionForAccount(account, session);
      return json(200, publicSession(s), { session: s });
    }
    if (path.startsWith("/api/auth/passkey/") && method === "DELETE") {
      if (!session?.accountId) fail(401, "Ingresá con tu cuenta.");
      store.passkeys.remove(
        decodeURIComponent(path.split("/")[4]),
        session.accountId,
      );
      return json(200, { ok: true });
    }

    // ---- Cliente ----
    if (path === "/api/me" && method === "GET") {
      if (!session || session.role !== "cliente") return json(200, null);
      const c = session.phone ? store.customers.get(session.phone) : null;
      const account = session.accountId
        ? store.accounts.get(session.accountId)
        : null;
      const data = c
        ? withSummary(c)
        : {
            phone: session.phone,
            name: session.name,
            summary: {
              balance: 0,
              owed: 0,
              creditBalance: 0,
              pendingOrders: 0,
              boxes: 0,
            },
          };
      return json(200, {
        ...data,
        name: data.name || account?.name || session.name,
        account: account
          ? {
              email: account.email,
              google: !!account.googleSub,
              password: !!account.passwordHash,
              passkeys: store.passkeys.forAccount(account.id).map((k) => ({
                id: k.id,
                device: k.device,
                created: k.created,
                lastUsed: k.lastUsed,
              })),
            }
          : null,
      });
    }
    if (path === "/api/me" && method === "PATCH") {
      if (!session || session.role !== "cliente")
        fail(401, "Ingresá para editar tus datos.");
      const current = session;
      if (!current.phone) {
        // Sin teléfono verificado solo se guarda el nombre en la sesión.
        const name = str(body.name, { min: 2, max: 100, name: "el nombre" });
        store.sessions.update(current.id, { name });
        if (current.accountId) {
          const account = store.accounts.get(current.accountId);
          if (account) {
            account.name = name;
            store.accounts.save(account);
          }
        }
        return json(
          200,
          { phone: null, name },
          { session: { ...current, name } },
        );
      }
      const c = ensureCustomer(current.phone, {
        ...body,
        name: body.name || current.name,
      });
      if (
        plans.includes(body.plan) &&
        body.plan !== c.plan &&
        store.orders.countFor(c.phone) === 0
      ) {
        c.plan = body.plan;
        store.customers.save(c);
      }
      return json(
        200,
        withSummary(c),
        current !== session ? { session: current } : {},
      );
    }
    if (path === "/api/geo/reverse" && method === "GET") {
      geoLimit(ip);
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
    if (path === "/api/geo/search" && method === "GET") {
      geoLimit(ip);
      const q = str(query.get("q"), { min: 3, max: 120, name: "la búsqueda" });
      return json(200, await search(store, q, localities).catch(() => []));
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
        fail(
          403,
          "Los repartidores cargan pedidos eligiendo un cliente de la lista.",
        );
      if (session?.role !== "admin") orderLimit(ip);
      const { order, session: s, created } = createOrder(body, session);
      if (created) afterCreate(order);
      const sessionChanged =
        s !== session &&
        (!session || s.id !== session.id || s.phone !== session.phone);
      return json(
        created ? 201 : 200,
        view(order, s),
        sessionChanged ? { session: s } : {},
      );
    }
    const orderMatch = path.match(/^\/api\/orders\/([^/]+)(?:\/(mp))?$/);
    if (orderMatch && method === "DELETE" && !orderMatch[2]) {
      if (session?.role !== "admin")
        fail(403, "Solo administración elimina pedidos.");
      const id = decodeURIComponent(orderMatch[1]);
      return withOrderLock(id, async () => {
        const o = store.orders.get(id);
        if (!o) fail(404, "Pedido no encontrado.");
        const reason = str(body?.reason, {
          max: 300,
          name: "el motivo",
          optional: true,
        });
        let customer = null;
        store.transaction(() => {
          if (o.paid && !o.refunded && o.payment !== "cuenta") {
            customer = store.customers.get(o.customer);
            if (customer) {
              customer.creditBalance =
                Math.round(((customer.creditBalance || 0) + o.total) * 100) /
                100;
              store.customers.save(customer);
            }
          }
          store.audit.log(session, "order.delete", "order", o.id, {
            reason,
            order: {
              name: o.name,
              customer: o.customer,
              total: o.total,
              status: o.status,
              items: o.items,
              paid: o.paid,
            },
          });
          store.orders.remove(o.id);
        });
        events.orderChanged({ ...o, status: "eliminado", deleted: true });
        if (customer) events.customerChanged(customer);
        return json(200, { ok: true, id: o.id });
      });
    }
    if (orderMatch && method === "PATCH" && !orderMatch[2]) {
      if (!session) fail(401, "Ingresá para gestionar pedidos.");
      const id = decodeURIComponent(orderMatch[1]);
      return withOrderLock(id, async () => {
        const o = store.orders.get(id);
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
      });
    }
    if (orderMatch && orderMatch[2] === "mp" && method === "POST") {
      if (!session) fail(401, "Ingresá para pagar.");
      const id = decodeURIComponent(orderMatch[1]);
      return withOrderLock(id, async () => {
        const o = store.orders.get(id);
        if (!o || !canSee(session, o)) fail(404, "Pedido no encontrado.");
        if (o.paid) fail(400, "El pedido ya está pagado.");
        if (!config.mercadopago)
          fail(400, "El pago online no está habilitado.");
        const pref = await createPreference(o, { base });
        const current = store.orders.get(id);
        current.mp = { preferenceId: pref.id, createdAt: now() };
        store.orders.save(current);
        return json(200, { url: pref.initPoint });
      });
    }
    if (path === "/api/mp/webhook" && method === "POST") {
      const paymentId =
        body?.data?.id || query.get("data.id") || query.get("id");
      if (!paymentId || (body?.type && body.type !== "payment"))
        return json(200, { ignored: true });
      const pmt = await fetchPayment(paymentId).catch(() => null);
      if (!pmt?.orderId) return json(200, { ignored: true });
      await withOrderLock(pmt.orderId, async () => {
        const o = store.orders.get(pmt.orderId);
        if (
          o &&
          pmt.approved &&
          !o.paid &&
          Math.abs(pmt.amount - o.total) < 1
        ) {
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
      });
      return json(200, { ok: true });
    }

    // ---- Clientes (equipo) ----
    if (path === "/api/customers" && method === "GET") {
      if (!isStaff(session)) fail(403, "Solo el equipo.");
      const prices = store.prices.all();
      const mine = servedBy(session);
      const list = store.customers.all().map((c) => ({
        ...withSummary(c),
        prices: prices[c.phone] || {},
        ...(session.role === "repartidor" ? { mine: !!mine(c) } : {}),
      }));
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
      if (!c || !driverServes(session)) fail(404, "Cliente no encontrado.");
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

    // ---- Cierre de caja (solo administración) ----
    if (path === "/api/closures" && method === "GET") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      const date = query.get("date");
      return json(
        200,
        date && /^\d{4}-\d{2}-\d{2}$/.test(date)
          ? store.closures.forDate(date)
          : store.closures.recent(),
      );
    }
    if (path === "/api/closures" && method === "POST") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      const date = str(body.date, { min: 10, max: 10, name: "la fecha" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, "Fecha inválida.");
      const driver = oneOf(body.driver, config.drivers, "repartidor");
      const money = (v, name) => num(v ?? 0, { min: 0, max: 100000000, name });
      const closure = store.closures.save({
        date,
        driver,
        expected: money(body.expected, "esperado"),
        received: money(body.received, "recibido"),
        transfers: money(body.transfers, "transferencias"),
        accountCash: money(body.accountCash, "cobros a cuenta"),
        note: str(body.note, { max: 300, name: "nota", optional: true }),
        by: actorOf(session),
      });
      store.audit.log(session, "cash.close", "closure", `${date}/${driver}`, {
        expected: closure.expected,
        received: closure.received,
        difference:
          Math.round((closure.received - closure.expected) * 100) / 100,
      });
      return json(201, closure);
    }

    // ---- Usuarios del equipo (solo administración) ----
    if (path === "/api/staff" && method === "GET") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      return json(200, store.staff.all());
    }
    if (path === "/api/staff" && method === "POST") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      const username = str(body.username, {
        min: 2,
        max: 40,
        name: "el usuario",
        pattern: /^[a-z0-9._-]+$/i,
      }).toLowerCase();
      const name = str(body.name, { min: 2, max: 80, name: "el nombre" });
      const role = oneOf(body.role, ["admin", "repartidor"], "rol");
      const driver =
        role === "repartidor"
          ? oneOf(body.driver, config.drivers, "repartidor")
          : null;
      if (!passwordOk(body.password))
        fail(400, "La contraseña debe tener al menos 8 caracteres.");
      if (store.staff.byUsername(username)) fail(409, "Ese usuario ya existe.");
      const user = store.staff.create({
        username,
        name,
        role,
        driver,
        passwordHash: await hashPassword(body.password),
      });
      store.audit.log(session, "staff.create", "staff", String(user.id), {
        username,
        role,
        driver,
      });
      return json(201, { ...user, password_hash: undefined, active: true });
    }
    if (path.startsWith("/api/staff/") && method === "PATCH") {
      if (session?.role !== "admin") fail(403, "Solo administración.");
      const id = Number(path.split("/")[3]);
      const user = store.staff.get(id);
      if (!user) fail(404, "Usuario no encontrado.");
      const role =
        body.role !== undefined
          ? oneOf(body.role, ["admin", "repartidor"], "rol")
          : user.role;
      const active =
        body.active !== undefined ? bool(body.active, "activo") : !!user.active;
      if (user.id === session.staffId && (!active || role !== "admin"))
        fail(400, "No podés desactivar ni degradar tu propio usuario.");
      const driver =
        role === "repartidor"
          ? oneOf(body.driver ?? user.driver, config.drivers, "repartidor")
          : null;
      const name =
        body.name !== undefined
          ? str(body.name, { min: 2, max: 80, name: "el nombre" })
          : user.name;
      let passwordHash = null;
      if (body.password !== undefined) {
        if (!passwordOk(body.password))
          fail(400, "La contraseña debe tener al menos 8 caracteres.");
        passwordHash = await hashPassword(body.password);
      }
      const permissionsChanged =
        !active ||
        !!passwordHash ||
        role !== user.role ||
        (driver || null) !== (user.driver || null);
      store.staff.update(id, { name, role, driver, active, passwordHash });
      if (permissionsChanged) store.sessions.deleteFor({ staffId: id });
      store.audit.log(session, "staff.update", "staff", String(id), {
        role,
        driver,
        active,
        password: !!passwordHash,
      });
      return json(200, {
        ...store.staff.get(id),
        password_hash: undefined,
        active,
      });
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
          name:
            session.role === "admin"
              ? session.name || business.adminName
              : session.driver,
        },
        text,
      );
      events.messageAdded(message, thread.slice(11));
      if (session.role === "admin")
        notifyDriver(thread.slice(11), {
          title: `${session.name}: ${text.slice(0, 60)}`,
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
    (session.role === "cliente" &&
      ((!!session.phone && o.customer === session.phone) ||
        (!!session.accountId && o.accountId === session.accountId) ||
        o.sessionId === session.id));
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
    newsChanged() {
      for (const c of clients)
        if (c.session.role === "admin" || c.session.role === "repartidor")
          send(c, "news", { at: now() });
    },
    fleetChanged(trip) {
      for (const c of clients)
        if (c.session.role === "admin" || c.session.role === "repartidor")
          send(c, "fleet", { id: trip.id, date: trip.date });
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
