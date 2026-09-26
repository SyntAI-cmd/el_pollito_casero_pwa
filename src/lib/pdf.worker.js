import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { PedidosDocument } from "../pdf/PedidosPdf.jsx";
import { HojaDocument } from "../pdf/HojaPdf.jsx";
import { RemitoDocument } from "../pdf/RemitoPdf.jsx";

const documents = {
  pedidos: PedidosDocument,
  hoja: HojaDocument,
  remito: RemitoDocument,
};
self.onmessage = async ({ data: { kind, props } }) => {
  try {
    const blob = await pdf(createElement(documents[kind], props)).toBlob();
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error.message || "No se pudo generar el PDF." });
  }
};
