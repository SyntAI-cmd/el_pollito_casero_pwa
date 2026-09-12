import React from "react";
import {
  ArrowUpRight,
  Package,
  CircleHelp,
  Wallet,
  Store,
  LogOut,
  User,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money, dateText, kgText, totalKg, planNames } from "../lib/format.js";
import { PageHead, EmptyState } from "../components/ui.jsx";

export default function Account() {
  const { session, me, orders, contact, setModal, logout, localities } =
    useStore();
  if (!session)
    return (
      <>
        <PageHead
          title="Las cuentas, claras."
          description="Ingresá con tu teléfono para ver tu cuenta corriente y tus envases."
        />
        <EmptyState
          icon={Wallet}
          title="Tu cuenta, en un solo lugar"
          text="Saldo, movimientos y envases pendientes de devolución."
        />
        <div className="actions-row">
          <button
            className="primary"
            onClick={() => setModal({ type: "login" })}
          >
            Ingresar con mi teléfono
          </button>
        </div>
      </>
    );
  if (session.role !== "cliente")
    return (
      <>
        <PageHead title="Las cuentas, claras." />
        <EmptyState
          icon={Store}
          title={`Estás como ${session.role}`}
          text="Las cuentas corrientes se consultan por cliente desde Operación."
          to="/operacion"
          action="Ir a Operación"
        />
      </>
    );
  const summary = me?.summary || { balance: 0, boxes: 0, pendingOrders: 0 };
  const movements = [
    ...orders
      .filter((o) => o.payment === "cuenta" || o.boxes > 0)
      .map((o) => ({ kind: "order", at: o.created, o })),
    ...(me?.payments || []).map((p) => ({ kind: "payment", at: p.at, p })),
  ].sort((x, y) => y.at.localeCompare(x.at));
  const locality = localities.find((l) => l.id === me?.localityId);
  return (
    <>
      <PageHead
        title="Las cuentas, claras."
        description="Tu cuenta corriente y los envases que tenés para devolver."
      />
      <section className="panel profile-card">
        <span className="avatar big">{session.name[0].toUpperCase()}</span>
        <div>
          <h2>{session.name}</h2>
          <p>
            {planNames[me?.plan || session.plan || "minorista"]}
            {me?.credit && me?.plan === "mayorista"
              ? " · cuenta corriente habilitada"
              : ""}
            {me?.address
              ? ` · ${me.address}${locality ? ", " + locality.name : ""}`
              : ""}
          </p>
        </div>
        <div className="profile-actions">
          <button
            className="secondary"
            onClick={() => setModal({ type: "profile" })}
          >
            <User size={15} /> Mis datos
          </button>
          <button className="link-button" onClick={logout}>
            <LogOut size={14} /> Salir
          </button>
        </div>
      </section>
      {me?.plan !== "mayorista" && (
        <div className="notice">
          <CircleHelp size={18} /> La cuenta corriente y los envases retornables
          son para clientes mayoristas habituales. Consultá por WhatsApp si
          querés pasarte.
        </div>
      )}
      <div className="account-grid">
        <section className="balance-card">
          <span>
            {summary.balance < 0 ? "SALDO A FAVOR" : "SALDO PENDIENTE"}
          </span>
          <h2>{money(Math.abs(summary.balance))}</h2>
          <p>
            {summary.pendingOrders
              ? `${summary.pendingOrders} ${summary.pendingOrders === 1 ? "pedido" : "pedidos"} a cuenta sin pagar${summary.creditBalance ? ` · ${money(summary.creditBalance)} a favor` : ""}`
              : summary.balance < 0
                ? "Se descuenta de tu próxima compra a cuenta"
                : "Sin compras a cuenta pendientes"}
          </p>
          <button onClick={() => contact("admin")}>
            Coordinar pago <ArrowUpRight size={18} />
          </button>
        </section>
        <section className="panel box-card">
          <Package size={30} />
          <div>
            <h2>
              {summary.boxes}{" "}
              <span>{summary.boxes === 1 ? "envase" : "envases"}</span>
            </h2>
            <p>Pendientes de devolución</p>
          </div>
          <p>
            Entregalos en tu próximo reparto. El repartidor registra la
            devolución y se descuenta de tu saldo.
          </p>
        </section>
      </div>
      <section className="panel">
        <div className="section-line">
          <h2>Movimientos</h2>
          <span className="muted">Cuenta corriente y envases</span>
        </div>
        {movements.length === 0 ? (
          <p className="muted">Todavía no hay movimientos a cuenta.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th>Importe</th>
                  <th>Envases</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) =>
                  m.kind === "payment" ? (
                    <tr key={m.p.id} className="payment-row">
                      <td>{m.p.id}</td>
                      <td>{dateText(m.p.at)}</td>
                      <td>
                        Pago recibido · {m.p.method}
                        {m.p.by && m.p.by !== "admin" ? ` · ${m.p.by}` : ""}
                      </td>
                      <td className="green">− {money(m.p.amount)}</td>
                      <td>—</td>
                      <td>Acreditado</td>
                    </tr>
                  ) : (
                    <tr key={m.o.id}>
                      <td>{m.o.id}</td>
                      <td>{dateText(m.o.created)}</td>
                      <td>
                        {kgText(totalKg(m.o))} de pollo
                        {m.o.weighed ? " · pesado en balanza" : ""}
                      </td>
                      <td>
                        {m.o.payment === "cuenta" ? money(m.o.total) : "—"}
                      </td>
                      <td>
                        {m.o.boxes
                          ? `${m.o.boxes - m.o.returned} / ${m.o.boxes}`
                          : "—"}
                      </td>
                      <td>
                        {m.o.status === "cancelado"
                          ? "Cancelado"
                          : m.o.paid || m.o.payment !== "cuenta"
                            ? "Pagado"
                            : "Pendiente"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
