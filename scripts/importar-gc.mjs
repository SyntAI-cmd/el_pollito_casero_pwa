/**
 * Importa las fichas de clientes exportadas de GC/Atuq (xlsx) y las listas de precios por cliente
 * (json generado por scripts/parsear-listas.py) a la base de la app.
 *
 *   node scripts/importar-gc.mjs --clientes import/clientes.xlsx --precios import/precios.json [--db data/pollito.sqlite]
 *
 * Idempotente: vuelve a correrse sin duplicar (clave = "c<id GC>" o "l-<zona>-<nombre>" para los que
 * solo están en las listas). Nunca pisa saldos ni pedidos; solo datos de ficha y precios.
 * Los clientes de las listas sin ficha en GC quedan en estado "revisar".
 */
import { readFile } from "node:fs/promises";
import { openStore } from "../server/store.mjs";
import { localities, products } from "../domain.mjs";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : []))
    .filter((x) => x.length),
);
if (!args.clientes && !args.precios) {
  console.error(
    "Uso: node scripts/importar-gc.mjs --clientes <xlsx> --precios <json> [--db ruta]",
  );
  process.exit(1);
}
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const slug = (s) =>
  norm(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const title = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/(^|\s|\.)([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase())
    .trim();
const normalizePhone = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 10 && d.length <= 11 ? "549" + d : "";
};
const ZONE_ALIASES = {
  "ciudad de junin": "Junín",
  junin: "Junín",
  "san martin": "San Martín",
  ciudad: "San Martín",
  "los barriales": "Barriales",
  "tres portenas": "Tres Porteñas",
  "nueva californi": "California",
  "nueva california": "California",
  "fray luis beltran": "Beltrán",
  "rodeo de la cruz": "Rodeo de la Cruz",
  "rodeo del medio": "Rodeo del Medio",
  "los corralitos": "Corralito",
  "las catitas": "Catitas",
  "la dormida": "La Dormida",
  "la paz": "La Paz",
  "santa rosa": "Santa Rosa",
  "godoy cruz": "Godoy Cruz",
  "las heras": "Las Heras",
  lavalle: "Lavalle",
  "tres de mayo": "Lavalle",
  maipu: "Maipú",
  coquimbito: "Maipú",
  perdriel: "Luján",
  carrodilla: "Luján",
  villanueva: "Guaymallén",
  palmira: "Palmira",
  rivadavia: "Rivadavia",
  montecaseros: "San Martín",
  "la colonia": "La Colonia",
};
/** Zona con nombre canónico (misma grafía para GC y listas). */
const canonicalZone = (z) => {
  const n = norm(z);
  if (!n) return "";
  const hit = Object.entries(ZONE_ALIASES).find(
    ([k, v]) => k === n || norm(v) === n,
  );
  return hit ? hit[1] : title(n);
};
const zoneFromDistrict = (district) => {
  const first = norm(String(district || "").split(",")[0]);
  return ZONE_ALIASES[first] || title(first);
};
const localityFor = (zone, district) => {
  const candidates = [zone, String(district || "").split(",")[0]].map(norm);
  return (
    localities.find((l) => candidates.includes(norm(l.name)))?.id ||
    localities.find((l) =>
      candidates.some((c) => c && norm(l.name).includes(c)),
    )?.id ||
    ""
  );
};
const parseAddress = (raw) => {
  if (!raw) return "";
  const m = /CALLE:\s*([^-]+?)(?:\s+N[°º]?:\s*(\d+))?(?:\s*-|$)/i.exec(raw);
  if (!m) return String(raw).slice(0, 250);
  const street = title(m[1].trim());
  const number = m[2] && m[2] !== "0" ? " " + m[2] : "";
  const dept = /DEPTO:\s*([^-]+)/i.exec(raw);
  return `${street}${number}${dept ? " · Depto " + dept[1].trim() : ""}`.slice(
    0,
    250,
  );
};

const stats = {
  creados: 0,
  actualizados: 0,
  precios: 0,
  revisar: 0,
  sucursales: 0,
};
// pdftotext pierde algunas tildes (quedan como U+FFFD): se reponen las más comunes en nombres.
const FIXES = [
  ["av�cola", "avícola"],
  ["andr�s", "andrés"],
  ["jos�", "josé"],
  ["agust�n", "agustín"],
  ["mat�as", "matías"],
  ["hern�n", "hernán"],
  ["n�stor", "néstor"],
  ["rub�n", "rubén"],
  ["porte�as", "porteñas"],
  ["mar�a", "maría"],
  ["an�bal", "aníbal"],
  ["luj�n", "luján"],
  ["jun�n", "junín"],
  ["gui�azu", "guiñazú"],
  ["tap�n", "tapón"],
  ["ag�ero", "agüero"],
];
const fixText = (t) => {
  let out = String(t || "");
  for (const [bad, good] of FIXES)
    out = out.replace(new RegExp(bad, "gi"), (m) =>
      m[0] === m[0].toUpperCase()
        ? good[0].toUpperCase() + good.slice(1)
        : good,
    );
  return out.replace(/�/g, "");
};
const store = await openStore(
  args.db || process.env.DB_PATH || "data/pollito.sqlite",
  { log: { info() {} } },
);
// --reset-listas: vuelve a crear las fichas que solo existen en las listas (sin pedidos), por si mejoró el cruce.
if ("reset-listas" in args)
  for (const c of store.customers.all())
    if (c.phone.startsWith("l-") && store.customers.remove(c.phone))
      stats.borrados = (stats.borrados || 0) + 1;
const upsert = (key, data) => {
  const existing = store.customers.get(key);
  const c = existing || {
    phone: key,
    creditBalance: 0,
    created: new Date().toISOString(),
  };
  const merged = {
    ...c,
    ...data,
    plan: existing?.plan || data.plan || "mayorista",
    credit: existing ? existing.credit : true,
  };
  store.customers.save(merged);
  stats[existing ? "actualizados" : "creados"]++;
  return merged;
};

// ---- 1. Fichas de GC ----
const byGc = new Map();
if (args.clientes) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(args.clientes);
  const ws = wb.worksheets[0];
  const header = ws.getRow(1).values.map((v) => norm(v));
  const col = (name) => header.indexOf(name);
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const v = (name) => {
      const cell = row.getCell(col(name)).value;
      return cell && typeof cell === "object" && "text" in cell
        ? cell.text
        : cell;
    };
    const id = String(v("id") || "").trim();
    if (!id) return;
    const legalName = [v("nombre"), v("apellido")]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    let alias = String(v("descripcion") || "").trim();
    const district = v("distrito");
    let zone = district ? zoneFromDistrict(district) : "";
    // En GC a veces la "descripción" trae la zona en vez del apodo.
    if (
      alias &&
      canonicalZone(alias) &&
      Object.values(ZONE_ALIASES).some(
        (z) => norm(z) === norm(canonicalZone(alias)),
      ) &&
      !norm(alias).includes(" ")
    ) {
      zone = zone || canonicalZone(alias);
      alias = "";
    }
    const data = {
      code: id,
      cuit: String(v("cuit") || "").replace(/\D/g, ""),
      legalName,
      alias: alias || legalName,
      name: title(alias || legalName),
      contactPhone: normalizePhone(v("telefono")),
      address: parseAddress(v("domicilio")),
      localityId: localityFor(zone, district),
      zone,
      status: "ok",
      plan: "mayorista",
    };
    if (/facturar a cuit/i.test(alias)) data.notes = alias;
    byGc.set(id, upsert("c" + id, data));
  });
  console.log(`Fichas GC: ${byGc.size}`);
}

