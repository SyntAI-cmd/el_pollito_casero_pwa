# Auditoría del incidente del 25/09/2026

Fecha de revisión: 25/09/2026. Horas en Argentina (UTC−3).

## Conclusión

No hay evidencia de saturación sostenida de CPU o RAM en los gráficos de Railway consultados. Sí hay fallos de subida de documentos en producción, reintentos repetitivos y defectos reproducidos en la cola local de pesadas. Comprar más capacidad no corrige estos defectos.

El usuario sitúa el comienzo del problema a las 14:30, con pesada desde teléfono y carga de pedidos desde PC. Confirma que ambos usan la misma dirección de Railway: la PC es un cliente de la aplicación; para esa dirección, el servidor está en Railway.

La causa exacta del bloqueo del teléfono no queda demostrada sin sus registros. No se afirma pérdida de pesadas reales ni que todos los errores tengan una sola causa.

## Evidencia de producción

Consultado el panel autenticado de Railway, proyecto `pollito-casero`, servicio de producción, una réplica, región US West. Despliegue activo `fba95b27-c269-41f1-be5c-a12fc3180fcd`, fechado 25/09 a las 04:29, publicado por CLI.

En la vista de 24 horas, CPU visualmente próxima al piso de la gráfica, sin meseta de saturación; memoria aproximadamente 50–150 MB durante el intervalo completo, en torno a 100–150 MB durante la operación diurna. Son lecturas visuales aproximadas, no máximos exportados ni garantía de ausencia de picos breves. No se verificó el límite configurado de recursos.

Registros de aplicación relevantes, usando la hora incluida en el mensaje (la hora de recepción de Railway puede diferir):

| Hora | Operación | Resultado |
| --- | --- | --- |
| 14:30:30 | Crear pedido | 201, 1150 ms |
| 14:31:02 | Agregar pesada | 201, 392 ms |
| 14:36:58 | Agregar pesada | 201, 16 ms |
| 14:39:34 | Agregar pesada | 201, 5 ms |
| 14:43:26 | Agregar pesada | 201, 407 ms |
| 14:47:46 | Cerrar sesión y consultas posteriores | DELETE sesión 200; news y customers 403 |
| 14:49:16 / 14:49:21 | Reenvíos de pesadas | 200, 378 / 2 ms |

Los 200 de reenvíos son compatibles con la protección contra duplicados del endpoint: devuelve 201 si inserta y 200 si el identificador ya existía. No deben confundirse con rechazos. Estos datos muestran que el servidor seguía procesando operaciones, no prueban que el teléfono recibiera todas las respuestas.

La consulta HTTP específica de la pesada de las 14:31:02 confirmó estado 201 y duración total de 395 ms en Railway (392 ms en el registro de aplicación). Es una comprobación puntual, no una medición de todas las pesadas ni del tiempo percibido en pantalla.

**Documentos:** los registros HTTP muestran muchas solicitudes POST `/api/documents` con estado 499 durante la tarde. Ejemplos visibles: 14:49:23 (17 s), 14:50:46 (13 s), 14:54:55 (54 s), numerosas repeticiones de 12–13 s hasta las 15:35 y otra a las 15:36:07. Un 499 corresponde al cierre por parte del cliente; es compatible con cancelación/timeout, sin identificar por sí solo dónde se originó la demora. El cliente local configura un timeout de 12 s para todas las operaciones.

A las 16:55:29 hubo una subida 200 (~1 s); desde 16:55:30 hubo repetidos 400, a menudo separados por 30 s, y seguían apareciendo a las 17:06. También había 400 repetidos desde las 04:31:54. Por tanto, la falla de documentos ya existía antes del horario informado. No se obtuvo el cuerpo de la respuesta 400: no se puede afirmar si fue un PDF, nombre, referencia a pedido o rechazo anterior a la aplicación.

**Backup:** el log de las 04:31:50 contiene `Backup falló: output file already exists`. Coincide con el uso de `VACUUM INTO` a un nombre fijo por día. Esto no demuestra que falten todas las copias, pero sí un intento fallido que debe corregirse y verificarse.

Los percentiles globales de HTTP incluyen conexiones largas de `/api/events`. No se usan como prueba de que cada pesada tarde decenas de segundos.

## Defectos del código revisado

El directorio local tiene cambios previos sin confirmar y la publicación activa se hizo por CLI. No se verificó equivalencia byte por byte entre este código y el desplegado. Los hallazgos locales son demostrables sobre los archivos actuales; su presencia exacta en producción debe contrastarse antes de publicar correcciones.

### Prioridad urgente: conservar y recuperar pesadas

En `src/lib/outbox.js` se reprodujeron tres problemas con datos sintéticos y sin red:

