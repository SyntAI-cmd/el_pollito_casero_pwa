import React from "react";
import { Plus, MessageCircle, ArrowUpRight } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { PageHead } from "../components/ui.jsx";

const faqs = [
  [
    "¿Cómo hago un pedido?",
    "Elegí la modalidad (mayorista, intermedio o minorista), agregá los cortes que necesitás por kilo y completá tus datos de entrega. Al confirmar quedás identificado con tu WhatsApp y podés seguir el pedido desde cualquier dispositivo.",
  ],
  [
    "¿Cómo puedo pagar?",
    "Los clientes minoristas e intermedios pagan al recibir el pedido (efectivo) o por transferencia cuando administración la habilita. Los mayoristas habituales pueden comprar a cuenta corriente y coordinar el pago con administración.",
  ],
  [
    "¿Qué pasa con el peso final?",
    "Los precios son por kilo y las cantidades son estimadas. Al preparar el pedido se pesa en balanza y el importe final se ajusta a lo entregado.",
  ],
  [
    "¿Cómo devuelvo los envases?",
    "Los cajones se registran como saldo de envases en tu cuenta mayorista. Devolvelos al repartidor en la próxima entrega y se descuentan al instante.",
  ],
  [
    "¿Dónde hacen entregas?",
    "En San Martín, Mendoza, y localidades cercanas del Este mendocino y el Gran Mendoza. Elegí la tuya al hacer el pedido; el horario se coordina con administración.",
  ],
  [
    "¿Puedo cancelar un pedido?",
    "Sí, desde Seguir mi pedido, mientras todavía figure como recibido. Una vez en preparación, escribinos por WhatsApp.",
  ],
  [
    "¿Cómo veo dónde está el repartidor?",
    "Cuando tu pedido sale, el repartidor puede compartir su ubicación y la ves en el mapa de seguimiento con el tiempo estimado de llegada. Además podés escribirle directo por WhatsApp.",
  ],
];

export default function Help() {
  const { contact, config } = useStore();
  return (
    <>
      <PageHead
        title="Estamos para ayudarte."
        description="Una respuesta rápida para que sigas con tu día."
      />
      <div className="help-grid">
        <section className="panel" aria-labelledby="faq">
          <h2 id="faq">Lo que nos suelen preguntar</h2>
          {faqs.map(([q, a]) => (
            <details key={q}>
              <summary>
                {q}
                <Plus size={17} />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
        <section className="contact-panel">
          <MessageCircle size={34} />
          <h2>
            Del otro lado,
            <br />
            hay alguien de acá.
          </h2>
          <p>Consultá sobre tu pedido, la entrega o tu cuenta corriente.</p>
          <button className="primary full" onClick={() => contact("admin")}>
            Escribir por WhatsApp <ArrowUpRight size={17} />
          </button>
          <p className="demo-note">
            {config?.adminName || "Administración"} · Administración
            <br />
            {(config?.drivers || []).join(" y ")} · Reparto
            <br />
            {config?.origin?.address}
          </p>
        </section>
      </div>
    </>
  );
}
