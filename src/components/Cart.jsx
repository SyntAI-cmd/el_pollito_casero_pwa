import React from "react";
import {
  ShoppingBag,
  Minus,
  Plus,
  Trash2,
  ArrowRight,
  ShieldCheck,
  Truck,
  Store,
  House,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money, lineAmount, planNames, kgText } from "../lib/format.js";

export function CartLines() {
  const { items, cart, price, setQuantity } = useStore();
  return (
    <div className="cart-items">
      {items.map((p) => (
        <div className="cart-item" key={p.id}>
          <div>
            <strong>{p.name}</strong>
            <small>{money(price(p))} / kg</small>
            <div className="cart-quantity">
              <button
                aria-label={`Quitar medio kilo de ${p.name}`}
                onClick={() => setQuantity(p.id, cart[p.id] - 0.5)}
              >
                <Minus size={13} />
              </button>
              <span>{kgText(cart[p.id])}</span>
              <button
                aria-label={`Sumar medio kilo de ${p.name}`}
                disabled={cart[p.id] >= 1000}
                onClick={() => setQuantity(p.id, cart[p.id] + 0.5)}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
          <div>
            <strong>{money(lineAmount(price(p), cart[p.id]))}</strong>
            <button
              className="remove"
              aria-label={`Eliminar ${p.name}`}
              onClick={() => setQuantity(p.id, 0)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CartTotals() {
  const { totals } = useStore();
  return (
    <div className="cart-totals">
      <div>
        <span>
          Productos <small>({kgText(totals.kg)})</small>
        </span>
        <span>{money(totals.subtotal)}</span>
      </div>
      <div>
        <span>Envío</span>
        <span className={totals.shipping ? "" : "green"}>
          {totals.shipping ? money(totals.shipping) : "Sin cargo"}
        </span>
      </div>
      <div className="total">
        <strong>Total estimado</strong>
        <strong>{money(totals.total)}</strong>
      </div>
    </div>
  );
}

export default function Cart() {
  const { items, plan, online, setModal, config } = useStore();
  return (
    <aside className="cart-panel" id="carrito" aria-label="Tu pedido">
      <div className="section-line">
        <h2>Tu pedido</h2>
        <span className="count">{items.length}</span>
      </div>
      <div className="cart-plan">
        {plan === "minorista" ? <House size={15} /> : <Store size={15} />}
        {"Compra " + planNames[plan].toLowerCase()}
        <span>Precio por kg</span>
      </div>
      {!items.length ? (
        <div className="empty-cart">
          <ShoppingBag size={32} strokeWidth={1.3} />
          <h3>Acá empieza tu pedido</h3>
          <p>Elegí tus productos y sumá los kilos que necesitás.</p>
        </div>
      ) : (
        <CartLines />
      )}
      <CartTotals />
      <button
        className="primary full"
        disabled={!items.length || !online}
        onClick={() => setModal({ type: "checkout" })}
      >
        Continuar pedido <ArrowRight size={17} />
      </button>
      <p className="cart-foot">
        <ShieldCheck size={14} /> Revisás todo antes de confirmar
      </p>
      <div className="cart-delivery">
        <Truck size={20} />
        <div>
          <strong>De nuestro local a tu puerta</strong>
          <p>El peso final se ajusta en la balanza al preparar.</p>
        </div>
      </div>
      {config?.demo && (
        <p className="demo-note">Precios y condiciones de demostración.</p>
      )}
    </aside>
  );
}

/** Barra fija inferior en móvil, al estilo de las apps de pedidos. */
export function MobileCartBar() {
  const { items, totals, online, setModal } = useStore();
  if (!items.length) return null;
  return (
    <div className="mobile-cart-bar">
      <button
        className="primary"
        disabled={!online}
        onClick={() => setModal({ type: "cart" })}
      >
        <span className="count">{items.length}</span>
        <span>Ver mi pedido</span>
        <strong>{money(totals.total)}</strong>
      </button>
    </div>
  );
}
