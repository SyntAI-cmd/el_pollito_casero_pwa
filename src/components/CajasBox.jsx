import React from "react";
import { Package } from "lucide-react";
import { boxSummary, orderBoxes } from "../lib/cajas.js";

/**
 * Las cajas de un pedido, con las cuatro cifras y el resultado a la vista:
 *
 *   saldo de cajas = adeudadas anteriores + salientes − devueltas
 *
 * Nada de esto es dinero. Cargar cajones al camión no genera deuda: las salientes se cuentan
 * cuando se confirma la entrega al cliente.
 */
export default function CajasBox({ order, customer }) {
  const saldo = boxSummary(customer);
  const {
    previas,
    salientes,
    devueltas,
    saldo: resultado,
  } = orderBoxes(order, saldo.balance);

  const plural = (n) => (Math.abs(n) === 1 ? "caja" : "cajas");
  return (
    <section className="cajas-box" aria-label="Cajas (envases)">
      <h4>
        <Package size={15} /> Cajas (envases)
      </h4>
      <dl>
        <dt>Cajas adeudadas anteriores</dt>
        <dd>{previas === null ? "Sin registro histórico" : previas}</dd>
        <dt>Cajas salientes de este pedido</dt>
        <dd>{salientes || "—"}</dd>
        <dt>Cajas devueltas</dt>
        <dd>{devueltas ? `−${devueltas}` : "—"}</dd>
        <div className="cajas-total" style={{ display: "contents" }}>
          {resultado !== null && (
            <>
              <dt>Saldo tras estos movimientos</dt>
              <dd>{resultado}</dd>
            </>
          )}
          <dt>Saldo actual de cajas del cliente</dt>
          <dd>
            {saldo.balance} {plural(saldo.balance)}
          </dd>
        </div>
      </dl>
      {saldo.balance < 0 && (
        <p className="muted small">
          Saldo histórico negativo: revisar con administración. Las nuevas
          devoluciones excedentes están bloqueadas.
        </p>
      )}
    </section>
  );
}

/** Versión corta para listas y tarjetas: solo el saldo de cajas, separado del importe. */
export function CajasChip({ customer }) {
  const { balance } = boxSummary(customer);
  if (!balance) return null;
  return (
    <span
      className={"cajas-chip" + (balance > 0 ? " pendiente" : "")}
      title="Saldo de cajas (envases), aparte del dinero"
    >
      <Package size={12} /> {balance}{" "}
      {Math.abs(balance) === 1 ? "caja" : "cajas"}
    </span>
  );
}
