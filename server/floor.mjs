import { randomUUID } from "node:crypto";
import {
  products,
  localities,
  plans,
  shifts,
  priceOrder,
  normalizePhone,
  lineAmount,
  defaultTare,
  validateLists,
  accountSummary,
  remitoNumber,
} from "../domain.mjs";
import { fail } from "./errors.mjs";
import { readFile } from "node:fs/promises";

/** Logo tipográfico para el Excel: en producción vive en dist/brand, en desarrollo en public/brand. */
let logoCache;
async function brandLogo() {
  if (logoCache === undefined) {
    logoCache = null;
    for (const p of [
      "dist/brand/logo-texto.png",
      "public/brand/logo-texto.png",
    ]) {
      try {
        logoCache = await readFile(p);
        break;
      } catch {}
    }
  }
  return logoCache;
}
import { str, num, oneOf, bool } from "./validate.mjs";

/**
 * Módulo de piso (administración y reparto): fichas de clientes al estilo GC, precios propios por
 * cliente, repartidores con zonas y turno, pedidos de reparto por cajas, pesada por cajón con tara,
 * carga del camión, noticias del día, ajustes y export del consolidado.
 *
 * Es un segundo enrutador: `createApi` lo consulta primero y, si devuelve null, sigue con sus rutas.
 */
const now = () => new Date().toISOString();
const round2 = (n) => Math.round(n * 100) / 100;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const slug = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Campos de la ficha que administración puede editar. */
const FICHA = {
  name: (v) => str(v, { min: 2, max: 100, name: "el nombre" }),
  alias: (v) => str(v, { max: 80, name: "el apodo", optional: true }),
  legalName: (v) =>
    str(v, { max: 120, name: "la razón social", optional: true }),
  cuit: (v) => {
    const d = String(v || "").replace(/\D/g, "");
    if (d && d.length !== 11) fail(400, "El CUIT tiene 11 dígitos.");
    return d;
  },
  code: (v) => str(v, { max: 30, name: "el código GC", optional: true }),
  branch: (v) => str(v, { max: 80, name: "la sucursal", optional: true }),
  parent: (v) =>
    str(v, { max: 80, name: "el cliente principal", optional: true }),
  zone: (v) => str(v, { max: 60, name: "la zona", optional: true }),
  shift: (v) => (v ? oneOf(v, shifts, "turno") : ""),
  truck: (v) => str(v, { max: 60, name: "el camión", optional: true }),
  contactPhone: (v) => {
    const raw = str(v, { max: 40, name: "el teléfono", optional: true });
    if (!raw) return "";
    const n = normalizePhone(raw);
    if (!n)
      fail(400, "Teléfono inválido: código de área + número, sin 0 ni 15.");
    return n;
  },
  address: (v) => str(v, { max: 250, name: "la dirección", optional: true }),
  localityId: (v) => {
    if (!v) return "";
    if (!localities.some((l) => l.id === v)) fail(400, "Localidad inválida.");
    return v;
  },
  notes: (v) => str(v, { max: 500, name: "las notas", optional: true }),
  status: (v) =>
    v ? oneOf(v, ["ok", "incompleto", "revisar", "inactivo"], "estado") : "ok",
  plan: (v) => (v ? oneOf(v, plans, "modalidad") : "mayorista"),
  credit: (v) => bool(v, "crédito"),
  driver: (v) =>
    str(v, { max: 60, name: "el repartidor habitual", optional: true }),
};

