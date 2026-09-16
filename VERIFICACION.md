# Verificación · 10 de septiembre de 2026 (etapa 2)

- Compilación de producción con Vite: correcta.
- 8 pruebas de dominio con Node: correctas (precios por modalidad, importes alterados, crédito por plan, cantidades inválidas, medios kilos, localidad obligatoria, normalización de teléfonos argentinos, resumen de cuenta).
- E2E (`scripts/verify.mjs`, servidor aislado con SQLite en memoria):
  - API: sesiones por teléfono, PIN de equipo, filtrado de pedidos por rol, idempotencia, orden de estados, asignación, GPS, cobro previo a entrega, envases y devoluciones, cancelación del cliente, clientes y crédito, rechazo de origen ajeno, SSE (el cliente recibe el cambio de estado), metadatos por ruta, robots por ruta, 404.
  - Navegador cliente (1440 px): catálogo, búsqueda, filtros, modalidades, carrito con medios kilos y límite de 1000 kg, checkout, seguimiento con indicador en vivo, historial, repetición, cancelación, cuenta e ingreso desde otro dispositivo con el mismo teléfono.
  - Navegador administración: acceso con PIN, tablero, preparar, asignar, pestaña de clientes.
  - Navegador repartidor (390 px, geolocalización simulada): solo sus entregas, iniciar reparto, compartir GPS, el cliente ve el marcador del repartidor, cobro obligatorio antes de entregar, entrega.
  - Responsive 320/390/768/1024/1440 sin desbordamiento; barra de carrito y hoja inferior en móvil.
  - PWA: catálogo disponible sin conexión y pedido bloqueado.
  - Sin errores de JavaScript en ninguna página.
- Axe (WCAG 2 A/AA y 2.1 AA) en las 10 rutas, incluidas operación y reparto con sesión: sin violaciones tras corregir contraste y semántica de pestañas.
- Prueba manual con servidor real: geocodificación de "Boulogne Sur Mer 250, San Martín" con Nominatim correcta; ruta y ETA por OSRM visibles en el seguimiento del pedido de ejemplo ("Llega en 3 min · 0,9 km").

No se enviaron mensajes de WhatsApp ni se realizaron pagos. No se verificó GPS entre dispositivos físicos ni instalación de la PWA en iOS. Capturas en `test-results/` (carpeta ignorada en Git).

## Etapa 3 · 10 de septiembre de 2026

- Unit: 8/8. E2E completo correcto, con nuevas comprobaciones: clave push publicada; reverse geocoding rechaza puntos fuera de Mendoza; pedido con punto marcado por el cliente usa esas coordenadas como destino y las guarda en el cliente; repartidor habitual preasigna pedidos nuevos; al salir se registra hora de salida y ETA; entrega con hora y repartidor; devoluciones con fecha; suscripción push requiere sesión y endpoint https. Navegador: "Usar mi ubicación actual" completa dirección y localidad y muestra el pin; el cliente ve el destino, el aviso de repartidor asignado, el banner "salió · llega aprox."; administración con avisos push registrados, pestaña Reparto y rendición con saldo a rendir, hojas de impresión de pedidos y de ruta con la interfaz oculta en modo print.
- Axe sin violaciones en 11 rutas (incluida `/admin`).
- Inspección visual: hover animado de planes (elevación, borde rojo, brillo y atenuación de los otros), checkout con mapa y autocompletado, tablero de reparto, hoja de pedidos en modo impresión.
- Sin imágenes para menudos, rancho y garras: no hay generador de imágenes disponible en esta sesión; el servidor detecta automáticamente `public/images/<id>.webp` cuando se agreguen.

## Etapa 4 · 11 de septiembre de 2026

