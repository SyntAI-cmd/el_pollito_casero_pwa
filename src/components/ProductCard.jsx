import React, { useState } from "react";
import { Minus, Plus, Check } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { money } from "../lib/format.js";

const initials = (name) =>
  name
    .split(" ")
    .filter(
      (w) =>
        !["del", "de", "con", "la", "las", "los", "el"].includes(
          w.toLowerCase(),
        ),
    )
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export default function ProductCard({ product: p, defaultKg = 1 }) {
  const { price, add, cart } = useStore();
  const [kg, setKg] = useState(defaultKg);
  const unit = price(p);
  const available = Number.isFinite(unit);
  const inCart = cart[p.id] || 0;
  const step = (delta) =>
    setKg((k) =>
      Math.min(1000, Math.max(1, Math.round((Number(k || 0) + delta) * 2) / 2)),
    );
  return (
    <article
      className={"product " + (inCart ? "in-cart" : "")}
      aria-labelledby={"name-" + p.id}
    >
      <div className={"product-image " + p.id}>
        {p.image ? (
          <img
            src={p.image}
            width="768"
            height="512"
            alt={p.name + ", imagen ilustrativa"}
            loading={p.id === "entero" ? "eager" : "lazy"}
          />
        ) : (
          <div className="cut-placeholder" aria-hidden="true">
            <span>{initials(p.name)}</span>
            <small>Nº {String(p.code).padStart(2, "0")}</small>
          </div>
        )}
        {inCart > 0 && (
          <span className="product-in-cart">
            <Check size={12} /> {inCart} kg
          </span>
        )}
      </div>
      <div className="product-body">
        <h3 id={"name-" + p.id}>{p.name}</h3>
        <p>{p.description}</p>
        <div className="price">
          {money(unit)}
          <span>{available ? "/ kg" : ""}</span>
        </div>
        <div className="product-actions">
          <div className="quantity">
            <button
              aria-label={`Reducir kg de ${p.name}`}
              disabled={kg <= 1}
              onClick={() => step(-0.5)}
            >
              <Minus size={15} />
            </button>
            <label className="sr-only" htmlFor={"kg-" + p.id}>
              Kilogramos de {p.name}
            </label>
            <input
              id={"kg-" + p.id}
              type="number"
              inputMode="decimal"
              min="1"
              max="1000"
              step="0.5"
              value={kg}
              onChange={(e) => setKg(e.target.value)}
              onBlur={() =>
                setKg((k) =>
                  Number.isFinite(Number(k)) && Number(k) >= 1
                    ? Math.round(Number(k) * 2) / 2
                    : 1,
                )
              }
            />
            <span>kg</span>
            <button
              aria-label={`Aumentar kg de ${p.name}`}
              disabled={kg >= 1000}
              onClick={() => step(0.5)}
            >
              <Plus size={15} />
            </button>
          </div>
          <button
            className="add-button"
            disabled={!available}
            onClick={() => add(p, kg)}
          >
            <Plus size={17} /> {available ? "Agregar" : "Sin tarifa"}
          </button>
        </div>
      </div>
    </article>
  );
}
