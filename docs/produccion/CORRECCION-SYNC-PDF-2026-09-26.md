# Corrección de sincronización y documento pendiente — 26/09/2026

## Incidente y alcance
El aviso de PDF mayor de 4 MB corresponde al POST de la cola de archivado del navegador. Railway seguía ejecutando la publicación fba95b27-c269-41f1-be5c-a12fc3180fcd (25/09 07:29 UTC), anterior a los cambios locales que retiraban esa cola.

En Chrome local, un lote sintético de 25 remitos produjo 9.121.256 bytes con el logo original de 1180 × 800. Con un logo específico de impresión de 240 px produjo 696.348 bytes (92,4 % menos). La medición es del tamaño de archivo, no del consumo RAM de la PC del usuario.

## Corrección
- Cola de PDF retirada: limpieza sin leer los blobs ni convertirlos a base64. No toca pc-outbox ni pesadas.
- El service worker también limpia la cola al activarse y reconoce como retirados los POST de pestañas anteriores sin subir sus cuerpos al servidor.
- Generación de PDF aislada en un worker: una tarea simultánea, cancelación al cerrar/cambiar la vista y terminación al completar, fallar o superar 60 s. Los logos reducidos conservan los originales de la interfaz.
- Vista diaria: consulta por fecha con filtros del servidor, agrupación de eventos y descarte/cancelación de respuestas de fechas anteriores.
- Clientes: refresco de saldos ante eventos de pedidos y conservación de invalidaciones durante consultas en vuelo.
- Restauración histórica: sólo revisión por defecto. Para aplicar requiere plan de diferencias conciliadas por cliente, saldo esperado, motivo, backup previo y registro contra duplicados. El cero ya no se interpreta como pérdida. No se ejecutó sobre datos del negocio.
- Docker incluye los scripts operativos que server.mjs puede importar.

## Validación
- npm test: 90 aprobadas, 0 fallidas.
- npm run build: aprobado; advertencia de tamaño de paquete de interfaz existente.
- node scripts/verify-sync-pdf.mjs: Chrome con servidor aislado, SQLite en memoria e integraciones apagadas. Cola sintética de 5 MB eliminada, pesada pendiente preservada, cero subidas de documentos, tres PDF generados y ningún error JavaScript.
- Saldo visible actualizado dentro de 5 s tras pesada desde otro cliente HTTP.
- Lote de 25 pedidos: hoja de ruta 98.832 bytes; remitos 696.348 bytes; hoja de pedidos 44.535 bytes.
- Artefactos locales: test-results/sync-pdf.json y test-results/sync-pdf.png.
- Antes de publicar se verificó que RESET_DATOS, PRUEBA_DATOS e IMPORTAR_CLIENTES no estaban configuradas en Railway.

No se modificaron saldos, pedidos ni comprobantes de producción como parte de la validación. Las pestañas antiguas deben recibir el nuevo service worker o volver a abrirse para retirar el código anterior.