- Unit: 10/10 (nuevos: pesaje recalcula líneas y total conservando lo pedido; pago a cuenta cubre los pedidos más viejos y deja saldo a favor; resumen con saldo a favor).
- E2E correcto con nuevas comprobaciones: el cliente no pesa; en "recibido" solo administración pesa; pesaje con dos decimales recalcula el total y notifica; pago de cuenta corriente desde administración cubre varios pedidos y deja saldo a favor; un pedido a cuenta chico se paga solo con el saldo a favor; el repartidor solo cobra a clientes de su reparto y ve solo sus clientes; en navegador, administración pesa desde la tarjeta y el cliente ve "pediste 2 kg"; el repartidor tiene el enlace "Ruta completa en Google Maps"; repetir un pedido usa los kilos pedidos, no los pesados.
- Axe sin violaciones en 11 rutas.
- Inspección visual de los modales de balanza y de cobro de cuenta corriente.

## Etapa 5 · 12 de septiembre de 2026

- Backend reescrito sobre esquema relacional v2 (migración automática desde v1), transacciones, auditoría, validación, límite de intentos (429 tras 6 PIN erróneos), backups diarios, `GET /api/health`.
- Unit 10/10. E2E correcto con nuevas comprobaciones: separación por rol (admin en `/` o `/seguimiento` → Operación; repartidor en `/operacion` o `/` → Reparto; cliente en `/operacion` o `/reparto` → catálogo; anónimo en `/operacion` → ingreso del equipo y en `/pedidos` → `/ingresar?volver=`); la app del cliente no contiene enlaces a `/admin` ni `/acceso`; el cliente no recibe `staffAccess` ni `key` en los pedidos; chat interno en vivo (no leídos, respuesta por SSE); transferencia informada con referencia y confirmada por administración con medio; MP online rechazado sin token; envases recibidos por cliente (FIFO) y tope; repartidor sin acceso a clientes ajenos (404).
- Axe sin violaciones en 12 rutas (incluidas `/ingresar`, `/admin`, `/operacion` y `/reparto` con sesión).
- Mapa MapLibre verificado en Chromium headless (WebGL): marcadores de local, domicilio y camioneta, ruta OSRM, pin arrastrable en el checkout.
- Inspección visual: ingreso del cliente (split tipo Rappi), ingreso del equipo (pantalla oscura aparte), barra de administración con chat, vista móvil del repartidor con clientes de su reparto, hover de planes simplificado.

## Etapa 6 · 12 de septiembre de 2026

- Esquema v3: cuentas de cliente (email + contraseña scrypt, Google, enlaces temporales de un uso, passkeys WebAuthn) y usuarios del equipo (`staff_users`) en lugar de PINs. Sesiones con vencimiento y vinculación de teléfono en el primer pedido.
- Unit 10/10. E2E correcto con nuevas comprobaciones: registro e ingreso por email (contraseña corta y duplicado rechazados), enlace mágico (un solo uso, vencido → `/ingresar?enlace=vencido`), opciones de passkey con desafío firmado, Google rechazado sin `GOOGLE_CLIENT_ID`, ingreso del equipo por usuario/contraseña, alta/desactivación/cambio de contraseña desde Equipo (el usuario desactivado pierde la sesión al instante, nadie se desactiva a sí mismo), `/api/staff` vedado a repartidor y cliente, cliente sin teléfono no ve pedidos, búsqueda de direcciones acotada a Mendoza.
- Axe sin violaciones en 13 rutas (incluidas `/ingresar`, `/admin`, `/operacion/equipo`).
- Ubicación: `matchLocality` prioriza nombre de distrito sobre código postal (Los Barriales ya no cae en Palmira); en PC sin GPS se avisa el margen de error y se ofrece la búsqueda de dirección con sugerencias.
- Pantalla en blanco al actualizar: ErrorBoundary con recarga automática ante chunks viejos y recarga al cambiar el service worker.
- Inspección visual: sello del hero centrado, pantalla de ingreso con las cuatro opciones, pestaña Equipo, sugerencias de dirección en el checkout.

## Etapa 7 · 12 de septiembre de 2026 · respuesta a la auditoría (commit `ab2e4c9`)

