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
 * Remitos internos en PDF, 4 por hoja A4 (2 arriba, 2 abajo), listos para cortar.
 * Cada remito es UN solo original (el respaldo queda en el sistema y en el PDF) con las
 * proporciones del talonario 10 × 15 cm: cabecera con logo, marca y datos fiscales, N° y fecha,
 * cliente / calle / localidad / cel., grilla KILOS · DETALLE · PRECIO X UN. · PRECIO TOTAL y al
 * pie CAJAS ADEUDADAS, SALDO, TOTAL y Firma Conforme.
 *
 * Geometría: cuatro remitos de 10 × 15 exactos ocuparían 200 × 300 mm y la A4 mide 210 × 297,
 * así que cada uno se dibuja a 95 × 142,5 mm (misma proporción 2:3) y queda un margen seguro de
 * 10 mm a los lados y 6 mm arriba y abajo, fuera del área no imprimible de la Brother. Se imprime
 * en A4 al 100 % y se corta por las marcas.
 */

const MM = 72 / 25.4;
const PAGE_W = 210 * MM;
const PAGE_H = 297 * MM;
const CELL_W = 95 * MM;
const CELL_H = 142.5 * MM;
const MX = (PAGE_W - 2 * CELL_W) / 2;
const MY = (PAGE_H - 2 * CELL_H) / 2;
const PER_PAGE = 4;
const MIN_ROWS = 10;

const RED = "#dc2626";
const INK = "#111111";
const MUTED = "#555555";
const LINE = "#c8c8c8";
const CUT = "#9a9a9a";

const s = StyleSheet.create({
  page: { backgroundColor: "#ffffff" },
  cell: {
    position: "absolute",
    width: CELL_W,
    height: CELL_H,
    paddingTop: 10,
    paddingBottom: 9,
    paddingHorizontal: 11,
    fontFamily: "Helvetica",
    fontSize: 7,
    color: INK,
  },
  cut: { position: "absolute", backgroundColor: CUT },
  dashV: {
    position: "absolute",
    top: MY,
    left: MX + CELL_W,
    width: 0,
    height: 2 * CELL_H,
    borderLeftWidth: 0.5,
    borderLeftColor: LINE,
    borderStyle: "dashed",
  },
  dashH: {
    position: "absolute",
    top: MY + CELL_H,
    left: MX,
    width: 2 * CELL_W,
    height: 0,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    borderStyle: "dashed",
  },
  head: { flexDirection: "row", alignItems: "flex-start" },
  logo: { width: 42, height: 28, objectFit: "contain", marginTop: 1 },
  brand: { flex: 1, marginLeft: 6, paddingRight: 6 },
  title: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: RED,
    letterSpacing: 0.2,
    lineHeight: 1.15,
    marginBottom: 4,
  },
  tagline: { fontSize: 6.5, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  small: { fontSize: 5.8, color: MUTED, lineHeight: 1.3 },
  doc: { width: 80, alignItems: "flex-end" },
  docTitle: { fontSize: 8.6, fontFamily: "Helvetica-Bold", marginBottom: 1 },
  docNum: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 5 },
  docLine: { fontSize: 6.8, marginTop: 2 },
  fiscal: {
    fontSize: 5.2,
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
  clientLine: { fontSize: 7.2, marginBottom: 3, lineHeight: 1.2 },
  table: { marginTop: 6, borderWidth: 0.6, borderColor: LINE },
  tr: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINE },
  trLast: { borderBottomWidth: 0 },
  th: {
    backgroundColor: RED,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 6.3,
    paddingVertical: 3.5,
    paddingHorizontal: 5,
  },
  td: { paddingVertical: 3.6, paddingHorizontal: 5, fontSize: 7.4 },
  tdTight: { paddingVertical: 1.6, fontSize: 6 },
  kilos: { width: 40, textAlign: "right" },
  // Renglón virtual (saldo anterior): se distingue de los productos físicos.
  virtual: { color: "#666", fontFamily: "Helvetica-Oblique" },
  detail: { flex: 1, borderLeftWidth: 0.6, borderLeftColor: LINE },
  unit: {
    width: 60,
    textAlign: "right",
    borderLeftWidth: 0.6,
    borderLeftColor: LINE,
  },
  total: {
    width: 66,
    textAlign: "right",
    borderLeftWidth: 0.6,
    borderLeftColor: LINE,
  },
  note: { fontSize: 6.4, color: MUTED, marginTop: 5 },
  foot: {
    marginTop: 9,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  footLine: { flexDirection: "row", alignItems: "flex-end", marginBottom: 5 },
  footLabel: { fontSize: 7.2, fontFamily: "Helvetica-Bold", marginRight: 4 },
  footBox: {
    minWidth: 56,
    borderBottomWidth: 0.6,
    borderBottomColor: MUTED,
    fontSize: 7.6,
    paddingBottom: 1,
    paddingHorizontal: 2,
  },
  totalLine: { fontSize: 12, fontFamily: "Helvetica-Bold", marginLeft: 8 },
  sign: {
    position: "absolute",
    left: 11,
    bottom: 12,
    width: 110,
    borderTopWidth: 0.6,
    borderTopColor: MUTED,
    paddingTop: 2.5,
  },
  signText: { fontSize: 6.4, color: MUTED, textAlign: "center" },
  preventista: {
    position: "absolute",
    right: 11,
    bottom: 12,
    fontSize: 6,
    color: MUTED,
  },
});

