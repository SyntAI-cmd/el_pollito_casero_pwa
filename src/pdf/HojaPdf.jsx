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
import { routeRows, routeParts } from "../lib/routeRows.js";

const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
const s = StyleSheet.create({
  page: {
    padding: 24,
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#111",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  logo: { width: 105, height: 32, objectFit: "contain" },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 7, color: "#444", marginTop: 4 },
  meta: {
    flexDirection: "row",
    gap: 16,
    borderBottomWidth: 1,
    paddingBottom: 8,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    minHeight: 24,
    borderBottomWidth: 0.5,
    borderColor: "#777",
  },
  cell: {
    padding: 4,
    borderRightWidth: 0.5,
    borderColor: "#999",
    justifyContent: "center",
  },
  th: { fontFamily: "Helvetica-Bold", fontSize: 6.8, textAlign: "center" },
  table: { borderWidth: 0.5, borderColor: "#777" },
  note: { fontSize: 7, color: "#444", marginTop: 6 },
  foot: { flexDirection: "row", gap: 16, marginTop: 12 },
  box: { flex: 1, borderWidth: 0.5, padding: 8 },
  bold: { fontFamily: "Helvetica-Bold" },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 0.4,
    borderColor: "#bbb",
    paddingVertical: 4,
  },
  signs: { flexDirection: "row", gap: 80, marginTop: 25 },
  sign: { flex: 1, borderTopWidth: 0.5, paddingTop: 4, textAlign: "center" },
  footer: { position: "absolute", bottom: 12, right: 24, fontSize: 7 },
  obs: { borderWidth: 0.5, minHeight: 350, padding: 12, marginTop: 12 },
});
const cols = [
  ["Pedido / remito", 44],
  ["Cliente / zona", 233],
  ["Pedido $", 65],
  ["Deuda previa $", 65],
  ["Cajas previas", 34],
  ["Salientes", 34],
  ["Devueltas", 34],
  ["Saldo cajas", 40],
  ["Efectivo $", 60],
  ["Transfer. $", 65],
  ["Cheque $", 55],
  ["Saldo final $", 65],
];
function Header({ date, drivers, vehicle, zone, logo, part, total, back }) {
  return (
    <>
      <View style={s.header}>
        {logo && <Image style={s.logo} src={logo} />}
        <View>
          <Text style={s.title}>HOJA DE RUTA · RENDICIÓN DE REPARTO</Text>
          <Text style={s.sub}>
            Parte {part} de {total} ·{" "}
            {back ? "Dorso / Observaciones" : "Frente / Control de pedidos"} ·
            N° pedido = N° remito
          </Text>
        </View>
      </View>
      <View style={s.meta}>
        <Text>Fecha: {(date || "").split("-").reverse().join("/")}</Text>
        <Text>Preventistas: {drivers.join(" / ") || "Sin asignar"}</Text>
        <Text>Vehículo: {vehicle || "—"}</Text>
      </View>
      {zone && <Text style={s.note}>Ruta / Zona: {zone}</Text>}
    </>
  );
}
export function HojaDocument({
  date,
  drivers = [],
  vehicle = "",
  zone = "",
  orders = [],
  customers = [],
  logo = "/brand/logo-texto.png",
}) {
  const rows = routeRows(orders, customers),
    parts = routeParts(rows);
  return (
    <Document
      title={`Hoja de ruta ${date}`}
      author="El Pollito Casero"
      language="es-AR"
    >
      {parts.flatMap((chunk, i) => {
        const total = chunk.reduce(
          (n, r) => n + (r.order.noPricing ? 0 : r.order.total || 0),
          0,
        );
        const props = {
          date,
          drivers,
          vehicle,
          zone,
          logo,
          part: i + 1,
          total: parts.length,
        };
        return [
          <Page
            key={`${i}-front`}
            size="A4"
            orientation="landscape"
            style={s.page}
            wrap={false}
          >
            <Header {...props} />
            <View style={s.table}>
              <View style={[s.row, { backgroundColor: "#eee" }]}>
                {cols.map(([label, width]) => (
                  <View key={label} style={[s.cell, { width }]}>
                    <Text style={s.th}>{label}</Text>
                  </View>
                ))}
              </View>
              {chunk.map((r) => {
                const o = r.order;
                const values = [
                  orderNumber(o),
                  `${r.customer?.alias || o.name}${o.zone ? " · " + o.zone : ""}`,
                  o.noPricing
                    ? "Sin precio"
                    : o.weighed
                      ? money(o.total)
                      : "Sin pesar",
                  r.firstCustomer ? money(r.moneyBefore) : "Incl. anterior",
                  r.before,
                  r.out,
                  r.back,
                  r.after,
                  "",
                  "",
                  "",
                ];
                return (
                  <View style={s.row} key={o.id}>
                    {values.map((v, k) => (
                      <View key={k} style={[s.cell, { width: cols[k][1] }]}>
                        <Text style={{ fontSize: k === 1 ? 7.5 : 8 }}>
                          {String(v)}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
            <Text style={s.note}>
              Cajas: previas + salientes - devueltas = saldo. Saldos proyectados
              al emitir; las salientes pendientes se confirman al entregar.
              Deuda previa: corte de emisión, una vez por cliente.
            </Text>
            <View style={s.foot}>
              <View style={s.box}>
                <Text style={s.bold}>RENDICIÓN DE ESTA PARTE</Text>
                {[
                  ["Total pedidos", money(total)],
                  ["Efectivo cobrado", ""],
                  ["Transferencias / cheques", ""],
                  ["Gastos con comprobante", ""],
                  ["Efectivo entregado", ""],
                  ["Diferencia de efectivo", ""],
                ].map(([k, v]) => (
                  <View style={s.line} key={k}>
                    <Text>{k}</Text>
                    <Text>{v || "________________"}</Text>
                  </View>
                ))}
              </View>
              <View style={s.box}>
                <Text style={s.bold}>
                  GASTOS · CONCEPTO / IMPORTE / COMPROBANTE
                </Text>
                {[1, 2, 3, 4].map((x) => (
                  <View key={x} style={[s.line, { minHeight: 23 }]}>
                    <Text> </Text>
                  </View>
                ))}
                <Text style={s.note}>
                  Diferencia = efectivo cobrado - gastos pagados en efectivo -
                  efectivo entregado. Los gastos no aumentan la deuda del
                  cliente.
                </Text>
              </View>
            </View>
            <View style={s.signs}>
              <Text style={s.sign}>Firma repartidor</Text>
              <Text style={s.sign}>Control / Administración</Text>
            </View>
            <Text style={s.footer}>
              Parte {i + 1}/{parts.length} · Página 1 de 2 · Imprimir doble faz,
              borde corto
            </Text>
          </Page>,
          <Page
            key={`${i}-back`}
            size="A4"
            orientation="landscape"
            style={s.page}
            wrap={false}
          >
            <Header {...props} back />
            <View style={s.obs}>
              <Text style={s.bold}>
                OBSERVACIONES · Indicar pedido/remito cuando corresponda
              </Text>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => (
                <View key={x} style={[s.line, { minHeight: 32 }]}>
                  <Text> </Text>
                </View>
              ))}
            </View>
            <Text style={s.note}>
              Esta parte incluye {chunk.length} pedidos. Los importes y las
              cajas se controlan por separado. No sumar dos veces la deuda
              previa de un mismo cliente.
            </Text>
            <Text style={s.footer}>
              Parte {i + 1}/{parts.length} · Página 2 de 2 · Dorso
            </Text>
          </Page>,
        ];
      })}
    </Document>
  );
}
export default HojaDocument;
