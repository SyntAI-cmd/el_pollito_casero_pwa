import test from "node:test";
import assert from "node:assert/strict";
import { testEnv } from "../scripts/test-env.mjs";
Object.assign(process.env, await testEnv());
const { openStore } = await import("../server/store.mjs");
const { createApi, createEvents } = await import("../server/api.mjs");
const { default: ExcelJS } = await import("exceljs");

/** La plantilla de clientes exporta todas las fichas actuales con producto y precio . */
test("plantilla: todos los clientes con sus precios, ", async () => {
  const store = await openStore(":memory:");
  const api = createApi({
    store,
    events: createEvents(),
    dataDir: process.env.DATA_DIR,
  });
  store.drivers.save({ name: "Ensayo", active: true, zones: [] });
  const admin = { role: "admin", staffId: 1, name: "Mauro" };
  const as = (method, path, body = {}) =>
    api({
      method,
      path,
      body,
      session: admin,
      query: new URLSearchParams(),
      ip: "127.0.0.1",
    });
  const alta = async (name, prices) => {
    const phone = (await as("POST", "/api/customers", { name })).body.phone;
    if (prices) await as("PUT", `/api/customers/${phone}/prices`, { prices });
    return phone;
  };
  await alta("Kiosco Zeta", { entero: 3900, alas: 2100 });
  await alta("Almacén Alfa");
  const borrado = await alta("Archivado");
  store.customers.save({ ...store.customers.get(borrado), archived: true });

  const res = await as("GET", "/api/customers/plantilla");
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.raw);
  const ws = wb.getWorksheet("Clientes");
  assert.match(String(ws.getCell("A2").value), /Clientes y precios/);
  assert.deepEqual(ws.getRow(4).values.slice(1), [
    "Cliente",
    "Producto",
    "Precio",
  ]);
  // El nombre va solo en el primer renglón del cliente: se completa hacia abajo para comparar.
  const filas = [];
  for (let r = 5; r <= ws.rowCount; r++) {
    const [c, p, precio] = ws.getRow(r).values.slice(1);
    filas.push([c || filas.at(-1)[0], p, precio]);
  }
  const zeta = filas.filter((f) => f[0] === "Kiosco Zeta");
  assert.deepEqual(zeta, [
    ["Kiosco Zeta", "Pollo entero", 3900],
    ["Kiosco Zeta", "Alas", 2100],
  ]);
  const alfa = filas.filter((f) => f[0] === "Almacén Alfa");
  assert.ok(alfa.length > 0, "sin precio propio: sale con su lista");
  assert.ok(alfa.every((f) => f[2] > 0));
  assert.equal(filas[0][0], "Almacén Alfa", "ordenados por nombre");
  assert.equal(
    filas.some((f) => f[0] === "Archivado" || f[0] === "Kiosco Prueba"),
    false,
  );
});
