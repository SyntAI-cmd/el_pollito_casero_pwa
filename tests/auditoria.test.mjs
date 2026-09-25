import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.mjs";
import {
  limpiar,
  cambios,
  categoriaDe,
  actorDe,
} from "../server/auditoria.mjs";

/** PC-003 — El historial registra quién, qué cambió y por qué, sin guardar secretos. */

const store = () => openStore(":memory:");

test("el actor sale de la sesión: dos personas con el mismo nombre no se confunden", () => {
  const a = actorDe({ role: "repartidor", staffId: 7, driver: "Franco" });
  const b = actorDe({ role: "repartidor", staffId: 9, driver: "Franco" });
  assert.equal(a.nombre, b.nombre);
  assert.notEqual(a.id, b.id, "el identificador los distingue");
  assert.equal(a.id, "staff:7");
  // Un registro viejo sin sesión no inventa identidad.
  assert.equal(actorDe(null).id, null);
});

test("nunca se guardan contraseñas, tokens ni imágenes", () => {
  const sucio = {
    status: "entregado",
    password: "secreta",
    apiToken: "abc",
    image: "data:image/jpeg;base64,/9j/4AAQ",
    firma: "data:image/png;base64,iVBOR",
    cookie: "sid=1",
    loQueSea: "campo no declarado",
  };
  const limpio = limpiar(sucio);
  assert.deepEqual(limpio, { status: "entregado" });
});

test("solo se guarda lo que cambió, con su antes y su después", () => {
  const d = cambios(
    { balance: 100000, boxes: 10, name: "Cliente" },
    { balance: 90000, boxes: 8, name: "Cliente" },
  );
  assert.deepEqual(d, { balance: [100000, 90000], boxes: [10, 8] });
  assert.equal(cambios({ balance: 1 }, { balance: 1 }), undefined);
});

test("las acciones se agrupan en categorías legibles", () => {
  assert.equal(categoriaDe("customer.saldos"), "Saldos");
  assert.equal(categoriaDe("crate.add"), "Pesadas");
  assert.equal(categoriaDe("order.assign"), "Asignaciones");
  assert.equal(categoriaDe("order.delivered"), "Entregas");
  assert.equal(categoriaDe("order.update"), "Pedidos");
  assert.equal(categoriaDe("document.delete"), "Documentos");
});

test("un reintento de la misma operación no duplica el movimiento", async () => {
  const s = await store();
  const sesion = { role: "admin", staffId: 1, name: "Mauro" };
  for (let i = 0; i < 3; i++)
    s.audit.log(
      sesion,
      "customer.saldos",
      "customer",
      "c-1",
      { delta: -10000 },
      {
        antes: { balance: 100000 },
        despues: { balance: 90000 },
        motivo: "arreglo con el cliente",
        opId: "op-unica",
      },
    );
  const { movimientos } = s.audit.query({ categoria: "Saldos" });
  assert.equal(movimientos.length, 1, "una sola vez pese a tres intentos");
  assert.deepEqual(movimientos[0].cambios, { balance: [100000, 90000] });
  assert.equal(movimientos[0].motivo, "arreglo con el cliente");
  assert.equal(movimientos[0].actorId, "staff:1");
  assert.equal(movimientos[0].resultado, "ok");
  s.close();
});

test("si la operación se deshace, tampoco queda el movimiento", async () => {
  const s = await store();
  const sesion = { role: "admin", staffId: 1, name: "Mauro" };
  assert.throws(() =>
    s.transaction(() => {
      s.audit.log(sesion, "order.update", "order", "PC-1", {
        campos: ["status"],
      });
      throw Error("algo falló después de registrar");
    }),
  );
  assert.equal(s.audit.query({}).movimientos.length, 0);
  s.close();
});

test("un intento rechazado se distingue de un cambio efectivo", async () => {
  const s = await store();
  const sesion = { role: "repartidor", staffId: 4, driver: "Franco" };
  s.audit.log(
    sesion,
    "order.update",
    "order",
    "PC-9",
    { campos: ["status"] },
    {
      resultado: "rechazado",
      motivo: "ese pedido no es tuyo",
    },
  );
  const [m] = s.audit.query({}).movimientos;
  assert.equal(m.resultado, "rechazado");
  assert.equal(m.motivo, "ese pedido no es tuyo");
  s.close();
});

test("la consulta pagina con orden estable y filtra por actor y categoría", async () => {
  const s = await store();
  const mauro = { role: "admin", staffId: 1, name: "Mauro" };
  const franco = { role: "repartidor", staffId: 2, driver: "Franco" };
  for (let i = 0; i < 12; i++)
    s.audit.log(i % 2 ? franco : mauro, "crate.add", "order", `PC-${i}`, {
      gross: 43.4,
    });
  s.audit.log(mauro, "customer.saldos", "customer", "c-1", { delta: 100 });

  const p1 = s.audit.query({ limite: 5 });
  assert.equal(p1.movimientos.length, 5);
  assert.ok(p1.siguiente, "devuelve cursor para la página siguiente");
  const p2 = s.audit.query({ limite: 5, cursor: p1.siguiente });
  const ids1 = p1.movimientos.map((m) => m.id);
  const ids2 = p2.movimientos.map((m) => m.id);
  assert.equal(
    new Set([...ids1, ...ids2]).size,
    10,
    "no se repiten entre páginas",
  );

  assert.equal(s.audit.query({ actorId: "staff:2" }).movimientos.length, 6);
  assert.equal(s.audit.query({ categoria: "Saldos" }).movimientos.length, 1);
  assert.equal(s.audit.query({ categoria: "Pesadas" }).movimientos.length, 12);

  const f = s.audit.facetas();
  assert.ok(
    f.categorias.includes("Saldos") && f.categorias.includes("Pesadas"),
  );
  assert.equal(f.actores.length, 2);
  s.close();
});

test("los movimientos anteriores a esta versión quedan marcados como históricos", async () => {
  const s = await store();
  // Fila vieja: solo autor de texto, sin identidad ni categoría.
  s.db
    .prepare(
      "INSERT INTO audit_log(at, actor_role, actor, action, entity, entity_id) VALUES(?,?,?,?,?,?)",
    )
    .run(
      new Date().toISOString(),
      "admin",
      "Mauro",
      "order.update",
      "order",
      "PC-0",
    );
  const [m] = s.audit.query({}).movimientos;
  assert.equal(m.historico, true, "se identifica como dato incompleto");
  assert.equal(m.actor, "Mauro", "conserva su autor textual");
  assert.equal(m.actorId, null, "no se inventa un identificador");
  assert.equal(m.categoria, "Pedidos", "la categoría se deduce de la acción");
  s.close();
});

test("auditoría general: escrituras sin evento específico identifican al usuario sin filtrar secretos", async () => {
  const { withRequestAudit } = await import("../server/request-audit.mjs");
  const store = await openStore(":memory:");
  try {
    const handle = withRequestAudit(
      async () => ({ status: 200, body: { ok: true } }),
      store,
    );
    await Promise.all(
      [7, 8].map((staffId) =>
        handle({
          method: "PATCH",
          path: `/api/settings/config${staffId}`,
          body: { name: "Prueba", password: "secret", image: "secret" },
          session: { role: "admin", staffId, name: "Iguales" },
        }),
      ),
    );
    const rows = store.audit.query({}).movimientos;
    assert.deepEqual(rows.map((r) => r.actorId).sort(), ["staff:7", "staff:8"]);
    assert.ok(rows.every((r) => !JSON.stringify(r.detalle).includes("secret")));
  } finally {
    store.close();
  }
});
