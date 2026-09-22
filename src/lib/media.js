import { useEffect, useState } from "react";

/**
 * ¿Estamos en pantalla de celular? Las tablas operativas se muestran como tarjetas debajo de
 * 760 px; arriba de eso conviene la tabla, que entra entera y se lee de un vistazo.
 */
export function useIsMobile(query = "(max-width: 760px)") {
  const [is, setIs] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = (e) => setIs(e.matches);
    m.addEventListener("change", on);
    setIs(m.matches);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return is;
}
