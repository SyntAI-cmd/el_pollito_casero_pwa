# Entrega 27/09/2026 — Pesaje fluido y confiable (PC-017, PC-018, PC-019, PC-020, PC-023 a PC-025)

Objetivo: que el pesaje sea fluido en el teléfono mientras administración carga pedidos en la PC,
sin perder ni duplicar pesadas y con kilos, saldos y cajas correctos.

Estado: **código hecho, probado en entorno aislado y listo para publicar. No publicado.**
Falta la verificación en teléfono físico y en la red del galpón (ver "Pendiente").

Convención: **Comprobado** = medido o reproducido acá, con el comando para repetirlo.
**Hipótesis** = compatible con la evidencia pero no demostrado. **Pendiente** = requiere acceso
o dispositivo que no tuve.

## 1. Inventario de versiones

| Componente | Versión | Cómo se verificó |
| --- | --- | --- |
| Commit base | `0a46d00` (= `origin/main`) | `git rev-parse HEAD`, `git ls-remote origin main` |
| Frontend en producción | **el mismo de `0a46d00`** | `/admin` en producción sirve `index-BrdVv1hc.js` e `index-B_hSZws-.css`, idénticos al build de `0a46d00` |
| Servidor en producción | responde `schema: 5`, 155 pedidos | `GET /api/health` (sólo lectura). El commit del servidor no se expone; se asume el del mismo deploy (hipótesis) |
| Node | 24.21.0 local; `node:24-alpine` en la imagen | `node -v`, `Dockerfile` |
| SQLite (node:sqlite) | 3.53.4 | `select sqlite_version()` |
| React / Vite | 19.3.0 / 7.3.6 | `npm ls` |
| Railway | 1 réplica, volumen `/data`, borde `gru1` | `railway.json`, cabecera `x-railway-edge` |

Publicación: Railway **no** está conectado a GitHub; se publica con `railway up` desde la PC.
Un commit en GitHub no acredita qué corre en producción: por eso se comparó el hash de los assets.

## 2. Integridad y copias (P0)

**Producción: pendiente** (no tuve acceso autorizado al volumen). No hay evidencia de corrupción:
la alerta "pollito.sqlite CORRUPTO" no trae archivo, método ni error. Procedimiento listo en
[RECUPERACION.md](RECUPERACION.md) con `scripts/verificar-integridad.mjs`.

**Base local de esta PC y copias recientes: comprobado** (`node scripts/verificar-integridad.mjs
data/pollito.sqlite data/backups/pollito-2026-09-25.sqlite data/backups/pollito-2026-09-26-11-13-11.sqlite`):

| Archivo | quick / integrity | FK | Neto ≠ bruto − tara | Original intacto | Restauración |
| --- | --- | --- | --- | --- | --- |
| `data/pollito.sqlite` (0 pedidos, 148 clientes) | ok / ok | 0 | 0 | sí (hash igual) | ok |
| `backups/pollito-2026-09-25.sqlite` (6 pedidos, 2 cajones, 41,6 kg) | ok / ok | 0 | 0 | sí | ok |
| `backups/pollito-2026-09-26-11-13-11.sqlite` | ok / ok | 0 | 0 | sí | ok |

La copia se hace con la API de backup de SQLite (consistente con WAL), nunca copiando el archivo
suelto, y todos los chequeos corren sobre la copia.

## 3. Línea base reproducible

Entorno aislado: directorio temporal, base SQLite **en archivo con WAL** (como producción), datos
sintéticos anonimizados ("Cliente N"), sin credenciales ni integraciones. Escenario: 1000 clientes,
3000 pedidos históricos, 200 pedidos del día. Teléfono: repartidor, **4G emulada** (80 ms,
4 Mbps / 1,5 Mbps) y **CPU ×4 más lenta**. PC: administración en la lista de pedidos. Mientras el
teléfono confirma 20 pesadas a ritmo de operador (una cada 4 s), otra PC carga un pedido cada 5 s.

