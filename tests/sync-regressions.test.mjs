import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { coalescedRefresh } from "../src/lib/refresh.js";
import * as sync from "../src/lib/sync.js";
const turn = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

function hooks(source, api) {
  let state = [],
    slot = 0,
    effects = [],
    listeners = [];
  const ctx = vm.createContext({
    useState(initial) {
      const i = slot++;
      if (!(i in state)) state[i] = initial;
      return [
        state[i],
        (v) => (state[i] = typeof v === "function" ? v(state[i]) : v),
      ];
    },
    useRef: () => ({ current: null }),
    useCallback: (f) => f,
    useEffect: (f) => effects.push(f),
    coalescedRefresh,
    ...sync,
    isLive: () => true,
    api,
    subscribe: (f) => {
      listeners.push(f);
      return () => {
        listeners = listeners.filter((x) => x !== f);
      };
    },
    window: { addEventListener() {}, removeEventListener() {} },
    AbortController,
    AbortSignal,
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  });
  vm.runInContext(
    source.replace(/^import [\s\S]*?;\r?\n/gm, "").replace(/export /g, "") +
      "\nglobalThis.subject=useDay;",
    ctx,
  );
  let cleanup;
  return {
    render(date) {
      cleanup?.();
      slot = 0;
      effects = [];
      ctx.subject(date);
      cleanup = effects[0]();
    },
    event() {
      listeners.forEach((f) => f("orders", { id: "A" }));
    },
    emit(type, data) {
      listeners.forEach((f) => f(type, data));
    },
    get day() {
      return state[0];
    },
    close() {
      cleanup?.();
    },
  };
}
const daySource = await readFile("src/lib/day.js", "utf8");
test("día: una respuesta anterior no pisa la nueva fecha aunque llegue última", async () => {
  const a = deferred(),
    b = deferred();
  const paths = [];
  const h = hooks(daySource, (path) => {
    paths.push(path);
    return path.endsWith("25") ? a.promise : b.promise;
  });
  h.render("2026-09-25");
  await turn();
  h.render("2026-09-26");
  await turn();
  b.resolve({ date: "2026-09-26", orders: [] });
  await turn();
  a.resolve({ date: "2026-09-25", orders: [{ id: "A" }] });
  await turn();
  assert.equal(paths.length, 2);
  assert.equal(h.day.date, "2026-09-26");
  assert.equal(h.day.orders.length, 0);
  h.close();
});
test("día: cancelación o traslado se reconcilian con el filtro del servidor", async () => {
  const paths = [];
  const h = hooks(daySource, async (path) => {
    paths.push(path);
    // Con `ids` el servidor aplica los mismos filtros de la nota: A ya no pertenece a este día.
    return path.includes("&ids=")
      ? { date: "2026-09-25", partial: true, orders: [] }
      : { date: "2026-09-25", orders: [{ id: "A" }, { id: "B" }] };
  });
  h.render("2026-09-25");
  await turn();
  assert.equal(h.day.orders.length, 2);
  h.event();
  // Los eventos se agrupan 250 ms antes de consultar.
  await new Promise((r) => setTimeout(r, 300));
  await turn();
  assert.deepEqual(h.day.orders.map((o) => o.id), ["B"], "sale sólo el pedido del evento");
  assert.deepEqual(paths, ["/dia?fecha=2026-09-25", "/dia?fecha=2026-09-25&ids=A"],
    "el evento consulta sólo ese pedido, no la nota entera");
  h.close();
});
test("día: un evento de otra fecha que no está en la nota no consulta nada", async () => {
  const paths = [];
  const h = hooks(daySource, async (path) => {
    paths.push(path);
    return { date: "2026-09-25", orders: [{ id: "A" }] };
  });
  h.render("2026-09-25");
  await turn();
  h.emit("orders", { id: "Z", date: "2026-09-26", customer: "c" });
  await turn();
  assert.deepEqual(paths, ["/dia?fecha=2026-09-25"]);
  h.close();
});
test("refresco: conserva una invalidación durante la consulta sin concurrencia", async () => {
  const hold = deferred();
  let calls = 0,
    concurrent = 0,
    max = 0;
  const refresh = coalescedRefresh(async () => {
    calls++;
    concurrent++;
    max = Math.max(max, concurrent);
    if (calls === 1) await hold.promise;
    concurrent--;
  });
  const first = refresh();
  await turn();
  const second = refresh();
  refresh();
  hold.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal(max, 1);
});
test("archivo retirado: el service worker corta el POST antiguo sin leer el PDF ni usar red", async () => {
  const handlers = {};
  let fetched = 0;
  const ctx = vm.createContext({
    self: { addEventListener: (type, fn) => (handlers[type] = fn) },
    location: { origin: "https://example.test" },
    URL,
    Response,
    Promise,
    fetch: () => {
      fetched++;
      throw Error("no debe enviar");
    },
  });
  vm.runInContext(await readFile("public/sw.js", "utf8"), ctx);
  let response;
  handlers.fetch({
    request: {
      method: "POST",
      url: "https://example.test/api/documents",
      get body() {
        throw Error("no debe leer");
      },
    },
    respondWith: (p) => (response = p),
  });
  assert.equal((await response).status, 200);
  assert.equal(fetched, 0);
});
test("service worker: las consultas por id no se guardan en la copia del teléfono", async () => {
  const handlers = {};
  const ctx = vm.createContext({
    self: { addEventListener: (type, fn) => (handlers[type] = fn) },
    location: { origin: "https://example.test" },
    URL,
    Response,
    Promise,
    fetch: async () => new Response("{}"),
    caches: {
      open: async () => ({ match: async () => undefined, put: async () => {} }),
    },
  });
  vm.runInContext(await readFile("public/sw.js", "utf8"), ctx);
  const intercepted = (path) => {
    let used = false;
    handlers.fetch({
      request: { method: "GET", url: "https://example.test" + path, mode: "cors" },
      respondWith: () => (used = true),
    });
    return used;
  };
  assert.equal(intercepted("/api/dia?fecha=2026-09-27&ids=A,B"), false);
  assert.equal(intercepted("/api/orders?ids=A"), false);
  assert.equal(intercepted("/api/customers?phones=c1"), false);
  assert.equal(intercepted("/api/dia?fecha=2026-09-27"), true, "la nota completa sí (sin señal)");
  assert.equal(intercepted("/api/orders"), true);
});
test("refresco: devuelve el resultado de la última consulta", async () => {
  let n = 0;
  const hold = deferred();
  const refresh = coalescedRefresh(async () => {
    n++;
    if (n === 1) await hold.promise;
    return n;
  });
  const a = refresh();
  await turn(); // la primera consulta ya salió…
  refresh(); // …y llega un cambio mientras tanto
  hold.resolve();
  assert.equal(await a, 2, "se vuelve a consultar y se devuelve lo más nuevo");
  assert.equal(await refresh(), 3);
});
