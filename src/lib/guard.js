/**
 * Guardia de las ventanas: una ventana con cambios sin guardar puede pedir que no se cierre.
 * `check()` devuelve true si se puede cerrar; si devuelve false, la ventana queda abierta
 * (y es la propia ventana la que le pregunta al usuario qué hacer con lo que escribió).
 */
export const modalGuard = { check: null };

/** ¿Se puede cerrar la ventana abierta? */
export const puedeCerrar = () => {
  try {
    return modalGuard.check ? modalGuard.check() !== false : true;
  } catch {
    return true;
  }
};