```bash
node scripts/bench-pesaje.mjs test-results/bench-pesaje.json      # escritura, lecturas, eventos, red, render
node scripts/bench-carga.mjs <carpeta-app> test-results/carga.json # caché fría/caliente y precache
```

`/api/events` (SSE) queda **fuera** de los percentiles: es una conexión abierta, no una consulta.
Se mide aparte la entrega del evento a la PC.

## 4. Tabla de problemas

| # | Problema | Evidencia | Cambio | Estado |
| --- | --- | --- | --- | --- |
| 1 | Cada pesada disparaba ~5 consultas en el teléfono y descargas completas en **cada** equipo conectado: `GET /api/customers` completo (381 KB, **249 ms de CPU bloqueante** en el servidor) y cada 30 s `GET /api/orders` con **todo el histórico** (2,6 MB, 297 ms). Con N teléfonos, cada pesada costaba N × 249 ms de servidor. | Comprobado. Banco: teléfono **12,4 MB en 94 s** (620 KB por pesada); PC **21,2 MB** | PC-017: eventos con cliente y fecha; consultas por id (`/orders?ids`, `/customers?phones`, `/dia?ids`) agrupadas y deduplicadas; conciliación completa sólo al abrir, reconectar, volver a la pantalla o cada 5 min con SSE sano (30 s sin SSE, igual que antes); se reutiliza la respuesta de cada escritura | Hecho: teléfono **220 KB** (−98 %), PC **99,5 KB** (−99,5 %) |
| 2 | Una pesada pendiente desaparecía de la pantalla si llegaba un refresco (p. ej. un pedido cargado en la PC) antes de confirmarse: el estado optimista vivía en el día y el refresco lo pisaba. Riesgo de volver a cargarla (duplicado real). | Comprobado por lectura de código y reproducido en navegador | PC-018: los pendientes se derivan de la cola guardada y se superponen al estado confirmado hasta que el servidor tiene ese id de cajón (`src/lib/pending.js`) | Hecho; verificado en navegador (`verify-pesaje-offline.mjs`) |
| 3 | **Sesión vencida = pesada perdida**: el servidor responde 403 "Solo el equipo." y la cola lo trataba como rechazo definitivo, la sacaba del almacenamiento y la dejaba sólo en memoria | Comprobado (test) | PC-023: 401/403 sin sesión → queda en espera hasta que vuelva su dueño; 403 con sesión válida → revisión | Hecho |
| 4 | 429 y 500 eran rechazos definitivos: la operación salía de la cola a un arreglo en memoria que se perdía al reiniciar | Comprobado (test; coincide con el diagnóstico) | 429 respeta `Retry-After`; 500 se reintenta 5 veces y pasa a **revisión guardada** (`pc-outbox-revision`), con Reintentar/Descartar | Hecho |
| 5 | `persist()` silenciaba la falla de almacenamiento: se mostraba "guardado" aunque no lo estaba | Comprobado (test) | La cola escribe en modo estricto; si falla, la pesada sigue en memoria, se envía igual, se reintenta guardarla y la pantalla avisa **"No cierres la app"** | Hecho |
| 6 | Una respuesta HTML (proxy 502/503, portal Wi-Fi) perdía el estado HTTP por parsear JSON antes | Comprobado (test) | `api()` conserva estado y marca `nonJson`; la cola lo reintenta con el mismo id | Hecho |
| 7 | Respuesta perdida después de guardar en el servidor | Comprobado (test con el servidor real) | Mismo id en todos los reintentos; el servidor ya era idempotente; ahora también la **anulación** repetida (no recalcula ni duplica auditoría) | Hecho |
| 8 | **Reabrir la app sin señal volvía al ingreso** y no se veían las pesadas pendientes: al arrancar, la app avisaba "sin sesión" al service worker y éste borraba la copia de datos | Comprobado: la versión base también termina en `/admin` sin copia de datos (`offline-open`) | PC-019: "sin sesión" se avisa sólo cuando el servidor lo confirma o al salir; el cambio de persona sigue borrando la copia | Hecho; verificado en navegador |
| 9 | Dos pestañas escribiendo la cola podían pisarse (leer-modificar-escribir) | Hipótesis (no reproducible en Node) | Cola con Web Locks; formato `pc-outbox` sin cambios (compatible hacia atrás) | Hecho; falta prueba física |
| 10 | Varias conexiones SSE por pestaña (store, día, noticias, flota) | Comprobado por lectura | Una conexión compartida por pestaña; reconexión avisa "hubo corte" → conciliación completa | Hecho |
| 11 | Respuestas viejas podían pisar nuevas (`updateOrderById` sin orden, `loadOrders` que omitía llamadas) | Comprobado por lectura; cubierto por test | Reloj lógico por entidad: una respuesta sólo se aplica a lo que no cambió después de que salió (`src/lib/sync.js`) | Hecho |
| 12 | Precache de 2,55 MB con el motor de PDF (1,27 MB) y fotos del catálogo | Comprobado | Precache sin el worker PDF ni fotos (se cachean al usarse); páginas poco usadas bajo demanda | Hecho: **277 KB por red** |
| 13 | JSON grande sin comprimir. En producción el borde de Railway comprime los JS pero **no** el JSON (`/api/config` llega sin `Content-Encoding`) | Comprobado (lecturas públicas) | gzip para JSON > 1,4 KB y estáticos; `Server-Timing` para separar servidor de red | Hecho |
| 14 | Carga de camión: un refresco completo al terminar borraba de la pantalla las cargas hechas sin señal | Comprobado por lectura (mismo patrón que #2) | Se aplica la respuesta de cada carga; lo encolado sigue marcado hasta confirmarse | Hecho |
| 15 | El segundo preventista recibía el evento de su pedido pero `GET /orders/:id` le daba 404 y la app lo sacaba de su lista | Comprobado (test) | Lectura permitida (`canRead`); **modificar** sigue igual que antes (verificado) | Hecho |
| 16 | Enlaces directos a pantallas de piso respondían 404 (con la app igual) | Comprobado (navegador) | Rutas registradas | Hecho |
| 17 | 4 vulnerabilidades (1 crítica, 1 alta, 2 moderadas) | Comprobado (`npm audit --json`) | Ver sección 7 | Hecho: **0** |
| 18 | ~0,3–0,45 s por petición en producción aunque la respuesta sea trivial | Comprobado desde esta PC (n = 8; `robots.txt` y `/api/health`) | Ninguno (no se cambia región/plan sin aprobación). Menos peticiones por pesada mitiga | **Para decidir** (sección 9) |
| 19 | `scripts/verify.mjs` (E2E general) falla en "ETA estimada al salir" y "entrega registrada…" | Comprobado: **falla igual en la versión base** | Ninguno (script desactualizado respecto de reglas actuales; no es regresión) | Pendiente de actualizar el script |

## 5. Cambios por lote

Todos compatibles con los datos existentes: **sin cambios de esquema ni migraciones**. La cola del
teléfono conserva el formato `pc-outbox`.

- **A · Confiabilidad (PC-023, PC-019)** — `src/lib/outbox.js`, `src/lib/api.js`,
  `server/floor.mjs` (anulación idempotente), `src/lib/store.jsx` (arranque sin red).
- **B · Sincronización (PC-017)** — `src/lib/sync.js` (nuevo), `src/lib/day.js`,
  `src/lib/store.jsx`, `src/lib/api.js` (SSE compartido), `server/api.mjs` (`?ids`, `?phones`,
  eventos con cliente/fecha, `canRead`), `server/floor.mjs` (`/dia?ids`), `server/store.mjs`
  (clientes del preventista sin hidratar pedidos), `public/sw.js` (no guarda consultas por id).
- **C · Pesaje (PC-018)** — `src/lib/pending.js` (nuevo), `src/pages/Weighing.jsx` (pendiente /
  enviando / requiere revisión, Reintentar/Descartar, el operador sigue sin esperar al servidor),
  `src/pages/TruckLoading.jsx`.
- **D · Carga (PC-024)** — `src/App.jsx` (pantallas bajo demanda; pesaje, carga y entregas en el
  paquete principal para abrir sin segunda descarga), `vite.config.js` (precache), `server.mjs`
  (gzip, `Server-Timing`, rutas de piso, registro de lecturas lentas con `op=`).
- **E · Dependencias (PC-025)** — `package.json`, `package-lock.json`.

## 6. Pruebas

| Prueba | Resultado |
| --- | --- |
| `npm test` (suite completa) | **116/116** (90 antes + 26 nuevas) |
| `tests/outbox-confiabilidad.test.mjs` | 429, 500→revisión (sobrevive reinicio), 503 HTML, 200 no JSON, almacenamiento lleno, almacenamiento ilegible (no se pisa), sesión vencida, rechazo de negocio, orden sin señal, pendientes de la versión anterior, **respuesta perdida tras guardar** (sin duplicar; tara 1,7 × cajas; bolsa con 0 cajas; anulación repetida; auditoría una vez por operación) |
| `tests/pesaje-pendientes.test.mjs` | tara/neto locales **idénticos al servidor** en 5 casos; refresco sin la pesada; sin doble conteo; lista vieja no pisa nueva |
| `tests/sync-incremental.test.mjs` | consultas por id con permisos y filtros; eventos; segundo preventista lee pero no modifica |
| `tests/http-compresion.test.mjs` | servidor real: gzip, `Vary`, `Server-Timing`, contenido idéntico |
| `scripts/verify-pesaje-offline.mjs` (navegador) | con red → foco en el peso; sin red → pendiente visible y sumada; **recarga sin red** → sigue; vuelve la red → una sola vez, 52,5 kg exactos |
| `scripts/verify-pc-sync.mjs` (navegador) | pedido de otra PC, kilos y **saldo** actualizados sin recargar y **sin descargas completas** |
| `scripts/verify-sync-pdf.mjs` (navegador) | 25 remitos 696.359 bytes (igual que el 26/09), cola PDF retirada, pesada preservada, 0 subidas |
| Imagen Docker (misma receta que Railway) | compila; healthcheck `healthy`; pesaje 200; gzip + `Server-Timing`; integridad dentro del contenedor ok |
| Dependencias | `sharp` carga; Excel con formato condicional (uuid 11) se genera y relee; nodemailer 10 entrega a un SMTP local |

## 7. Dependencias (`npm audit`: 4 → 0)

| Hallazgo | Alcance real | Acción |
| --- | --- | --- |
| `maplibre-gl` ≤ 6.4 (crítica, XSS en `DOM.sanitize`) | **No se importa** en ningún archivo (sólo quedaban reglas CSS) | Quitada |
| `nodemailer` ≤ 9.1 (alta, 12 advisories) | Servidor, sólo con `SMTP_URL` (enlace mágico; portal cerrado en modo equipo) | 6.10.1 → 10.0.11; misma API; envío verificado |
| `uuid` < 11.1.1 vía `exceljs` (2 moderadas) | exceljs usa `v4()` sin buffer: no explotable | `overrides: uuid ^11.1.1`; Excel verificado |

No se usó `npm audit fix --force`.

## 8. Mediciones antes / después

Mismo escenario, misma máquina, n = 20 pesadas (percentiles con 20 muestras: orientativos).

**Pesaje con la PC cargando pedidos** (`bench-pesaje-antes.json` / `bench-pesaje-despues.json`):

| Medida | Antes | Después |
| --- | --- | --- |
| Confirmación del servidor en el teléfono p50 / p95 | 353 / **1248 ms** | 290 / **353 ms** |
| Feedback visual p50 / p95 (incluye la latencia de la herramienta) | 173 / 432 ms | 183 / **231 ms** |
| Consultas del teléfono por pesada | 5,3 | 4,0 |
| Datos del teléfono en 94 s / por pesada | 12.408 KB / 620 KB | **220 KB / 11 KB** |
| Datos de la PC en 94 s | 21.173 KB | **99,5 KB** |
| Interacciones del teléfono p95 / máx. | 136 / 272 ms | **80 / 112 ms** |
| Tareas largas del teléfono (total) | 37 · 2.869 ms | **11 · 900 ms** |
| Evento de la pesada en la PC p50 / p95 | 94 / 381 ms | 122 / 162 ms |
| Apertura del pesaje | 3.480 ms | 2.463 ms |

**Servidor** (misma base en archivo): `/api/customers` completo 249 ms · `/api/orders` completo
297 ms (sin cambios: ahora se piden mucho menos). Nuevas: `/orders?ids` 0,2 ms · `/customers?phones`
0,35 ms · `/dia?ids` 0,2 ms. Pesada 1,6 ms.

**Carga de la PWA** (`bench-carga-antes.json` / `bench-carga-despues.json`, mediana de 5):

| Medida | Antes | Después |
| --- | --- | --- |
| Caché fría: pantalla lista | 2.972 ms | **2.051 ms** |
| Caché fría: estáticos por la red | 656 KB | **165 KB** |
| Caché fría: JavaScript ejecutado | 611 ms | 588 ms |
| Caché caliente: pantalla lista | 1.782 ms | 1.714 ms |
| Caché caliente: JavaScript ejecutado | 763 ms | 717 ms |
| Descarga del service worker al instalar/actualizar | 2.547 KB (con worker PDF) | **277 KB** |

Bytes descargados y JavaScript ejecutado son medidas distintas: dividir el paquete bajó mucho los
bytes pero poco el JS ejecutado para abrir el pesaje (la pantalla necesita React y su código igual).
**En producción los JS ya llegaban comprimidos por el borde de Railway**: la reducción de bytes de
estáticos por gzip es sólo local; la del precache (sin el worker de PDF) sí aplica.

## 9. Riesgos y decisiones

- **Red a producción (para decidir, no se cambió nada):** desde esta PC cada petición tarda
  ~0,3–0,45 s aunque el servidor no haga nada (`robots.txt`). Con `Server-Timing` publicado se
  podrá separar servidor de trayecto en cada petición real. Medirlo desde el galpón (Wi-Fi y
  datos) antes de evaluar región o plan.
- **SSE caído:** la app vuelve al sondeo de 30 s y a conciliar todo después de cada escritura,
  como antes. Ningún dato depende sólo de los eventos.
- **Eventos perdidos durante un corte:** al reconectar se concilia todo (el servidor no guarda
  historial de eventos).
- **Reasignación de pedido a otro preventista:** el anterior no recibe el evento; lo corrige la
  conciliación periódica (3 min en la nota, 5 min en la lista). Igual que antes.
- **Operación rechazada:** queda guardada con su motivo hasta que alguien la reintente o descarte.
- **Pantallas bajo demanda sin señal:** están en el precache; el motor de PDF se baja la primera
  vez que se imprime (imprimir requiere haberlo usado una vez con señal).

## 10. Rollback compatible con los datos

No hay migraciones: volver a `0a46d00` es seguro para la base. La cola del teléfono conserva el
formato `pc-outbox`: **probado** que la cola de `0a46d00` envía una vez lo que dejó la nueva y lo saca de la cola. Lo que esté en
`pc-outbox-revision` la versión anterior no lo muestra, pero no lo borra. Pasos en
[RECUPERACION.md](RECUPERACION.md).

## 11. Pendiente (con los datos que faltan)

1. **Teléfono físico + PC** en el galpón: `scripts/verify-pesaje-offline.mjs` reproduce el
   recorrido; en el teléfono, repetirlo a mano (pesar sin señal, cerrar y reabrir la app, volver
   la señal) y medir feedback p95 ≤ 150 ms. Con CPU ×4 emulada da 231 ms incluyendo la herramienta.
2. **Integridad de producción:** correr `verificar-integridad.mjs` en Railway (RECUPERACION.md).
3. **Red real:** Wi-Fi y datos del galpón, p50/p95 de `Server-Timing` vs total.
4. **Renders globales:** el contexto del store sigue siendo uno; con los eventos reducidos ya no
   es el cuello medido. Separarlo sólo si el perfil en teléfono real lo pide.
5. Actualizar `scripts/verify.mjs` a las reglas actuales (entrega con foto, ETA externa).
