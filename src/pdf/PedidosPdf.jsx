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
 * Hoja de pedidos (PDF, A4 apaisada): todos los pedidos cargados para una fecha en una sola
 * tabla que ocupa el ancho completo de la hoja. Cabecera con el logo, el turno y la cantidad de
 * pedidos; columnas N° PEDIDO (= N° de remito) · CLIENTE (nombre y, debajo, dirección) ·
 * PRODUCTO · KG · OBSERVACIÓN. Las filas no se parten entre hojas; la cabecera de la tabla se
 * repite en cada una.
 */

const MM = 72 / 25.4;
const INK = "#111111";
const MUTED = "#555555";
const LINE = "#9a9a9a";
const RED = "#dc2626";
const ZEBRA = "#f1f1f1";

const shiftName = { manana: "Mañana", tarde: "Tarde" };
const fmtKg = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
const dmy = (iso) => (iso || "").split("-").reverse().join("/");

const s = StyleSheet.create({
  page: {
    backgroundColor: "#ffffff",
    paddingTop: 8 * MM,
    paddingBottom: 10 * MM,
    paddingHorizontal: 10 * MM,
    fontFamily: "Helvetica",
    fontSize: 8.5,
    color: INK,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1.5,
    borderBottomColor: RED,
    paddingBottom: 6,
    marginBottom: 8,
  },
  logo: { width: 112, height: 34, objectFit: "contain", marginRight: 14 },
  titleBox: { flex: 1 },
  title: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sub: { fontSize: 8, color: MUTED, marginTop: 2 },
  facts: { flexDirection: "row", gap: 18 },
  fact: { alignItems: "flex-end" },
  factLabel: {
    fontSize: 6.5,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  factValue: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 1 },
  table: { borderWidth: 0.8, borderColor: LINE },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.6,
    borderBottomColor: LINE,
  },
  th: {
    backgroundColor: "#e9e9e9",
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderRightWidth: 0.6,
    borderRightColor: LINE,
  },
  td: {
    paddingVertical: 4,
    paddingHorizontal: 5,
    borderRightWidth: 0.6,
    borderRightColor: LINE,
    justifyContent: "flex-start",
    minHeight: 24,
  },
  zebra: { backgroundColor: ZEBRA },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 7, color: MUTED, marginTop: 2 },
  line: { marginBottom: 2 },
  cNum: { width: 64 },
  cClient: { flex: 1.45 },
  cProduct: { flex: 1.25 },
  cKg: { width: 58, textAlign: "right" },
  cObs: { flex: 1, borderRightWidth: 0 },
  foot: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    fontSize: 7,
    color: MUTED,
  },
  pageNum: {
    position: "absolute",
    bottom: 5 * MM,
    right: 10 * MM,
    fontSize: 7,
    color: MUTED,
  },
  empty: { marginTop: 20, fontSize: 10, color: MUTED, textAlign: "center" },
});

const productLine = (p) =>
  (p.boxes
    ? `${p.boxes} ${p.boxes === 1 ? "caja" : "cajas"} · `
    : (p.ordered ?? p.kg)
      ? `${fmtKg(p.ordered ?? p.kg)} kg · `
      : "") + p.name;

function Row({ o, zebra }) {
  const items = o.items.filter((p) => p.kg > 0 || p.boxes || p.ordered);
  return (
    <View style={[s.tr, zebra ? s.zebra : null]} wrap={false}>
      <View style={[s.td, s.cNum]}>
        <Text style={[s.bold, { fontSize: 9.5 }]}>{orderNumber(o)}</Text>
        {o.driver ? <Text style={s.small}>{o.driver}</Text> : null}
      </View>
      <View style={[s.td, s.cClient]}>
        <Text style={s.bold}>{o.name}</Text>
        <Text style={s.small}>
          {[o.address, o.zone || o.locality?.name]
            .filter(Boolean)
            .join(" · ") || " "}
        </Text>
      </View>
      <View style={[s.td, s.cProduct]}>
        {items.map((p) => (
          <Text key={p.id} style={s.line}>
            {productLine(p)}
          </Text>
        ))}
        {!items.length && <Text> </Text>}
      </View>
      <View style={[s.td, s.cKg]}>
        {items.map((p) => (
          <Text key={p.id} style={[s.line, s.bold]}>
            {p.kg > 0 ? fmtKg(p.kg) : " "}
          </Text>
        ))}
        {!items.length && <Text> </Text>}
      </View>
      <View style={[s.td, s.cObs]}>
        <Text>{o.notes || " "}</Text>
      </View>
    </View>
  );
}

export function PedidosDocument({
  date,
  orders,
  shift = "",
  logo = "/brand/logo-texto.png",
}) {
  const sorted = [...orders].sort(
    (a, b) =>
      (a.driver || "").localeCompare(b.driver || "") ||
      (a.number || 0) - (b.number || 0),
  );
  const shifts = shift
    ? [shift]
    : Object.keys(shiftName).filter((k) => sorted.some((o) => o.shift === k));
  const turno = shifts.length
    ? shifts.map((x) => shiftName[x] || x).join(" / ")
    : "—";
  const kg = sorted.reduce(
    (a, o) => a + o.items.reduce((n, p) => n + (p.kg || 0), 0),
    0,
  );
  return (
    <Document
      title={`Hoja de pedidos ${dmy(date)}`}
      author="El Pollito Casero"
      language="es-AR"
    >
      <Page size="A4" orientation="landscape" style={s.page} wrap>
        <View style={s.head} fixed>
          {logo ? <Image style={s.logo} src={logo} /> : null}
          <View style={s.titleBox}>
            <Text style={s.title}>Hoja de pedidos</Text>
            <Text style={s.sub}>
              {dmy(date)} · El número de pedido coincide con el número de
              remito.
            </Text>
          </View>
          <View style={s.facts}>
            <View style={s.fact}>
              <Text style={s.factLabel}>Turno</Text>
              <Text style={s.factValue}>{turno}</Text>
            </View>
            <View style={s.fact}>
              <Text style={s.factLabel}>Pedidos</Text>
              <Text style={s.factValue}>{sorted.length}</Text>
            </View>
          </View>
        </View>
        <View style={s.table}>
          <View style={s.tr} fixed>
            <Text style={[s.th, s.cNum]}>N° pedido</Text>
            <Text style={[s.th, s.cClient]}>Cliente</Text>
            <Text style={[s.th, s.cProduct]}>Producto</Text>
            <Text style={[s.th, s.cKg]}>Kg</Text>
            <Text style={[s.th, s.cObs, { borderRightWidth: 0 }]}>
              Observación
            </Text>
          </View>
          {sorted.map((o, i) => (
            <Row key={o.id} o={o} zebra={i % 2 === 1} />
          ))}
        </View>
        {!sorted.length && (
          <Text style={s.empty}>No hay pedidos cargados para esta fecha.</Text>
        )}
        <View style={s.foot} wrap={false}>
          <Text>
            {sorted.length} {sorted.length === 1 ? "pedido" : "pedidos"}
            {kg > 0 ? ` · ${fmtKg(kg)} kg pesados` : ""}
          </Text>
          <Text>El Pollito Casero · Hoja de pedidos {dmy(date)}</Text>
        </View>
        <Text
          style={s.pageNum}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Hoja ${pageNumber} de ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

export default PedidosDocument;
