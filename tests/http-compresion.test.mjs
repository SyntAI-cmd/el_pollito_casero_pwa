import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import { readdir } from "node:fs/promises";
import { testEnv } from "../scripts/test-env.mjs";

/**
 * Entrega por HTTP (PC-017): las respuestas grandes viajan comprimidas y llevan el tiempo de
 * servidor, separado de la red. Se prueba con el servidor real, no con la función de la API.
 */
const port = 6000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
const get = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get(base + path, { headers }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });

test("JSON y estáticos grandes se comprimen si el navegador lo acepta; el contenido no cambia", async (t) => {
  const env = await testEnv({ PORT: String(port), SITE_URL: base, APP_MODE: "equipo" });
  const server = spawn(process.execPath, ["server.mjs"], { env, stdio: "ignore", windowsHide: true });
  t.after(() => server.kill());
  for (let i = 0; i < 80; i++) {
    try {
      if ((await get("/api/health")).res.statusCode === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const login = await fetch(base + "/api/session/staff", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ username: "admin", password: env.ADMIN_PASSWORD }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const plano = await get("/api/config", { Cookie: cookie });
  const comprimido = await get("/api/config", { Cookie: cookie, "Accept-Encoding": "gzip, br" });
  assert.equal(plano.res.headers["content-encoding"], undefined);
  assert.equal(comprimido.res.headers["content-encoding"], "gzip");
  assert.match(comprimido.res.headers.vary || "", /Accept-Encoding/);
  assert.match(comprimido.res.headers["server-timing"] || "", /^app;dur=\d+$/);
  assert.ok(comprimido.body.length < plano.body.length / 2, "al menos la mitad de bytes");
  assert.deepEqual(JSON.parse(gunzipSync(comprimido.body)), JSON.parse(plano.body));

  // Respuestas chicas (un pedido, un error) no se comprimen: no vale la pena.
  const chico = await get("/api/session", { Cookie: cookie, "Accept-Encoding": "gzip" });
  assert.equal(chico.res.headers["content-encoding"], undefined);

  const js = (await readdir("dist/assets")).find((f) => /^index-.*\.js$/.test(f));
  if (js) {
    const a = await get("/assets/" + js);
    const b = await get("/assets/" + js, { "Accept-Encoding": "gzip" });
    assert.equal(b.res.headers["content-encoding"], "gzip");
    assert.match(b.res.headers["cache-control"], /immutable/);
    assert.ok(gunzipSync(b.body).equals(a.body), "el mismo archivo");
    assert.ok(b.body.length < a.body.length / 2);
  }
});
