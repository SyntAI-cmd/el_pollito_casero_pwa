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
import { Link } from "../lib/router.jsx";
import { money, dateText, planNames } from "../lib/format.js";
import { ledger } from "../lib/ledger.js";
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
          <Link to="/ingresar?volver=/cuenta" className="primary">
            Ingresar a mi cuenta
          </Link>
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
  // Extracto: cargos, ajustes, pagos y anulaciones con saldo acumulado (del más nuevo al más viejo).
  const statement = ledger(orders, me?.payments || []).reverse();
  const boxOrders = orders
    .filter((o) => o.boxes > 0)
    .sort((x, y) => y.created.localeCompare(x.created));
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
          <h2>Extracto de cuenta corriente</h2>
          <span className="muted">
            Cargos, ajustes de balanza, pagos y saldo después de cada movimiento
          </span>
        </div>
        {statement.length === 0 ? (
          <p className="muted">Todavía no hay movimientos a cuenta.</p>
        ) : (
          <div className="table-scroll">
            <table className="statement">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Concepto</th>
                  <th className="num">Cargo</th>
                  <th className="num">Pago</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {statement.map((r, i) => (
                  <tr key={r.ref + r.kind + i} className={"kind-" + r.kind}>
                    <td>{dateText(r.at)}</td>
                    <td>{r.label}</td>
                    <td className="num">
                      {r.amount > 0 ? money(r.amount) : ""}
                    </td>
                    <td className="num green">
                      {r.amount < 0 ? money(-r.amount) : ""}
                    </td>
                    <td className={"num " + (r.balance > 0 ? "red" : "")}>
                      {r.balance < 0
                        ? `${money(-r.balance)} a favor`
                        : money(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {boxOrders.length > 0 && (
        <section className="panel">
          <div className="section-line">
            <h2>Envases</h2>
            <span className="muted">Dejados y devueltos por pedido</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fecha</th>
                  <th className="num">Pendientes</th>
                </tr>
              </thead>
              <tbody>
                {boxOrders.map((o) => (
                  <tr key={o.id}>
                    <td>{o.id}</td>
                    <td>{dateText(o.created)}</td>
                    <td className="num">
                      {o.boxes - o.returned} de {o.boxes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
