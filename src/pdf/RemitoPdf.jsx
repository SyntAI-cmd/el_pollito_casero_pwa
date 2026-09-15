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
 * Remito interno en PDF (A4): la mitad superior es el ORIGINAL y la inferior el DUPLICADO,
 * calcados del talonario: cabecera con el logo y los datos fiscales, cliente, grilla
 * KILOS · DETALLE · PRECIO X UN. · PRECIO TOTAL y al pie CAJAS ADEUDADAS, Firma Conforme y TOTAL.
 * Un pedido por hoja; varios pedidos = varias hojas en el mismo documento.
 */

const RED = "#dc2626";
const INK = "#111111";
const MUTED = "#555555";
const LINE = "#cccccc";

const s = StyleSheet.create({
  page: {
    flexDirection: "column",
    backgroundColor: "#ffffff",
    paddingVertical: 18,
    paddingHorizontal: 26,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
  },
  copy: {
    height: "50%",
    paddingTop: 10,
    paddingBottom: 12,
    position: "relative",
  },
  copyFirst: { borderBottom: `1px dashed ${LINE}` },
  watermark: {
    position: "absolute",
    top: 10,
    right: 0,
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    borderWidth: 1,
    borderColor: MUTED,
    paddingVertical: 2,
    paddingHorizontal: 6,
    letterSpacing: 1,
  },
  head: { flexDirection: "row", justifyContent: "space-between" },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 84, height: 57, objectFit: "contain" },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: RED,
    letterSpacing: 0.3,
  },
  tagline: { fontSize: 9, fontFamily: "Helvetica-Bold", marginTop: 1 },
  small: { fontSize: 7.5, color: MUTED, marginTop: 1.5 },
  doc: { alignItems: "flex-end", paddingTop: 16 },
  docTitle: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  docSub: { fontSize: 6.5, color: MUTED },
  docLine: { fontSize: 8.5, marginTop: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  rule: { borderBottomWidth: 1.5, borderBottomColor: RED, marginTop: 8 },
  client: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#fafafa",
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 10,
    flexDirection: "row",
  },
  clientCol: { flex: 1, gap: 4 },
  table: { marginTop: 8, borderWidth: 1, borderColor: LINE },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE },
  trLast: { borderBottomWidth: 0 },
  th: {
    backgroundColor: RED,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  td: { paddingVertical: 4.5, paddingHorizontal: 6, fontSize: 9 },
  kilos: { width: 62 },
  detail: { flex: 1, borderLeftWidth: 1, borderLeftColor: LINE },
  unit: {
    width: 92,
    textAlign: "right",
    borderLeftWidth: 1,
    borderLeftColor: LINE,
  },
  total: {
    width: 96,
    textAlign: "right",
    borderLeftWidth: 1,
    borderLeftColor: LINE,
  },
  note: { fontSize: 8, color: MUTED, marginTop: 4 },
  foot: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  boxes: { fontSize: 9, color: "#374151" },
  balance: { fontSize: 7.5, color: MUTED, marginTop: 3 },
  totalLine: { fontSize: 13, fontFamily: "Helvetica-Bold" },
  sign: { position: "absolute", left: 0, bottom: 14, width: 180 },
  signLine: { borderTopWidth: 1, borderTopColor: MUTED, marginTop: 24 },
  signText: { fontSize: 7.5, color: MUTED, textAlign: "center", marginTop: 2 },
});

const MIN_ROWS = 4;

function Copy({ data, fiscal, logo, label, first }) {
  const d = data;
  const rows = Math.max(MIN_ROWS, d.lines.length);
  return (
    <View style={[s.copy, first ? s.copyFirst : null]}>
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
          <Page key={o.id} size="A4" style={s.page}>
            <Copy
              data={data}
              fiscal={fiscal}
              logo={logo}
              label="ORIGINAL"
              first
            />
            <Copy data={data} fiscal={fiscal} logo={logo} label="DUPLICADO" />
          </Page>
        );
      })}
    </Document>
  );
}

export default RemitoDocument;