Estado de cada hallazgo. "Prueba" indica qué lo cubre en `scripts/verify.mjs` (E2E) o `tests/` (unit).

| # | Hallazgo | Estado | Cómo quedó / prueba |
|---|---|---|---|
| 1 | Registro sobre cuenta sin contraseña toma la cuenta | **Corregido** | `/api/auth/register` rechaza (409) cualquier email existente; la contraseña se crea con sesión en `POST /api/auth/password`. E2E: "registrarse con el email de una cuenta sin contraseña no la toma". |
| 2 | Celular sin verificación entra en una cuenta existente | **Corregido** | `POST /api/session` retirado (410). Ingreso por celular = código de un solo uso por WhatsApp (`/api/auth/phone` + `/verify`, 10 min, 5 intentos, hash scrypt, límite por IP). La sesión por teléfono ya no recibe `accountId`. E2E: "ya no se entra solo con el número", "un teléfono conocido no da acceso al historial ajeno". |
| 3 | Vincular un teléfono ajeno trae su historial | **Corregido** | `session.phone` solo se fija verificado; el pedido guarda `account_id`/`session_id` (esquema v4) y una sesión sin verificar ve únicamente lo que creó. `PATCH /me` ya no acepta teléfono; `ensureCustomer` no pisa una ficha existente desde un teléfono sin verificar. E2E: Mallory declara el teléfono de Eva → sin historial ni vínculo; el pedido del impostor no cambia la dirección del almacén. |
| 4 | Cambiar rol/repartidor no revoca sesiones | **Corregido** | Cualquier cambio de rol, repartidor, contraseña o baja borra las sesiones del usuario; además `sessions.get` compara la sesión con `staff_users` en cada solicitud. E2E: "degradar a repartidor cierra la sesión de administrador" (`/staff` → 403). |
| 5 | Clave de idempotencia revela un pedido ajeno | **Corregido** | La clave se guarda como `teléfono:clave`; si la sesión no es dueña del pedido previo → 409. E2E: "otra sesión con la misma clave de idempotencia no recibe el pedido". |
| 6 | Dos cambios simultáneos se sobrescriben | **Corregido** | `PATCH /orders/:id` se serializa por pedido (cola por id) y relee el pedido dentro de la cola. E2E: preparar + cobrar en paralelo conserva ambos y no duplica historial. |
| 7 | Pesar un pedido a cuenta pagado borra la diferencia | **Corregido** | La diferencia de peso de un pedido pagado ajusta `creditBalance` (puede quedar deudor) y se registra en `order.adjustments`. E2E: saldo a favor 2600 → 2120 tras pesar 5→6 kg. |
| 8 | Cancelar un pedido pagado con saldo a favor no lo repone | **Corregido** | Al cancelar un pedido pagado, el importe vuelve como saldo a favor una sola vez (`order.refunded`). E2E: 2120 → 5000; segundo cancel → 400. |
| 9 | Transferencias sumadas al efectivo a rendir | **Corregido** | `routeSheet` separa efectivo cobrado en la puerta **por ese repartidor** (`paidBy`), efectivo pendiente, transferencias/MP y cobros de cuenta corriente; "Efectivo a rendir" solo suma efectivo. Unit: `tests/report.test.mjs`. |
| 10 | "Entregado a cuenta hoy" incluye pedidos en camino | **Corregido** | `account` cuenta solo entregados; se muestra aparte "A cuenta en este reparto". Unit. |
| 11 | "Saldo anterior" no fiable | **Mitigado** | Se calcula una vez por cliente (saldo actual − pendiente de sus paradas del día) y se rotula "estado actual". Un corte histórico por movimientos queda pendiente (requiere libro mayor de movimientos). Unit. |
| 12 | "Por cobrar" no descuenta saldo a favor | **Corregido** | `receivables()` compartido: pedidos directos impagos + deuda neta por cliente. Unit. |
| 13 | Excepción del mapa al desmontar | **Corregido** | Arreglo del auditor en `src/Map.jsx` incorporado y commiteado. |
| 14 | Cambiar la dirección conserva el pin | **Corregido** | Cambiar calle o localidad invalida el punto; las búsquedas viejas se descartan por número de solicitud. |
| 15 | Autocompletado contra Nominatim público | **Corregido** | Sin autocompletado: búsqueda explícita (botón Buscar / Enter). `GEOCODER_URL` para un servicio propio. |
| 16 | GPS congelado a los 200 puntos | **Corregido** | Los puntos se insertan por `orders.addTrack` con secuencia propia y ventana de 200 en la base. E2E: 205 lecturas → 200 puntos y el último coincide con la ubicación. |
| 17 | "Ruta completa" omite paradas | **Corregido** | Enlaces por tramos de 10 paradas ("Tramo 1–10", "Tramo 11–20"). |
| UX | No se entiende cómo entrar a administración | **Corregido** | Botón **Equipo** en la cabecera de escritorio, "Administración / Equipo" en el menú móvil y el enlace del pie. Sin controles de gestión antes de autenticar (E2E). |
| UX | Cargar pedido ocupa mucho y es lento | **Corregido** | Nueva pantalla `/operacion/nuevo` en un solo paso (buscador de clientes, tabla de kilos, pago, repartidor, Ctrl+Enter). E2E de navegador con captura `test-results/operacion-cargar.png`. |
| P2 | Carrito y perfil compartidos entre sesiones | **Corregido** | Se vacían al cerrar sesión y al entrar como equipo; administración ya no usa el carrito. |
| P2 | Pedido inexistente muestra otro | **Corregido** | `activeOrder(id)` devuelve null con id explícito; Seguimiento muestra "No encontramos el pedido". |
| P2 | Pedidos abiertos antiguos ocultos | **Corregido** | El filtro de antigüedad solo recorta la columna Entregados. |
| P2 | La interfaz no identifica al administrador actual | **Corregido** | `publicSession` expone `staffId` (y `verified`). |
| P2 | Sesión inválida deja la vista privada | **Corregido** | Ante 401/403 la app reconsulta `/api/session`; si no hay sesión limpia la vista y vuelve al ingreso. |
| P3 | Ancla de Planes | **Corregido** | El router conserva el hash y desplaza al destino. |
| P3 | Textos viejos (PIN, SMTP_URL…) | **Corregido** | Sin variables de entorno ni "PIN del equipo" en textos del cliente. |
| Prod | Semilla de ejemplo fuera de demo | **Corregido** | Solo con `business.demo: true`. |
| A11y | Chat sin región de anuncios; listbox incompleto | **Corregido** | `role="log" aria-live="polite"` en el chat; las sugerencias son una lista de botones. Axe: 16 rutas sin violaciones (incluye `/operacion/nuevo`, `/operacion/reparto`, `/operacion/clientes`, `/operacion/equipo`). |

