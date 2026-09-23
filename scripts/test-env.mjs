import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Lista permitida: nunca heredar credenciales, imports ni resets operativos.
export async function testEnv(overrides = {}) {
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "PLAYWRIGHT_BROWSERS_PATH", "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"])
    if (process.env[key]) env[key] = process.env[key];
  return {
    ...env,
    DATA_DIR: await mkdtemp(join(tmpdir(), "pollito-test-")),
    DB_PATH: ":memory:", HOST: "127.0.0.1",
    GEOCODING: "off", ROUTING: "off", PUSH: "off",
    ADMIN_PASSWORD: "clave-de-prueba-1", LOGIN_LIMIT: "10000",
    APP_MODE: "completo", DEMO: "1",
    ...overrides,
  };
}
