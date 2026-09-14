import React from "react";
import { money } from "../lib/format.js";

const fmtKg = (n) =>
  Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
const ROWS = 12;

/**
 * Remito interno 10×15 cm, calcado del talonario: cabecera con la marca y los datos fiscales,
 * Nº y fecha en casilleros, cliente / calle / localidad / cel., grilla KILOS · DETALLE ·
 * PRECIO X UNIDAD · PRECIO TOTAL, y al pie CAJAS ADEUDADAS y TOTAL en la misma grilla.
 * Recibe el pedido ya pesado y la ficha del cliente (para cajas adeudadas y saldo).
 */
export default function Remito({ order: o, customer: c, fiscal = {}, number }) {
  const date = new Date(
    o.deliveryDate ? o.deliveryDate + "T12:00:00" : o.created,
  );
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(2);
  const lines = o.items.filter((i) => i.kg > 0 || i.boxes);
  const owedBoxes = Math.max(0, c?.summary?.boxes || 0);
  const onAccount = o.payment === "cuenta" && !o.paid ? o.total : 0;
  const previous = c
    ? Math.round(((c.summary?.balance || 0) - onAccount) * 100) / 100
    : null;
  const name =
    (c?.alias || o.name) +
    (c?.legalName && c.legalName !== (c.alias || o.name)
      ? ` (${c.legalName})`
      : "");
  return (
    <article className="remito" aria-label={"Remito " + o.id}>
      <header className="remito-head">
        <div className="remito-brand">
          <div className="remito-ribbon" aria-hidden="true">
            {fiscal.legalName || "EL POLLITO CASERO"}
          </div>
          <strong className="remito-tagline">
            {fiscal.tagline || "VENTA POR MAYOR Y MENOR"}
          </strong>
          <p>
            <b>☏</b> {fiscal.whatsapp || ""}
          </p>
          <p>
            <b>⌂</b> {fiscal.address || ""}
          </p>
          <p className="remito-iva">{fiscal.ivaCondition || ""}</p>
        </div>
        <div className="remito-x" aria-hidden="true">
          X
        </div>
        <div className="remito-doc">
          <h1>REMITO INTERNO</h1>
          <p className="remito-nv">DOCUMENTO NO VÁLIDO COMO FACTURA</p>
          <p className="remito-fiscal">
            C.U.I.T.: {fiscal.cuit} · Ingresos Brutos: {fiscal.iibb}
            <br />
            Inicio de Actividades: {fiscal.since}
          </p>
          <p className="remito-n">
            <span>N°:</span>{" "}
            <strong>{number || o.id.replace("PC-", "")}</strong>
          </p>
          <p className="remito-date">
            <span>Fecha:</span>
            <i>{dd}</i>
            <i>{mm}</i>
            <i>{yy}</i>
          </p>
        </div>
      </header>
      <section className="remito-client">
        <p>
          <span>Cliente:</span> <u>{name}</u>
        </p>
        <p>
          <span>Calle:</span> <u>{o.address || c?.address || ""}</u>
        </p>
        <p className="remito-two">
          <span>
            <span>Localidad:</span> <u>{o.locality?.name || c?.zone || ""}</u>
          </span>
          <span>
            <span>Cel.:</span>{" "}
            <u>{(o.phone || c?.contactPhone || "").replace(/^549/, "")}</u>
          </span>
        </p>
      </section>
      <table className="remito-table">
        <thead>
          <tr>
            <th className="kilos">KILOS</th>
            <th>DETALLE</th>
            <th className="num">PRECIO X UNIDAD</th>
            <th className="num">PRECIO TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(ROWS, lines.length) }, (_, i) => {
            const l = lines[i];
            return (
              <tr key={i}>
                <td className="kilos">{l ? fmtKg(l.kg) : ""}</td>
                <td>
                  {l
                    ? `${l.name}${l.boxes ? ` · ${l.boxes} ${l.boxes === 1 ? "caja" : "cajas"}` : ""}`
                    : ""}
                  {i === lines.length && o.notes ? (
                    <em className="remito-note">{o.notes}</em>
                  ) : null}
                </td>
                <td className="num">{l ? money(l.price) : ""}</td>
                <td className="num">{l ? money(l.lineTotal) : ""}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="2" className="remito-boxes">
              <span>CAJAS ADEUDADAS:</span>
              <strong>{owedBoxes || ""}</strong>
            </td>
            <td className="remito-total-label">TOTAL:</td>
            <td className="num remito-total">{money(o.total)}</td>
          </tr>
        </tfoot>
      </table>
      {previous !== null && previous !== 0 && (
        <p className="remito-balance">
          Saldo anterior: {money(previous)} · Saldo con este remito:{" "}
          {money(previous + onAccount)}
        </p>
      )}
    </article>
  );
}
