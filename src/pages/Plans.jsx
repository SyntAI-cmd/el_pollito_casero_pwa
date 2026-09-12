import React from "react";
import { Store, House, ShoppingBag, Check, ArrowRight } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { useRoute } from "../lib/router.jsx";
import { money, productPrice } from "../lib/format.js";
import { PageHead } from "../components/ui.jsx";

const copy = {
  mayorista: {
    icon: Store,
    eyebrow: "PARA TU NEGOCIO",
    title: "Mayorista",
    text: "Para quienes nos eligen todos los días: comercios, rotiserías y comedores.",
    perks: (s) => [
      "Precio mayorista en todos los cortes",
      "Cuenta corriente para clientes habituales",
      "Envases retornables con saldo de cajas",
      s ? `Envío ${money(s)}` : "Envío sin cargo",
    ],
  },
  intermedio: {
    icon: ShoppingBag,
    eyebrow: "PARA COMPRAR UN POCO MÁS",
    title: "Intermedio",
    text: "Para familias grandes, eventos o compras compartidas.",
    perks: (s) => [
      "Precio intermedio en todos los cortes",
      "Pago al recibir o por transferencia",
      "Sin saldo de envases",
      `Envío ${money(s)}`,
    ],
  },
  minorista: {
    icon: House,
    eyebrow: "PARA TU CASA",
    title: "Minorista",
    text: "La cantidad que necesitás, sin vueltas.",
    perks: (s) => [
      "Precio minorista por kilo",
      "Pago al recibir o por transferencia",
      "Sin mínimos ni compromisos",
      `Envío ${money(s)}`,
    ],
  },
};

export default function Plans() {
  const { products, plan, setPlan, notify, config } = useStore();
  const { navigate } = useRoute();
  return (
    <>
      <PageHead
        title="Un plan para cada mesa."
        description="Elegí cómo comprás. El precio por kilo queda claro desde el principio."
      />
      <div className="plans">
        {Object.entries(copy).map(([v, c]) => (
          <section
            className={"plan-card " + (v === plan ? "chosen" : "")}
            key={v}
            aria-labelledby={"plan-" + v}
          >
            <c.icon size={28} />
            <span className="eyebrow">{c.eyebrow}</span>
            <h2 id={"plan-" + v}>{c.title}</h2>
            <p>{c.text}</p>
            <div className="plan-prices">
              {products.map((p) => (
                <div key={p.id}>
                  <span>{p.name}</span>
                  <strong>
                    {money(productPrice(p, v))}
                    <small> / kg</small>
                  </strong>
                </div>
              ))}
            </div>
            <ul>
              {c.perks(config?.shipping?.[v] ?? 0).map((t) => (
                <li key={t}>
                  <Check size={16} />
                  {t}
                </li>
              ))}
            </ul>
            <button
              className={v === plan ? "primary full" : "secondary full"}
              onClick={() => {
                setPlan(v);
                navigate("/#productos");
                notify(`Modalidad ${c.title.toLowerCase()} seleccionada`);
              }}
            >
              {v === plan ? "Seguir como " : "Elegir "}
              {c.title.toLowerCase()}
              <ArrowRight size={16} />
            </button>
          </section>
        ))}
      </div>
      <p className="demo-note">
        La cuenta corriente mayorista la habilita administración. El peso final
        de cada pedido se ajusta en la balanza al preparar.
      </p>
    </>
  );
}
