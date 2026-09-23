import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fail } from "./errors.mjs";

export const DEFAULT_DRIVE_FOLDER = "1ocqnaKCa0U4C4ukOgtH4OvEt9-azQ1lX";
export function createDocuments({
  store,
  dataDir,
  isStaff,
  env = process.env,
  fetcher = fetch,
}) {
  const db = store.db,
    dir = `${dataDir}/documents`;
  db.exec(
    `CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,file TEXT NOT NULL,kind TEXT NOT NULL,orders TEXT NOT NULL,at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',drive_id TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT)`,
  );
  const folder = env.DRIVE_FOLDER_ID || DEFAULT_DRIVE_FOLDER;
  const configured = () =>
    !!(
      env.DRIVE_CLIENT_ID &&
      env.DRIVE_CLIENT_SECRET &&
      env.DRIVE_REFRESH_TOKEN
    );
  let token = null,
    expires = 0,
    running = false;
  async function accessToken() {
    if (token && Date.now() < expires) return token;
    const r = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: env.DRIVE_CLIENT_ID,
        client_secret: env.DRIVE_CLIENT_SECRET,
        refresh_token: env.DRIVE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok)
      throw Error(
        "No se pudo autorizar Drive. Revisar credenciales y consentimiento.",
      );
    const b = await r.json();
    token = b.access_token;
    expires = Date.now() + Math.max(0, b.expires_in - 60) * 1000;
    return token;
  }
  async function request(path, options = {}) {
    const r = await fetcher(`https://www.googleapis.com/${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...options.headers,
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) {
      if (r.status === 401) {
        token = null;
        expires = 0;
      }
      const e = Error(
        `Drive respondió ${r.status}. Revisar acceso a la carpeta o reintentar.`,
      );
      e.status = r.status;
      throw e;
    }
    return r.json();
  }
  const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  async function subfolder(parent, name) {
    const q = `'${esc(parent)}' in parents and name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const r = await request(
      `drive/v3/files?${new URLSearchParams({ q, fields: "files(id)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" })}`,
    );
    if (r.files?.[0]) return r.files[0].id;
    return (
      await request("drive/v3/files?supportsAllDrives=true&fields=id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parent],
        }),
      })
    ).id;
  }
  async function enqueue({
    name,
    mime,
    bytes,
    kind = "documento",
    orders = [],
    at = new Date().toISOString(),
  }) {
    const id = createHash("sha256")
      .update(JSON.stringify([kind, [...orders].sort()]))
      .update(bytes)
      .digest("hex");
    if (!db.prepare("SELECT id FROM documents WHERE id=?").get(id)) {
      await mkdir(dir, { recursive: true });
      const file = `${id}.bin`;
      await writeFile(`${dir}/${file}`, bytes);
      db.prepare(
        "INSERT OR IGNORE INTO documents(id,name,mime,file,kind,orders,at) VALUES(?,?,?,?,?,?,?)",
      ).run(id, name, mime, file, kind, JSON.stringify(orders), at);
    }
    return db.prepare("SELECT * FROM documents WHERE id=?").get(id);
  }
  async function sync() {
    if (running || !configured()) return;
    running = true;
    try {
      const rows = db
        .prepare(
          "SELECT * FROM documents WHERE status!='synced' AND (next_at IS NULL OR next_at<=?) ORDER BY at LIMIT 10",
        )
        .all(new Date().toISOString());
      for (const r of rows) {
        try {
          db.prepare("UPDATE documents SET status='uploading' WHERE id=?").run(
            r.id,
          );
          // Reserve an ID before upload. Retry the same ID after timeout; never create a duplicate.
          let driveId = r.drive_id;
          if (!driveId) {
            driveId = (
              await request(
                "drive/v3/files/generateIds?count=1&space=drive&type=files",
              )
            ).ids[0];
            db.prepare("UPDATE documents SET drive_id=? WHERE id=?").run(
              driveId,
              r.id,
            );
          }
          let exists = false;
          try {
            await request(
              `drive/v3/files/${encodeURIComponent(driveId)}?fields=id&supportsAllDrives=true`,
            );
            exists = true;
          } catch (e) {
            if (e.status !== 404) throw e;
          }
          if (!exists) {
            const month = await subfolder(folder, r.at.slice(0, 7));
            const dest = await subfolder(month, r.kind);
            const boundary = "pollito-" + randomUUID();
            const metadata = {
              id: driveId,
              name: r.name,
              mimeType: r.mime,
              parents: [dest],
              appProperties: { pollitoDocument: r.id },
            };
            const bytes = await readFile(`${dir}/${r.file}`);
            const body = Buffer.concat([
              Buffer.from(
                `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${r.mime}\r\n\r\n`,
              ),
              bytes,
              Buffer.from(`\r\n--${boundary}--`),
            ]);
            await request(
              "upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id",
              {
                method: "POST",
                headers: {
                  "Content-Type": `multipart/related; boundary=${boundary}`,
                },
                body,
              },
            );
          }
          db.prepare(
            "UPDATE documents SET status='synced',error=NULL,next_at=NULL WHERE id=?",
          ).run(r.id);
        } catch (e) {
          const next = new Date(
            Date.now() +
              Math.min(3600000, 30000 * 2 ** Math.min(r.attempts, 7)),
          ).toISOString();
          db.prepare(
            "UPDATE documents SET status='error',error=?,attempts=attempts+1,next_at=? WHERE id=?",
          ).run(e.message.slice(0, 250), next, r.id);
        }
      }
    } finally {
      running = false;
    }
  }
  const canAccess = (session, orders) =>
    session?.role === "admin" ||
    (orders.length > 0 &&
      orders.every((id) => {
        const o = store.orders.get(id);
        return (
          o && (o.driver === session?.driver || o.driver2 === session?.driver)
        );
      }));
  function publicRow(r) {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      at: r.at,
      status: r.status,
      error: r.error,
      orders: JSON.parse(r.orders),
      url:
        r.status === "synced"
          ? `https://drive.google.com/file/d/${r.drive_id}/view`
          : null,
    };
  }
  async function handle({ method, path, body, session }) {
    if (!path.startsWith("/api/documents")) return null;
    if (!isStaff(session)) fail(403, "Solo el equipo.");
    if (path === "/api/documents" && method === "POST") {
      const orders = Array.isArray(body.orders)
        ? [...new Set(body.orders)]
        : [];
      if (
        orders.length > 500 ||
        orders.some((id) => typeof id !== "string" || !store.orders.get(id))
      )
        fail(400, "Pedidos del documento inválidos.");
      if (!canAccess(session, orders))
        fail(403, "El documento pertenece a otro reparto.");
      if (!/^[\w .áéíóúÁÉÍÓÚñÑ()_-]{1,160}\.pdf$/.test(body.name || ""))
        fail(400, "Nombre de PDF inválido.");
      const bytes = Buffer.from(String(body.base64 || ""), "base64");
      if (
        bytes.length > 4_000_000 ||
        bytes.subarray(0, 5).toString() !== "%PDF-"
      )
        fail(400, "PDF inválido o demasiado grande (máximo 4 MB).");
      const kind = ["remitos", "hojas-ruta", "pedidos"].includes(body.kind)
        ? body.kind
        : "documentos";
      const row = await enqueue({
        name: body.name,
        mime: "application/pdf",
        bytes,
        orders,
        kind,
      });
      void sync();
      return { status: 200, body: publicRow(row) };
    }
    if (path === "/api/documents" && method === "GET") {
      const rows = db
        .prepare("SELECT * FROM documents ORDER BY at DESC")
        .all()
        .filter((r) => canAccess(session, JSON.parse(r.orders)));
      return {
        status: 200,
        body: {
          configured: configured(),
          folder,
          documents: rows.slice(0, 200).map(publicRow),
          pending: rows.filter((r) => r.status !== "synced").length,
        },
      };
    }
    if (path === "/api/documents/retry" && method === "POST") {
      if (session.role !== "admin") fail(403, "Solo administración.");
      db.prepare(
        "UPDATE documents SET next_at=NULL WHERE status!='synced'",
      ).run();
      void sync();
      return { status: 200, body: { ok: true } };
    }
    const download = path.match(/^\/api\/documents\/([a-f0-9]{64})\/file$/);
    if (download && method === "GET") {
      const r = db
        .prepare("SELECT * FROM documents WHERE id=?")
        .get(download[1]);
      if (!r) fail(404, "Documento no encontrado.");
      if (!canAccess(session, JSON.parse(r.orders)))
        fail(403, "Documento de otro reparto.");
      return {
        status: 200,
        raw: await readFile(`${dir}/${r.file}`),
        headers: {
          "Content-Type": r.mime,
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.name)}`,
          "Cache-Control": "private, no-store",
        },
      };
    }
    return null;
  }
  const timer = setInterval(() => void sync(), 30000);
  timer.unref();
  return {
    enqueue,
    sync,
    handle,
    configured,
    close: () => clearInterval(timer),
  };
}
