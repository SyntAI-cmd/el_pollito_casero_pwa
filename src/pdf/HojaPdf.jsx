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
 * Hoja de ruta · rendición de reparto (PDF, A4 apaisada): la que se lleva cada preventista y
 * rinde en papel. Cabecera con fecha, repartidor(es), ruta/zona y vehículo; por pedido
 * N° PEDIDO / REMITO, CLIENTE, TOTAL PEDIDO, SALDO DE CAJAS y columnas en blanco EFECTIVO,
 * TRANSFERENCIA, CHEQUE y SALDO; totales, cuadro de rendición (total hoja de ruta, efectivo,
 * transferencias, cheques, saldo, total rendido, diferencia), observaciones y firmas.
 * Compacta: hasta 26 pedidos por hoja; sigue en otra hoja si hay más.
 */

const INK = "#000";
const MUTED = "#333";
const LINE = "#000";
const HAND = "#fffdf2";

const money = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);
const dmy = (iso) => (iso || "").split("-").reverse().join("/");

const s = StyleSheet.create({
  page: {
    backgroundColor: "#fff",
    paddingVertical: 20,
    paddingHorizontal: 24,
    fontFamily: "Helvetica",
    fontSize: 8,
    color: INK,
  },
  head: {
    borderBottomWidth: 2,
    borderBottomColor: LINE,
    paddingBottom: 6,
    marginBottom: 6,
  },
  logo: { width: 110, height: 33, objectFit: "contain", marginRight: 10 },
  title: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  sub: { fontSize: 7, color: MUTED, marginTop: 2 },
  data: { flexDirection: "row", gap: 16, marginTop: 6 },
  field: { flexDirection: "row", alignItems: "flex-end" },
  label: { fontFamily: "Helvetica-Bold", fontSize: 7.5, marginRight: 4 },
  value: {
    fontSize: 8.5,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    width: 90,
    paddingBottom: 1,
  },
  table: { borderWidth: 1, borderColor: LINE },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    minHeight: 15,
  },
  th: {
    backgroundColor: "#eee",
    fontFamily: "Helvetica-Bold",
    fontSize: 6.8,
    textTransform: "uppercase",
    textAlign: "center",
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderRightWidth: 1,
    borderRightColor: LINE,
  },
  td: {
    paddingVertical: 2.5,
    paddingHorizontal: 3,
    borderRightWidth: 1,
    borderRightColor: LINE,
    justifyContent: "center",
  },
  hand: { backgroundColor: HAND },
  num: { textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 6.5, color: MUTED },
  cNum: { width: 58 },
  cClient: { flex: 1 },
  cTotal: { width: 72 },
  cBalance: { width: 72 },
  cBoxes: { width: 56 },
  cPay: { width: 72 },
  foot: { flexDirection: "row", gap: 10, marginTop: 8 },
  summary: {
    borderWidth: 2,
    borderColor: LINE,
    width: 300,
  },
  sRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE },
  sLabel: {
    flex: 1,
    paddingVertical: 3.5,
    paddingHorizontal: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    textTransform: "uppercase",
  },
  sValue: {
    width: 110,
    borderLeftWidth: 1,
    borderLeftColor: LINE,
    paddingVertical: 3.5,
    paddingHorizontal: 5,
    textAlign: "right",
    fontFamily: "Helvetica-Bold",
  },
  grand: { backgroundColor: "#eee", fontSize: 9.5 },
  obs: {
    flex: 1,
    borderWidth: 1,
    borderColor: LINE,
    padding: 5,
    minHeight: 90,
  },
  obsTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    textTransform: "uppercase",
  },
  sign: { flexDirection: "row", gap: 60, marginTop: 22, paddingHorizontal: 40 },
  signBox: { flex: 1, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 3 },
  signText: { fontSize: 7, textAlign: "center" },
  note: { fontSize: 6.5, color: MUTED, marginTop: 4 },
  pageNum: {
    position: "absolute",
    bottom: 10,
    right: 24,
    fontSize: 6.5,
    color: MUTED,
  },
});

const ROWS_PER_PAGE = 26;

