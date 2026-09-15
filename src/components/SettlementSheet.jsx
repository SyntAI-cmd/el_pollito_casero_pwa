import React from "react";
import { money, orderNumber } from "../lib/format.js";
import { dayLabel, paidByMethod } from "../lib/report.js";
import { methodNames } from "../lib/photo.js";

/**
 * Resumen de rendición del día (solo administración, para imprimir): compacto, muchas filas por
 * hoja. Por preventista: N° pedido, cliente, importe, cómo se cobró (efectivo / transf. / cheque /
 * a cuenta) y saldo del cliente; totales por medio y efectivo a rendir contra lo recibido.
 */
export default function SettlementSheet({ sheets, date, closures = [] }) {
  return (
    <div className="settlement">
      <header className="settlement-head">
        <img src="/brand/logo-texto.png" alt="El Pollito Casero" />
        <div>
          <span className="eyebrow">
            RESUMEN DE RENDICIÓN · SOLO ADMINISTRACIÓN
          </span>
          <h2>{dayLabel(date)}</h2>
        </div>
      </header>
      {sheets.map((sheet) => {
        const closure = closures.find((c) => c.driver === sheet.driver);
        return (
          <section key={sheet.driver} className="settlement-driver">
            <h3>
              {sheet.driver}
              <small>
                {sheet.stops.length}{" "}
                {sheet.stops.length === 1 ? "pedido" : "pedidos"} ·{" "}
                {sheet.delivered} entregados
              </small>
            </h3>
            <table className="settlement-table">
              <thead>
                <tr>
                  <th>N°</th>
                  <th>Cliente</th>
                  <th className="num">Importe</th>
                  <th>Cobro</th>
                  <th className="num">Efectivo</th>
                  <th className="num">Transf./MP</th>
                  <th className="num">Cheque</th>
                  <th className="num">A cuenta</th>
                  <th className="num">Saldo cliente</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {sheet.stops.map((s) => {
                  const by = paidByMethod(s.order);
                  return (
                    <tr key={s.order.id}>
                      <td>{orderNumber(s.order)}</td>
                      <td>{s.customer?.alias || s.order.name}</td>
                      <td className="num">{money(s.order.total)}</td>
                      <td>
                        {s.order.paid
                          ? methodNames[s.order.paidMethod] ||
                            methodNames[s.method] ||
                            s.method
                          : s.order.payment === "cuenta"
                            ? "a cuenta"
                            : "pendiente"}
                      </td>
                      <td className="num">
                        {by.efectivo ? money(by.efectivo) : ""}
                      </td>
                      <td className="num">
                        {by.transferencia + by.mercadopago
                          ? money(by.transferencia + by.mercadopago)
                          : ""}
                      </td>
                      <td className="num">
                        {by.cheque ? money(by.cheque) : ""}
                      </td>
                      <td className="num">
                        {s.account ? money(s.account) : ""}
                      </td>
                      <td className="num">
                        {s.customer
                          ? money((s.previousBalance || 0) + s.account)
                          : ""}
                      </td>
                      <td>
                        {s.order.status === "entregado"
                          ? "entregado"
                          : s.order.status.replace("_", " ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="2">Totales</td>
                  <td className="num">
                    {money(sheet.stops.reduce((a, s) => a + s.order.total, 0))}
                  </td>
                  <td />
                  <td className="num">
                    {money(sheet.collected + sheet.accountCash)}
                  </td>
                  <td className="num">
                    {money(sheet.transfers + sheet.accountTransfers)}
                  </td>
                  <td className="num">
                    {money(sheet.cheques + sheet.accountCheques)}
                  </td>
                  <td className="num">{money(sheet.account)}</td>
                  <td colSpan="2" />
                </tr>
                <tr className="settle">
                  <td colSpan="4">Efectivo a rendir</td>
                  <td className="num">{money(sheet.toSettle)}</td>
                  <td colSpan="5">
                    {closure
                      ? `Recibido ${money(closure.received)} · ${closure.received === closure.expected ? "sin diferencia" : (closure.received > closure.expected ? "+" : "−") + money(Math.abs(closure.received - closure.expected))} · ${closure.by}`
                      : "Recibido $ ____________ · Diferencia $ ____________"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        );
      })}
      {!sheets.length && <p className="muted">Sin pedidos para esta fecha.</p>}
      <footer className="signatures">
        <span>Firma administración</span>
      </footer>
    </div>
  );
}
