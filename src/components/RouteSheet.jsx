import React from "react";
import { money, kgText, timeText, paymentLabel } from "../lib/format.js";
import { dayLabel } from "../lib/report.js";
import { mapsRouteLegs, copyText } from "../lib/maps.js";
import { useStore } from "../lib/store.jsx";

/** Hoja de ruta y rendición de un repartidor (misma vista en pantalla y en papel). */
export default function RouteSheet({ sheet }) {
  const { driver, date, stops, zones } = sheet;
  const { config, notify } = useStore();
  const legs = mapsRouteLegs(
    stops.map((s) => s.order),
    config?.origin,
  );
  return (
    <div className="sheet">
      <header className="sheet-head">
        <div>
          <span className="eyebrow">HOJA DE RUTA Y RENDICIÓN</span>
          <h2>{driver}</h2>
          <p>{dayLabel(date)}</p>
        </div>
        <dl className="sheet-facts">
          <div>
            <dt>Salida</dt>
            <dd>{sheet.departedAt ? timeText(sheet.departedAt) : "—"}</dd>
          </div>
          <div>
            <dt>Última entrega</dt>
            <dd>
              {sheet.lastDeliveryAt ? timeText(sheet.lastDeliveryAt) : "—"}
            </dd>
          </div>
          <div>
            <dt>Entregas</dt>
            <dd>
              {sheet.delivered} / {stops.length}
            </dd>
          </div>
          <div>
            <dt>Kilos</dt>
            <dd>{kgText(sheet.kg)}</dd>
          </div>
        </dl>
      </header>
      {legs.length > 0 && (
        <div className="route-links no-print">
          {legs.map((leg) => (
            <a
              key={leg.from}
              className="secondary small"
              href={leg.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {legs.length === 1
                ? "Abrir la ruta en Google Maps"
                : `Tramo ${leg.from}–${leg.to} en Google Maps`}
            </a>
          ))}
          <button
            type="button"
            className="link-button"
            onClick={async () =>
              notify(
                (await copyText(legs.map((l) => l.url).join(" ")))
                  ? "Enlace de la ruta copiado."
                  : "No se pudo copiar el enlace.",
              )
            }
          >
            Copiar enlace
          </button>
        </div>
      )}
      {zones.length > 0 && (
        <p className="sheet-zones">
          <strong>Zonas:</strong> {zones.join(" · ")}
        </p>
      )}
      {stops.length === 0 ? (
        <p className="muted">
          Sin entregas asignadas a {driver} en esta fecha.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Cliente</th>
                <th>Dirección</th>
                <th>Pedido</th>
                <th className="num">Kg</th>
                <th className="num">Importe</th>
                <th>Pago</th>
                <th className="num">Saldo ant.</th>
                <th className="num">Cajas que debía</th>
                <th className="num">Cajas dejadas</th>
                <th className="num">Cajas devueltas</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((s, i) => (
                <tr key={s.order.id}>
                  <td>{i + 1}</td>
                  <td>
                    <strong>{s.order.name}</strong>
                    <br />
                    <small>{s.order.phone}</small>
                  </td>
                  <td>
                    {s.order.address}
                    <br />
                    <small>{s.order.locality?.name}</small>
                    {s.order.notes && (
                      <>
                        <br />
                        <small>“{s.order.notes}”</small>
                      </>
                    )}
                  </td>
                  <td>
                    <small>{s.order.id}</small>
                    <br />
                    {s.order.items
                      .map((p) => `${p.name} ${kgText(p.kg)}`)
                      .join(", ")}
                  </td>
                  <td className="num">{s.kg}</td>
                  <td className="num">{money(s.order.total)}</td>
                  <td>
                    {paymentLabel(s.order)}
                    <br />
                    <small>
                      {s.order.paid
                        ? s.order.payment === "cuenta"
                          ? "Saldado en cuenta"
                          : `Cobrado · ${s.method}${s.order.paidBy ? " · " + s.order.paidBy : ""}`
                        : s.order.payment === "cuenta"
                          ? "A cuenta"
                          : s.order.payment === "entrega"
                            ? "Cobrar efectivo"
                            : "Espera " + s.method}
                    </small>
                  </td>
                  <td className="num">
                    {s.customer?.plan === "mayorista"
                      ? money(s.previousBalance)
                      : "—"}
                  </td>
                  <td className="num">
                    {s.order.plan === "mayorista"
                      ? Math.max(
                          0,
                          s.boxesPending - s.boxesLeft + s.boxesReturned,
                        )
                      : "—"}
                  </td>
                  <td className="num">
                    {s.order.plan === "mayorista" ? s.boxesLeft : "—"}
                  </td>
                  <td className="num">
                    {s.order.plan === "mayorista" ? s.boxesReturned : "—"}
                  </td>
                  <td>
                    {s.order.status === "entregado"
                      ? `Entregado ${timeText(s.order.deliveredAt)}`
                      : s.order.status === "en_camino"
                        ? "En camino"
                        : "Para salir"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sheet.accountPayments.length > 0 && (
        <div className="table-scroll">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Cobro de cuenta corriente</th>
                <th>Cliente</th>
                <th>Medio</th>
                <th>Aplicado a</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {sheet.accountPayments.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.id} · {timeText(p.at)}
                  </td>
                  <td>{p.customer.name}</td>
                  <td>{p.method}</td>
                  <td>
                    {p.applied.length ? p.applied.join(", ") : "saldo a favor"}
                  </td>
                  <td className="num">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="sheet-summary">
        <section>
          <h3>Rendición de caja</h3>
          <dl>
            <div>
              <dt>Efectivo cobrado en la puerta</dt>
              <dd>{money(sheet.collected)}</dd>
            </div>
            <div>
              <dt>Efectivo pendiente de cobro</dt>
              <dd className={sheet.pendingCash ? "red" : ""}>
                {money(sheet.pendingCash)}
              </dd>
            </div>
            <div>
              <dt>Cobros de cuenta corriente en efectivo</dt>
              <dd>{money(sheet.accountCash)}</dd>
            </div>
            <div className="total">
              <dt>Efectivo a rendir</dt>
              <dd>{money(sheet.toSettle)}</dd>
            </div>
            <div>
              <dt>Transferencias / Mercado Pago (no van en efectivo)</dt>
              <dd>{money(sheet.transfers + sheet.accountTransfers)}</dd>
            </div>
            <div>
              <dt>Cheques recibidos (se entregan con la rendición)</dt>
              <dd>{money(sheet.cheques + sheet.accountCheques)}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Cuenta corriente</h3>
          <dl>
            <div>
              <dt>A cuenta en este reparto</dt>
              <dd>{money(sheet.accountPlanned)}</dd>
            </div>
            <div>
              <dt>Entregado a cuenta</dt>
              <dd>{money(sheet.account)}</dd>
            </div>
            <div>
              <dt>Saldo anterior de clientes (al inicio del día)</dt>
              <dd>{money(sheet.previousBalance)}</dd>
            </div>
            <div>
              <dt>Cobrado a cuenta hoy</dt>
              <dd>
                {money(
                  sheet.accountCash +
                    sheet.accountTransfers +
                    sheet.accountCheques,
                )}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Envases</h3>
          <dl>
            <div>
              <dt>Dejados hoy</dt>
              <dd>{sheet.boxesLeft}</dd>
            </div>
            <div>
              <dt>Devueltos hoy</dt>
              <dd>{sheet.boxesReturned}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>Carga</h3>
          <dl>
            {sheet.byProduct.map(([name, kg]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{kgText(kg)}</dd>
              </div>
            ))}
            <div className="total">
              <dt>Total</dt>
              <dd>{kgText(sheet.kg)}</dd>
            </div>
          </dl>
        </section>
      </div>
      <div className="sheet-sign">
        <span>Firma repartidor</span>
        <span>Firma administración</span>
      </div>
    </div>
  );
}
