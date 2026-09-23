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
