import React, { useRef } from "react";
import { Search, X } from "lucide-react";

/**
 * Buscador único de la app: el contenedor dibuja el único borde (y el foco); el campo no tiene
 * borde propio. La × borra y devuelve el foco; Esc borra si hay texto. El filtrado lo sigue
 * haciendo cada pantalla con su propio estado: acá solo se presenta.
 */
export default function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className = "",
}) {
  const input = useRef(null);
  const borrar = () => {
    onChange("");
    input.current?.focus();
  };
  return (
    <div className={"sf" + (value ? " has" : "") + (className ? " " + className : "")}>
      <Search size={16} aria-hidden="true" />
      <input
        ref={input}
        className="sf-input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            borrar();
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        enterKeyHint="search"
      />
      {value ? (
        <button
          type="button"
          className="sf-clear"
          onClick={borrar}
          aria-label="Borrar búsqueda"
        >
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}
