/**
 * Identidad estable de quien está usando la app (PC-019).
 *
 * Se arma con el identificador de la sesión, nunca con el nombre escrito: dos personas pueden
 * llamarse igual. Es el mismo formato que usa el servidor para la auditoría, así los dos lados
 * hablan de lo mismo.
 */
export const dueñoDe = (s) =>
  !s
    ? ""
    : s.staffId != null
      ? `staff:${s.staffId}`
      : s.phone
        ? `cliente:${s.phone}`
        : s.role
          ? `rol:${s.role}`
          : "";

/**
 * Versión de los datos que guarda el dispositivo. Si cambia el formato de lo que se encola,
 * se sube este número y lo viejo queda para conciliar a mano en vez de enviarse mal.
 */
export const VERSION_DATOS = 1;
