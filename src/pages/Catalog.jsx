import React, { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Leaf,
  Truck,
  ShieldCheck,
  Store,
  ShoppingBag,
  House,
  Search,
  Package,
  MapPin,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Link } from "../lib/router.jsx";
import { labels, normalize, kgText, totalKg, isActive } from "../lib/format.js";
import Cart from "../components/Cart.jsx";
import ProductCard from "../components/ProductCard.jsx";
import { MiniMap } from "../components/ui.jsx";

const filters = [
  ["todos", "Todos"],
  ["entero", "Entero"],
  ["trozado", "Trozado"],
];

export default function Catalog() {
  const { products, plan, setPlan, orders, session, config } = useStore();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("todos");
  const active = orders.find(isActive);
  const shown = products.filter(
    (p) =>
      (filter === "todos" || p.category === filter) &&
      normalize(p.name).includes(normalize(search)),
  );
  const adminMode = session?.role === "admin";
  const greeting = adminMode
    ? "Cargar un pedido telefónico"
    : session?.role === "cliente"
      ? `Hola, ${session.name.split(" ")[0]}.`
      : "¿Qué llevamos hoy?";
  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow">
            {adminMode ? "OPERACIÓN" : "BUEN POLLO. BUENA COMPAÑÍA."}
          </span>
          <h1>{greeting}</h1>
          <p>
            {adminMode
              ? "Elegí la modalidad del cliente, cargá los kilos y completá sus datos al confirmar."
              : "Para tu negocio o para tu mesa. Siempre casero."}
          </p>
        </div>
        <span className="fresh-label">
          <MapPin size={13} />{" "}
          {config?.origin?.address || "San Martín, Mendoza"}
        </span>
      </div>
      {!adminMode && (
        <>
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">EL SABOR DE ELEGIR BIEN</span>
              <h2>
                Fresco de origen.
                <br />
                <em>Casero de corazón.</em>
              </h2>
              <p>
                Pollo entero y por corte, por kilo,
                <br />
                con entrega en San Martín y alrededores.
              </p>
              <a className="hero-button" href="#productos">
                Armá tu pedido <ArrowUpRight size={17} />
              </a>
            </div>
            <img
              src="/images/pollo.webp"
              width="1440"
              height="960"
              fetchPriority="high"
              alt="Pollo entero fresco sobre papel de carnicería, con limón y romero. Imagen ilustrativa."
            />
            <div className="hero-stamp" aria-hidden="true">
              <i>DE ACÁ.</i>
              <b>BIEN CASERO.</b>
              <span>PARA VOS.</span>
            </div>
          </section>
          <div className="benefits">
            <span>
              <Leaf /> Fresco, como tiene que ser
            </span>
            <span>
              <Truck /> Reparto a tu puerta
            </span>
            <span>
              <ShieldCheck /> Compra simple y directa
            </span>
          </div>
        </>
      )}
      <div className="shop-grid">
        <section
          id="productos"
          className="product-section"
          aria-labelledby="catalogo"
        >
          <div className="section-line">
            <div>
              <h2 id="catalogo">Elegí tu pollo</h2>
              <p>Vos ponés la receta. Nosotros, el pollo.</p>
            </div>
            <span className="product-count">{products.length} productos</span>
          </div>
          <div
            className="plan-switch"
            role="group"
            aria-label="Modalidad de compra"
          >
            <button
              className={plan === "mayorista" ? "selected" : ""}
              onClick={() => setPlan("mayorista")}
              aria-pressed={plan === "mayorista"}
            >
              <Store size={17} /> Mayorista <span>Para tu negocio</span>
            </button>
            <button
              className={plan === "intermedio" ? "selected" : ""}
              onClick={() => setPlan("intermedio")}
              aria-pressed={plan === "intermedio"}
            >
              <ShoppingBag size={17} /> Intermedio
            </button>
            <button
              className={plan === "minorista" ? "selected" : ""}
              onClick={() => setPlan("minorista")}
              aria-pressed={plan === "minorista"}
            >
              <House size={17} /> Minorista <span>Para tu casa</span>
            </button>
          </div>
          <label className="catalog-search">
            <Search size={17} />
            <span className="sr-only">Buscar un producto</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscá un corte…"
            />
          </label>
          <div className="catalog-toolbar">
            <div
              className="filters"
              role="group"
              aria-label="Filtrar productos"
            >
              {filters.map(([v, l]) => (
                <button
                  key={v}
                  className={filter === v ? "active" : ""}
                  aria-pressed={filter === v}
                  onClick={() => setFilter(v)}
                >
                  {l}
                </button>
              ))}
            </div>
            <span>Precios por kilogramo</span>
          </div>
          {shown.length ? (
            <div className="products">
              {shown.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  defaultKg={
                    plan === "mayorista" ? (p.id === "entero" ? 10 : 5) : 1
                  }
                />
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <Search />
              <h2>No encontramos “{search}”</h2>
              <p>Probá con otro nombre o quitá el filtro.</p>
            </div>
          )}
          <div className="wholesale-note">
            <Package size={24} />
            <div>
              <strong>¿Comprás para tu negocio?</strong>
              <p>
                Cuenta corriente, envases retornables y envío sin cargo con la
                modalidad mayorista.
              </p>
            </div>
            <Link to="/planes" aria-label="Conocer planes">
              <ArrowUpRight size={22} />
            </Link>
          </div>
        </section>
        <div className="right-column">
          <Cart />
          {active && (
            <section
              className="tracking-preview"
              aria-label="Tu pedido en curso"
            >
              <div className="section-line">
                <span className="eyebrow">TU PEDIDO EN CURSO</span>
                <span className="status-dot" />
              </div>
              <h3>{labels[active.status]}</h3>
              <p>
                {active.id} · {kgText(totalKg(active))}
              </p>
              <MiniMap />
              <Link to={"/seguimiento?pedido=" + active.id}>
                Seguir mi pedido <ArrowRight size={16} />
              </Link>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
