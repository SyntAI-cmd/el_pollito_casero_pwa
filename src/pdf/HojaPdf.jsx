import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";
import { orderNumber } from "../lib/remito.js";

/**
 * Hoja de pedidos del repartidor (PDF, A4 apaisada): el consolidado de la camioneta que se lleva el
 * reparto y vuelve completado a mano. Cabecera con fecha, preventistas, pedidos, kilos e importe
 * total; una fila por pedido con N° PEDIDO (= N° de remito), CLIENTE, CUIT, DETALLE, CAJONES,
 * CAJAS ADEUDADAS y TOTAL, y columnas en blanco para MÉTODO DE PAGO (T/E/CH), PAGO, SALDO y
 * comprobante/remito adjuntos. Hasta ~18 pedidos por hoja; sigue en otra hoja si hay más.
 */

const RED = "#dc2626";
const INK = "#111111";
const MUTED = "#555555";
const LINE = "#bdbdbd";
const HAND = "#fffbea";

const money = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
const kg = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
const dmy = (iso) => (iso || "").split("-").reverse().join("/");

const s = StyleSheet.create({
  page: {
    backgroundColor: "#fff",
    paddingVertical: 22,
    paddingHorizontal: 26,
    fontFamily: "Helvetica",
    fontSize: 8.5,
    color: INK,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: RED,
    paddingBottom: 8,
    marginBottom: 8,
  },
  logo: { width: 120, height: 36, objectFit: "contain" },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  meta: { flexDirection: "row", gap: 18 },
  metaItem: { alignItems: "flex-start" },
  metaLabel: {
    fontSize: 6.5,
    color: MUTED,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  metaValue: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 1 },
  table: { borderWidth: 1, borderColor: LINE },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    minHeight: 24,
  },
  th: {
    backgroundColor: "#f5c400",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    letterSpacing: 0.4,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderRightColor: LINE,
  },
  td: {
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderRightColor: LINE,
    justifyContent: "center",
  },
  hand: { backgroundColor: HAND },
  num: { textAlign: "right" },
  small: { fontSize: 7, color: MUTED },
  bold: { fontFamily: "Helvetica-Bold" },
  cNum: { width: 40 },
  cClient: { width: 120 },
  cCuit: { width: 62 },
  cDetail: { flex: 1.4 },
  cCrates: { width: 46 },
  cOwed: { width: 44 },
  cTotal: { width: 66 },
  cMethod: { width: 60 },
  cPaid: { width: 62 },
  cBalance: { width: 62 },
  cDocs: { width: 58 },
  foot: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    fontSize: 8,
    color: MUTED,
  },
  sign: {
    flexDirection: "row",
    gap: 30,
    marginTop: 26,
  },
  signBox: { flex: 1, borderTopWidth: 1, borderTopColor: INK, paddingTop: 3 },
  signText: { fontSize: 7.5, color: MUTED, textAlign: "center" },
  pageNum: {
    position: "absolute",
    bottom: 12,
    right: 26,
    fontSize: 7,
    color: MUTED,
  },
});

const ROWS_PER_PAGE = 18;

function Head({ date, drivers, vehicle, orders, logo }) {
  const totalKg = orders.reduce(
    (a, o) => a + o.items.reduce((k, i) => k + (i.kg || 0), 0),
    0,
  );
  const total = orders.reduce((a, o) => a + o.total, 0);
  return (
    <View style={s.head}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        {logo ? <Image style={s.logo} src={logo} /> : null}
        <View>
          <Text style={s.title}>Hoja de pedidos</Text>
          <Text style={s.small}>
            {vehicle ? `${vehicle} · ` : ""}
            Preventistas: {drivers.length ? drivers.join(" / ") : "—"}
          </Text>
        </View>
      </View>
      <View style={s.meta}>
        <View style={s.metaItem}>
          <Text style={s.metaLabel}>Fecha</Text>
          <Text style={s.metaValue}>{dmy(date)}</Text>
        </View>
        <View style={s.metaItem}>
          <Text style={s.metaLabel}>Pedidos</Text>
          <Text style={s.metaValue}>{orders.length}</Text>
        </View>
        <View style={s.metaItem}>
          <Text style={s.metaLabel}>Kilos totales</Text>
          <Text style={s.metaValue}>{totalKg ? `${kg(totalKg)} kg` : "—"}</Text>
        </View>
        <View style={s.metaItem}>
          <Text style={s.metaLabel}>Importe total</Text>
          <Text style={s.metaValue}>{money(total)}</Text>
        </View>
      </View>
    </View>
  );
}