/** Marcas de corte en el borde de la hoja, alineadas con la grilla 2 × 2. */
function CutMarks() {
  const len = 9;
  const xs = [MX, MX + CELL_W, MX + 2 * CELL_W];
  const ys = [MY, MY + CELL_H, MY + 2 * CELL_H];
  return (
    <>
      {xs.map((x) => (
        <React.Fragment key={"x" + x}>
          <View style={[s.cut, { left: x, top: 0, width: 0.5, height: len }]} />
          <View
            style={[
              s.cut,
              { left: x, top: PAGE_H - len, width: 0.5, height: len },
            ]}
          />
        </React.Fragment>
      ))}
      {ys.map((y) => (
        <React.Fragment key={"y" + y}>
          <View style={[s.cut, { top: y, left: 0, width: len, height: 0.5 }]} />
          <View
            style={[
              s.cut,
              { top: y, left: PAGE_W - len, width: len, height: 0.5 },
            ]}
          />
        </React.Fragment>
      ))}
      <View style={s.dashV} />
      <View style={s.dashH} />
    </>
  );
}

function Remito({ data: d, fiscal, logo, slot }) {
  const rows = Math.max(MIN_ROWS, d.lines.length);
  const tight = rows > 11;
  const left = MX + (slot % 2) * CELL_W;
  const top = MY + Math.floor(slot / 2) * CELL_H;
  return (
    <View style={[s.cell, { left, top }]}>
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
          return (
            <View key={i} style={[s.tr, i === rows - 1 ? s.trLast : null]}>
              <Text style={[...td, s.kilos]}>{l ? l.kg : " "}</Text>
              <Text style={[...td, s.detail, l?.virtual ? s.virtual : null]}>
                {l ? l.detail : " "}
              </Text>
              <Text style={[...td, s.unit]}>{l ? l.unit : " "}</Text>
              <Text style={[...td, s.total, l?.virtual ? s.virtual : null]}>
                {l ? l.total : " "}
              </Text>
            </View>
          );
        })}
      </View>
      {d.notes ? <Text style={s.note}>Obs.: {d.notes}</Text> : null}
      <View style={s.foot}>
        <View>
          <View style={s.footLine}>
            <Text style={s.footLabel}>CAJAS ADEUDADAS:</Text>
            <Text style={s.footBox}>{d.owedBoxesText || " "}</Text>
          </View>
        </View>
        <Text style={s.totalLine}>TOTAL: {d.total || " "}</Text>
      </View>
      <View style={s.sign}>
        <Text style={s.signText}>Firma Conforme</Text>
      </View>
      {d.driver ? (
        <Text style={s.preventista}>Preventista: {d.driver}</Text>
      ) : null}
    </View>
  );
}

export function RemitoDocument({
  orders,
  customers = [],
  fiscal = {},
  logo = "/brand/logo-pollito.png",
  hidePrices = false,
  hideBalance = false,
}) {
  const pages = [];
  for (let i = 0; i < orders.length; i += PER_PAGE)
    pages.push(orders.slice(i, i + PER_PAGE));
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
      {pages.map((chunk, pi) => (
        <Page key={pi} size="A4" style={s.page}>
          <CutMarks />
          {chunk.map((o, slot) => (
            <Remito
              key={o.id}
              slot={slot}
              data={remitoData(
                o,
                customers.find((c) => c.phone === o.customer),
                { hidePrices, hideBalance },
              )}
              fiscal={fiscal}
              logo={logo}
            />
          ))}
        </Page>
      ))}
    </Document>
  );
}

export default RemitoDocument;
