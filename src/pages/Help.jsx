import React, { useState } from "react";
import { ChevronDown, MessageCircle, ArrowUpRight } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { PageHead } from "../components/ui.jsx";
import SearchField from "../components/SearchField.jsx";
import { normalize } from "../lib/format.js";

/**
 * Ayuda por rol. Cada respuesta describe lo que la app hace hoy (pantallas y botones con su
 * nombre real); si un flujo cambia, se corrige acá.
 */
const ADMIN = [
  {
    id: "pedidos",
    title: "Pedidos",
    img: "caja-lista",
    faqs: [
      [
        "¿Cómo encuentro un pedido?",
        "En Pedidos, escribí en el buscador el N°, el nombre del cliente, el teléfono o la dirección. Con Filtros elegís la fecha de reparto, el turno, el preventista y si están entregados o no. La × del buscador lo borra.",
      ],
      [
        "¿Cómo abro un pedido y qué puedo hacer?",
        "Tocá «Abrir» en la fila (en el celular, «Ver pedido»). Se abre el pedido completo al costado: productos, kilos, total, saldo anterior y los botones según el estado: Preparar pedido, Pesar o Corregir peso, Editar, Comprobantes, Registrar cobro y Confirmar entrega.",
      ],
      [
        "¿Cómo asigno el preventista?",
        "Dentro del pedido elegí «Preventista» y, si van dos, «Segundo preventista». Los dos ven y gestionan el pedido igual en Mis entregas.",
      ],
      [
        "¿Para qué sirve la casilla «Cargado»?",
        "Tildala cuando el pedido sube al camión. Así se ve de un vistazo qué falta cargar.",
      ],
      [
        "¿Cómo cargo un pedido telefónico?",
        "En Cargar pedido buscá al cliente por apodo, zona o razón social y elegilo de la lista (Enter elige el primero). Completá fecha de reparto, turno, preventista y pago, y poné las cajas o los kilos de cada producto. Ctrl+Enter confirma.",
      ],
      [
        "El cliente no existe, ¿qué hago?",
        "Tocá «¿Cliente nuevo? Crealo acá» debajo del buscador. La ficha queda disponible para todo el equipo.",
      ],
      [
        "¿Por qué el importe dice que se confirma con el pesaje?",
        "Los pedidos en cajas se cobran por kilo: el importe final sale cuando se pesan en la balanza.",
      ],
    ],
  },
  {
    id: "pesaje",
    title: "Pesaje",
    img: "balanza",
    faqs: [
      [
        "¿Cómo peso un pedido?",
        "En Pesaje elegí la fecha y el pedido. Indicá cuántas cajas van juntas en la balanza y el peso bruto total: la app resta la tara por caja y muestra el peso neto. Tocá «Guardar pesada». Si va en bolsa, no se resta tara.",
      ],
      [
        "¿Qué pasa si me quedo sin señal mientras peso?",
        "La pesada queda guardada en el teléfono y se envía sola cuando vuelve la señal. Arriba ves cuántas hay pendientes; cuando dice «Todo guardado en el servidor», ya están confirmadas.",
      ],
      [
        "Una pesada dice «requiere revisión», ¿qué hago?",
        "El servidor no la aceptó (por ejemplo, el pedido se canceló). Leé el motivo y elegí reintentarla o descartarla. Nada se borra solo.",
      ],
    ],
  },
  {
    id: "entregas",
    title: "Entregas y cobros",
    img: "dinero",
    faqs: [
      [
        "¿Cómo reviso lo que entregaron los preventistas?",
        "En Revisar entregas elegí el preventista: ves cada pedido con sus comprobantes, cajas y saldo. «Marcar entregados del día» confirma de una vez los que quedaron abiertos.",
      ],
      [
        "¿Cómo registro un cobro?",
        "Dentro del pedido, «Registrar cobro». Se puede cobrar con varios medios a la vez (mixto). Para cobrar deuda vieja de un cliente, andá a Clientes → Saldos → Dinero.",
      ],
      [
        "¿Cómo se calculan las cajas?",
        "Saldo anterior + le dejamos − nos entrega = saldo que queda. El cliente puede devolver más de las que le dejamos.",
      ],
    ],
  },
  {
    id: "clientes",
    title: "Clientes",
    img: "camion",
    faqs: [
      [
        "¿Qué veo en cada cliente?",
        "Saldos (cuenta corriente, cajas y comprobantes), Ficha (datos, zona, turno, preventista) y Precios propios. Las marcas «Revisar» o «Sin CUIT» indican que falta completar la ficha.",
      ],
      [
        "¿Cómo cargo muchos clientes juntos?",
        "Con «Plantilla» descargás el Excel de ejemplo; completalo y subilo con «Importar Excel».",
      ],
    ],
  },
  {
    id: "imprimir",
    title: "Imprimir y equipo",
    img: "impresora",
    faqs: [
      [
        "¿Cómo imprimo la hoja de ruta o los remitos?",
        "En Imprimir elegí la fecha y el documento. Se abre la vista previa con Descargar, Compartir e Imprimir.",
      ],
      [
        "¿Cómo agrego un preventista o cambio una contraseña?",
        "En Equipo editás usuarios, roles y contraseñas, y cargás los vehículos.",
      ],
    ],
  },
];