function Row({ o, c }) {
  const crates = o.items.reduce((n, i) => n + (i.boxes || 0), 0);
  const owed = Math.max(0, c?.summary?.boxes || 0);
  const detail = o.items
    .map((i) =>
      i.kg > 0
        ? `${kg(i.kg)} kg ${i.name.toLowerCase()}${i.boxes ? ` (${i.boxes} cj)` : ""}`
        : i.boxes
          ? `${i.boxes} cajas ${i.name.toLowerCase()}`
          : `${kg(i.ordered ?? i.kg)} kg ${i.name.toLowerCase()}`,
    )
    .join(" · ");
  return (
    <View style={s.tr} wrap={false}>
      <View style={[s.td, s.cNum]}>
        <Text style={s.bold}>{orderNumber(o)}</Text>
      </View>
      <View style={[s.td, s.cClient]}>
        <Text style={s.bold}>{c?.alias || o.name}</Text>
        <Text style={s.small}>
          {[o.zone || c?.zone, o.payment === "cuenta" ? "cta. cte." : "contado"]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <View style={[s.td, s.cCuit]}>
        <Text>{c?.cuit || "—"}</Text>
      </View>
      <View style={[s.td, s.cDetail]}>
        <Text>{detail}</Text>
        {o.notes ? <Text style={s.small}>“{o.notes}”</Text> : null}
      </View>
      <View style={[s.td, s.cCrates, s.num]}>
        <Text>{crates || "—"}</Text>
      </View>
      <View style={[s.td, s.cOwed, s.num]}>
        <Text>{owed || "—"}</Text>
      </View>
      <View style={[s.td, s.cTotal, s.num]}>
        <Text style={s.bold}>{money(o.total)}</Text>
      </View>
      <View style={[s.td, s.cMethod, s.hand]}>
        <Text style={s.small}>T · E · CH</Text>
      </View>
      <View style={[s.td, s.cPaid, s.hand]}>
        <Text> </Text>
      </View>
      <View style={[s.td, s.cBalance, s.hand]}>
        <Text> </Text>
      </View>
      <View style={[s.td, s.cDocs, s.hand, { borderRightWidth: 0 }]}>
        <Text style={s.small}>[ ] compr. [ ] remito</Text>
      </View>
    </View>
  );
}

export function HojaDocument({
  date,
  drivers = [],
  vehicle = "",
  orders,
  customers = [],
  logo = "/brand/logo-texto.png",
}) {
  const sorted = [...orders].sort((a, b) => (a.number || 0) - (b.number || 0));
  const pages = [];
  for (let i = 0; i < Math.max(1, sorted.length); i += ROWS_PER_PAGE)
    pages.push(sorted.slice(i, i + ROWS_PER_PAGE));
  const total = orders.reduce((a, o) => a + o.total, 0);
  return (
    <Document
      title={`Hoja de pedidos ${dmy(date)} ${drivers.join(" y ")}`}
      author="El Pollito Casero"
      language="es-AR"
    >
      {pages.map((chunk, pi) => (
        <Page key={pi} size="A4" orientation="landscape" style={s.page}>
          <Head
            date={date}
            drivers={drivers}
            vehicle={vehicle}
            orders={orders}
            logo={logo}
          />
          <View style={s.table}>
            <View style={s.tr}>
              <Text style={[s.th, s.cNum]}>PEDIDO</Text>
              <Text style={[s.th, s.cClient]}>CLIENTE</Text>
              <Text style={[s.th, s.cCuit]}>CUIT</Text>
              <Text style={[s.th, s.cDetail]}>DETALLE</Text>
              <Text style={[s.th, s.cCrates, s.num]}>CAJ.</Text>
              <Text style={[s.th, s.cOwed, s.num]}>CAJAS ADEUD.</Text>
              <Text style={[s.th, s.cTotal, s.num]}>TOTAL</Text>
              <Text style={[s.th, s.cMethod]}>MÉTODO DE PAGO</Text>
              <Text style={[s.th, s.cPaid]}>PAGO</Text>
              <Text style={[s.th, s.cBalance]}>SALDO</Text>
              <Text style={[s.th, s.cDocs, { borderRightWidth: 0 }]}>
                ADJUNTOS
              </Text>
            </View>
            {chunk.map((o) => (
              <Row
                key={o.id}
                o={o}
                c={customers.find((x) => x.phone === o.customer)}
              />
            ))}
            {pi === pages.length - 1 && (
              <View style={[s.tr, { backgroundColor: "#f4f2ec" }]}>
                <View style={[s.td, { flex: 1 }]}>
                  <Text style={s.bold}>
                    TOTAL · {orders.length}{" "}
                    {orders.length === 1 ? "pedido" : "pedidos"}
                  </Text>
                </View>
                <View style={[s.td, s.cTotal, s.num]}>
                  <Text style={s.bold}>{money(total)}</Text>
                </View>
                <View style={[s.td, s.cMethod, s.hand]}>
                  <Text> </Text>
                </View>
                <View style={[s.td, s.cPaid, s.hand]}>
                  <Text> </Text>
                </View>
                <View style={[s.td, s.cBalance, s.hand]}>
                  <Text> </Text>
                </View>
                <View style={[s.td, s.cDocs, s.hand, { borderRightWidth: 0 }]}>
                  <Text> </Text>
                </View>
              </View>
            )}
          </View>
          {pi === pages.length - 1 && (
            <>
              <View style={s.foot}>
                <Text>
                  Método de pago: T = transferencia · E = efectivo · CH =
                  cheque. Adjuntar foto del comprobante y del remito firmado
                  desde la app.
                </Text>
                <Text>
                  Efectivo rendido $ __________ · Transferencias $ __________ ·
                  Cheques $ __________
                </Text>
              </View>
              <View style={s.sign}>
                <View style={s.signBox}>
                  <Text style={s.signText}>Firma repartidor</Text>
                </View>
                <View style={s.signBox}>
                  <Text style={s.signText}>Firma administración</Text>
                </View>
              </View>
            </>
          )}
          <Text style={s.pageNum}>
            Hoja {pi + 1} de {pages.length}
          </Text>
        </Page>
      ))}
    </Document>
  );
}

export default HojaDocument;
