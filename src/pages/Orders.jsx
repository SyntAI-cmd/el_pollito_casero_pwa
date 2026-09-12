import React from "react";
import { Package, ArrowUpRight, RefreshCw, ShoppingBag } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link } from "../lib/router.jsx";
import { money, dateText, kgText } from "../lib/format.js";
import { PageHead, EmptyState, StatusBadge } from "../components/ui.jsx";

export default function Orders() {
  const { orders, session, repeat, setModal } = useStore();
  if (!session)
    return (
      <>
        <PageHead
          title="Todo lo que pediste."
          description="Ingresá con tu teléfono para ver tu historial."
        />
        <EmptyState
          icon={ShoppingBag}
          title="Tus pedidos te esperan"
          text="Identificate con tu nombre y tu WhatsApp para recuperar tus pedidos."
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
  return (
    <>
      <PageHead
        title="Todo lo que pediste."
        description="Tus pedidos, sus estados y un atajo para volver a pedir."
      />
      {orders.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="Tu primer pedido te espera"
          to="/"
          action="Ver productos"
        />
      ) : (
        <div className="order-list">
          {orders.map((o) => (
            <article className="order-row" key={o.id}>
              <span className="order-icon">
                <Package />
              </span>
              <div>
                <strong>{o.id}</strong>
                <p>
                  {dateText(o.created)} ·{" "}
                  {o.items
                    .map((p) => `${kgText(p.kg)} ${p.name.toLowerCase()}`)
                    .join(" · ")}
                </p>
              </div>
              <StatusBadge status={o.status} />
              <strong>{money(o.total)}</strong>
              <Link className="secondary" to={"/seguimiento?pedido=" + o.id}>
                Ver pedido <ArrowUpRight size={15} />
              </Link>
              {session.role === "cliente" && (
                <button
                  className="icon-button"
                  aria-label={"Repetir pedido " + o.id}
                  title="Repetir pedido"
                  onClick={() => repeat(o)}
                >
                  <RefreshCw size={18} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
