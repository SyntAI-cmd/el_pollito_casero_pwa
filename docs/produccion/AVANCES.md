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