// ---- 2. Listas de precios por cliente ----
if (args.precios) {
  const { lists } = JSON.parse(await readFile(args.precios, "utf8"));
  const productIds = new Set(products.map((p) => p.id));
  const junk = /^(pollo|pechuga c\/?|suprema|alas|cuarto)/i;
  for (const item of lists) {
    item.name = fixText(item.name);
    item.zone = canonicalZone(fixText(item.zone));
    if (junk.test(item.name)) continue; // renglón de producto leído como cliente
    const prices = Object.fromEntries(
      Object.entries(item.prices || {}).filter(
        ([k, v]) => productIds.has(k) && v > 0,
      ),
    );
    let c = item.gcId ? store.customers.get("c" + item.gcId) : null;
    if (!c) {
      const key = `l-${slug(item.zone || "sin-zona")}-${slug(item.name)}`;
      c = upsert(key, {
        name: title(item.name.replace(/\s+(Pollo|Suprema)\s*$/i, "")),
        alias: item.name,
        zone: item.zone || "",
        shift: item.shift,
        localityId: localityFor(item.zone, ""),
        status: "revisar",
        notes: `Tomado de la lista de precios (turno ${item.shift}). Confirmar ficha GC y CUIT.`,
        plan: "mayorista",
      });
      stats.revisar++;
    } else {
      // Si la zona de la lista no coincide con la de GC, puede ser otro cliente con el mismo apodo: a revisar.
      const conflict = c.zone && item.zone && norm(c.zone) !== norm(item.zone);
      c = upsert(c.phone, {
        zone: item.zone || c.zone,
        shift: item.shift || c.shift,
        ...(conflict
          ? {
              status: "revisar",
              notes: `Zona GC: ${c.zone} · zona lista: ${item.zone}. Confirmar que sea el mismo cliente.`,
            }
          : {}),
      });
    }
    for (const [productId, price] of Object.entries(prices)) {
      store.prices.set(c.phone, productId, price, "importación listas 09-09");
      stats.precios++;
    }
  }
}

// ---- 3. Sucursales conocidas de ALMA S.R.L. (Benedetti) ----
const alma = [...byGc.values()].find((c) =>
  /alma s\.?r\.?l/i.test(c.legalName || ""),
);
if (alma) {
  const branches = [
    "Alsina",
    "Ameghino",
    "Azcuénaga",
    "Cervantes",
    "Cortaderas",
    "Dorrego",
    "General Paz",
    "Lamadrid",
    "Serpa Luján",
    "Pedemonte",
    "Coquimbito",
    "Taboada",
    "Terra Malva",
    "Arauca",
    "Nova Market",
  ];
  for (const b of branches) {
    upsert(`${alma.phone}-${slug(b)}`, {
      name: b,
      alias: b,
      branch: b,
      parent: alma.phone,
      legalName: alma.legalName,
      cuit: alma.cuit,
      code: alma.code,
      zone: "Gran Mendoza",
      shift: alma.shift || "manana",
      status: "revisar",
      notes:
        "Sucursal de ALMA S.R.L. (Benedetti). Confirmar zona, camión y precio.",
      plan: "mayorista",
    });
    stats.sucursales++;
  }
}
console.log("Resultado:", stats);