const REPARTO = [
  {
    id: "entregas",
    title: "Mis entregas",
    img: "camion",
    faqs: [
      [
        "¿Dónde veo lo que tengo que entregar hoy?",
        "En Mis entregas. Arriba ves cuántas entregas te quedan, los kilos y lo cobrado hoy. Con «Para entregar», «En camino» y «Entregadas» cambiás la lista. Tocá «Ver pedido» para abrir uno.",
      ],
      [
        "¿Cómo cierro una entrega?",
        "Abrí el pedido y tocá «Confirmar entrega». Completá lo que cobraste, las cajas y sacá la foto del remito firmado o del comprobante. Sin al menos una foto la entrega no se cierra.",
      ],
    ],
  },
  {
    id: "cajas",
    title: "Cajas y saldos",
    img: "caja-lista",
    faqs: [
      [
        "¿Cómo anoto las cajas?",
        "Saldo anterior + le dejamos − nos entrega = saldo que queda. Si el cliente devuelve más de las que le dejaste, se acepta.",
      ],
      [
        "Un cliente me paga deuda vieja o me devuelve cajas sin pedido",
        "En la tarjeta del pedido tocá «Cajas, deuda y comprobantes», o andá a Clientes → Saldos. Elegí Dinero o Cajas y cargá lo que recibiste.",
      ],
    ],
  },
  {
    id: "senal",
    title: "Cobros, señal y la app",
    img: "dinero",
    faqs: [
      [
        "¿Cómo cobro si me pagan con transferencia o cheque?",
        "Elegí el medio de pago y sacá la foto del comprobante: es obligatoria. Si pagan con varios medios, usá pago mixto.",
      ],
      [
        "Me quedé sin señal",
        "Podés ver los pedidos que ya estaban cargados, pero entregar y cobrar necesita conexión. Esperá a tener señal y confirmá; no se pierde lo que ya estaba guardado.",
      ],
      [
        "¿Cómo instalo la app en el celular?",
        "Abrí la app en Chrome, tocá el menú ⋮ y elegí «Instalar aplicación». Queda como una app más y entrás con tu usuario.",
      ],
    ],
  },
];

const CLIENTE = [
  {
    id: "cliente",
    title: "Tus pedidos",
    img: "caja-lista",
    faqs: [
      [
        "¿Cómo hago un pedido?",
        "Elegí la modalidad (mayorista, intermedio o minorista), agregá los cortes por kilo y completá tus datos de entrega.",
      ],
      [
        "¿Qué pasa con el peso final?",
        "Los precios son por kilo: al preparar el pedido se pesa y el importe final se ajusta a lo entregado.",
      ],
      [
        "¿Puedo cancelar un pedido?",
        "Sí, desde Seguir mi pedido, mientras figure como recibido. Después, escribinos por WhatsApp.",
      ],
    ],
  },
];

export default function Help() {
  const { contact, config, session } = useStore();
  const role = session?.role;
  const grupos =
    role === "admin" ? ADMIN : role === "repartidor" ? REPARTO : CLIENTE;
  const [q, setQ] = useState("");
  const nq = normalize(q.trim());
  const visibles = grupos
    .map((g) => ({
      ...g,
      faqs: nq
        ? g.faqs.filter(([p, r]) => normalize(p + " " + r).includes(nq))
        : g.faqs,
    }))
    .filter((g) => g.faqs.length);
  return (
    <>
      <PageHead
        eyebrow="AYUDA"
        title={
          role === "admin"
            ? "Cómo se usa la app."
            : role === "repartidor"
              ? "Ayuda para el reparto."
              : "Estamos para ayudarte."
        }
        description={
          role === "admin" || role === "repartidor"
            ? "Respuestas cortas para cada pantalla. Buscá o elegí un tema."
            : "Una respuesta rápida para que sigas con tu día."
        }
      />
      <div className="help-search">
        <SearchField
          value={q}
          onChange={setQ}
          label="Buscar en la ayuda"
          placeholder="Ej.: pesada, cajas, transferencia"
        />
      </div>
      {grupos.length > 1 && !nq && (
        <nav className="help-topics" aria-label="Temas">
          {grupos.map((g) => (
            <a key={g.id} href={"#ayuda-" + g.id} className="help-topic">
              <img
                src={`/ilustraciones/${g.img}-sinfondo.webp`}
                width="240"
                height="240"
                alt=""
                loading="lazy"
              />
              <span>{g.title}</span>
            </a>
          ))}
        </nav>
      )}
      <div className="help-grid">
        <div className="help-groups">
          {visibles.length === 0 ? (
            <p className="muted">
              No encontramos «{q}». Probá con otra palabra o escribinos.
            </p>
          ) : (
            visibles.map((g) => (
              <section
                key={g.id}
                id={"ayuda-" + g.id}
                className="panel help-group"
                aria-labelledby={"ayuda-t-" + g.id}
              >
                <h2 id={"ayuda-t-" + g.id}>{g.title}</h2>
                {g.faqs.map(([pregunta, respuesta]) => (
                  <details key={pregunta} open={!!nq}>
                    <summary>
                      {pregunta}
                      <ChevronDown size={18} aria-hidden="true" />
                    </summary>
                    <p>{respuesta}</p>
                  </details>
                ))}
              </section>
            ))
          )}
        </div>
        <section className="contact-panel">
          <MessageCircle size={28} />
          <h2>¿No encontrás lo que buscás?</h2>
          <p>
            {role === "repartidor"
              ? "Escribile a administración: te responden por WhatsApp."
              : role === "admin"
                ? "Si algo no funciona como dice acá, anotá qué pantalla y qué tocaste."
                : "Consultá sobre tu pedido, la entrega o tu cuenta corriente."}
          </p>
          {role !== "admin" && (
            <button className="primary full" onClick={() => contact("admin")}>
              Escribir a {config?.adminName || "administración"}{" "}
              <ArrowUpRight size={17} />
            </button>
          )}
        </section>
      </div>
    </>
  );
}
