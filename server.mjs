import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { openStore } from "./server/store.mjs";
import { createApi, createEvents, ApiError } from "./server/api.mjs";
import { createPush } from "./server/push.mjs";
import { statuses, origin } from "./domain.mjs";

const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT || 5173);
const base = process.env.SITE_URL || `http://localhost:${port}`;
const baseHost = new URL(base).host;
const secure = base.startsWith("https://");
const dbPath = process.env.DB_PATH || "data/pollito.sqlite";
const store = await openStore(dbPath);
const events = createEvents();
const push = await createPush({
  store,
  dbPath,
  contact: `mailto:pedidos@${baseHost.split(":")[0] === "localhost" ? "pollitocasero.local" : baseHost}`,
});
const api = createApi({ store, events, push });

// Pedido de ejemplo para la demostración: visible desde Operación y para el repartidor Franco.
if (!store.orders.count() && !process.env.DB_PATH) {
  const at = new Date().toISOString();
  const track = [
    [-33.0725, -68.4905],
    [-33.0742, -68.4862],
    [-33.0768, -68.4818],
    [-33.0791, -68.4771],
    [-33.0806, -68.4722],
  ];
  store.customers.save({
    phone: "5492635000000",
    name: "Almacén de ejemplo",
    plan: "mayorista",
    credit: true,
    address: "Belgrano 1200",
    localityId: "san-martin",
    created: at,
    updated: at,
  });
  store.orders.save({
    id: "PC-1024",
    key: "demo-seed",
    customer: "5492635000000",
    name: "Almacén de ejemplo",
    phone: "263 500-0000",
    address: "Belgrano 1200",
    locality: {
      id: "san-martin",
      name: "San Martín",
      postalCode: "5570",
      province: "Mendoza",
      country: "Argentina",
    },
    plan: "mayorista",
    items: [
      {
        id: "entero",
        name: "Pollo entero",
        kg: 20,
        price: 3500,
        lineTotal: 70000,
      },
      { id: "suprema", name: "Suprema", kg: 5, price: 7440, lineTotal: 37200 },
    ],
    subtotal: 107200,
    shipping: 0,
    total: 107200,
    payment: "cuenta",
    paid: false,
    status: "en_camino",
    driver: "Franco",
    boxes: 0,
    returned: 0,
    created: at,
    demo: true,
    departedAt: at,
    eta: {
      minutes: 4,
      km: 1.1,
      source: "estimado",
      at,
      arrival: new Date(Date.now() + 4 * 60000).toISOString(),
    },
    destination: {
      lat: -33.0812,
      lng: -68.4698,
      label: "Belgrano 1200, San Martín, Mendoza",
      precise: true,
    },
    location: { lat: track.at(-1)[0], lng: track.at(-1)[1], at },
    track,
    history: statuses.slice(0, 3).map((status) => ({ status, at })),
  });
}

const pages = {
  "/": [
    "Pedidos de pollo fresco a domicilio en San Martín, Mendoza | Pollito Casero",
    "Elegí pollo entero o por corte, por kilo, comprá como mayorista o minorista y seguí tu pedido hasta la puerta. Pollito Casero, San Martín, Mendoza.",
  ],
  "/pedidos": [
    "Mis pedidos | Pollito Casero",
    "Consultá tus pedidos de pollo, repetilos y seguí el estado de preparación y entrega.",
  ],
  "/seguimiento": [
    "Seguí tu pedido | Pollito Casero",
    "Mirá la preparación y el recorrido de tu pedido en el mapa y contactá a tu repartidor.",
  ],
  "/cuenta": [
    "Mi cuenta y envases | Pollito Casero",
    "Revisá el saldo de tu cuenta corriente mayorista, tus movimientos y los envases pendientes de devolución.",
  ],
  "/planes": [
    "Precios mayoristas y minoristas de pollo | Pollito Casero",
    "Compará el precio por kilo de pollo entero y cortes para negocios y hogares. Cuenta corriente para mayoristas habituales.",
  ],
  "/ayuda": [
    "Ayuda y contacto | Pollito Casero",
    "Respuestas sobre pedidos, pagos, envases y entregas. Escribinos por WhatsApp.",
  ],
  "/operacion": [
    "Panel de operación | Pollito Casero",
    "Preparación, asignación de repartidores, cobros y envases.",
  ],
  "/reparto": [
    "Mis entregas | Pollito Casero",
    "Entregas asignadas al repartidor, GPS compartido y cobros.",
  ],
  "/acceso": [
    "Acceso del equipo | Pollito Casero",
    "Ingreso para administración y repartidores de Pollito Casero.",
  ],
  "/admin": [
    "Administración | Pollito Casero",
    "Ingreso de Pollito Casero para gestionar pedidos, repartos y clientes.",
  ],
  "/imprimir": [
    "Hoja de pedidos y ruta | Pollito Casero",
    "Impresión de la hoja de pedidos del día y la hoja de ruta por repartidor.",
  ],
};
const indexable = ["/", "/planes", "/ayuda"];
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};
const vite = dev
  ? await (
      await import("vite")
    ).createServer({ server: { middlewareMode: true }, appType: "custom" })
  : null;

const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "")
      .split(/; */)
      .filter(Boolean)
      .map((c) => c.split("=").map(decodeURIComponent)),
  );