1. `flush()` conserva una copia de la cola mientras espera una respuesta. Si durante esa espera otra pesada falla y se agrega a la cola, al completar el primer reenvío se escribe la copia vieja y desaparece el nuevo pendiente sin enviarse.
2. Un 503 durante el reenvío se trata como rechazo definitivo: la operación sale de la cola persistida y queda solo en el arreglo de rechazos en memoria.
3. La pesada se guarda localmente recién después del fallo de red. Mientras espera respuesta no tiene respaldo en la cola; cerrar la aplicación en ese intervalo deja un resultado incierto.

Además, la cola no programa reintentos periódicos ante recuperación del servidor si el dispositivo nunca perdió internet. Solo se dispara al cambiar de dueño, al evento `online` y una vez al iniciar. La lectura JSON de respuestas falla fuera del bloque de clasificación de errores de red: una respuesta HTML de un proxy puede no entrar a la recuperación prevista.

Reproducción: `node scripts/audit-outbox-2026-09-25.mjs`. Resultado: `test-results/auditoria-2026-09-25-outbox.json`. No son pesadas del negocio y no prueban una pérdida histórica.

### Prioridad alta: documentos que se reintentan indefinidamente

`src/lib/archive.js` reintenta cada 30 segundos. El primer documento rechazado interrumpe el recorrido completo y vuelve a intentarse sin distinguir errores permanentes de transitorios. Esto permite que un documento inválido bloquee los siguientes y repita el aviso constantemente. El texto encontrado es “Documento pendiente en este dispositivo: …”, parecido al reportado por el usuario.

Es necesario separar documentos rechazados, conservarlos con su motivo, continuar con los restantes y espaciar reintentos transitorios. Subir PDFs requiere un presupuesto de tiempo distinto del de una pesada, con progreso y cancelación; aumentar únicamente el timeout general ocultaría otros problemas. La generación de PDF ocurre en el navegador y puede afectar el teléfono independientemente de la CPU del servidor.

### Prioridad alta: actualizaciones excesivas

`src/lib/store.jsx` descarga todos los pedidos y clientes al recibir un evento de pedido, sin agrupar solicitudes concurrentes. `src/lib/day.js` abre otra conexión de eventos y refresca la nota del día; `Weighing.jsx` también la refresca después de confirmar. Una sola operación puede provocar varias descargas en cada dispositivo conectado.

Medición local nueva, 1000 pedidos y 1000 clientes, 20 repeticiones, SQLite en memoria, sin HTTP ni red ni render de teléfono:

| Operación | Mediana | p95 orientativo | Respuesta |
| --- | --- | --- | --- |
| Listar pedidos | 67,29 ms | 109,34 ms | 887.454 bytes |
| Listar clientes | 86,13 ms | 134,22 ms | 397.781 bytes |
| Confirmar pesada | 1,03 ms | 1,66 ms | 1.480 bytes |

Solo las dos listas suman aproximadamente 1,29 MB sin comprimir por actualización completa. La medición sirve para localizar trabajo redundante; no estima la capacidad real de Railway ni el tiempo del teléfono. Resultado completo: `test-results/auditoria-2026-09-25-benchmark.json`.

Cambiar a actualizaciones por pedido/cliente, consultas por fecha, agrupación de eventos y una solicitud en vuelo por recurso. Conservar pendientes visibles al refrescar y evitar que una respuesta vieja reemplace cambios nuevos.

## Qué hacer, en orden

1. Conciliar las pesadas de la tarde con lo registrado y los pendientes en el teléfono. No borrar datos de la aplicación ni reinstalar mientras existan pendientes; no repetir a mano una pesada sin verificar si ya ingresó.
2. Corregir primero la persistencia de pesadas, los reintentos y el bloqueo de documentos. Mantener los identificadores de operación y mostrar estados claros: pendiente, confirmado o requiere revisión.
3. Reducir descargas completas y separar el trabajo de PDF/subidas del flujo de balanza.
4. Registrar identificador de solicitud, estado, duración, bytes, causa de cancelación y errores del navegador. Medir por endpoint, excluyendo SSE de las comparaciones de latencia normales. Verificar y probar restauración de backups.
5. Validar con PC y teléfono simultáneamente: crear pedido, pesar, subir PDF, cortar/restaurar conexión, dejar el servidor inaccesible con Wi-Fi conectado, cerrar/reabrir y simular 503. Debe terminar sin pérdidas ni duplicaciones.
6. Evaluar recursos o región después de estas correcciones, con tiempos por operación y métricas correlacionadas. US West merece una comparación de latencia desde Mendoza; no se recomienda mover el volumen ni cambiar de base por intuición. No agregar réplicas sin diseñar primero cómo compartir la base persistente.

No se modificó ni reinició producción y no se cambió el plan. Se generaron únicamente esta auditoría, una reproducción aislada y resultados de medición.

Fuentes: panel autenticado de [Railway](https://railway.com/project/b1d5b6b4-d116-4446-a1a9-3932bbeae3a6/service/7baa7a54-610e-4b1e-b245-18b3e9258dce), código local y reproducciones. Referencias del proveedor: [métricas](https://docs.railway.com/observability/metrics) y [registros](https://docs.railway.com/observability/logs).