export function createFloor({
  store,
  events,
  config,
  isStaff,
  actorOf,
  view,
  withOrderLock,
  driverNames,
}) {
  const tare = () =>
    Number(store.settings.get("tare", defaultTare)) || defaultTare;
  const staffOnly = (session) => {
    if (!isStaff(session)) fail(403, "Solo el equipo.");
  };
  const adminOnly = (session) => {
    if (session?.role !== "admin") fail(403, "Solo administración.");
  };
  const customerByKey = (key) => {
    const c = store.customers.get(key);
    if (!c) fail(404, "Cliente no encontrado.");
    return c;
  };
  const summarize = (c) => ({
    ...c,
    prices: Object.fromEntries(
      store.prices.forCustomer(c.phone).map((p) => [p.productId, p.price]),
    ),
  });

  /** Pedido de reparto cargado por el equipo: por cajas y/o kilos, con el precio propio del cliente. */
  function createTeamOrder(b, session) {
    const customer = customerByKey(
      str(b.customer, { min: 1, max: 80, name: "el cliente" }),
    );
    const key = `${customer.phone}:${str(b.key, { min: 1, max: 80, name: "identificador" })}`;
    const previous = store.orders.byKey(key);
    if (previous) return { order: previous, created: false };
    const prices = Object.fromEntries(
      store.prices
        .forCustomer(customer.phone)
        .map((p) => [p.productId, p.price]),
    );
    const deliveryDate = str(b.deliveryDate, {
      min: 10,
      max: 10,
      name: "la fecha de reparto",
    });
    if (!dateRe.test(deliveryDate)) fail(400, "Fecha de reparto inválida.");
    const shift = b.shift
      ? oneOf(b.shift, shifts, "turno")
      : customer.shift || "";
    const driver = b.driver
      ? oneOf(b.driver, driverNames(), "repartidor")
      : driverNames().includes(customer.truck || customer.driver)
        ? customer.truck || customer.driver
        : "";
    const plan = plans.includes(b.plan) ? b.plan : customer.plan || "mayorista";
    const payment = b.payment
      ? oneOf(b.payment, ["cuenta", "entrega", "transferencia"], "medio")
      : customer.credit
        ? "cuenta"
        : "entrega";
    if (payment === "cuenta" && !customer.credit)
      fail(400, "Este cliente no tiene cuenta corriente habilitada.");
    const locality = localities.find((l) => l.id === customer.localityId) || {
      id: customer.localityId || "otra",
      name: customer.zone || "Sin localidad",
      postalCode: "",
      province: "Mendoza",
      country: "Argentina",
    };
    const priced = priceOrder(
      {
        plan,
        payment,
        items: b.items,
        address: customer.address || "Sin dirección cargada",
        name: customer.name,
        phone: customer.contactPhone ? customer.contactPhone : "",
        localityId: locality.id,
      },
      {
        enforceMin: false,
        prices,
        staff: true,
        locality,
        lists: store.settings.get("priceLists", null),
      },
    );
    return store.transaction(() => {
      const o = {
        ...priced,
        locality,
        id: "PC-" + randomUUID().slice(0, 8).toUpperCase(),
        key,
        customer: customer.phone,
        name: customer.alias ? `${customer.name}` : customer.name,
        phone: customer.contactPhone || "",
        address: customer.address || "",
        notes: str(b.notes, { max: 500, name: "las notas", optional: true }),
        plan,
        payment,
        paid: false,
        status: "recibido",
        driver,
        deliveryDate,
        shift,
        boxes: 0,
        returned: 0,
        created: now(),
        createdBy:
          session.role === "admin" ? "admin" : `preventista:${session.driver}`,
        history: [{ status: "recibido", at: now() }],
        destination: null,
      };
      if (customer.location)
        o.destination = {
          ...customer.location,
          precise: true,
          source: "ficha",
        };
      store.orders.save(o);
      store.audit.log(session, "order.create", "order", o.id, {
        total: o.total,
        deliveryDate,
        shift,
        boxes: o.items.reduce((s, i) => s + (i.boxes || 0), 0),
      });
      return { order: o, created: true };
    });
  }

  /** Recalcula kilos e importes de un pedido a partir de sus cajones vigentes. */
  function applyCrates(o, session) {
    const crates = store.crates.forOrder(o.id).filter((c) => !c.voided);
    // La primera pesada saca el pedido de "recibido": ya está en preparación.
    if (crates.length && o.status === "recibido") {
      o.status = "preparando";
      o.history = [...(o.history || []), { status: "preparando", at: now() }];
    }
    const before = Math.round(o.total * 100);
    const byProduct = {};
    for (const c of crates)
      byProduct[c.productId] = (byProduct[c.productId] || 0) + c.net;
    o.items = o.items.map((i) =>
      i.id in byProduct
        ? {
            ...i,
            ordered: i.ordered ?? i.kg,
            kg: round2(byProduct[i.id]),
            lineTotal: lineAmount(i.price, round2(byProduct[i.id])),
            weighed: true,
          }
        : i,
    );
    o.subtotal =
      o.items.reduce((n, p) => n + Math.round(p.lineTotal * 100), 0) / 100;
    o.total =
      (Math.round(o.subtotal * 100) + Math.round((o.shipping || 0) * 100)) /
      100;
    o.weighed = crates.length > 0;
    o.weighedAt = now();
    o.weighedBy = actorOf(session);
    const diff = Math.round(o.total * 100) - before;
    // Pedido a cuenta ya saldado: la diferencia queda como deuda o saldo a favor.
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
        events.customerChanged(customer);
      }
    }
    store.orders.save(o);
    events.orderChanged(o);
    return o;
  }
  const withCrates = (o, session) => ({
    ...view(o, session),
    crates: store.crates.forOrder(o.id),
  });

  return async function floor({ method, path, body, query, session }) {
    const json = (status, b, extra = {}) => ({ status, body: b, ...extra });

    // ---- Pedido de reparto (equipo, por clave de cliente) ----
    if (
      path === "/api/orders" &&
      method === "POST" &&
      isStaff(session) &&
      body.customer
    ) {
      const { order, created } = createTeamOrder(body, session);
      if (created) events.orderChanged(order);
      return json(created ? 201 : 200, withCrates(order, session));
    }

    // ---- Fichas de clientes ----
    if (path === "/api/customers" && method === "POST") {
      staffOnly(session);
      const name = FICHA.name(body.name);
      const contactPhone = FICHA.contactPhone(body.contactPhone || body.phone);
      const cuit = FICHA.cuit(body.cuit);
      const key =
        contactPhone && !store.customers.get(contactPhone)
          ? contactPhone
          : "n-" + randomUUID().slice(0, 8);
      const c = store.customers.save({
        phone: key,
        name,
        alias: FICHA.alias(body.alias) || name,
        legalName: FICHA.legalName(body.legalName),
        cuit,
        contactPhone,
        zone: FICHA.zone(body.zone),
        shift: FICHA.shift(body.shift),
        truck: FICHA.truck(body.truck),
        driver: FICHA.truck(body.truck),
        address: FICHA.address(body.address),
        localityId: FICHA.localityId(body.localityId),
        notes: FICHA.notes(body.notes),
        plan: FICHA.plan(body.plan),
        credit: body.credit === undefined ? true : bool(body.credit, "crédito"),
        creditBalance: 0,
        status: cuit ? "ok" : "incompleto",
        created: now(),
      });
      store.audit.log(session, "customer.create", "customer", key, {
        name,
        cuit: !!cuit,
      });
      events.customerChanged(c);
      return json(201, summarize(c));
    }
    const ficha = path.match(/^\/api\/customers\/([^/]+)\/(ficha|prices)$/);
    if (ficha) {
      staffOnly(session);
      const c = customerByKey(decodeURIComponent(ficha[1]));
      if (ficha[2] === "ficha" && method === "PATCH") {
        adminOnly(session);
        const changes = {};
        for (const [k, parse] of Object.entries(FICHA))
          if (body[k] !== undefined) changes[k] = parse(body[k]);
        if (changes.truck !== undefined) changes.driver = changes.truck;
        if (changes.cuit && !changes.status && c.status === "incompleto")
          changes.status = "ok";
        Object.assign(c, changes);
        store.customers.save(c);
        store.audit.log(
          session,
          "customer.ficha",
          "customer",
          c.phone,
          Object.keys(changes),
        );
        events.customerChanged(c);
        return json(200, summarize(c));
      }
      if (ficha[2] === "prices" && method === "GET")
        return json(200, summarize(c).prices);
      if (ficha[2] === "prices" && method === "PUT") {
        adminOnly(session);
        const prices =
          body.prices && typeof body.prices === "object" ? body.prices : {};
        store.transaction(() => {
          for (const [productId, price] of Object.entries(prices)) {
            if (!products.some((p) => p.id === productId))
              fail(400, "Producto inválido: " + productId);
            const value =
              price === null || price === ""
                ? null
                : num(price, { min: 0, max: 1000000, name: "el precio" });
            store.prices.set(c.phone, productId, value, actorOf(session));
          }
        });
        store.audit.log(
          session,
          "customer.prices",
          "customer",
          c.phone,
          prices,
        );
        events.customerChanged(c);
        return json(200, summarize(c).prices);
      }
    }

    // ---- Repartidores / camiones ----
    if (path === "/api/drivers" && method === "GET") {
      staffOnly(session);
      return json(200, store.drivers.all());
    }
    if (path === "/api/drivers" && method === "POST") {
      adminOnly(session);
      const name = str(body.name, { min: 2, max: 60, name: "el nombre" });
      if (store.drivers.get(name))
        fail(409, "Ya existe un repartidor con ese nombre.");
      store.drivers.save({
        name,
        phone: body.phone
          ? normalizePhone(body.phone) || fail(400, "Teléfono inválido.")
          : "",
        cuit: String(body.cuit || "").replace(/\D/g, ""),
        zones: Array.isArray(body.zones)
          ? body.zones.map((z) => String(z).slice(0, 60)).slice(0, 40)
          : [],
        shift: body.shift ? oneOf(body.shift, shifts, "turno") : "",
        active: true,
        sort: store.drivers.all().length + 1,
      });
      store.audit.log(session, "driver.create", "driver", name);
      return json(201, store.drivers.get(name));
    }
    const drv = path.match(/^\/api\/drivers\/([^/]+)$/);
    if (drv && method === "PATCH") {
      adminOnly(session);
      const d = store.drivers.get(decodeURIComponent(drv[1]));
      if (!d) fail(404, "Repartidor no encontrado.");
      if (body.phone !== undefined)
        d.phone = body.phone
          ? normalizePhone(body.phone) || fail(400, "Teléfono inválido.")
          : "";
      if (body.cuit !== undefined)
        d.cuit = String(body.cuit || "").replace(/\D/g, "");
      if (body.zones !== undefined)
        d.zones = Array.isArray(body.zones)
          ? body.zones.map((z) => String(z).slice(0, 60)).slice(0, 40)
          : d.zones;
      if (body.shift !== undefined)
        d.shift = body.shift ? oneOf(body.shift, shifts, "turno") : "";
      if (body.active !== undefined) d.active = bool(body.active, "activo");
      if (body.sort !== undefined)
        d.sort = num(body.sort, {
          min: 0,
          max: 999,
          integer: true,
          name: "orden",
        });
      store.drivers.save(d);
      store.audit.log(session, "driver.update", "driver", d.name, body);
      return json(200, store.drivers.get(d.name));
    }

    // ---- Pesada por cajón ----
    const crateAdd = path.match(/^\/api\/orders\/([^/]+)\/crates$/);
    if (crateAdd && method === "POST") {
      staffOnly(session);
      const id = decodeURIComponent(crateAdd[1]);
      return withOrderLock(id, async () => {
        const o = store.orders.get(id);
        if (!o) fail(404, "Pedido no encontrado.");
        if (
          session.role === "repartidor" &&
          o.driver &&
          o.driver !== session.driver
        )
          fail(403, "Ese pedido es de otro camión.");
        if (["entregado", "cancelado"].includes(o.status))
          fail(400, "El pedido ya no admite pesadas.");
        const productId = oneOf(
          body.productId,
          o.items.map((i) => i.id),
          "producto",
        );
        const t =
          body.tare === undefined
            ? tare()
            : num(body.tare, { min: 0, max: 20, name: "la tara" });
        // Pesada por lote: `boxes` cajas juntas con su peso neto total (`net`) o bruto total (`gross`).
        // Sin `boxes` es la pesada clásica de un cajón por su bruto. Hasta 5000 kg por pesada.
        const boxes =
          num(body.boxes, {
            min: 1,
            max: 500,
            integer: true,
            name: "las cajas",
            optional: true,
          }) || 1;
        let gross, netTotal;
        if (body.net !== undefined && body.net !== null && body.net !== "") {
          netTotal = num(body.net, {
            min: 0.05,
            max: 5000,
            name: "el peso neto",
          });
          gross = round2(netTotal + t * boxes);
        } else {
          gross = num(body.gross, {
            min: 0.1,
            max: 5000,
            name: "el peso bruto",
          });
          netTotal = round2(gross - t * boxes);
          if (netTotal <= 0)
            fail(
              400,
              `El bruto (${gross} kg) no supera la tara (${round2(t * boxes)} kg${boxes > 1 ? ` de ${boxes} cajas` : ""}).`,
            );
        }
        const crateId =
          str(body.id, { max: 60, name: "el identificador", optional: true }) ||
          randomUUID();
        // Un cajón por caja del lote, con el neto repartido (el último absorbe el redondeo); los ids
        // derivan del id del lote, así reintentar desde el celular no duplica nada (idempotente).
        const each = round2(netTotal / boxes);
        let inserted = 0;
        for (let i = 0; i < boxes; i++) {
          const net =
            i === boxes - 1 ? round2(netTotal - each * (boxes - 1)) : each;
          inserted += store.crates.add({
            id: boxes === 1 ? crateId : `${crateId}:${i + 1}`,
            orderId: o.id,
            productId,
            gross: round2(net + t),
            tare: t,
            net,
            by: actorOf(session),
          })
            ? 1
            : 0;
        }
        if (inserted) applyCrates(o, session);
        store.audit.log(session, "crate.add", "order", o.id, {
          crateId,
          productId,
          boxes,
          gross,
          net: netTotal,
          duplicate: !inserted,
        });
        return json(
          inserted ? 201 : 200,
          withCrates(store.orders.get(o.id), session),
        );
      });
    }
    const crateOne = path.match(/^\/api\/crates\/([^/]+)(?:\/(load|unload))?$/);
    if (crateOne) {
      staffOnly(session);
      const c = store.crates.get(decodeURIComponent(crateOne[1]));
      if (!c) fail(404, "Cajón no encontrado.");
      return withOrderLock(c.orderId, async () => {
        const o = store.orders.get(c.orderId);
        if (!crateOne[2] && method === "DELETE") {
          if (c.loadedAt)
            fail(
              400,
              "El cajón ya está cargado en el camión: bajalo antes de anularlo.",
            );
          store.crates.void(
            c.id,
            str(body.reason, { max: 200, name: "el motivo", optional: true }),
          );
          applyCrates(o, session);
          store.audit.log(session, "crate.void", "order", o.id, {
            crateId: c.id,
            net: c.net,
            reason: body.reason,
          });
          return json(200, withCrates(store.orders.get(o.id), session));
        }
        if (crateOne[2] === "load" && method === "POST") {
          if (c.voided) fail(400, "Ese cajón está anulado.");
          store.crates.load(c.id, actorOf(session));
          events.orderChanged(o);
          return json(200, withCrates(o, session));
        }
        if (crateOne[2] === "unload" && method === "POST") {
          store.crates.unload(c.id);
          events.orderChanged(o);
          return json(200, withCrates(o, session));
        }
        return null;
      });
    }

    // ---- Nota del día: pedidos de una fecha con sus cajones ----
    if (path === "/api/dia" && method === "GET") {
      staffOnly(session);
      const date = query.get("fecha");
      if (!date || !dateRe.test(date))
        fail(400, "Indicá la fecha (AAAA-MM-DD).");
      let orders = store.orders
        .forDate(date)
        .filter((o) => o.status !== "cancelado");
      if (session.role === "repartidor")
        orders = orders.filter((o) => o.driver === session.driver);
      return json(200, {
        date,
        tare: tare(),
        orders: orders.map((o) => withCrates(o, session)),
      });
    }

    // ---- Cierre del camión: todo lo pesado de ese camión y fecha sale a reparto ----
    if (path === "/api/dia/cerrar-camion" && method === "POST") {
      staffOnly(session);
      const date = str(body.date, { min: 10, max: 10, name: "la fecha" });
      if (!dateRe.test(date)) fail(400, "Fecha inválida.");
      const driver = oneOf(body.driver, driverNames(), "repartidor");
      if (session.role === "repartidor" && session.driver !== driver)
        fail(403, "Solo podés cerrar tu camión.");
      const reason = str(body.reason, {
        max: 300,
        name: "el motivo",
        optional: true,
      });
      const orders = store.orders
        .forDate(date)
        .filter(
          (o) =>
            o.driver === driver &&
            ["recibido", "preparando"].includes(o.status),
        );
      if (!orders.length)
        fail(400, "No hay pedidos pendientes de salir para ese camión.");
      const missing = [];
      for (const o of orders) {
        const crates = store.crates.forOrder(o.id).filter((c) => !c.voided);
        const expected = o.items.reduce((n, i) => n + (i.boxes || 0), 0);
        const weighedKgItems = o.items
          .filter((i) => !i.boxes)
          .every((i) => crates.some((c) => c.productId === i.id));
        const loaded = crates.filter((c) => c.loadedAt).length;
        if (
          !crates.length ||
          crates.length < expected ||
          !weighedKgItems ||
          loaded < crates.length
        )
          missing.push({
            id: o.id,
            name: o.name,
            crates: crates.length,
            expected,
            loaded,
          });
      }
      if (missing.length && !reason)
        return json(409, {
          error:
            "Faltan cajones por pesar o cargar. Indicá el motivo para cerrar igual.",
          missing,
        });
      const departed = [];
      for (const o of orders) {
        await withOrderLock(o.id, async () => {
          const current = store.orders.get(o.id);
          if (current.status === "recibido") {
            current.status = "preparando";
            current.history.push({ status: "preparando", at: now() });
          }
          current.status = "en_camino";
          current.history.push({ status: "en_camino", at: now() });
          current.departedAt = now();
          if (reason) current.loadNote = reason;
          store.orders.save(current);
          events.orderChanged(current);
          departed.push(current.id);
        });
      }
      store.audit.log(session, "truck.close", "truck", `${date}/${driver}`, {
        departed,
        missing,
        reason,
      });
      return json(200, { departed, missing });
    }

    // ---- Noticias del día ----
    if (path === "/api/news" && method === "GET") {
      staffOnly(session);
      return json(200, store.news.list(Number(query.get("limit")) || 50));
    }
    if (path === "/api/news" && method === "POST") {
      staffOnly(session);
      const text = str(body.text, { min: 1, max: 1000, name: "la noticia" });
      const id = store.news.add(
        text,
        actorOf(session),
        session.role === "admin" && !!body.pinned,
      );
      events.newsChanged?.();
      return json(
        201,
        store.news.list(50).find((n) => n.id === id),
      );
    }
    const newsOne = path.match(/^\/api\/news\/(\d+)$/);
    if (newsOne && method === "PATCH") {
      adminOnly(session);
      store.news.update(Number(newsOne[1]), {
        pinned:
          body.pinned === undefined ? undefined : bool(body.pinned, "fijada"),
        archived:
          body.archived === undefined
            ? undefined
            : bool(body.archived, "archivada"),
      });
      events.newsChanged?.();
      return json(200, { ok: true });
    }
    if (newsOne && method === "DELETE") {
      adminOnly(session);
      const id = Number(newsOne[1]);
      if (!store.news.remove(id)) fail(404, "La noticia no existe.");
      store.audit.log(session, "news.delete", "news", String(id));
      events.newsChanged?.();
      return json(200, { ok: true });
    }

    // ---- Listas de precios (mayorista / intermedio / minorista), editables desde Administración ----
    if (path === "/api/precios/listas" && method === "GET") {
      staffOnly(session);
      return json(200, {
        lists: store.settings.get("priceLists", null) || {},
        products: config.products,
      });
    }
    if (path === "/api/precios/listas" && method === "PUT") {
      adminOnly(session);
      const lists = validateLists(body.lists);
      store.settings.set("priceLists", lists);
      store.audit.log(
        session,
        "settings.priceLists",
        "settings",
        "priceLists",
        { lists },
      );
      return json(200, { lists, products: config.products });
    }

    // ---- Ajustes ----
    if (path === "/api/settings" && method === "PATCH") {
      adminOnly(session);
      if (body.tare !== undefined) {
        store.settings.set(
          "tare",
          num(body.tare, { min: 0, max: 20, name: "la tara" }),
        );
        store.audit.log(session, "settings.tare", "settings", "tare", {
          tare: body.tare,
        });
      }
      return json(200, { tare: tare() });
    }

    // ---- Consolidado del día en Excel (misma estética que la planilla de facturación) ----
    if (path === "/api/export/consolidado" && method === "GET") {
      adminOnly(session);
      const date = query.get("fecha");
      if (!date || !dateRe.test(date))
        fail(400, "Indicá la fecha (AAAA-MM-DD).");
      const driverFilter = query.get("repartidor") || "";
      const { default: ExcelJS } = await import("exceljs");
      const RED = "FFA81A1A",
        BLACK = "FF141416",
        ZEBRA = "FFF2F2F2",
        GOLD = "FFE5AF1E",
        GRID = "FFBFBFBF";
      const thin = { style: "thin", color: { argb: GRID } };
      const rowBorder = { top: thin, bottom: thin };
      const font = (o = {}) => ({ name: "Arial", size: 10, ...o });
      const fill = (argb) => ({
        type: "pattern",
        pattern: "solid",
        fgColor: { argb },
      });
      const wb = new ExcelJS.Workbook();
      wb.creator = "El Pollito Casero";
      const ws = wb.addWorksheet("Consolidado", {
        views: [{ showGridLines: false, state: "frozen", ySplit: 4 }],
        pageSetup: {
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        },
      });
      const cols = [
        ["N° Pedido", 16],
        ["Cliente", 26],
        ["CUIT", 14],
        ["Detalle", 40],
        ["Cajones", 9],
        ["Kilos", 13],
        ["Saldo", 15],
        ["Cajas adeudadas", 12],
        ["Total", 16],
        ["", 3],
        ["", 22],
        ["", 16],
      ];
      cols.forEach(([, w], i) => (ws.getColumn(i + 1).width = w));
      const last = cols.length - 3; // I
      const dmy = date.split("-").reverse().join("/");
      // Fila 1: logo tipográfico a la izquierda y, si no hay logo, el nombre en texto.
      ws.mergeCells(1, 1, 1, last);
      ws.getRow(1).height = 60;
      const logo = await brandLogo();
      if (logo) {
        const id = wb.addImage({ buffer: logo, extension: "png" });
        ws.addImage(id, {
          tl: { col: 0.15, row: 0.1 },
          ext: { width: 232, height: 70 },
          editAs: "oneCell",
        });
      }
      ws.getCell("A1").value = logo ? "" : "EL POLLITO CASERO";
      ws.getCell("A1").font = font({
        size: 20,
        bold: true,
        color: { argb: RED },
      });
      ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      ws.mergeCells(2, 1, 2, last);
      ws.getCell("A2").value =
        `Consolidado del reparto  ·  Fecha: ${dmy}${driverFilter ? "  ·  Preventista: " + driverFilter : ""}  ·  Un renglón por pedido`;
      ws.getCell("A2").font = font({ bold: true, color: { argb: "FFFFFFFF" } });
      ws.getCell("A2").fill = fill(BLACK);
      ws.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(2).height = 21.75;
      ws.getRow(3).height = 7.5;
      const head = ws.getRow(4);
      cols.slice(0, last).forEach(([name], i) => {
        const c = head.getCell(i + 1);
        c.value = name;
        c.font = font({ bold: true, color: { argb: "FFFFFFFF" } });
        c.fill = fill(BLACK);
        c.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
        c.border = rowBorder;
      });
      head.height = 24;
      let orders = store.orders
        .forDate(date)
        .filter((o) => o.status !== "cancelado");
      if (driverFilter)
        orders = orders.filter((o) => o.driver === driverFilter);
      orders.sort(
        (a, b) =>
          (a.driver || "").localeCompare(b.driver || "") ||
          a.name.localeCompare(b.name),
      );
      const first = 5;
      const lastData = first + Math.max(orders.length, 1) - 1;
      const totalRow = lastData + 1;
      const kgEs = (n) =>
        Number(n).toLocaleString("es-AR", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 2,
        });
      const summaries = new Map();
      const summaryOf = (phone) => {
        if (!summaries.has(phone))
          summaries.set(
            phone,
            accountSummary(
              store.orders.forCustomer(phone),
              store.customers.get(phone) || {},
            ),
          );
        return summaries.get(phone);
      };
      orders.forEach((o, i) => {
        const c = store.customers.get(o.customer) || {};
        const sum = summaryOf(o.customer);
        const r = ws.getRow(first + i);
        const kilos = round2(o.items.reduce((s2, it) => s2 + it.kg, 0));
        // Cajones: solo los de lo pedido por cajas; lo pedido por kilo va como bulto y no cuenta acá.
        const boxed = new Set(
          o.items.filter((it) => it.boxes).map((it) => it.id),
        );
        const crates = store.crates
          .forOrder(o.id)
          .filter((x) => !x.voided && boxed.has(x.productId)).length;
        const values = [
          remitoNumber(o),
          c.alias || o.name,
          c.cuit || "",
          o.items
            .map(
              (it) =>
                `${it.name} ${kgEs(it.kg)} kg${it.boxes ? ` (${it.boxes} cj)` : ""}`,
            )
            .join(" · "),
          crates,
          kilos,
          round2(sum.balance),
          Math.max(0, sum.boxes),
          round2(o.total),
        ];
        values.forEach((v, j) => {
          const cell = r.getCell(j + 1);
          cell.value = v;
          cell.font = font();
          cell.border = rowBorder;
          if (i % 2 === 1) cell.fill = fill(ZEBRA);
        });
        r.getCell(1).alignment = { horizontal: "center" };
        r.getCell(5).numFmt = "0";
        r.getCell(6).numFmt = '#,##0.00" kg"';
        r.getCell(7).numFmt = "\\$#,##0.00";
        r.getCell(8).numFmt = "0";
        r.getCell(9).numFmt = "\\$#,##0.00";
      });
      const t = ws.getRow(totalRow);
      t.height = 21.75;
      const totals = {
        2: `TOTAL (${orders.length} pedidos)`,
        5: { formula: `SUM(E${first}:E${lastData})` },
        6: { formula: `SUM(F${first}:F${lastData})` },
        9: { formula: `SUM(I${first}:I${lastData})` },
      };
      for (let k = 1; k <= last; k++) {
        const cell = t.getCell(k);
        if (totals[k] !== undefined) cell.value = totals[k];
        cell.font = font({ size: 11, bold: true, color: { argb: "FFFFFFFF" } });
        cell.fill = fill(RED);
        cell.border = rowBorder;
      }
      t.getCell(6).numFmt = '#,##0.00" kg"';
      t.getCell(9).numFmt = "\\$#,##0.00";
      // Resumen del día a la derecha, como en la planilla de facturación.
      const M = last + 2,
        N = last + 3;
      ws.mergeCells(4, M, 4, N);
      const rh = ws.getCell(4, M);
      rh.value = "RESUMEN DEL DÍA";
      rh.font = font({ size: 11, bold: true, color: { argb: "FFFFFFFF" } });
      rh.fill = fill(BLACK);
      rh.alignment = { horizontal: "center", vertical: "middle" };
      const summary = [
        ["Pedidos", { formula: `COUNTA(A${first}:A${lastData})` }, "0"],
        ["Clientes", new Set(orders.map((o) => o.customer)).size, "0"],
        ["Cajones", { formula: `E${totalRow}` }, "0"],
        ["Kilos", { formula: `F${totalRow}` }, '#,##0.00" kg"'],
        [
          "Precio por kg",
          { formula: `IF(F${totalRow}=0,0,I${totalRow}/F${totalRow})` },
          "\\$#,##0.00",
        ],
        ["Total del día", { formula: `I${totalRow}` }, "\\$#,##0.00", true],
      ];
      summary.forEach(([label, value, fmt, gold], i) => {
        const a = ws.getCell(first + i, M),
          v = ws.getCell(first + i, N);
        a.value = label;
        a.font = font({ bold: true });
        v.value = value;
        v.font = font({ bold: !!gold });
        v.numFmt = fmt;
        v.alignment = { horizontal: "right" };
        for (const c of [a, v]) {
          c.border = rowBorder;
          if (gold) c.fill = fill(GOLD);
        }
      });
      const note = ws.getCell(first + summary.length + 1, M);
      note.value = `Consolidado del ${dmy}. Saldo = cuenta corriente del cliente al exportar; cajas adeudadas = envases en su poder.`;
      note.font = font({ size: 9, italic: true, color: { argb: "FF666666" } });
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      return {
        status: 200,
        raw: buffer,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="Consolidado_${dmy.replace(/\//g, "-")}_El_Pollito_Casero.xlsx"`,
        },
      };
    }
    return null;
  };
}
