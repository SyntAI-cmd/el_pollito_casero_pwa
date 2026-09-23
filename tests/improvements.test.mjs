import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/store.mjs";
import { createDocuments } from "../server/documents.mjs";
import { routeRows, routeParts } from "../src/lib/routeRows.js";
import { orderBoxes } from "../src/lib/cajas.js";

test("hoja de ruta: un cliente repetido lleva su saldo una sola vez", () => {
  const c = { phone: "a", summary: { boxes: 10, balance: 100 } };
  const orders = [1, 2].map((n) => ({
    id: String(n),
    number: n,
    customer: "a",
    status: "en_camino",
    items: [{ boxes: 5 }],
    boxes: 0,
    returned: 0,
    total: 0,
  }));
  const rows = routeRows(orders, [c]);
  assert.equal(rows[0].before, 10);
  assert.equal(rows[0].after, 15);
  assert.equal(rows[1].before, 15);
  assert.equal(rows[1].after, 20);
  assert.equal(rows[1].firstCustomer, false);
  assert.deepEqual(
    routeParts(Array(21).fill({})).map((x) => x.length),
    [10, 10, 1],
  );
});
test("detalle de cajas: no inventa saldos históricos y usa el corte de entrega", () => {
  assert.equal(orderBoxes({ boxes: 10 }, 80).previas, null);
  assert.deepEqual(
    orderBoxes({ boxBalanceBefore: 10, boxes: 30, returned: 5 }, 90),
    { previas: 10, salientes: 30, devueltas: 5, saldo: 35, actual: 90 },
  );
});
test("Drive: conserva archivos sin credenciales y no duplica al reintentar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pollito-docs-")),
    store = await openStore(":memory:");
  const docs = createDocuments({
    store,
    dataDir: dir,
    isStaff: (s) => s?.role === "admin",
    env: {},
  });
  try {
    const data = {
      name: "prueba.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-prueba"),
      orders: ["order-1"],
    };
    const a = await docs.enqueue(data),
      b = await docs.enqueue(data);
    assert.equal(a.id, b.id);
    await docs.sync();
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM documents").get().n,
      1,
    );
    const listing = await docs.handle({
      path: "/api/documents",
      method: "GET",
      session: { role: "admin" },
    });
    assert.equal(listing.body.configured, false);
    assert.equal(listing.body.pending, 1);
  } finally {
    docs.close();
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("Drive: timeout después de crear el archivo recupera el mismo ID sin otra subida", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pollito-drive-")),
    store = await openStore(":memory:");
  let uploaded = false,
    uploads = 0;
  const fetcher = async (url, options = {}) => {
    if (url.includes("oauth2"))
      return Response.json({ access_token: "test", expires_in: 3600 });
    if (url.includes("generateIds"))
      return Response.json({ ids: ["reserved-id"] });
    if (url.includes("/files/reserved-id"))
      return uploaded
        ? Response.json({ id: "reserved-id" })
        : new Response("", { status: 404 });
    if (url.includes("upload/drive")) {
      uploads++;
      uploaded = true;
      throw Error("Network timeout");
    }
    if (url.includes("files?"))
      return Response.json({ files: [{ id: "folder" }] });
    throw Error("Unexpected request " + url);
  };
  const docs = createDocuments({
    store,
    dataDir: dir,
    isStaff: () => true,
    env: {
      DRIVE_CLIENT_ID: "test",
      DRIVE_CLIENT_SECRET: "test",
      DRIVE_REFRESH_TOKEN: "test",
    },
    fetcher,
  });
  try {
    await docs.enqueue({
      name: "a.pdf",
      mime: "application/pdf",
      bytes: Buffer.from("%PDF-test"),
    });
    await docs.sync();
    assert.equal(
      store.db.prepare("SELECT status FROM documents").get().status,
      "error",
    );
    store.db.prepare("UPDATE documents SET next_at=NULL").run();
    await docs.sync();
    assert.equal(
      store.db.prepare("SELECT status FROM documents").get().status,
      "synced",
    );
    assert.equal(uploads, 1);
  } finally {
    docs.close();
    store.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