function Header({ date, drivers, zone, vehicle, logo }) {
  return (
    <View style={s.head}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {logo ? <Image style={s.logo} src={logo} /> : null}
        <View>
          <Text style={s.title}>Hoja de ruta · Rendición de reparto</Text>
          <Text style={s.sub}>
            El número de pedido coincide con el número de remito.
          </Text>
        </View>
      </View>
      <View style={s.data}>
        <View style={s.field}>
          <Text style={s.label}>Fecha:</Text>
          <Text style={s.value}>{dmy(date)}</Text>
        </View>
        <View style={s.field}>
          <Text style={s.label}>Repartidor:</Text>
          <Text style={[s.value, { width: 150 }]}>
            {drivers.length ? drivers.join(" / ") : " "}
          </Text>
        </View>
        <View style={s.field}>
          <Text style={s.label}>Ruta / Zona:</Text>
          <Text style={[s.value, { width: 150 }]}>{zone || " "}</Text>
        </View>
        <View style={s.field}>
          <Text style={s.label}>Vehículo:</Text>
          <Text style={[s.value, { width: 150 }]}>{vehicle || " "}</Text>
        </View>
      </View>
    </View>
  );
}

/** Saldo de cuenta corriente del cliente ANTES de este pedido (lo que ya debía). */
const previousBalance = (o, c) => {
  if (!c) return 0;
  const onAccount = o.payment === "cuenta" && !o.paid ? o.total : 0;
  return Math.round(((c.summary?.balance || 0) - onAccount) * 100) / 100;
};

function Row({ o, c }) {
  const owed = Math.max(0, c?.summary?.boxes || 0);
  const prev = previousBalance(o, c);
  return (
    <View style={s.tr} wrap={false}>
      <View style={[s.td, s.cNum]}>
        <Text style={s.bold}>{orderNumber(o)}</Text>
      </View>
      <View style={[s.td, s.cClient]}>
        <Text>
          <Text style={s.bold}>{c?.alias || o.name}</Text>
          {o.zone || c?.zone ? (
            <Text style={s.small}> {o.zone || c?.zone}</Text>
          ) : null}
        </Text>
      </View>
      <View style={[s.td, s.cTotal, s.num]}>
        <Text style={s.bold}>{money(o.total)}</Text>
      </View>
      <View style={[s.td, s.cBalance, s.num]}>
        <Text>{prev ? money(prev) : " "}</Text>
      </View>
      <View style={[s.td, s.cBoxes, s.num]}>
        <Text>{owed || " "}</Text>
      </View>
      <View style={[s.td, s.cPay, s.hand]}>
        <Text> </Text>
      </View>
      <View style={[s.td, s.cPay, s.hand]}>
        <Text> </Text>
      </View>
      <View style={[s.td, s.cPay, s.hand]}>
        <Text> </Text>
      </View>
      <View style={[s.td, s.cPay, s.hand, { borderRightWidth: 0 }]}>
        <Text> </Text>
      </View>
    </View>
  );
}

