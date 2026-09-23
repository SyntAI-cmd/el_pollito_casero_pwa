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

/**
 * Hoja de ruta · rendición de caja, según la plantilla entregada por Mauro el 23/09/2026
 * (`docs/produccion/plantilla-hoja-ruta.png`).
 *
 * Se imprimen los datos ya registrados; lo que se completa en la calle va como casillero vacío:
 * corrección, efectivo, transferencia, cheque y saldo final. Un guion en los totales significa
 * "se suma a mano", no cero.
 */
const ROJO = "#c9262e";
const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
const FILAS_POR_HOJA = 14;

const s = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingBottom: 18,
    paddingHorizontal: 24,
    fontFamily: "Helvetica",
    fontSize: 7.5,
    color: "#111",
    backgroundColor: "#fff",
  },
  // Cabecera: marca a la izquierda, título a la derecha
  head: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  logo: { width: 58, height: 30, objectFit: "contain", marginRight: 8 },
  marca: { fontSize: 13, fontFamily: "Helvetica-Bold", color: ROJO },
  lema: { fontSize: 6.5, fontFamily: "Helvetica-Bold", marginTop: 2 },
  domicilio: { fontSize: 5.8, color: "#555", marginTop: 2 },
  titulo: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "right" },
  subtitulo: {
    fontSize: 6,
    color: "#555",
    textAlign: "right",
    marginTop: 3,
    fontStyle: "italic",
  },
  // Datos del reparto
  meta: {
    flexDirection: "row",
    borderWidth: 0.5,
    borderColor: "#999",
    marginBottom: 6,
  },
  metaCelda: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRightWidth: 0.5,
    borderColor: "#999",
  },
  metaRotulo: { fontFamily: "Helvetica-Bold" },
  // Tabla
  grupo: { flexDirection: "row" },
  grupoCelda: {
    backgroundColor: ROJO,
    color: "#fff",
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    textAlign: "center",
    paddingVertical: 2.5,
    marginRight: 1,
  },
  fila: { flexDirection: "row", minHeight: 16 },
  celda: {
    borderWidth: 0.4,
    borderColor: "#bbb",
    paddingVertical: 3,
    paddingHorizontal: 3,
    justifyContent: "center",
  },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 6.4,
    textAlign: "center",
    backgroundColor: "#f0f0f0",
  },
  num: { textAlign: "right" },
  centro: { textAlign: "center" },
  totales: { flexDirection: "row", minHeight: 17 },
  celdaTotal: {
    borderWidth: 0.4,
    borderColor: "#bbb",
    borderTopWidth: 1.2,
    borderTopColor: ROJO,
    paddingVertical: 4,
    paddingHorizontal: 3,
    justifyContent: "center",
    fontFamily: "Helvetica-Bold",
  },
  nota: { fontSize: 5.6, color: "#555", marginTop: 4, fontStyle: "italic" },
  // Bloques de abajo
  abajo: { flexDirection: "row", gap: 12, marginTop: 10 },
  bloque: { flex: 1, borderWidth: 0.5, borderColor: "#bbb" },
  bloqueTitulo: {
    backgroundColor: ROJO,
    color: "#fff",
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    textAlign: "center",
    paddingVertical: 3,
  },
  linea: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottomWidth: 0.4,
    borderColor: "#ddd",
  },
  lineaFuerte: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderTopWidth: 1.2,
    borderTopColor: ROJO,
    fontFamily: "Helvetica-Bold",
  },
  firmas: { flexDirection: "row", gap: 40, marginTop: 26 },
  firma: {
    flex: 1,
    borderTopWidth: 0.6,
    borderColor: "#333",
    paddingTop: 4,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 6.5,
  },
  pie: {
    position: "absolute",
    bottom: 8,
    left: 24,
    right: 24,
    textAlign: "center",
    fontSize: 5.5,
    color: "#777",
  },
});

