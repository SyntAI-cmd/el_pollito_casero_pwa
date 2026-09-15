import { randomUUID } from "node:crypto";
import { fail } from "./errors.mjs";
import { str, num, bool } from "./validate.mjs";

/**
 * Flota: vehículos (Toyota Hino A7234…), salidas del día (vehículo + preventistas + hora de
 * salida) y ubicación en vivo del camión para administración.
 *
 * Los pedidos siguen asignados a un preventista (`order.driver`, que manda en cobros y rendición);
 * la salida agrupa a los preventistas que van en un mismo vehículo ese día.
 *
 * Es un tercer enrutador: `createApi` lo consulta después del de piso.
 */
const now = () => new Date().toISOString();
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const TRACK_KEEP = 600; // puntos de recorrido por salida (≈ 5 h a un punto cada 30 s)

export function createFleet({ store, events, isStaff, actorOf, driverNames }) {
  const staffOnly = (session) => {
    if (!isStaff(session)) fail(403, "Solo el equipo.");
  };
  const adminOnly = (session) => {
    if (session?.role !== "admin") fail(403, "Solo administración.");
  };
  const vehicleOr404 = (id) => {
    const v = store.vehicles.get(id);
    if (!v) fail(404, "Vehículo no encontrado.");
    return v;
  };
  const tripOr404 = (id) => {
    const t = store.trips.get(id);
    if (!t) fail(404, "Salida no encontrada.");
    return t;
  };
  const inTrip = (session, trip) =>
    session.role === "admin" ||
    (session.role === "repartidor" && trip.drivers.includes(session.driver));
  const withLive = (trip) => ({
    ...trip,
    vehicle: store.vehicles.get(trip.vehicleId) || null,
    last: store.trips.lastPosition(trip.id),
  });

  return async function handle({ method, path, body, query, session }) {
    const json = (status, b, extra = {}) => ({ status, body: b, ...extra });

    // ---- Vehículos ----
    if (path === "/api/vehicles" && method === "GET") {
      staffOnly(session);
      const all = store.vehicles.all();
      return json(
        200,
        session.role === "admin" ? all : all.filter((v) => v.active),
      );
    }
    if (path === "/api/vehicles" && method === "POST") {
      adminOnly(session);
      const name = str(body.name, { min: 2, max: 60, name: "el vehículo" });
      const plate = str(body.plate, {
        max: 12,
        name: "la patente",
        optional: true,
      })
        .toUpperCase()
        .replace(/\s+/g, " ");
      const note = str(body.note, {
        max: 60,
        name: "la descripción",
        optional: true,
      });
      const v = store.vehicles.save({
        id: randomUUID().slice(0, 8),
        name,
        plate,
        note,
        active: true,
        sort: store.vehicles.all().length,
        created: now(),
      });
      store.audit.log(session, "vehicle.create", "vehicle", v.id, {
        name,
        plate,
      });
      return json(201, v);
    }
    const vehicleOne = path.match(/^\/api\/vehicles\/([^/]+)$/);
    if (vehicleOne && method === "PATCH") {
      adminOnly(session);
      const v = vehicleOr404(decodeURIComponent(vehicleOne[1]));
      const next = {
        ...v,
        ...(body.name !== undefined
          ? { name: str(body.name, { min: 2, max: 60, name: "el vehículo" }) }
          : {}),
        ...(body.plate !== undefined
          ? {
              plate: str(body.plate, {
                max: 12,
                name: "la patente",
                optional: true,
              })
                .toUpperCase()
                .replace(/\s+/g, " "),
            }
          : {}),
        ...(body.active !== undefined
          ? { active: bool(body.active, "activo") }
          : {}),
        ...(body.note !== undefined
          ? {
              note: str(body.note, {
                max: 60,
                name: "la descripción",
                optional: true,
              }),
            }
          : {}),
      };
      store.vehicles.save(next);
      store.audit.log(session, "vehicle.update", "vehicle", v.id, body);
      return json(200, next);
    }

    // ---- Salidas del día: vehículo + preventistas + hora ----
    if (path === "/api/salidas" && method === "GET") {
      staffOnly(session);
      const date = query.get("fecha");
      if (!date || !dateRe.test(date))
        fail(400, "Indicá la fecha (AAAA-MM-DD).");
      return json(200, store.trips.forDate(date).map(withLive));
    }
    if (path === "/api/salidas" && method === "PUT") {
      staffOnly(session);
      const date = str(body.date, { min: 10, max: 10, name: "la fecha" });
      if (!dateRe.test(date)) fail(400, "Fecha inválida.");
      const vehicle = vehicleOr404(
        str(body.vehicleId, { min: 1, max: 20, name: "el vehículo" }),
      );
      if (!vehicle.active) fail(400, "Ese vehículo está dado de baja.");
      const names = driverNames();
      const drivers = Array.isArray(body.drivers)
        ? [
            ...new Set(
              body.drivers.map((d) =>
                str(d, { min: 1, max: 60, name: "preventista" }),
              ),
            ),
          ]
        : null;
      if (drivers && drivers.some((d) => !names.includes(d)))
        fail(400, "Hay un preventista que no existe.");
      if (drivers && drivers.length > 2)
        fail(400, "Cada vehículo sale con dos preventistas como máximo.");
      const departure =
        body.departure === undefined
          ? undefined
          : body.departure === "" || body.departure === null
            ? ""
            : str(body.departure, {
                min: 5,
                max: 5,
                name: "la hora de salida",
              });
      if (departure && !timeRe.test(departure))
        fail(400, "Hora de salida inválida (HH:MM).");
      const existing = store.trips
        .forDate(date)
        .find((t) => t.vehicleId === vehicle.id);
      // Un preventista puede armar su salida (sumarse a un vehículo); el resto lo edita administración.
      if (
        session.role === "repartidor" &&
        existing &&
        !inTrip(session, existing) &&
        !(drivers || []).includes(session.driver)
      )
        fail(403, "Esa salida es de otro camión.");
      const trip = store.trips.save({
        id: existing?.id || randomUUID().slice(0, 10),
        date,
        vehicleId: vehicle.id,
        drivers: drivers ?? existing?.drivers ?? [],
        departure:
          departure === undefined ? existing?.departure || "" : departure,
        departedAt: existing?.departedAt || null,
        created: existing?.created || now(),
        updated: now(),
      });
      // Un preventista va en un solo vehículo por día.
      for (const other of store.trips.forDate(date))
        if (
          other.id !== trip.id &&
          other.drivers.some((d) => trip.drivers.includes(d))
        )
          store.trips.save({
            ...other,
            drivers: other.drivers.filter((d) => !trip.drivers.includes(d)),
            updated: now(),
          });
      store.audit.log(
        session,
        existing ? "trip.update" : "trip.create",
        "trip",
        trip.id,
        {
          date,
          vehicle: vehicle.name,
          drivers: trip.drivers,
          departure: trip.departure,
        },
      );
      events.fleetChanged?.(trip);
      return json(existing ? 200 : 201, withLive(trip));
    }
    const tripOne = path.match(
      /^\/api\/salidas\/([^/]+)(?:\/(ubicacion|recorrido|salir))?$/,
    );
    if (tripOne) {
      staffOnly(session);
      const trip = tripOr404(decodeURIComponent(tripOne[1]));
      const sub = tripOne[2];
      if (!sub && method === "DELETE") {
        adminOnly(session);
        store.trips.remove(trip.id);
        store.audit.log(session, "trip.delete", "trip", trip.id, {
          date: trip.date,
        });
        events.fleetChanged?.(trip);
        return json(200, { ok: true });
      }
      if (sub === "ubicacion" && method === "POST") {
        if (!inTrip(session, trip)) fail(403, "No vas en ese camión.");
        const lat = num(body.lat, { min: -90, max: 90, name: "la latitud" });
        const lng = num(body.lng, { min: -180, max: 180, name: "la longitud" });
        const speed = num(body.speed, {
          min: 0,
          max: 300,
          name: "la velocidad",
          optional: true,
        });
        const heading = num(body.heading, {
          min: 0,
          max: 360,
          name: "el rumbo",
          optional: true,
        });
        store.trips.addPosition(trip.id, {
          lat,
          lng,
          speed: speed ?? null,
          heading: heading ?? null,
          by: actorOf(session),
          at: now(),
        });
        if (!trip.departedAt)
          store.trips.save({ ...trip, departedAt: now(), updated: now() });
        events.fleetChanged?.(trip);
        return json(200, { ok: true, at: now() });
      }
      if (sub === "recorrido" && method === "GET") {
        if (!inTrip(session, trip)) fail(403, "No vas en ese camión.");
        return json(200, {
          ...withLive(trip),
          track: store.trips.track(trip.id),
        });
      }
      if (sub === "salir" && method === "POST") {
        if (!inTrip(session, trip)) fail(403, "No vas en ese camión.");
        const t = { ...trip, departedAt: now(), updated: now() };
        store.trips.save(t);
        events.fleetChanged?.(t);
        return json(200, withLive(t));
      }
      return null;
    }
    return null;
  };
}

export const tripTrackKeep = TRACK_KEEP;