Pendiente (fuera de esta etapa): paginación de listados; validación en teléfonos reales (GPS en segundo plano, offline, Mercado Pago sandbox, WhatsApp Cloud API real).

Resultados: unit 14/14; E2E completo correcto; axe 16 rutas sin violaciones.

## Etapa 8 · 13 de septiembre de 2026

- **Libro de movimientos** de cuenta corriente (`src/lib/ledger.js`), reconstruido siempre desde pedidos y pagos: cargo (importe pedido, fecha de creación), ajuste de balanza, anulación, pago y reintegro, con saldo acumulado. Usado por el extracto del cliente (Mi cuenta), el extracto por cliente en Operación → Clientes y el "saldo anterior" de la hoja de ruta como corte al inicio del día.
- **Cierre de caja** por repartidor y día (`cash_closures`, `GET/POST /api/closures`, solo administración): esperado según la hoja, recibido, diferencia, nota, quién y cuándo; corregible; auditado (`cash.close`).
- **Búsqueda operativa** en Pedidos (número, cliente, teléfono, dirección, localidad) y filtro por repartidor.
- **Equipo**: edición de nombre, rol y repartidor (tocar el nombre); cambiar rol cierra las sesiones.
- Unit 15/15 (ledger + rendición). E2E correcto con nuevas comprobaciones: cierre de caja por API (403 repartidor, 201, corrección, fecha inválida) y en navegador; extracto en Clientes y en Mi cuenta; búsqueda de pedidos; edición de usuario. Axe: 16 rutas sin violaciones.

