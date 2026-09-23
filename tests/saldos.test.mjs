import test from "node:test";
import assert from "node:assert/strict";
import { openStore } from "../server/store.mjs";
import { createApi, createEvents } from "../server/api.mjs";
import { testEnv } from "../scripts/test-env.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** PC-005 — Corregir saldos sin perder historial y sin pisar el trabajo de otro. */

async function entorno() {
  Object.assign(process.env, await testEnv());
  const dataDir = await mkdtemp(join(tmpdir(), "pollito-saldos-"));
  const store = await openStore(":memory:");
  const api = createApi({ store, events: createEvents(), dataDir });
  const call = (method, path, body = {}, session) =>
    api({
      method,
      path,
      body,
      session: session || { role: "admin", staffId: 1, name: "Mauro" },
      query: new URLSearchParams(),
      ip: "127.0.0.1",
    });
  store.customers.save({
    phone: "cliente-1",
    name: "Cliente de ensayo",
    plan: "mayorista",
    credit: true,
    created: new Date().toISOString(),
  });
  return {
    store,
    call,
    cerrar: async () => {
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
const saldo = (store) =>
  store.customers.get("cliente-1").balanceAdjustments || [];

test("corregir 100.000 a 90.000 deja una diferencia de -10.000 con autor y motivo", async () => {
  const { store, call, cerrar } = await entorno();
  try {
    await call("PATCH", "/api/customers/cliente-1/saldos", {
      delta: 100000,
      note: "saldo inicial",
      opId: "op-1",
    });
    const r = await call("PATCH", "/api/customers/cliente-1/saldos", {
      balance: 90000,
      note: "arreglo con el cliente",
      opId: "op-2",
    });
    assert.equal(r.body.summary.balance, 90000);
    const ajustes = saldo(store);
    assert.equal(ajustes.length, 2);
    assert.equal(ajustes[1].amount, -10000, "la diferencia queda registrada");
    assert.equal(ajustes[1].note, "arreglo con el cliente");
    assert.ok(ajustes[1].by, "queda quién lo hizo");
    // El movimiento también está en el historial, con antes y después.
    const mov = store.audit
      .query({ categoria: "Saldos" })
      .movimientos.find((m) => m.opId === "op-2");
    assert.deepEqual(mov.cambios.balance, [100000, 90000]);
    assert.equal(mov.motivo, "arreglo con el cliente");
  } finally {
    await cerrar();
  }
});

test("corregir 10 cajas a 8 deja -2, sin tocar el dinero", async () => {
  const { store, call, cerrar } = await entorno();
  try {
    await call("PATCH", "/api/customers/cliente-1/saldos", {
      boxesDelta: 10,
      opId: "c-1",
    });
    const r = await call("PATCH", "/api/customers/cliente-1/saldos", {
      boxes: 8,
      note: "conteo físico",
      opId: "c-2",
    });
    assert.equal(r.body.summary.boxes, 8);
    assert.equal(r.body.summary.balance, 0, "el dinero no se movió");
    const cajas = store.customers.get("cliente-1").boxAdjustments;
    assert.equal(cajas[cajas.length - 1].boxes, -2);
    assert.equal(cajas[cajas.length - 1].note, "conteo físico");
  } finally {
    await cerrar();
  }
});

test("repetir la misma corrección no la aplica dos veces", async () => {
  const { call, cerrar } = await entorno();
  try {
    const cuerpo = () => ({ delta: 5000, note: "ensayo", opId: "repetida" });
    await call("PATCH", "/api/customers/cliente-1/saldos", cuerpo());
    const r = await call("PATCH", "/api/customers/cliente-1/saldos", cuerpo());
    assert.equal(r.body.summary.balance, 5000, "sigue siendo 5.000, no 10.000");
  } finally {
    await cerrar();
  }
});

test("dos personas editando el mismo saldo: la segunda recibe un aviso, no pisa", async () => {
  const { store, call, cerrar } = await entorno();
  try {
    await call("PATCH", "/api/customers/cliente-1/saldos", {
      delta: 100000,
      opId: "base",
    });
    // Los dos abrieron la ventana viendo 100.000.
    const vistoPorAmbos = { balance: 100000, boxes: 0 };
    // El primero corrige a 90.000.
    await call(
      "PATCH",
      "/api/customers/cliente-1/saldos",
      { balance: 90000, esperado: vistoPorAmbos, opId: "primero" },
      { role: "admin", staffId: 1, name: "Mauro" },
    );
    assert.equal(
      store.customers.get("cliente-1").summary?.balance ??
        (await call("GET", "/api/customers")).body.find(
          (c) => c.phone === "cliente-1",
        ).summary.balance,
      90000,
    );
    // El segundo intenta guardar con el estado viejo: se rechaza con aviso.
    await assert.rejects(
      () =>
        call(
          "PATCH",
          "/api/customers/cliente-1/saldos",
          { balance: 70000, esperado: vistoPorAmbos, opId: "segundo" },
          { role: "admin", staffId: 2, name: "Franco" },
        ),
      (e) => e.status === 409 && /cambió este saldo/i.test(e.message),
    );
    // El saldo quedó como lo dejó el primero: no se pisó en silencio.
    const lista = await call("GET", "/api/customers");
    assert.equal(
      lista.body.find((c) => c.phone === "cliente-1").summary.balance,
      90000,
    );
    // El intento rechazado queda registrado, diferenciado de un cambio efectivo.
    const rechazado = store.audit
      .query({ categoria: "Saldos" })
      .movimientos.find((m) => m.resultado === "rechazado");
    assert.ok(rechazado, "el intento fallido queda en el historial");
    assert.match(rechazado.motivo, /otro usuario/i);
  } finally {
    await cerrar();
  }
});

test("si el estado no cambió, la corrección se aplica normalmente", async () => {
  const { call, cerrar } = await entorno();
  try {
    await call("PATCH", "/api/customers/cliente-1/saldos", {
      delta: 100000,
      opId: "base",
    });
    const r = await call("PATCH", "/api/customers/cliente-1/saldos", {
      balance: 90000,
      esperado: { balance: 100000, boxes: 0 },
      opId: "ok",
    });
    assert.equal(r.body.summary.balance, 90000);
  } finally {
    await cerrar();
  }
});
