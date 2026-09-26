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
import { orderNumber } from "../lib/remito.js";
import { routeRows } from "../lib/routeRows.js";

/**
 * Hoja de ruta · rendición de caja, según la plantilla entregada por Mauro el 23/09/2026
 * (`docs/produccion/plantilla-hoja-ruta.png`).
 *
 * Se imprimen los datos ya registrados; lo que se completa en la calle va como casillero vacío:
 * corrección, pagos y rendición. Los movimientos de cajas siempre se imprimen.
 */
const ROJO = "#c9262e";
const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
const ALTO_PEDIDOS = 420;

const s = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingBottom: 18,
    paddingHorizontal: 24,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111",
    backgroundColor: "#fff",
  },
  // Cabecera: marca a la izquierda, título a la derecha
  head: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  logo: { width: 58, height: 30, objectFit: "contain", marginRight: 8 },
  marca: { fontSize: 15, fontFamily: "Helvetica-Bold", color: ROJO },
  lema: { fontSize: 6.5, fontFamily: "Helvetica-Bold", marginTop: 2 },
  domicilio: { fontSize: 5.8, color: "#555", marginTop: 2 },
  titulo: { fontSize: 14, fontFamily: "Helvetica-Bold", textAlign: "right" },
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
    fontSize: 9,
    textAlign: "center",
    paddingVertical: 2.5,
    marginRight: 1,
  },
  fila: { flexDirection: "row", minHeight: 16 },
  celda: {
    borderWidth: 0.4,
    borderColor: "#bbb",
    paddingVertical: 6,
    paddingHorizontal: 3,
    justifyContent: "center",
  },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    textAlign: "center",
    backgroundColor: "#f0f0f0",
  },
  num: { textAlign: "right" },
  centro: { textAlign: "center" },
  nota: { fontSize: 5.6, color: "#555", marginTop: 4, fontStyle: "italic" },
  sectionTitle: {
    backgroundColor: ROJO,
    color: "#fff",
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    paddingVertical: 5,
  },
  firmas: { flexDirection: "row", gap: 40, marginTop: 42 },
  firma: {
    flex: 1,
    borderTopWidth: 0.6,
    borderColor: "#333",
    paddingTop: 6,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
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

function valoresFila(r) {
  const o = r.order;
  // Lo ya registrado se imprime; lo que se completa en la calle va vacío.
  // IMPORTE TOTAL = lo del pedido + lo que el cliente ya debía: es lo que hay que cobrar
  // en esa parada. La deuda previa se suma UNA sola vez por cliente, así que si el cliente
  // tiene dos pedidos, el segundo lleva solo lo suyo.
  const deudaPrevia = r.firstCustomer ? r.moneyBefore || 0 : 0;
  const aCobrar = (o.noPricing ? 0 : o.total || 0) + deudaPrevia;
  return [
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
    String(r.after),
    "",
    "",
    "",
    "",
  ];
}

// Reserva espacio para textos de varias líneas antes de repartir el alto sobrante.
function altoFila(r, fontSize) {
  const lines = valoresFila(r).map((value, i) => {
    const capacity = TODAS[i][1] - 8;
    const font = Font.getFont({ fontFamily: "Helvetica" }).data;
    const width = (text) => (font.layout(text).advanceWidth * fontSize) / 1000;
    let count = 1,
      line = "";
    for (const word of String(value).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(next) > capacity) {
        count++;
        line = word;
      } else line = next;
    }
    return count;
  });
  return Math.max(30, Math.max(...lines) * fontSize * 1.15 + 13);
}

function partesAdaptadas(filas) {
  const partes = [[]];
  let height = 0;
  for (const fila of filas) {
    const needed = altoFila(fila, 9.5);
    if (height + needed > ALTO_PEDIDOS && partes.at(-1).length) {
      partes.push([]);
      height = 0;
    }
    partes.at(-1).push(fila);
    height += needed;
  }
  return partes;
}

