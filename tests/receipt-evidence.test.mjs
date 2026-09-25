import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
const { verifyEvidence } = await import("../server/receipt-evidence.mjs");

test("comprobantes: autor autenticado, saldo positivo, constancia firmada y acceso restringido", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pollito-evidence-"));
  const store = await openStore(":memory:");
  try {
    const api = createApi({ store, events: createEvents(), dataDir });
    const admin = { role: "admin", staffId: 1, name: "Administración" };
    const driver = {
      role: "repartidor",
      staffId: 7,
      name: "Mismo nombre",
      driver: "Ensayo",
    };
    const other = {
      role: "repartidor",
      staffId: 8,
      name: "Mismo nombre",
      driver: "Otro",
    };
    const call = (method, path, body = {}, session = admin) =>
      api({
        method,
        path,
        body,
        session,
        query: new URLSearchParams(),
        ip: "127.0.0.1",
      });
    store.drivers.save({ name: "Ensayo", active: true, zones: [] });
    store.customers.save({
      phone: "evidence",
      name: "Cliente de prueba",
      plan: "mayorista",
      credit: true,
      created: new Date().toISOString(),
    });
    const created = await call("POST", "/api/orders", {
      customer: "evidence",
      key: "evidence",
      driver: "Ensayo",
      noPricing: true,
      items: [{ id: "entero", boxes: 2 }],
      deliveryDate: "2026-09-24",
    });
    const order = created.body;
    await call(
      "PATCH",
      "/api/customers/evidence/saldos",
      { balance: 12000, opId: "debt", note: "Saldo inicial" },
      driver,
    );
    const bytes = await sharp({
      create: { width: 160, height: 120, channels: 3, background: "#c9262e" },
    })
      .jpeg()
      .toBuffer();
    const body = {
      kind: "transferencia",
      image: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      by: "Inventado",
      actor: { id: "staff:99" },
      customerBalance: 999999,
    };
    const uploaded = await call(
      "POST",
      `/api/orders/${order.id}/comprobantes`,
      body,
      driver,
    );
    assert.equal(uploaded.status, 201);
    const r = uploaded.body;
    assert.equal(r.evidence.payload.actor.id, "staff:7");
    assert.equal(r.evidence.payload.customerBalance, 12000);
    assert.ok(verifyEvidence(r.evidence, bytes));
    assert.ok(
      !verifyEvidence(
        {
          ...r.evidence,
          payload: { ...r.evidence.payload, customerBalance: 1 },
        },
        bytes,
      ),
    );
    assert.ok(!verifyEvidence(r.evidence, Buffer.from("different")));
    const retry = await call(
      "POST",
      `/api/orders/${order.id}/comprobantes`,
      body,
      admin,
    );
    assert.equal(retry.body.evidence.payload.actor.id, "staff:7");
    assert.equal(store.receipts.forOrder(order.id).length, 1);
    await assert.rejects(
      () => call("GET", `/api/comprobantes/${r.id}/constancia.pdf`, {}, other),
      (e) => e.status === 403,
    );
    const downloaded = await call(
      "GET",
      `/api/comprobantes/${r.id}/constancia.pdf`,
    );
    assert.ok(downloaded.raw.subarray(0, 4).equals(Buffer.from("%PDF")));
    assert.match(downloaded.headers["Content-Disposition"], /attachment/);
    await call("PATCH", `/api/comprobantes/${r.id}`, {
      note: "Corregido",
      amount: 10,
    });
    assert.deepEqual(
      store.receipts.get(r.id).evidence,
      r.evidence,
      "editar no reescribe la constancia original",
    );
    await call(
      "PATCH",
      "/api/customers/evidence/saldos",
      { balance: 0, opId: "clear-debt", note: "Quitar deuda" },
      driver,
    );
    const second = await call(
      "POST",
      `/api/orders/${order.id}/comprobantes`,
      { ...body, kind: "firma" },
      driver,
    );
    assert.ok(!("customerBalance" in second.body.evidence.payload));
    const activity = await call(
      "GET",
      `/api/orders/${order.id}/movimientos`,
      {},
      driver,
    );
    assert.ok(
      activity.body.movimientos.some(
        (m) => m.accion === "receipt.add" && m.actorId === "staff:7",
      ),
    );
    const customerActivity = await call(
      "GET",
      "/api/customers/evidence/movimientos",
      {},
      driver,
    );
    assert.ok(
      customerActivity.body.movimientos.some((m) => m.actorId === "staff:7"),
    );
    await writeFile(
      join(dataDir, "receipts", r.file),
      Buffer.from("changed image"),
    );
    await assert.rejects(
      () => call("GET", `/api/comprobantes/${r.id}/constancia.pdf`),
      (e) => e.status === 409,
    );
    assert.ok(
      (await readFile(join(dataDir, "receipt-evidence", "signing-key.pem")))
        .length > 0,
    );
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
