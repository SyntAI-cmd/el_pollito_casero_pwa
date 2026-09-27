# Backlog de producción

Inicio: 2026-09-23. Base: b4df34b. Rama: codex/produccion-tickets.
Se ejecuta el encargo adjunto a pedido explícito de Mauro; GitHub y Railway están autorizados. No se autoriza contratar recursos ni cambiar de plataforma sin decisión.

| ID | Ticket | Prioridad | Estado | Dependencias |
| --- | --- | --- | --- | --- |
| PC-000 | Diagnóstico reproducible y línea base | P0 | Hecho | ninguna. |
| PC-001 | Iniciar reparto con un toque y sin espera de servicios auxiliares | P0 | Hecho | PC-000. |
| PC-002 | Formularios móviles, teclado y desplazamiento estable | P0 | En revisión (falta teléfono físico) | PC-000. |
| PC-003 | Auditoría consistente para todas las mutaciones | P0 | Hecho | PC-000. Esta base debe estar antes de los cambios de saldos, cantidades y documentos. |
| PC-004 | Pesaje con cero cajas, cantidad escrita y tara correcta | P0 | Hecho | PC-000, PC-003. |
| PC-005 | Corregir saldos ya guardados sin perder historial | P0 | En revisión (falta teléfono físico) | PC-003; incorporar la solución de teclado PC-002. |
| PC-006 | Pedir por unidades en administración y reparto | P1 | Pendiente | PC-003 y contrato de peso/envases de PC-004. |
| PC-007 | Pesada filtrable por preventista | P1 | Hecho | PC-004. |
| PC-008 | Eliminar checklist de carga al camión | P1 | Pendiente | PC-001, PC-004; integrar el contrato de PC-006. |
| PC-009 | Tarjetas plegables de pedidos y filtro de asignados | P1 | Pendiente | PC-002, PC-006, PC-008. |
| PC-010 | Clientes compactos con detalle completo | P1 | Pendiente | PC-002, PC-005. |
| PC-011 | Buscadores sin bordes ni campos superpuestos | P1 | Pendiente | PC-002. |
| PC-012 | Sidebar y navegación coherentes con la marca | P2 | Pendiente | PC-008, PC-013, PC-014 para el menú definitivo. |
| PC-013 | Retirar el chat interno completo | P1 | En revisión (UI/API retiradas; limpieza pendiente) | PC-000. Coordinar cambios con PC-017 y PC-018. |
| PC-014 | Pestaña Movimientos por fecha, actor y categoría | P1 | Hecho | PC-003; verificar cobertura de los tickets que introduzcan nuevas mutaciones. |
| PC-015 | Eliminar documentos del archivo con trazabilidad | P1 | Pendiente | PC-003. |
| PC-016 | Hoja de ruta PDF con plantilla y datos automáticos | P1 | Hecho (plantilla recibida 23/09) | PC-003, PC-004, PC-005, PC-006, PC-008. |
| PC-017 | Reducir consultas y recargas del servidor | P1 | Hecho — sin publicar (27/09: teléfono −98 % de datos, PC −99,5 %) | PC-000, PC-001; coordinar con PC-008 y PC-013. |
| PC-018 | Interfaz liviana y renders controlados | P1 | En revisión (27/09: pesaje con pendientes superpuestos; falta perfil en teléfono físico) | PC-000; integrar PC-009, PC-010, PC-011 y PC-013. |
| PC-019 | Offline, cambios de usuario y actualización PWA sin pérdida | P0 | En revisión (27/09: corregida la reapertura sin señal; falta teléfono físico) | PC-000. Coordinar versión de datos con PC-004, PC-006 y PC-008. |
| PC-020 | Integración, regresión y entrega revisable | P1 | En revisión (entrega 27/09 lista para publicar) | tickets de implementación incluidos en cada entrega. Repetir la verificación pertinente por lote; no esperar a terminar todo para comprobar integración. |
| PC-021 | Decisión de rendimiento: código, servidor o nativo | P2 | Recomendación emitida | PC-000 y mediciones de PC-001, PC-017, PC-018, PC-019. No bloquear arreglos operativos por esta decisión. |
| PC-022 | Fecha Mendoza y confirmación numérica del pedido | P0 | Hecho — publicado | Prioridad expresa del usuario; PC-003/PC-005. |
| PC-023 | Cola de pesadas confiable: 429/500/sesión vencida/almacenamiento, rechazos guardados | P0 | Hecho — sin publicar | PC-019. Ver ENTREGA-2026-09-27. |
| PC-024 | Carga de la PWA: precache sin motor PDF, pantallas bajo demanda, gzip | P1 | Hecho — sin publicar | PC-020. |
| PC-025 | Dependencias vulnerables (audit 4 → 0) | P1 | Hecho — sin publicar | PC-020. |