// Ancho de cada columna, agrupadas como en la plantilla (A4 apaisada, 786 pt útiles).
const COLS = {
  remito: [
    ["Pedido /\nremito", 48],
    ["Cliente / zona", 150],
    ["Importe total $", 62],
    ["Saldo cliente $", 62],
    ["Corrección $", 56],
  ],
  cajas: [
    ["Previas", 38],
    ["Salientes", 44],
    ["Devueltas", 46],
    ["Saldo", 38],
  ],
  pagos: [
    ["Efectivo $", 62],
    ["Transfer. $", 62],
    ["Cheque $", 56],
    ["Saldo final $", 62],
  ],
};
const TODAS = [...COLS.remito, ...COLS.cajas, ...COLS.pagos];
const ancho = (cols) => cols.reduce((n, [, w]) => n + w, 0);

function Cabecera({ logo, preventistas, vehiculo, fecha, turno, cantidad }) {
  return (
    <>
      <View style={s.head}>
        <View style={{ flexDirection: "row", flex: 1 }}>
          {logo && <Image style={s.logo} src={logo} />}
          <View>
            <Text style={s.marca}>EL POLLITO CASERO</Text>
            <Text style={s.lema}>VENTA POR MAYOR Y MENOR</Text>
            <Text style={s.domicilio}>
              Carril Norte S/N° - El Ramblón, Mza. · WhatsApp: +54 9 2634
              56-9139
            </Text>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.titulo}>HOJA DE RUTA · RENDICIÓN DE CAJA</Text>
          <Text style={s.subtitulo}>
            N° pedido = N° remito · Documento interno de control
          </Text>
        </View>
      </View>
      <View style={s.meta}>
        {[
          ["Preventista:", preventistas || "", 210],
          ["Vehículo:", vehiculo || "", 190],
          ["Fecha:", (fecha || "").split("-").reverse().join("/"), 130],
          ["N° pedidos:", String(cantidad), 120],
          ["Turno:", turno || "", 130],
        ].map(([rotulo, valor, w], i, arr) => (
          <View
            key={rotulo}
            style={[
              s.metaCelda,
              { width: w },
              i === arr.length - 1 ? { borderRightWidth: 0 } : {},
            ]}
          >
            <Text style={s.metaRotulo}>{rotulo} </Text>
            <Text>{valor}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function Tabla({ filas }) {
  return (
    <View>
      {/* Bandas rojas de grupo: REMITO · CAJAS · PAGOS */}
      <View style={s.grupo}>
        <Text style={[s.grupoCelda, { width: ancho(COLS.remito) - 1 }]}>
          REMITO
        </Text>
        <Text style={[s.grupoCelda, { width: ancho(COLS.cajas) - 1 }]}>
          CAJAS
        </Text>
        <Text style={[s.grupoCelda, { width: ancho(COLS.pagos) }]}>PAGOS</Text>
      </View>
      <View style={s.fila}>
        {TODAS.map(([rotulo, w]) => (
          <View key={rotulo} style={[s.celda, s.th, { width: w }]}>
            <Text style={s.th}>{rotulo}</Text>
          </View>
        ))}
      </View>
      {filas.map((r) => {
        const o = r.order;
        // Lo ya registrado se imprime; lo que se completa en la calle va vacío.
        // IMPORTE TOTAL = lo del pedido + lo que el cliente ya debía: es lo que hay que cobrar
        // en esa parada. La deuda previa se suma UNA sola vez por cliente, así que si el cliente
        // tiene dos pedidos, el segundo lleva solo lo suyo.
        const deudaPrevia = r.firstCustomer ? r.moneyBefore || 0 : 0;
        const aCobrar = (o.noPricing ? 0 : o.total || 0) + deudaPrevia;
        const valores = [
          orderNumber(o),
          `${r.customer?.alias || o.name}${o.zone ? " · " + o.zone : ""}`,
          o.noPricing
            ? deudaPrevia
              ? money(deudaPrevia)
              : "Sin precio"
            : o.weighed
              ? money(aCobrar)
              : deudaPrevia
                ? `Sin pesar + ${money(deudaPrevia)}`
                : "Sin pesar",
          // De ese importe, esto es deuda anterior.
          r.firstCustomer ? money(deudaPrevia) : "Incl. anterior",
          "",
          r.before === null || r.before === undefined ? "" : String(r.before),
          String(r.out),
          String(r.back),
          r.after === null || r.after === undefined ? "" : String(r.after),
          "",
          "",
          "",
          "",
        ];
        return (
          <View style={s.fila} key={o.id} wrap={false}>
            {valores.map((v, i) => (
              <View key={i} style={[s.celda, { width: TODAS[i][1] }]}>
                <Text
                  style={[
                    { fontSize: i === 1 ? 7 : 7.5 },
                    i >= 2 && i !== 1
                      ? i >= 5 && i <= 8
                        ? s.centro
                        : s.num
                      : {},
                  ]}
                >
                  {v}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
      <View style={s.totales}>
        {TODAS.map(([rotulo, w], i) => {
          const suma =
            i === 2
              ? money(
                  filas.reduce(
                    (n, r) =>
                      n +
                      (r.order.noPricing ? 0 : r.order.total || 0) +
                      (r.firstCustomer ? r.moneyBefore || 0 : 0),
                    0,
                  ),
                )
              : i === 3
                ? money(
                    filas.reduce(
                      (n, r) => n + (r.firstCustomer ? r.moneyBefore || 0 : 0),
                      0,
                    ),
                  )
                : i >= 5 && i <= 8
                  ? String(
                      filas.reduce(
                        (n, r) =>
                          n +
                          (i === 5
                            ? r.before || 0
                            : i === 6
                              ? r.out || 0
                              : i === 7
                                ? r.back || 0
                                : r.after || 0),
                        0,
                      ),
                    )
                  : "-";
          return (
            <View key={rotulo} style={[s.celdaTotal, { width: w }]}>
              <Text
                style={[
                  { fontFamily: "Helvetica-Bold", fontSize: 7 },
                  i === 1 ? s.centro : i >= 5 && i <= 8 ? s.centro : s.num,
                ]}
              >
                {i === 0 ? "" : i === 1 ? "TOTALES" : suma}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={s.nota}>
        Cajas: previas + salientes - devueltas = saldo. Importe total = pedido
        del día + saldo del cliente: es lo que hay que cobrar en esa parada.
        Saldo final = importe total + corrección - efectivo - transferencia -
        cheque. La columna Saldo cliente muestra cuánto de ese importe es deuda
        anterior, y se cuenta una sola vez por cliente.
      </Text>
    </View>
  );
}

function Rendicion({ filas }) {
  const totalPedidos = filas.reduce(
    (n, r) => n + (r.order.noPricing ? 0 : r.order.total || 0),
    0,
  );
  const saldoAnterior = filas.reduce(
    (n, r) => n + (r.firstCustomer ? r.moneyBefore || 0 : 0),
    0,
  );
  // Lo ya cobrado por el pedido, separado por medio: no se mezcla con lo que se cobra en la calle.
  const cobrado = (metodo) =>
    filas.reduce(
      (n, r) =>
        n +
        (r.order.paid && (r.order.paidMethod || r.order.payment) === metodo
          ? r.order.total || 0
          : 0),
      0,
    );
  const pendienteCuenta = filas.reduce(
    (n, r) =>
      n +
      (r.order.payment === "cuenta" && !r.order.paid ? r.order.total || 0 : 0),
    0,
  );
  const lineas = [
    ["Total de pedidos del día", money(totalPedidos)],
    ["Saldo anterior de clientes", money(saldoAnterior)],
    ["Total a cobrar (pedidos + saldos)", money(totalPedidos + saldoAnterior)],
    [
      "Efectivo cobrado",
      cobrado("efectivo") ? money(cobrado("efectivo")) : "-",
    ],
    [
      "Transferencias",
      cobrado("transferencia") ? money(cobrado("transferencia")) : "-",
    ],
    ["Cheques", cobrado("cheque") ? money(cobrado("cheque")) : "-"],
    ["Gastos con comprobante", "-"],
    ["Total saldos (completar al rendir)", ""],
    ["Pendiente de cobro (cta. cte.)", money(pendienteCuenta)],
  ];
  return (
    <View style={s.bloque}>
      <Text style={s.bloqueTitulo}>RENDICIÓN</Text>
      {lineas.map(([k, v]) => (
        <View style={s.linea} key={k}>
          <Text>{k}</Text>
          <Text>{v}</Text>
        </View>
      ))}
      <View style={s.lineaFuerte}>
        <Text style={{ fontFamily: "Helvetica-Bold" }}>TOTAL PARA COMPROBAR</Text>
        <Text style={{ fontFamily: "Helvetica-Bold" }}>-</Text>
      </View>
    </View>
  );
}

function Gastos() {
  return (
    <View style={s.bloque}>
      <Text style={s.bloqueTitulo}>GASTOS</Text>
      <View style={[s.linea, { backgroundColor: "#f0f0f0" }]}>
        <Text style={{ fontFamily: "Helvetica-Bold", width: 110 }}>
          Concepto
        </Text>
        <Text style={{ fontFamily: "Helvetica-Bold", width: 70 }}>
          Importe $
        </Text>
        <Text style={{ fontFamily: "Helvetica-Bold", width: 120 }}>
          Comprobante (N° / tipo)
        </Text>
      </View>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <View style={[s.linea, { minHeight: 15 }]} key={i}>
          <Text> </Text>
        </View>
      ))}
      <View style={s.lineaFuerte}>
        <Text style={{ fontFamily: "Helvetica-Bold" }}>Total gastos</Text>
        <Text style={{ fontFamily: "Helvetica-Bold" }}>-</Text>
      </View>
    </View>
  );
}

export function HojaDocument({
  date,
  drivers = [],
  vehicle = "",
  shift = "",
  orders = [],
  customers = [],
  logo = "/brand/logo-texto.png",
}) {
  const filas = routeRows(orders, customers);
  const partes = routeParts(filas, FILAS_POR_HOJA);
  // Turno: si todos los pedidos de la hoja son del mismo, se imprime; si están mezclados,
  // el casillero queda vacío para completarlo a mano.
  const turnos = new Set(
    orders.map(
      (o) =>
        o.shift || customers.find((c) => c.phone === o.customer)?.shift || "",
    ),
  );
  const turno = shift || (turnos.size === 1 ? [...turnos][0] : "");
  return (
    <Document
      title={`Hoja de ruta ${date}`}
      author="El Pollito Casero"
      language="es-AR"
    >
      {partes.map((parte, i) => (
        <Page
          key={i}
          size="A4"
          orientation="landscape"
          style={s.page}
          wrap={false}
        >
          <Cabecera
            logo={logo}
            preventistas={drivers.join(" / ")}
            vehiculo={vehicle}
            fecha={date}
            turno={
              turno === "manana" ? "Mañana" : turno === "tarde" ? "Tarde" : ""
            }
            cantidad={parte.length}
          />
          <Tabla filas={parte} />
          <View style={s.abajo}>
            <Rendicion filas={parte} />
            <Gastos />
          </View>
          <Text style={s.nota}>
            Total saldos: sumar los saldos finales de la planilla. Total para comprobar:
            efectivo + transferencias + cheques + gastos + total saldos.
            Comparar con el total a cobrar y las correcciones anotadas.
          </Text>
          <View style={s.firmas}>
            <Text style={s.firma}>FIRMA REPARTIDOR</Text>
            <Text style={s.firma}>FIRMA CONTROL / ADMINISTRACIÓN</Text>
          </View>
          <Text style={s.pie}>
            El Pollito Casero · Documento no válido como factura · Uso interno
            {partes.length > 1 ? ` · Hoja ${i + 1} de ${partes.length}` : ""}
          </Text>
        </Page>
      ))}
    </Document>
  );
}
export default HojaDocument;
