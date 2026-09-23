import test from "node:test";
import assert from "node:assert/strict";
import { dueñoDe, VERSION_DATOS } from "../src/lib/sesion.js";

/**
 * PC-019 — Lo que queda pendiente en el dispositivo es de quien lo cargó.
 *
 * La cola vive en localStorage, así que acá se simula ese almacenamiento y se usa el módulo real.
 * Lo que se comprueba es el criterio de aceptación: al cambiar de usuario, lo pendiente NO pasa
 * a ser del nuevo ni se envía con su sesión.
 */

const guardado = new Map();
globalThis.localStorage = {
  getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
  setItem: (k, v) => guardado.set(k, String(v)),
  removeItem: (k) => guardado.delete(k),
};
// El módulo se engancha a `window` al cargarse; alcanza con que exista.
globalThis.window = { addEventListener() {} };

const encolar = (filas) =>
  guardado.set("pc-outbox", JSON.stringify(filas));
const { propias, ajenas, pending, setDueño } = await import(
  "../src/lib/outbox.js"
);

const FRANCO = { role: "repartidor", staffId: 7, name: "Franco" };
const MAURO = { role: "admin", staffId: 1, name: "Mauro" };
const pesadaDe = (owner) => ({
  path: "/orders/PC-1/crates",
  body: { gross: 43.4, boxes: 2 },
  method: "POST",
  at: new Date().toISOString(),
  owner,
  version: VERSION_DATOS,
});

test("la identidad sale de la sesión, no del nombre escrito", () => {
  assert.equal(dueñoDe(FRANCO), "staff:7");
  assert.equal(
    dueñoDe({ role: "repartidor", staffId: 9, name: "Franco" }),
    "staff:9",
    "dos personas con el mismo nombre no se confunden",
  );
  assert.equal(dueñoDe({ role: "cliente", phone: "5492634" }), "cliente:5492634");
  assert.equal(dueñoDe(null), "");
});

test("una pesada sin señal queda a nombre de quien la cargó y no la manda otro", () => {
  encolar([pesadaDe("staff:7")]);

  setDueño(FRANCO);
  assert.equal(propias().length, 1, "para Franco es suya");
  assert.equal(ajenas().length, 0);

  // Entra otra persona en el mismo teléfono.
  setDueño(MAURO);
  assert.equal(
    propias().length,
    0,
    "para Mauro no hay nada suyo que enviar: no se ejecuta como él",
  );
  assert.equal(ajenas().length, 1, "lo de Franco sigue esperando, identificado");
  assert.equal(pending().length, 1, "y no se borra");

  // Vuelve el dueño: recién ahí es suya otra vez.
  setDueño(FRANCO);
  assert.equal(propias().length, 1);
  assert.equal(ajenas().length, 0);
});

test("sin sesión no se envía nada pendiente", () => {
  encolar([pesadaDe("staff:7")]);
  setDueño(null);
  assert.equal(propias().length, 0);
  assert.equal(ajenas().length, 1);
});

test("lo que quedó de una versión anterior no se envía a ciegas", () => {
  encolar([
    // Registro viejo: sin dueño ni versión, como los que ya podían existir en un teléfono.
    { path: "/orders/PC-9/crates", body: {}, method: "POST" },
    {
      path: "/orders/PC-8/crates",
      body: {},
      method: "POST",
      owner: "staff:7",
      version: 0,
    },
  ]);
  setDueño(FRANCO);
  assert.equal(propias().length, 0, "ninguno se da por bueno automáticamente");
  assert.equal(
    ajenas().length,
    2,
    "los dos quedan identificados para revisar a mano",
  );
});

test("cada dueño ve solo lo suyo cuando hay pendientes de varios", () => {
  encolar([pesadaDe("staff:7"), pesadaDe("staff:1"), pesadaDe("staff:7")]);
  setDueño(FRANCO);
  assert.equal(propias().length, 2);
  assert.equal(ajenas().length, 1);
  setDueño(MAURO);
  assert.equal(propias().length, 1);
  assert.equal(ajenas().length, 2);
});