## Etapa 9 · 13 de septiembre de 2026 · diseño y seguridad

- Pasada de diseño (skills `redesign-existing-projects`, `impeccable audit`, `web-design-guidelines`): Instrument Serif para el display, numerales tabulares, sombras cálidas neutras, esqueleto de carga, fotos sobre blanco fundidas al fondo, contraste real en estados deshabilitados, piso tipográfico móvil (11/12 px), un solo kicker en la primera pantalla, filtros del tablero en la URL, `theme-color` acorde al fondo, confirmación al quitar una llave. Detector Impeccable: 12→5 (escritorio) y 30→5 (móvil); los 5 restantes son el kicker del hero (voz editorial declarada en DESIGN.md), etiquetas tracked cortas y el carrito sticky (falsos positivos documentados).
- Revisión de seguridad del servidor (el skill `security-review` requiere un remoto git; se hizo a mano con el mismo alcance). Corregido: **CSP** en producción; magic link en dos pasos (GET solo redirige, POST `/api/auth/magic/consume` consume: los previsualizadores de correo ya no queman el enlace); tope de 3 códigos OTP por teléfono cada 15 min; límites por IP en pedidos anónimos (20/min), geocodificación (30/min); ingreso del equipo con hash de relleno (sin enumeración por tiempo); parseo de cookies tolerante; `?volver=//…` rechazado; **mínimo de kilos por modalidad** (`planMinKg`, 10/5 kg) y modalidad ligada a la ficha para clientes con historial (antes cualquiera podía pedir 1 kg a precio mayorista); cambio de modalidad desde Mi cuenta solo antes del primer pedido.
- Sin hallazgos: inyección SQL (consultas preparadas), path traversal en estáticos (`resolve` + prefijo), CSRF (SameSite=Lax + verificación de Origin/Sec-Fetch-Site), webhook de Mercado Pago (se consulta el pago a la API, no se confía en el cuerpo), tokens (64 hex aleatorios), passkeys (desafío firmado y contador).
- Unit 16/16; E2E correcto (incluye mínimo por modalidad, modalidad ligada, enlace en dos pasos con doble consumo rechazado y CSP activa con el mapa MapLibre); axe 16 rutas.

## Etapa 10 · 13 de septiembre de 2026 · crítica Impeccable de Cargar pedido y checkout

Dos evaluaciones aisladas (revisión de diseño + detector/Playwright). Ambas pantallas propias del producto; corregido lo prioritario:
- **Cargar pedido**: sin scroll horizontal en 390 px (columna $/kg pasa bajo el nombre, grilla `minmax(0,1fr)`); Total a 18 px (la regla global `.total` quedó acotada a `.cart-totals`); kilos como texto decimal con coma, los inválidos no suman y la fila se marca con el mensaje al lado; aviso de mínimo por modalidad; "cambiar" limpia la ficha; chip "cuenta corriente" solo para mayoristas; línea "Para Fulano · 4,5 kg · $… · efectivo · Franco" antes del botón; barra fija con total y acción en móvil (el chat sube); inputs de kilos de 44 px en móvil.
- **Checkout**: campos a 16 px / 46 px (sin zoom en iOS) y etiquetas a 13 px; resumen de productos, envío y total antes de confirmar; aviso cuando la sugerencia cambia la localidad; pago como texto cuando hay una sola opción; una sola ayuda de ubicación; tocar fuera del diálogo ya no borra el formulario (checkout y perfil); botón Buscar de 36 px; mapa con `cooperativeGestures` dentro del formulario.
- Unit 16/16, E2E correcto, axe 16 rutas.