function Tabla({ filas }) {
  // Todo el alto útil se reparte entre los pedidos, sin agregar filas vacías.
  const fontSize =
    [11, 10, 9.5].find(
      (size) =>
        filas.reduce((sum, r) => sum + altoFila(r, size), 0) <= ALTO_PEDIDOS,
    ) || 9.5;
  const heights = filas.map((r) => altoFila(r, fontSize));
  const extra =
    Math.max(0, ALTO_PEDIDOS - heights.reduce((a, b) => a + b, 0)) /
    Math.max(filas.length, 1);
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
      {filas.map((r, rowIndex) => {
        const o = r.order;
        const valores = valoresFila(r);
        return (
          <View
            style={[s.fila, { minHeight: heights[rowIndex] + extra }]}
            key={o.id}
            wrap={false}
          >
            {valores.map((v, i) => (
              <View key={i} style={[s.celda, { width: TODAS[i][1] }]}>
                <Text
                  style={[
                    { fontSize },
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
      <Text style={s.nota}>
        Cajas: previas + salientes - devueltas = saldo (previsto hasta confirmar
        la entrega). Importe total = pedido del día + saldo del cliente: es lo
        que hay que cobrar en esa parada. Saldo final = importe total +
        corrección - efectivo - transferencia - cheque. La columna Saldo cliente
        muestra cuánto de ese importe es deuda anterior, y se cuenta una sola
        vez por cliente.
      </Text>
    </View>
  );
}

function Rendicion() {
  return (
    <View style={{ flex: 1.45, borderWidth: 0.6, borderColor: "#bbb" }}>
      <Text style={s.sectionTitle}>RENDICIÓN</Text>
      {[
        "SUMA DE BOLETA CORRECTA",
        "EFECTIVO TOTAL",
        "TRANSFERENCIA",
        "CHEQUE",
        "GASTOS",
        "PEN. SALDO DEL DÍA (CUENTA)",
      ].map((label, i) => (
        <View
          key={label}
          style={{
            flexDirection: "row",
            height: 52,
            borderTopWidth: i ? 1 : 0,
            borderColor: "#555",
          }}
        >
          <View
            style={{
              width: "55%",
              padding: 10,
              justifyContent: "center",
              borderRightWidth: 1,
              borderColor: "#555",
            }}
          >
            <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold" }}>
              {label}
            </Text>
          </View>
          <View style={{ width: "45%" }} />
        </View>
      ))}
    </View>
  );
}

function Gastos() {
  return (
    <View style={{ flex: 1, borderWidth: 0.6, borderColor: "#bbb" }}>
      <Text style={s.sectionTitle}>GASTOS</Text>
      <View style={{ flexDirection: "row", backgroundColor: "#f0f0f0" }}>
        {[
          ["Concepto", "50%"],
          ["Importe $", "25%"],
          ["Comprobante", "25%"],
        ].map(([label, width]) => (
          <Text
            key={label}
            style={{
              width,
              padding: 5,
              fontSize: 9,
              fontFamily: "Helvetica-Bold",
              textAlign: "center",
            }}
          >
            {label}
          </Text>
        ))}
      </View>
      {Array.from({ length: 6 }, (_, i) => (
        <View
          key={i}
          style={{
            flexDirection: "row",
            height: 47,
            borderTopWidth: 0.4,
            borderColor: "#bbb",
          }}
        >
          {["50%", "25%", "25%"].map((width, j) => (
            <View
              key={j}
              style={{
                width,
                borderLeftWidth: j ? 0.4 : 0,
                borderColor: "#bbb",
              }}
            />
          ))}
        </View>
      ))}
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
  logo = "/brand/logo-texto-print.png",
}) {
  const filas = routeRows(orders, customers);
  const partes = partesAdaptadas(filas);
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
      {partes.slice(0, 1).map((parte, i) => (
        <Page key={i} size="A4" orientation="landscape" style={s.page}>
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
          <Text style={s.pie} fixed>
            El Pollito Casero · Documento no válido como factura · Uso interno
            {partes.length > 1 ? ` · Hoja ${i + 1} de ${partes.length}` : ""}
          </Text>
        </Page>
      ))}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Cabecera
          logo={logo}
          preventistas={drivers.join(" / ")}
          vehiculo={vehicle}
          fecha={date}
          turno={
            turno === "manana" ? "Mañana" : turno === "tarde" ? "Tarde" : ""
          }
          cantidad={filas.length}
        />
        <View
          style={{ flexDirection: "row", gap: 14, marginTop: 12 }}
          wrap={false}
        >
          <Rendicion />
          <Gastos />
        </View>
        <View style={s.firmas} wrap={false}>
          <Text style={s.firma}>FIRMA REPARTIDOR</Text>
          <Text style={s.firma}>FIRMA CONTROL / ADMINISTRACIÓN</Text>
        </View>
        <Text style={s.pie} fixed>
          El Pollito Casero · Totales de todo el reparto
        </Text>
      </Page>
      {partes.slice(1).map((parte, i) => (
        <Page
          key={`continuacion-${i}`}
          size="A4"
          orientation="landscape"
          style={s.page}
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
          <Text style={s.pie} fixed>
            Continuación de pedidos · Hoja {i + 2} de {partes.length} ·
            Rendición única en el reverso de la principal
          </Text>
        </Page>
      ))}
    </Document>
  );
}
export default HojaDocument;
