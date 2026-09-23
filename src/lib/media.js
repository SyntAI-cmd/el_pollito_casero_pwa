import { useEffect, useRef, useState } from "react";

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

/**
 * Barra inferior: se esconde al bajar y vuelve al subir. Como la barra está fija y el espacio
 * al final de la pantalla no cambia, el contenido nunca salta.
 */
export function useHideOnScroll(umbral = 12) {
  const [oculta, setOculta] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    last.current = window.scrollY;
    let ticking = false;
    const on = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const d = y - last.current;
        if (Math.abs(d) < umbral) return;
        last.current = y;
        setOculta(d > 0 && y > 80);
      });
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [umbral]);
  return oculta;
}

/**
 * ¿Está abierto el teclado del teléfono? Se detecta por el alto real de la ventana visible
 * (visualViewport): cuando el teclado sube, ese alto se achica bastante.
 * Pone la clase `teclado-abierto` en el body para que la barra inferior y el chat se aparten.
 */
export function useKeyboardOpen() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => {
      const falta = window.innerHeight - vv.height;
      setAbierto(falta > 140);
    };
    vv.addEventListener("resize", on);
    on();
    return () => vv.removeEventListener("resize", on);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("teclado-abierto", abierto);
    return () => document.body.classList.remove("teclado-abierto");
  }, [abierto]);
  return abierto;
}

/** Pone o saca una clase en el body mientras el componente está montado. */
export function useBodyClass(clase, activo = true) {
  useEffect(() => {
    if (!activo) return;
    document.body.classList.add(clase);
    return () => document.body.classList.remove(clase);
  }, [clase, activo]);
}
