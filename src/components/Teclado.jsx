import React from "react";
import { Keyboard, Delete } from "lucide-react";

/**
 * Teclado numérico de la app, compartido por el pesaje y la carga de saldos.
 *
 * En el celular el campo va con `inputMode="none"`: el teclado del teléfono NO se abre, así
 * nunca hay dos teclados peleando por la pantalla y los botones de guardar quedan siempre a la
 * vista. Queda la alternativa de usar el teclado del teléfono, y la preferencia se recuerda.
 * En escritorio manda el teclado físico.
 */
export function useTecladoApp(clave = "teclado-app") {
  const [modo, setModo] = React.useState(() => {
    const guardado = localStorage.getItem(clave);
    if (guardado === "app" || guardado === "sistema") return guardado;
    return typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches
      ? "app"
      : "sistema";
  });
  const tecladoApp = modo === "app";
  const cambiar = () => {
    const otro = tecladoApp ? "sistema" : "app";
    localStorage.setItem(clave, otro);
    setModo(otro);
  };
  return { tecladoApp, cambiar };
}

/** Enlace para cambiar entre el teclado de la app y el del teléfono. */
export function CambiarTeclado({ tecladoApp, cambiar }) {
  return (
    <div className="teclado-modo">
      <button type="button" className="link-button" onClick={cambiar}>
        <Keyboard size={15} />{" "}
        {tecladoApp
          ? "Usar el teclado del teléfono"
          : "Usar el teclado de la app"}
      </button>
    </div>
  );
}

/**
 * Teclas. `onTecla` recibe un dígito, "," , "borrar" o "limpiar".
 * `decimales` en false saca la coma (cajas, cantidades enteras).
 */
export default function Teclado({
  onTecla,
  decimales = true,
  vacio = true,
  etiqueta = "Teclado numérico",
}) {
  const teclas = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];
  // Al tocar una tecla no se le saca el foco al campo: el cursor se queda donde está y
  // el teclado físico de escritorio sigue funcionando.
  const sinRobarFoco = (e) => e.preventDefault();
  return (
    <div
      className="keypad"
      role="group"
      aria-label={etiqueta}
      onMouseDown={sinRobarFoco}
    >
      {teclas.map((k) => (
        <button key={k} type="button" aria-label={k} onClick={() => onTecla(k)}>
          {k}
        </button>
      ))}
      {decimales ? (
        <button
          type="button"
          aria-label="coma decimal"
          onClick={() => onTecla(",")}
        >
          ,
        </button>
      ) : (
        <button type="button" disabled aria-hidden="true" tabIndex={-1} />
      )}
      <button type="button" aria-label="0" onClick={() => onTecla("0")}>
        0
      </button>
      <button
        type="button"
        aria-label="Borrar el último número"
        onClick={() => onTecla("borrar")}
      >
        <Delete size={22} />
      </button>
      <button
        type="button"
        className="clear"
        aria-label="Limpiar"
        disabled={vacio}
        onClick={() => onTecla("limpiar")}
        style={{ gridColumn: "span 3" }}
      >
        Limpiar
      </button>
    </div>
  );
}

/**
 * Aplica una tecla a un texto. Deja hasta `maxDecimales` después de la coma y `maxLargo`
 * caracteres en total. Nunca deja dos comas.
 */
export function aplicarTecla(
  valor,
  tecla,
  { maxDecimales = 2, maxLargo = 9 } = {},
) {
  if (tecla === "borrar") return valor.slice(0, -1);
  if (tecla === "limpiar") return "";
  if (tecla === "," && (valor.includes(",") || !valor)) return valor;
  const siguiente = (valor + tecla).slice(0, maxLargo);
  const [, dec] = siguiente.split(",");
  return dec && dec.length > maxDecimales ? valor : siguiente;
}
