import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
} from "@react-pdf/renderer";
import { remitoData } from "../lib/remito.js";

// Sin silabeo: en un remito chico "INSCRIP-TO" o "CASE-RO" se leen mal.
Font.registerHyphenationCallback((word) => [word]);

/**
 * Un remito por página, 105 mm de ancho, sin marcas de corte. Mide A6 (148 mm) como mínimo y se
 * alarga con los renglones: un pedido con muchos productos no se pisa con el total ni la firma.
 * Margen interno de 4 mm para impresión en papel precortado.
 */
const MM = 72 / 25.4;
const PAGE_W = 105 * MM;
const PAGE_H = 148 * MM;
const MIN_ROWS = 6;

const RED = "#dc2626";
const INK = "#111111";
const MUTED = "#555555";
const LINE = "#c8c8c8";
const GREEN = "#15803d";

const s = StyleSheet.create({
  page: { backgroundColor: "#ffffff" },
  cell: {
    width: PAGE_W,
    minHeight: PAGE_H,
    padding: 4 * MM,
    paddingBottom: 5 * MM,
    fontFamily: "Helvetica",
    fontSize: 8,
    color: INK,
  },
  head: { flexDirection: "row", alignItems: "flex-start" },
  logo: { width: 42, height: 28, objectFit: "contain", marginTop: 1 },
  brand: { flex: 1, marginLeft: 6, paddingRight: 6 },
  title: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: RED,
    letterSpacing: 0.2,
    lineHeight: 1.15,
    marginBottom: 4,
  },
  tagline: { fontSize: 7, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  small: { fontSize: 6.3, color: MUTED, lineHeight: 1.3 },
  doc: { width: 80, alignItems: "flex-end" },
  docTitle: { fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 1 },
  docNum: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 5 },
  docLine: { fontSize: 7.5, marginTop: 2 },
  fiscal: {
    fontSize: 5.8,
    color: MUTED,
    textAlign: "right",
    lineHeight: 1.3,
    marginTop: 2.5,
  },
  bold: { fontFamily: "Helvetica-Bold" },
  rule: { borderBottomWidth: 1.2, borderBottomColor: RED, marginTop: 5 },
  client: {
    marginTop: 5,
    borderWidth: 0.6,
    borderColor: "#e0e0e0",
    backgroundColor: "#fafafa",
    borderRadius: 2,
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  clientRow: { flexDirection: "row", gap: 6 },
  clientCol: { flex: 1 },
  clientLine: { fontSize: 8.2, marginBottom: 3, lineHeight: 1.2 },
  table: { marginTop: 6, borderWidth: 0.6, borderColor: LINE },
  tr: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINE },
  trLast: { borderBottomWidth: 0 },
  th: {
    backgroundColor: RED,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    paddingVertical: 3.5,
    paddingHorizontal: 3,
  },
  td: { paddingVertical: 3.2, paddingHorizontal: 3, fontSize: 9 },
  tdTight: { paddingVertical: 1.6, fontSize: 8.5 },
  kilos: { width: 34, textAlign: "right" },
  // Renglón virtual (saldo anterior): se distingue de los productos físicos.
  virtual: { color: "#666", fontFamily: "Helvetica-Oblique" },
  // Deuda en rojo, saldo a favor en verde: el cliente tiene que verlo de un vistazo.
  debt: { color: RED, fontFamily: "Helvetica-Bold" },
  credit: { color: GREEN, fontFamily: "Helvetica-Bold" },
  debtRow: { backgroundColor: "#fef2f2" },
  creditRow: { backgroundColor: "#f0fdf4" },
  creditLeft: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: GREEN,
    textAlign: "right",
    marginTop: 3,
  },
  detail: { flex: 1, borderLeftWidth: 0.6, borderLeftColor: LINE },
  unit: {
    width: 60,
    textAlign: "right",
    borderLeftWidth: 0.6,
    borderLeftColor: LINE,
  },
  total: {
    width: 72,
    textAlign: "right",
    borderLeftWidth: 0.6,
    borderLeftColor: LINE,
  },
  note: { fontSize: 7.2, color: MUTED, marginTop: 5 },
  foot: {
    marginTop: 9,
    flexDirection: "column",
    alignItems: "stretch",
  },
  totalLine: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "right" },
  // Empuja la firma al pie del A6; si el remito es más largo, la firma va después del total.
  spacer: { flexGrow: 1, minHeight: 22 },
  bottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sign: {
    width: 110,
    borderTopWidth: 0.6,
    borderTopColor: MUTED,
    paddingTop: 2.5,
  },
  signText: { fontSize: 7.2, color: MUTED, textAlign: "center" },
  preventista: { fontSize: 7, color: MUTED },
});