## Etapa 11 · 13 de septiembre de 2026 · revisión de código (`/code-review`)

Seis hallazgos, todos corregidos: `PATCH {paid:true}` sobre un pedido a cuenta ya no se acepta (se registra el pago desde la cuenta corriente, así el extracto y el resumen coinciden); el webhook de Mercado Pago y `POST /orders/:id/mp` entran por el bloqueo por pedido; la modalidad ligada a la ficha bloquea solo *subir* (bajar a un precio más alto se permite); el mínimo de kilos no aplica a los pedidos que carga administración; verificar un celular con sesión de equipo se rechaza en vez de cerrarla; Enter en los kilos salta al siguiente input habilitado. E2E ajustada (pago a cuenta por registro, bajada permitida, subida bloqueada con Eva, pedido chico de administración).

## Etapa 12 · 14 de septiembre de 2026 · módulo de piso, fase 1

- Pivot a MVP de administración y reparto (modo `equipo`); el portal de clientes queda apagado por interruptor.
- Esquema v5; `server/floor.mjs` (fichas, precios propios, camiones, pedidos por cajas, cajones con tara, nota del día, noticias, tara, export).
- Importación: 75 fichas GC, 83 cruces con las listas de precios, 62 fichas "a revisar" (apodos sin ficha), 15 sucursales de ALMA S.R.L., 114 precios propios. Corrección de tildes perdidas por pdftotext; zonas con nombre canónico; conflicto zona GC/lista → "revisar".
- UI: Clientes con filtros y ficha/precios; Camiones en Equipo; Cargar pedido por cajas para admin y preventistas.
- Unit 16/16; E2E correcta (incluye el piso por API: ficha sin CUIT, precios, pedido por cajas idempotente, pesada 21,7 − 1,7 = 20, reintento sin duplicar, anulación, carga, tara configurable, noticias, zonas del preventista, Excel).

## Etapa 13 · 14 de septiembre de 2026 · módulo de piso, fase 2 (pantallas)

