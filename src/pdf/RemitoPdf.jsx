import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";
import { remitoData } from "../lib/remito.js";

/**
 * Remito interno en PDF: por cada pedido, una hoja A4 con el ORIGINAL y otra con el DUPLICADO
 * (se archivan por separado), calcadas del talonario: cabecera con el logo y los datos fiscales,
 * cliente, grilla KILOS · DETALLE · PRECIO X UN. · PRECIO TOTAL y al pie CAJAS ADEUDADAS,
 * Firma Conforme y TOTAL. Varios pedidos = varias hojas en el mismo documento.
 */

const RED = "#dc2626";
const INK = "#111111";
const MUTED = "#555555";
const LINE = "#cccccc";

const s = StyleSheet.create({
  page: {
    flexDirection: "column",
    backgroundColor: "#ffffff",
    paddingVertical: 34,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 10.5,
    color: INK,
  },
  copy: { flex: 1, position: "relative", paddingBottom: 90 },
  watermark: {
    position: "absolute",
    top: 0,
    right: 0,
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    borderWidth: 1,
    borderColor: MUTED,
    paddingVertical: 3,
    paddingHorizontal: 9,
    letterSpacing: 1.5,
  },
  head: { flexDirection: "row", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 120, height: 82, objectFit: "contain" },
  title: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: RED,
    letterSpacing: 0.3,
  },
  tagline: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2 },
  small: { fontSize: 9, color: MUTED, marginTop: 2 },
  doc: { alignItems: "flex-end", paddingTop: 26 },
  docTitle: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  docSub: { fontSize: 7.5, color: MUTED },
  docLine: { fontSize: 10, marginTop: 3 },
  bold: { fontFamily: "Helvetica-Bold" },
  rule: { borderBottomWidth: 2, borderBottomColor: RED, marginTop: 12 },
  client: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#fafafa",
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
  },
  clientCol: { flex: 1, gap: 6 },
  table: { marginTop: 14, borderWidth: 1, borderColor: LINE },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE },
  trLast: { borderBottomWidth: 0 },
  th: {
    backgroundColor: RED,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  td: { paddingVertical: 7, paddingHorizontal: 8, fontSize: 10.5 },
  kilos: { width: 76 },
  detail: { flex: 1, borderLeftWidth: 1, borderLeftColor: LINE },
  unit: {
    width: 110,
    textAlign: "right",
    borderLeftWidth: 1,
    borderLeftColor: LINE,
  },
  total: {
    width: 116,
    textAlign: "right",
    borderLeftWidth: 1,
    borderLeftColor: LINE,
  },
  note: { fontSize: 9.5, color: MUTED, marginTop: 8 },
  foot: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  boxes: { fontSize: 11, color: "#374151" },
  balance: { fontSize: 9, color: MUTED, marginTop: 4 },
  totalLine: { fontSize: 17, fontFamily: "Helvetica-Bold" },
  sign: { position: "absolute", left: 0, bottom: 0, width: 220 },
  signLine: { borderTopWidth: 1, borderTopColor: MUTED },
  signText: { fontSize: 9, color: MUTED, textAlign: "center", marginTop: 4 },
});

const MIN_ROWS = 10;

function Copy({ data, fiscal, logo, label }) {
  const d = data;
  const rows = Math.max(MIN_ROWS, d.lines.length);
  return (
    <View style={s.copy}>
      <Text style={s.watermark}>{label}</Text>
      <View style={s.head}>
        <View style={s.brand}>
          {logo ? <Image style={s.logo} src={logo} /> : null}
          <View>
            <Text style={s.title}>
              {fiscal.legalName || "EL POLLITO CASERO"}
            </Text>
            <Text style={s.tagline}>
              {fiscal.tagline || "VENTA POR MAYOR Y MENOR"}
            </Text>
            <Text style={s.small}>
              {fiscal.address || "Carril Norte S/N° 0 - El Ramblón, Mza."}
            </Text>
            <Text style={s.small}>
              WhatsApp: {fiscal.whatsapp || "+54 9 2634 56-9139"}
            </Text>
            <Text style={s.small}>
              {fiscal.ivaCondition || "IVA RESPONSABLE INSCRIPTO"}
            </Text>
          </View>
        </View>
        <View style={s.doc}>
          <Text style={s.docTitle}>REMITO INTERNO</Text>
          <Text style={s.docSub}>DOCUMENTO NO VÁLIDO COMO FACTURA</Text>
          {fiscal.cuit ? (
            <Text style={s.docSub}>
              C.U.I.T.: {fiscal.cuit}
              {fiscal.iibb ? ` · Ing. Brutos: ${fiscal.iibb}` : ""}
            </Text>
          ) : null}
          <Text style={s.docLine}>
            <Text style={s.bold}>N°:</Text> {d.number}
          </Text>
          <Text style={s.docLine}>
            <Text style={s.bold}>Fecha:</Text> {d.date}
          </Text>
        </View>
      </View>
      <View style={s.rule} />
      <View style={s.client}>
        <View style={s.clientCol}>
          <Text>
            <Text style={s.bold}>Cliente:</Text> {d.name}
          </Text>
          <Text>
            <Text style={s.bold}>Calle:</Text> {d.address}
          </Text>
        </View>
        <View style={s.clientCol}>
          <Text>
            <Text style={s.bold}>Tel / Cel:</Text> {d.phone}
          </Text>
          <Text>
            <Text style={s.bold}>Localidad:</Text> {d.locality}
          </Text>
        </View>
        {d.driver ? (
          <View style={[s.clientCol, { flex: 0.8 }]}>
            <Text>
              <Text style={s.bold}>Preventista:</Text> {d.driver}
            </Text>
          </View>
        ) : null}
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
          return (
            <View key={i} style={[s.tr, i === rows - 1 ? s.trLast : null]}>
              <Text style={[s.td, s.kilos]}>{l ? l.kg : " "}</Text>
              <Text style={[s.td, s.detail]}>{l ? l.detail : " "}</Text>
              <Text style={[s.td, s.unit]}>{l ? l.unit : " "}</Text>
              <Text style={[s.td, s.total]}>{l ? l.total : " "}</Text>
            </View>
          );
        })}
      </View>
      {d.notes ? <Text style={s.note}>Obs.: {d.notes}</Text> : null}
      <View style={s.foot}>
        <View>
          <Text style={s.boxes}>
            <Text style={s.bold}>CAJAS ADEUDADAS:</Text>{" "}
            {d.owedBoxes
              ? `${d.owedBoxes} ${d.owedBoxes === 1 ? "caja" : "cajas"}`
              : "—"}
          </Text>
          {d.balance ? <Text style={s.balance}>{d.balance}</Text> : null}
        </View>
        <Text style={s.totalLine}>TOTAL: {d.total}</Text>
      </View>
      <View style={s.sign}>
        <View style={s.signLine} />
        <Text style={s.signText}>Firma Conforme</Text>
      </View>
    </View>
  );
}

export function RemitoDocument({
  orders,
  customers = [],
  fiscal = {},
  logo = "/brand/logo-pollito.png",
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
      {orders.map((o) => {
        const data = remitoData(
          o,
          customers.find((c) => c.phone === o.customer),
        );
        return (
          <React.Fragment key={o.id}>
            {["ORIGINAL", "DUPLICADO"].map((label) => (
              <Page key={label} size="A4" style={s.page}>
                <Copy data={data} fiscal={fiscal} logo={logo} label={label} />
              </Page>
            ))}
          </React.Fragment>
        );
      })}
    </Document>
  );
}

export default RemitoDocument;
