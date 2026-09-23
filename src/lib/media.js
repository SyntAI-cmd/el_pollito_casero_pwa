import { useEffect, useRef, useState } from "react";

/** El contenedor que realmente se desplaza alrededor de un campo. Dentro de una ventana
 * (`dialog`) la página no se mueve: hay que desplazar la caja de la ventana, no `window`. */
function contenedorDesplazable(el) {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    const desplaza = /auto|scroll|overlay/.test(cs.overflowY);
    if (desplaza && n.scrollHeight > n.clientHeight + 1) return n;
    if (n.tagName === "DIALOG") break;
  }
  return null;
}

/** Mantiene visible el campo activo al cambiar el área visible del teclado.
 * Sin temporizadores ni animación: cambiar de campo cancela el ajuste anterior.
 * El desplazamiento instantáneo también respeta movimiento reducido.
 * Funciona igual en la página y dentro de una ventana con su propio desplazamiento.
 */
export function useFieldVisibility() {
  const cleanup = useRef(() => {});
  useEffect(() => () => cleanup.current(), []);
  return (event) => {
    cleanup.current();
    const field = event.currentTarget;
    const viewport = window.visualViewport;
    let frame;
    const adjust = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!field.isConnected || document.activeElement !== field) return;
        const caja = contenedorDesplazable(field);
        const bounds = field.getBoundingClientRect();
        // Área visible: la del teclado, recortada por la caja que desplaza si hay una.
        const vTop = viewport?.offsetTop || 0;
        const vBottom = vTop + (viewport?.height || window.innerHeight);
        let top = vTop + 12;
        let bottom = vBottom - 12;
        if (caja) {
          const r = caja.getBoundingClientRect();
          top = Math.max(top, r.top + 12);
          bottom = Math.min(bottom, r.bottom - 12);
        }
        const delta =
          bounds.top < top
            ? bounds.top - top
            : bounds.bottom > bottom
              ? bounds.bottom - bottom
              : 0;
        if (!delta) return;
        if (caja) caja.scrollBy({ top: delta, behavior: "instant" });
        else window.scrollBy({ top: delta, behavior: "instant" });
      });
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", adjust);
      field.removeEventListener("blur", stop);
    };
    cleanup.current = stop;
    viewport?.addEventListener("resize", adjust);
    field.addEventListener("blur", stop);
    adjust();
  };
}

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

/**
 * Publica el alto realmente visible (el que deja el teclado del teléfono) como `--alto-visible`.
 * `100dvh` no sirve para esto: en Android no se achica cuando sube el teclado, así que una
 * ventana alta deja los botones de guardar debajo del teclado. Se monta una sola vez.
 */
export function useVisibleHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const set = () => {
      const alto = vv?.height || window.innerHeight;
      document.documentElement.style.setProperty("--alto-visible", `${alto}px`);
    };
    set();
    vv?.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    return () => {
      vv?.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
    };
  }, []);
}