- **Nota del día** (`/operacion/dia`, inicio de administración): totales para faena por producto (cajas y kilos pedidos vs. pesados), pedidos por camión con estado de piso (sin pesar / pesando / pesado / cargado / en camino / entregado), accesos a Pesar, Cargar camiones, Excel, Nota impresa, remitos del camión y hoja de ruta. Noticias del equipo arriba (fijar/archivar para administración; SSE `news`).
- **Pesada** (`/operacion/pesada`, `/reparto/pesada`): primero el pedido, después el producto; **cajas** → "Cajón N de M" y kilos acumulados; **kilos** → bulto con bruto y neto contra lo pedido. En ambos casos neto = bruto − tara (1,7 kg configurable) en grande antes de confirmar; anular con motivo; teclado numérico en móvil; **cola offline** (`src/lib/outbox.js`, se envía sola al volver la señal, id de cajón propio → sin duplicados).
- **Carga del camión** (`/operacion/carga`, `/reparto/carga`): +/−/todo por pedido, contador cargados/pesados, "Cerrar camión": `POST /api/dia/cerrar-camion` devuelve 409 con los faltantes si hay cajones sin pesar o sin cargar y exige motivo; con motivo (o completo) pasa todo a en camino.
- **Remitos en PDF** (`/imprimir?tipo=remito&pedido=` y `tipo=remitos&fecha=&repartidor=`, `src/pdf/RemitoPdf.jsx`): un original por pedido a proporción 10 × 15 (95 × 142,5 mm), 4 por hoja A4 con marcas de corte; datos fiscales de `business.fiscal`, N°, fecha, cliente/calle/localidad/cel., KILOS · DETALLE · PRECIO X UN. · PRECIO TOTAL, CAJAS ADEUDADAS y SALDO (en blanco si son cero), TOTAL, Firma Conforme. **Hoja de pedidos en PDF** (`tipo=pedidos`, `src/pdf/PedidosPdf.jsx`): A4 apaisada, logo + turno + cantidad de pedidos, columnas N° pedido · cliente (dirección debajo) · producto · kg · observación. Ambos con vista previa incrustada (`PdfPreview.jsx`) y Descargar / Compartir / Imprimir.
- **Cargar pedido**: cada producto va por cajas **o** por kilos (al escribir en una columna se borra la otra); título explica que el precio siempre es por kilo.
- Excel consolidado: cajones = solo los de lo pedido por cajas; detalle con formato es-AR. Misma estética que la planilla de facturación (verificado celda por celda: Arial 20 blanco sobre A81A1A, subtítulo sobre 141416, cebra F2F2F2, totales rojos, "Facturado total" dorado E5AF1E, formatos `#,##0.00" kg"`, `$#,##0.00`, `0.0%`).
- Barra del equipo compacta entre 741 y 1400 px (8 secciones sin desbordar); enlace de WhatsApp del pedido con nombre accesible y solo si hay teléfono; contraste de las observaciones.
- Unit 16/16; E2E correcta (nuevo: cerrar camión 409 → 403 ajeno → 200 con motivo → 400 vacío; noticias desde la nota del día; pesada en pantalla 21,7 → 20,0 kg y "Cajón 2 de 2"; remito impreso con el kilaje; cajas o kilos excluyentes en Cargar pedido); axe 0 violaciones en 14 rutas (incluye `/operacion/dia|pesada|carga`). Capturas en `test-results/` (nota-del-dia, pesada, pesada-movil, carga, remito, remito-solo, consolidado.xlsx).

## Etapa 14 · 14 de septiembre de 2026 · limpieza, precios y despliegue

- `business.demo: false` (código/enlace de prueba solo con `DEMO=1`, que usa la E2E); `scripts/limpiar.mjs` corrido sobre la base local: 0 pedidos, 143 clientes importados, 110 precios propios, 8 camiones, 3 usuarios (copia previa en `data/backups/antes-de-limpiar-*.sqlite`).
- Listas de precios: pollo entero mayorista **$5.500** (base), intermedio $6.000, minorista $6.500; el resto de los cortes proporcional. Editables en `/operacion/precios` (`GET/PUT /api/precios/listas`, guardadas en `settings.priceLists`, reflejadas en `/api/config`).
- Precio por kilo editable en la fila de Cargar pedido (administración) → se guarda como precio propio y se usa en el pedido; **Precios** en la tarjeta del pedido (`PATCH {prices, savePrices}`) recalcula y ajusta saldo si estaba pagado a cuenta; **Eliminar** pedido (`DELETE /api/orders/:id`, solo administración, con motivo en auditoría; devuelve como saldo a favor lo cobrado en efectivo/transferencia) desde la tarjeta y desde la nota del día.
- Despliegue: `Dockerfile` (node:24-alpine, `DATA_DIR=/data`, healthcheck), `railway.json`, `.env.example`, `DATA_DIR` para base/copias/VAPID. Arranque simulado con `DATA_DIR` y `HOST=0.0.0.0`: health 200, usuarios creados (admin + 8 camiones), copia diaria en `$DATA_DIR/backups`. La imagen no se pudo construir localmente (Docker Desktop apagado). Remoto `origin` configurado y rama `main`; el push requiere iniciar sesión en GitHub.
- Unit 18/18 (listas editadas, `applyPrices`); E2E correcta (listas: 403 preventista, PUT admin, `/api/config` refleja, pedido nuevo con lista editada, validación; reprecio desde el pedido con precio propio; borrado 403/200/404; modal Precios en el navegador); axe 0 violaciones en 15 rutas.

