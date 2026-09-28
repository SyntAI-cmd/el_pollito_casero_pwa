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
 * Se imprime solo lo ya registrado: N° de remito, cliente, importe total (con el saldo, si
 * lo hay) y el saldo que traía el cliente. Cajas, corrección, pagos y rendición salen en
 * blanco: es el arqueo que completa el preventista en lapicera.
 *
 * Diseño: tres bloques separados (REMITO · CAJAS · PAGOS) con el mismo alto de fila, un
 * contorno fino por bloque y líneas internas suaves. El reverso usa el mismo sistema.
 */
const ROJO = "#c9262e";
const MARCO = "#7a7a7a"; // contorno de cada bloque
const LINEA = "#c4c4c4"; // divisiones internas
const FONDO = "#f2f2f2"; // fila de títulos de columna
const money = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
const A_FAVOR = " a favor";
const ALTO_PEDIDOS = 420;
const SEPARACION = 8; // espacio blanco entre bloques
// Nombres y zonas se cortan por palabra, nunca con guion ("Gran Men-doza").
Font.registerHyphenationCallback((word) => [word]);

const s = StyleSheet.create({
  page: {
    paddingTop: 22,
    paddingBottom: 16,
    paddingHorizontal: 24,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    backgroundColor: "#fff",
  },
  // Cabecera: marca a la izquierda, título a la derecha, filete rojo abajo
  head: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    paddingBottom: 7,
    borderBottomWidth: 1.2,
    borderColor: ROJO,
  },
  logo: { width: 62, height: 32, objectFit: "contain", marginRight: 10 },
  marca: { fontSize: 16, fontFamily: "Helvetica-Bold", color: ROJO },
  lema: { fontSize: 7.5, fontFamily: "Helvetica-Bold", marginTop: 2 },
  domicilio: { fontSize: 7.5, color: "#444", marginTop: 2 },
  titulo: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "right" },
  // Datos del reparto: rótulo chico arriba y valor sobre una línea (como un formulario)
  meta: { flexDirection: "row", gap: 14, marginBottom: 10 },
  metaCampo: {
    borderBottomWidth: 0.75,
    borderColor: MARCO,
    paddingBottom: 3,
  },
  metaRotulo: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: "#666",
    marginBottom: 2,
  },
  metaValor: { fontSize: 10.5, minHeight: 12 },
  // Tabla
  fila: { flexDirection: "row" },
  banda: {
    backgroundColor: ROJO,
    color: "#fff",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    textAlign: "center",
    paddingVertical: 3.5,
  },
  celda: {
    borderRightWidth: 0.5,
    borderBottomWidth: 0.5,
    borderColor: LINEA,
    paddingHorizontal: 5,
    justifyContent: "center",
  },
  inicioBloque: { borderLeftWidth: 0.75, borderLeftColor: MARCO },
  finBloque: { borderRightWidth: 0.75, borderRightColor: MARCO },
  ultimaFila: { borderBottomWidth: 0.75, borderBottomColor: MARCO },
  th: {
    height: 24,
    paddingHorizontal: 1.5,
    backgroundColor: FONDO,
    alignItems: "center",
    borderBottomWidth: 0.75,
    borderBottomColor: MARCO,
  },
  thTexto: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: "#333",
    textAlign: "center",
  },
  num: { textAlign: "right" },
  aFavor: { fontSize: 7, color: "#555", textAlign: "right", marginTop: 1 },
  // Reverso
  seccion: { width: 389 }, // (794 - 16 de separación) / 2
  filaReverso: { height: 46 },
  rotuloReverso: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  firmas: { flexDirection: "row", gap: 40, marginTop: 48 },
  firma: {
    flex: 1,
    borderTopWidth: 0.75,
    borderColor: "#333",
    paddingTop: 6,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
  },
});

/*
 * Columnas por bloque (A4 apaisada: 794 pt útiles = columnas + contornos + separaciones).
 * Los importes que se escriben a mano llevan casilleros anchos.
 */
const BLOQUES = [
  {
    titulo: "REMITO",
    cols: [
      ["N°\nremito", 40],
      ["Cliente / zona", 128],
      ["Importe\ntotal $", 64],
      ["Saldo\ncliente $", 66],
      ["Corrección $", 70],
    ],
  },
  {
    titulo: "CAJAS",
    cols: [
      ["Previas", 34],
      ["Salientes", 38],
      ["Devueltas", 40],
      ["Saldo", 34],
    ],
  },
  {
    titulo: "PAGOS",
    cols: [
      ["Efectivo $", 66],
      ["Transfer. $", 66],
      ["Cheque $", 66],
      ["Saldo final $", 66],
    ],
  },
];
// Una celda por columna, más un hueco entre bloques; cada celda sabe dónde cae.
const CELDAS = BLOQUES.flatMap((b, bi) => [
  ...(bi ? [{ hueco: true, ancho: SEPARACION }] : []),
  ...b.cols.map(([rotulo, ancho], ci) => ({
    rotulo,
    ancho,
    inicio: ci === 0,
    fin: ci === b.cols.length - 1,
  })),
]);
const COLUMNAS = CELDAS.filter((c) => !c.hueco);
const anchoBloque = (b) => b.cols.reduce((n, [, w]) => n + w, 0);
const IMPORTES = new Set([2, 3]);