export function HojaDocument({
  date,
  drivers = [],
  vehicle = "",
  zone = "",
  orders,
  customers = [],
  logo = "/brand/logo-texto.png",
}) {
  const sorted = [...orders].sort((a, b) => (a.number || 0) - (b.number || 0));
  const pages = [];
  for (let i = 0; i < Math.max(1, sorted.length); i += ROWS_PER_PAGE)
    pages.push(sorted.slice(i, i + ROWS_PER_PAGE));
  const total = orders.reduce((a, o) => a + o.total, 0);
  const boxes = orders.reduce(
    (a, o) =>
      a +
      Math.max(
        0,
        customers.find((x) => x.phone === o.customer)?.summary?.boxes || 0,
      ),
    0,
  );
  const balances = orders.reduce(
    (a, o) =>
      a +
      previousBalance(
        o,
        customers.find((x) => x.phone === o.customer),
      ),
    0,
  );
  const zones =
    zone ||
    [...new Set(orders.map((o) => o.zone).filter(Boolean))]
      .slice(0, 3)
      .join(" / ");
  return (
    <Document
      title={`Hoja de ruta ${dmy(date)} ${drivers.join(" y ")}`}
      author="El Pollito Casero"
      language="es-AR"
    >
      {pages.map((chunk, pi) => {
        const last = pi === pages.length - 1;
        return (
          <Page key={pi} size="A4" orientation="landscape" style={s.page}>
            <Header
              date={date}
              drivers={drivers}
              zone={zones}
              vehicle={vehicle}
              logo={logo}
            />
            <View style={s.table}>
              <View style={s.tr}>
                <Text style={[s.th, s.cNum]}>N° Pedido / Remito</Text>
                <Text style={[s.th, s.cClient]}>Cliente</Text>
                <Text style={[s.th, s.cTotal]}>Total pedido</Text>
                <Text style={[s.th, s.cBalance]}>Saldo actual</Text>
                <Text style={[s.th, s.cBoxes]}>Saldo cajas</Text>
                <Text style={[s.th, s.cPay]}>Efectivo</Text>
                <Text style={[s.th, s.cPay]}>Transferencia</Text>
                <Text style={[s.th, s.cPay]}>Cheque</Text>
                <Text style={[s.th, s.cPay, { borderRightWidth: 0 }]}>
                  Saldo
                </Text>
              </View>
              {chunk.map((o) => (
                <Row
                  key={o.id}
                  o={o}
                  c={customers.find((x) => x.phone === o.customer)}
                />
              ))}
              {last && (
                <View
                  style={[
                    s.tr,
                    { backgroundColor: "#f5f5f5", borderBottomWidth: 0 },
                  ]}
                >
                  <View style={[s.td, s.cNum]}>
                    <Text style={s.bold}>TOTALES</Text>
                  </View>
                  <View style={[s.td, s.cClient]}>
                    <Text style={s.bold}>
                      {orders.length}{" "}
                      {orders.length === 1 ? "pedido" : "pedidos"}
                    </Text>
                  </View>
                  <View style={[s.td, s.cTotal, s.num]}>
                    <Text style={s.bold}>{money(total)}</Text>
                  </View>
                  <View style={[s.td, s.cBalance, s.num]}>
                    <Text style={s.bold}>
                      {balances ? money(balances) : " "}
                    </Text>
                  </View>
                  <View style={[s.td, s.cBoxes, s.num]}>
                    <Text style={s.bold}>{boxes || " "}</Text>
                  </View>
                  <View style={[s.td, s.cPay, s.hand]}>
                    <Text> </Text>
                  </View>
                  <View style={[s.td, s.cPay, s.hand]}>
                    <Text> </Text>
                  </View>
                  <View style={[s.td, s.cPay, s.hand]}>
                    <Text> </Text>
                  </View>
                  <View style={[s.td, s.cPay, s.hand, { borderRightWidth: 0 }]}>
                    <Text> </Text>
                  </View>
                </View>
              )}
            </View>
            {last && (
              <>
                <View style={s.foot}>
                  <View>
                    <View style={s.summary}>
                      {[
                        ["Total hoja de ruta", money(total), true],
                        ["Efectivo total", ""],
                        ["Transferencias", ""],
                        ["Cheques", ""],
                        ["Saldo / cuenta corriente", ""],
                        ["Total rendido / justificado", ""],
                        ["Diferencia", "", false, true],
                      ].map(([label, value, grand, lastRow], i) => (
                        <View
                          key={i}
                          style={[
                            s.sRow,
                            grand ? s.grand : null,
                            lastRow ? { borderBottomWidth: 0 } : null,
                          ]}
                        >
                          <Text
                            style={[s.sLabel, grand ? { fontSize: 9.5 } : null]}
                          >
                            {label}
                          </Text>
                          <Text
                            style={[s.sValue, grand ? { fontSize: 9.5 } : null]}
                          >
                            {value || " "}
                          </Text>
                        </View>
                      ))}
                    </View>
                    <Text style={s.note}>
                      Control: total pedido = efectivo + transferencia + cheque
                      + saldo. El saldo de cajas se controla por separado y no
                      integra el total monetario.
                    </Text>
                  </View>
                  <View style={s.obs}>
                    <Text style={s.obsTitle}>Observaciones</Text>
                  </View>
                </View>
                <View style={s.sign}>
                  <View style={s.signBox}>
                    <Text style={s.signText}>Firma repartidor</Text>
                  </View>
                  <View style={s.signBox}>
                    <Text style={s.signText}>Control / Administración</Text>
                  </View>
                </View>
              </>
            )}
            <Text style={s.pageNum}>
              Hoja {pi + 1} de {pages.length}
            </Text>
          </Page>
        );
      })}
    </Document>
  );
}

export default HojaDocument;