function Remito({ data: d, fiscal, logo }) {
  const rows = Math.max(MIN_ROWS, d.lines.length);
  const tight = rows > 6;
  return (
    <View style={s.cell}>
      <View style={s.head}>
        {logo ? <Image style={s.logo} src={logo} /> : null}
        <View style={s.brand}>
          <Text style={s.title}>{fiscal.legalName || "EL POLLITO CASERO"}</Text>
          <Text style={s.tagline}>
            {fiscal.tagline || "VENTA POR MAYOR Y MENOR"}
          </Text>
          <Text style={s.small}>
            {fiscal.address || "Carril Norte S/N° 0 - El Ramblón, Mza."}
          </Text>
          <Text style={s.small}>
            WhatsApp: {fiscal.whatsapp || "+54 9 2634 56-9139"}
          </Text>
        </View>
        <View style={s.doc}>
          <Text style={s.docTitle}>REMITO INTERNO</Text>
          <Text style={s.docNum}>N° {d.number}</Text>
          <Text style={s.docLine}>
            <Text style={s.bold}>Fecha:</Text> {d.date}
          </Text>
        </View>
      </View>
      <View style={s.rule} />
      <Text style={s.fiscal}>
        DOCUMENTO NO VÁLIDO COMO FACTURA
        {fiscal.cuit ? ` · C.U.I.T. ${fiscal.cuit}` : ""}
        {fiscal.iibb ? ` · Ing. Brutos ${fiscal.iibb}` : ""}
        {" · "}
        {fiscal.ivaCondition || "IVA RESPONSABLE INSCRIPTO"}
      </Text>
      <View style={s.client}>
        <View style={s.clientRow}>
          <Text style={[s.clientLine, { flex: 1.4 }]}>
            <Text style={s.bold}>Cliente:</Text> {d.name}
          </Text>
          <Text style={[s.clientLine, s.clientCol]}>
            <Text style={s.bold}>Cel.:</Text> {d.phone}
          </Text>
        </View>
        <View style={s.clientRow}>
          <Text style={[s.clientLine, { flex: 1.4, marginBottom: 0 }]}>
            <Text style={s.bold}>Calle:</Text> {d.address}
          </Text>
          <Text style={[s.clientLine, s.clientCol, { marginBottom: 0 }]}>
            <Text style={s.bold}>Localidad:</Text> {d.locality}
          </Text>
        </View>
      </View>
      <View style={s.table}>
        <View style={s.tr}>
          <Text style={[s.th, s.kilos]}>KILOS</Text>
          <Text style={[s.th, s.detail, { borderLeftColor: RED }]}>
            DETALLE
          </Text>
          <Text style={[s.th, s.unit, { borderLeftColor: RED }]}>
            PRECIO X UN.
          </Text>
          <Text style={[s.th, s.total, { borderLeftColor: RED }]}>
            PRECIO TOTAL
          </Text>
        </View>
        {Array.from({ length: rows }, (_, i) => {
          const l = d.lines[i];
          const td = tight ? [s.td, s.tdTight] : [s.td];
          const tone = l?.virtual ? s[l.tone] || s.virtual : null;
          const rowTone = l?.tone ? s[l.tone + "Row"] : null;
          return (
            <View
              key={i}
              style={[s.tr, rowTone, i === rows - 1 ? s.trLast : null]}
            >
              <Text style={[...td, s.kilos]}>{l ? l.kg : " "}</Text>
              <Text style={[...td, s.detail, tone]}>{l ? l.detail : " "}</Text>
              <Text style={[...td, s.unit]}>{l ? l.unit : " "}</Text>
              <Text style={[...td, s.total, tone]}>{l ? l.total : " "}</Text>
            </View>
          );
        })}
      </View>
      {d.notes ? <Text style={s.note}>Obs.: {d.notes}</Text> : null}
      <View style={s.foot}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            marginBottom: 5,
          }}
        >
          <Text
            style={{
              fontSize: 8.2,
              fontFamily: "Helvetica-Bold",
              marginRight: 4,
            }}
          >
            CAJAS ADEUDADAS:
          </Text>
          <Text
            style={{
              minWidth: 56,
              borderBottomWidth: 0.6,
              borderBottomColor: MUTED,
              fontSize: 8.5,
              paddingBottom: 1,
              paddingHorizontal: 2,
            }}
          >
            {d.owedBoxesText || " "}
          </Text>
        </View>
        <Text style={s.totalLine}>TOTAL: {d.total || " "}</Text>
        {d.creditLeft ? (
          <Text style={s.creditLeft}>Le queda a favor: {d.creditLeft}</Text>
        ) : null}
      </View>
      <View style={s.spacer} />
      <View style={s.bottom} wrap={false}>
        <View style={s.sign}>
          <Text style={s.signText}>Firma Conforme</Text>
        </View>
        <Text style={s.preventista}>
          {d.driver ? `Preventista: ${d.driver}` : " "}
        </Text>
      </View>
    </View>
  );
}

export function RemitoDocument({
  orders,
  customers = [],
  fiscal = {},
  logo = "/brand/logo-pollito-print.png",
  hidePrices = false,
  hideBalance = false,
}) {
  return (
    <Document
      title={
        orders.length === 1
          ? `Remito ${orders[0].id}`
          : `Remitos (${orders.length})`
      }
      author={fiscal.legalName || "El Pollito Casero"}
      language="es-AR"
    >
      {orders.map((o) => (
        // Solo ancho: la altura sale del contenido (mínimo A6, ver s.cell).
        <Page key={o.id} size={{ width: PAGE_W }} style={s.page} wrap={false}>
          <Remito
            data={remitoData(
              o,
              customers.find((c) => c.phone === o.customer),
              { hidePrices, hideBalance },
            )}
            fiscal={fiscal}
            logo={logo}
          />
        </Page>
      ))}
    </Document>
  );
}

export default RemitoDocument;