function Cabecera({
  logo,
  preventistas,
  vehiculo,
  fecha,
  turno,
  cantidad,
  hoja,
}) {
  const datos = [
    ["PREVENTISTA", preventistas || "", 3],
    ["VEHÍCULO", vehiculo || "", 3.4],
    ["FECHA", (fecha || "").split("-").reverse().join("/"), 1.4],
    ["N° PEDIDOS", String(cantidad), 1.1],
    ["TURNO", turno || "", 1.3],
    ...(hoja ? [["HOJA", hoja, 1]] : []),
  ];
  return (
    <>
      <View style={s.head}>
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
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
        <Text style={s.titulo}>HOJA DE RUTA · RENDICIÓN DE CAJA</Text>
      </View>
      <View style={s.meta}>
        {datos.map(([rotulo, valor, flex]) => (
          <View key={rotulo} style={[s.metaCampo, { flex }]}>
            <Text style={s.metaRotulo}>{rotulo}</Text>
            <Text style={s.metaValor}>{valor}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function valoresFila(r) {
  const o = r.order;
  // IMPORTE TOTAL = lo del pedido + lo que el cliente ya debía: es lo que hay que cobrar
  // en esa parada. La deuda previa se suma UNA sola vez por cliente, así que si el cliente
  // tiene dos pedidos, el segundo lleva solo lo suyo. Un saldo negativo es crédito del
  // cliente: se muestra "a favor" y, si cubre el pedido, no hay nada que cobrar (0).
  const saldo = r.firstCustomer ? r.moneyBefore || 0 : 0;
  const deuda = Math.max(saldo, 0);
  const aCobrar = Math.max((o.noPricing ? 0 : o.total || 0) + saldo, 0);
  return [
    orderNumber(o),
    `${r.customer?.alias || o.name}${o.zone ? " · " + o.zone : ""}`,
    o.noPricing
      ? deuda
        ? money(deuda)
        : "Sin precio"
      : o.weighed
        ? money(aCobrar)
        : deuda
          ? `Sin pesar + ${money(deuda)}`
          : "Sin pesar",
    // De ese importe, esto es lo que traía el cliente.
    !r.firstCustomer
      ? "Incl. anterior"
      : saldo < 0
        ? money(-saldo) + A_FAVOR
        : money(saldo),
    // Corrección, cajas y pagos: en blanco para el preventista.
    ...Array(COLUMNAS.length - 4).fill(""),
  ];
}

// Reserva espacio para textos de varias líneas antes de repartir el alto sobrante.
function altoFila(r, fontSize) {
  const font = Font.getFont({ fontFamily: "Helvetica" }).data;
  const width = (text) => (font.layout(text).advanceWidth * fontSize) / 1000;
  const lines = valoresFila(r).map((value, i) => {
    const capacity = COLUMNAS[i].ancho - 11;
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

// Bordes de una celda según su lugar en el bloque: contorno afuera, línea suave adentro.
const bordes = (c, { ultima } = {}) => [
  s.celda,
  { width: c.ancho },
  c.inicio ? s.inicioBloque : {},
  c.fin ? s.finBloque : {},
  ultima ? s.ultimaFila : {},
];

function Valor({ v, i, fontSize }) {
  const texto = String(v);
  if (texto.endsWith(A_FAVOR))
    return (
      <>
        <Text style={[{ fontSize }, s.num]}>
          {texto.slice(0, -A_FAVOR.length)}
        </Text>
        <Text style={s.aFavor}>a favor</Text>
      </>
    );
  return (
    <Text
      style={[
        { fontSize },
        i === 0 ? { fontFamily: "Helvetica-Bold" } : {},
        IMPORTES.has(i) ? s.num : {},
      ]}
    >
      {texto}
    </Text>
  );
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
      <View style={s.fila}>
        {BLOQUES.map((b, bi) => (
          <React.Fragment key={b.titulo}>
            {bi > 0 && <View style={{ width: SEPARACION }} />}
            <Text style={[s.banda, { width: anchoBloque(b) }]}>{b.titulo}</Text>
          </React.Fragment>
        ))}
      </View>
      <View style={s.fila}>
        {CELDAS.map((c, i) =>
          c.hueco ? (
            <View key={i} style={{ width: c.ancho }} />
          ) : (
            <View key={i} style={[...bordes(c), s.th]}>
              <Text style={s.thTexto}>{c.rotulo}</Text>
            </View>
          ),
        )}
      </View>
      {filas.map((r, rowIndex) => {
        const valores = valoresFila(r);
        const ultima = rowIndex === filas.length - 1;
        let col = 0;
        return (
          <View
            style={[s.fila, { height: heights[rowIndex] + extra }]}
            key={r.order.id}
            wrap={false}
          >
            {CELDAS.map((c, i) => {
              if (c.hueco) return <View key={i} style={{ width: c.ancho }} />;
              const j = col++;
              return (
                <View key={i} style={bordes(c, { ultima })}>
                  <Valor v={valores[j]} i={j} fontSize={fontSize} />
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

/** Bloque del reverso: mismo sistema que la tabla (banda roja, títulos, filas iguales). */
function Seccion({ titulo, cols, filas }) {
  const celdas = cols.map(([rotulo, ancho], i) => ({
    rotulo,
    ancho,
    inicio: i === 0,
    fin: i === cols.length - 1,
  }));
  const borde = (c, ultima) => [
    s.celda,
    { width: c.ancho },
    c.inicio ? s.inicioBloque : {},
    c.fin ? s.finBloque : {},
    ultima ? s.ultimaFila : {},
  ];
  return (
    <View style={s.seccion}>
      <Text style={s.banda}>{titulo}</Text>
      <View style={s.fila}>
        {celdas.map((c) => (
          <View key={c.rotulo} style={[...borde(c), s.th]}>
            <Text style={s.thTexto}>{c.rotulo}</Text>
          </View>
        ))}
      </View>
      {filas.map((rotulo, i) => (
        <View key={i} style={[s.fila, s.filaReverso]}>
          {celdas.map((c, j) => (
            <View
              key={j}
              style={[
                ...borde(c, i === filas.length - 1),
                { paddingHorizontal: 10 },
              ]}
            >
              {j === 0 && rotulo ? (
                <Text style={s.rotuloReverso}>{rotulo}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Reverso() {
  return (
    <View wrap={false}>
      <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
        <Seccion
          titulo="RENDICIÓN"
          cols={[
            ["Concepto", 216],
            ["Importe $", 173],
          ]}
          filas={[
            "SUMA DE BOLETA CORRECTA",
            "EFECTIVO TOTAL",
            "TRANSFERENCIA",
            "CHEQUE",
            "GASTOS",
            "PEN. SALDO DEL DÍA (CUENTA)",
          ]}
        />
        <Seccion
          titulo="GASTOS"
          cols={[
            ["Concepto", 195],
            ["Importe $", 97],
            ["Comprobante", 97],
          ]}
          filas={Array(6).fill("")}
        />
      </View>
      <View style={s.firmas}>
        <Text style={s.firma}>FIRMA REPARTIDOR</Text>
        <Text style={s.firma}>FIRMA CONTROL / ADMINISTRACIÓN</Text>
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
  const cabecera = {
    logo,
    preventistas: drivers.join(" / "),
    vehiculo: vehicle,
    fecha: date,
    turno: turno === "manana" ? "Mañana" : turno === "tarde" ? "Tarde" : "",
  };
  // Con varias hojas de pedidos, cada una lleva su número en la cabecera.
  const hoja = (i) => (partes.length > 1 ? `${i + 1} de ${partes.length}` : "");
  return (
    <Document
      title={`Hoja de ruta ${date}`}
      author="El Pollito Casero"
      language="es-AR"
    >
      {partes.slice(0, 1).map((parte, i) => (
        <Page key={i} size="A4" orientation="landscape" style={s.page}>
          <Cabecera {...cabecera} cantidad={parte.length} hoja={hoja(0)} />
          <Tabla filas={parte} />
        </Page>
      ))}
      <Page size="A4" orientation="landscape" style={s.page}>
        <Cabecera {...cabecera} cantidad={filas.length} />
        <Reverso />
      </Page>
      {partes.slice(1).map((parte, i) => (
        <Page
          key={`continuacion-${i}`}
          size="A4"
          orientation="landscape"
          style={s.page}
        >
          <Cabecera {...cabecera} cantidad={parte.length} hoja={hoja(i + 1)} />
          <Tabla filas={parte} />
        </Page>
      ))}
    </Document>
  );
}
export default HojaDocument;
