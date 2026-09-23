# Avances

## 2026-09-23 — PC-000 en curso

- Carpeta verificada contra package.json, server.mjs, domain.mjs y remoto indicado.
- Base b4df34b, árbol inicialmente limpio, rama codex/produccion-tickets.
- Node v24.21.0; npm test: 29 aprobadas, sin fallas ni omitidas.
- No hay AGENTS.md en el proyecto ni en los dos directorios superiores examinados.
- Inventario y reglas de los 22 tickets conservados en tickets/; no se consideran implementados.
- Pruebas E2E: la base ya era de memoria, pero DATA_DIR e integraciones heredaban configuración. Se agrega entorno con lista permitida y directorio temporal.
- Causas de código: ETA esperada antes de persistencia; recarga de pedidos/clientes antes de liberar acción; mínimo de una caja; campos vacíos reemplazados; caché privada compartida y cola sin propietario.
- Próximo paso: build, E2E aislada y ensayo repetible de latencias; iniciar PC-001 con regresión de servicio auxiliar lento.

No se ejecutaron scripts de limpieza/importación ni se abrió la base operativa.

## 2026-09-23 — PC-000 y PC-001 cerrados

- Línea base medida con `scripts/benchmark-production.mjs` en tres escalas (50/100, 200/1000,
  1000/1000), 20 repeticiones por operación, comparando `b4df34b` contra la rama de trabajo.
- **Causa confirmada y corregida:** iniciar reparto esperaba el servicio de rutas dentro del
  bloqueo del pedido. De 111,82 ms a 0,39 ms p50 con rutas lentas. Timeout real: 6000 ms.
- **Cuello que queda:** `/api/orders` devuelve 887 KB con 1000 pedidos y el navegador recarga
  pedidos + clientes completos tras cada operación. Va a PC-017.
- **Descartado con evidencia:** SQLite no está saturado (escrituras < 1 ms con 1000 pedidos). No
  se justifica cambiar de base, plan ni región.
- 4 pruebas nuevas en `tests/reparto.test.mjs`. Suite completa: 33 aprobadas.
- Pendiente de medir: navegador, teléfono real y hosting.
- Ticket activo: PC-002 (teclado y desplazamiento). Próximos: PC-003, PC-004, PC-005.

## 2026-09-23 — PC-002, PC-003, PC-004 y PC-016

- **PC-002 (en revisión):** el ajuste del campo activo dejó de usar temporizadores y ahora
  desplaza el contenedor real (la caja del `dialog`), no `window`. `--alto-visible` reemplaza a
  `100dvh`, que en Android no se achica con el teclado. Falta la prueba en teléfono físico.
- **PC-003 (hecho):** `audit_log` con actor estable, categoría, antes/después, motivo, operación
  y resultado; lista de campos permitidos (se cortó el volcado del cuerpo en `customer.update`);
  cambio y evento en la misma transacción; consulta paginada lista para PC-014.
- **PC-004 (hecho):** `crates.boxes` separa peso de envases. Bolsa = 0 cajas, sin tara y sin
  deuda de envases. Los tres casos numéricos del encargo, comprobados.
- **PC-016 (hecho):** llegó la plantilla el 23/09 y la hoja de ruta se rehízo contra ella.
- **PC-021:** recomendación emitida con mediciones: no cambiar de servidor, base ni plataforma.

Pruebas: 49 unitarias y 18 comprobaciones en navegador, todas en verde.

Ticket activo: ninguno. Próximos por dependencias: PC-005 (corregir saldos guardados),
PC-019 (offline y cambio de usuario), PC-017 (reducir recargas), PC-006 (unidades).

## 2026-09-23 (tarde) — Hoja de ruta corregida, teclado de saldos, PC-005, PC-007 y PC-019

- **Hoja de ruta:** el importe total ahora suma el saldo del cliente (pedido + deuda). La deuda
  se cuenta una sola vez por cliente y el saldo a favor resta. Desplegado el mismo día.
- **PC-005 cerrado (en revisión):** teclado propio de la app al cargar saldos, orden del
  formulario corregido, y detección de conflicto cuando dos personas editan el mismo saldo.
- **PC-007 cerrado:** el pesaje se filtra por preventista (Todos / Sin asignar) y por estado.
- **PC-019 (en revisión):** la copia del service worker pasa a ser privada por sesión y la cola
  de envíos lleva dueño. Dos filtraciones reales corregidas.
- Pruebas: 66 unitarias y 27 comprobaciones en navegador, en verde.

- **PC-014 cerrado:** pantalla de Movimientos, con el día de hoy por defecto, filtros de
  categoría y usuario, resumen "de cuánto a cuánto", detalle desplegable, hora de Mendoza y
  paginado de a 50. Solo administración: el servidor le devuelve 403 a un preventista.
- Pruebas: 66 unitarias y 34 comprobaciones en navegador, en verde.

Ticket activo: ninguno. Próximos: PC-017 (recargas y tamaño de respuestas), PC-006 (unidades),
PC-013 (retirar el chat), PC-009/PC-010/PC-011 (pantallas).

## Prioridad solicitada — fecha, resumen y casillas de rendición

Se interrumpe el orden ordinario para PC-022 (fecha correcta de Mendoza y confirmación numérica) y ajuste pequeño PC-016 según fotografía. Implementación y verificación detalladas en tickets/PC-022.md. 74 pruebas unitarias y circuito de navegador aislado aprobados; PDF generado/renderizado/inspeccionado. Publicación pendiente de verificar.

El trabajo local incompleto de retirada del chat tenía una referencia a UnreadBanner y había quitado también el objeto del contexto y funciones ajenas al chat. Se recuperaron estas funciones desde HEAD y se terminaron las referencias de UI/SSE para que la app vuelva a cargar. PC-013 sigue en revisión hasta completar limpieza de esquema/estilos y regresión específica.