const sessionCookie = (id) =>
  `pc_session=${id || ""}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${id ? 60 * 60 * 24 * 90 : 0}`;
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(value ?? null));
};
async function readBody(req) {
  let text = "";
  for await (const c of req) {
    text += c;
    if (text.length > 20000)
      throw new ApiError(413, "Solicitud demasiado grande.");
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "Cuerpo de la solicitud inválido.");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, base);
  const path = url.pathname;
  try {
    const host = req.headers.host || "";
    if (
      host !== baseHost &&
      !new RegExp(`^(localhost|127\\.0\\.0\\.1):${port}$`).test(host)
    ) {
      res.writeHead(403);
      return res.end("Host no permitido.");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (path.startsWith("/api/")) {
      const allowedOrigins = [
        base.replace(/\/$/, ""),
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
      ];
      if (
        req.method !== "GET" &&
        req.headers.origin &&
        !allowedOrigins.includes(req.headers.origin)
      )
        return json(res, 403, { error: "Origen no permitido." });
      const session = store.sessions.get(cookies(req).pc_session);
      if (path === "/api/events" && req.method === "GET") {
        if (!session)
          return json(res, 401, { error: "Ingresá para recibir novedades." });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        return events.subscribe(res, session);
      }
      const body = req.method === "GET" ? {} : await readBody(req);
      const result = await api({
        method: req.method,
        path,
        body,
        query: url.searchParams,
        session,
      });
      if (!result) return json(res, 404, { error: "Recurso no encontrado." });
      const headers = {};
      if ("session" in result)
        headers["Set-Cookie"] = sessionCookie(result.session?.id);
      return json(res, result.status, result.body, headers);
    }
    if (path === "/robots.txt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(
        `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /cuenta\nDisallow: /pedidos\nDisallow: /seguimiento\nDisallow: /operacion\nDisallow: /reparto\nDisallow: /acceso\nDisallow: /admin\nDisallow: /imprimir\nSitemap: ${base}/sitemap.xml\n`,
      );
    }
    if (path === "/sitemap.xml") {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      return res.end(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${indexable
          .map(
            (p) =>
              `<url><loc>${esc(base + p)}</loc><changefreq>weekly</changefreq></url>`,
          )
          .join("")}</urlset>`,
      );
    }
    if (path === "/llms.txt" || path === "/llm.txt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end(
        `# Pollito Casero\n\n> Pedidos de pollo fresco por kilogramo con entrega a domicilio en San Martín y alrededores, Mendoza, Argentina. Pollo entero y cortes. Modalidades mayorista (cuenta corriente y envases retornables), intermedio y minorista (pago al recibir).\n\n## Páginas\n\n- [Catálogo y pedido](${base}/): productos, precios por kilo y carrito.\n- [Planes y precios](${base}/planes): comparación de modalidades.\n- [Ayuda y contacto](${base}/ayuda): preguntas frecuentes y WhatsApp.\n\n## Notas\n\n- Ubicación del local: ${origin.address}.\n- Las páginas de pedidos, seguimiento, cuenta y operación son privadas y no deben indexarse.\n- Los precios publicados pueden variar; el servidor calcula el total al confirmar.\n`,
      );
    }
    const finish = async () => {
      const root = resolve(dev ? "public" : "dist");
      const target = resolve(root, "." + decodeURIComponent(path));
      if (
        path !== "/" &&
        target.startsWith(root + sep) &&
        ![".html", ".mjs", ".jsx"].includes(extname(target))
      ) {
        try {
          const data = await readFile(target);
          res.setHeader(
            "Content-Type",
            types[extname(target)] || "application/octet-stream",
          );
          if (path.startsWith("/assets/"))
            res.setHeader(
              "Cache-Control",
              "public, max-age=31536000, immutable",
            );
          else if (path === "/sw.js")
            res.setHeader("Cache-Control", "no-cache");
          else res.setHeader("Cache-Control", "public, max-age=86400");
          return res.end(data);
        } catch {}
      }
      const meta = pages[path] || [
        "Página no encontrada | Pollito Casero",
        "La página que buscás no existe. Volvé al catálogo de Pollito Casero para armar tu pedido.",
      ];
      let html = await readFile(dev ? "index.html" : "dist/index.html", "utf8");
      html = html
        .replaceAll("__TITLE__", esc(meta[0]))
        .replaceAll("__DESCRIPTION__", esc(meta[1]))
        .replaceAll("__CANONICAL__", esc(base + (pages[path] ? path : "/")))
        .replaceAll("__OG_IMAGE__", esc(base + "/og.png"))
        .replaceAll(
          "__ROBOTS__",
          indexable.includes(path) ? "index,follow" : "noindex,nofollow",
        );
      if (dev) html = await vite.transformIndexHtml(req.url, html);
      res.writeHead(pages[path] ? 200 : 404, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(html);
    };
    if (vite)
      vite.middlewares(req, res, () => {
        finish().catch((e) => {
          console.error(e);
          res.writeHead(500);
          res.end("No se pudo cargar la aplicación.");
        });
      });
    else await finish();
  } catch (e) {
    if (!(e instanceof ApiError) && e.constructor !== Error) console.error(e);
    const status = e instanceof ApiError ? e.status : 400;
    json(res, status, {
      error: e.message || "No se pudo completar la solicitud.",
    });
  }
});
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `Pollito Casero · ${process.env.HOST ? "escuchando en " + process.env.HOST : "demo local"} · http://localhost:${port}`,
  ),
);
