# Pollito Casero

PWA de pedidos de pollo por kilo para **El Pollito Casero** (San Martín, Mendoza). React 19 + Vite en el cliente; servidor Node.js con `node:sqlite`, sin frameworks. Tres roles: **cliente**, **administración** y **repartidor**.

Estado: demostración funcional en local, lista para una etapa de publicación (ver "Para operar con clientes reales").

## Ejecutar

Requiere Node.js 24 (usa `node:sqlite`).

**En la PC del negocio (Windows)**: doble clic en **`Iniciar Pollito Casero.cmd`**. Instala dependencias y compila si hace falta, deja el servidor corriendo y abre http://localhost:5173. Para que arranque solo al encender la PC, ejecutá una vez **`Instalar inicio automatico.cmd`** (crea un acceso directo en la carpeta Inicio de Windows). `Detener servidor.cmd` lo apaga.

Si la app dice **"No se pudo conectar con el servidor de Pollito Casero"**, el servidor local no está corriendo: volvé a abrir `Iniciar Pollito Casero.cmd`. No tiene que ver con tu conexión a internet.

**Desde la terminal:**

```sh
npm install
npm run build
npm start
```

Desarrollo con recarga: `npm run dev`.

## Subir a internet (Railway) y usarla en los celulares

La app es **un solo servidor Node con SQLite**: no sirve para Vercel/Netlify (funciones sin disco). Va en un host con disco persistente; la más simple es **Railway** (≈ USD 5/mes). El repo ya trae `Dockerfile`, `railway.json` y `.env.example`.

1. **GitHub**: `git push -u origin main` (remoto `origin` = https://github.com/SyntAI-cmd/el_pollito_casero_pwa).
2. **Railway** → https://railway.com/new → *Deploy from GitHub repo* → elegir el repo. Detecta el `Dockerfile`.
3. En el servicio → **Variables**: `ADMIN_PASSWORD` (clave larga), `SITE_URL` (la URL pública que Railway te da en *Settings → Networking → Generate domain*, con `https://`), `APP_MODE=equipo`. El resto es opcional (`.env.example`).
4. **Volumen**: *Settings → Volumes → Add volume* montado en **`/data`**. Ahí viven la base (`pollito.sqlite`), las copias diarias (`/data/backups`, 14 días) y las claves push. Sin volumen, los datos se pierden en cada deploy.
5. Deploy. Con `ADMIN_PASSWORD` se crean `admin` y un usuario por camión/preventista (Franco, Maxi, Nahuel, Andrés, Miguel, Brian, Nicolás, Carlos) con esa misma clave: cambiarlas desde **Equipo**.
6. Cada `git push` a `main` vuelve a desplegar; las migraciones de la base corren solas al arrancar.

**Repartidores y preventistas** ("¿APK?"): no hace falta una APK. Cada uno abre `https://tu-dominio/admin` en Chrome (Android) → menú ⋮ → **"Instalar aplicación"** (o "Agregar a pantalla de inicio"). Queda con ícono propio, pantalla completa, funciona con mala señal (las pesadas se guardan y se envían solas) y **todo se guarda en el servidor**, no en el teléfono: si cambian de celular, entran de nuevo y siguen. Si más adelante querés una APK real para Play Store, se genera desde la misma PWA con [PWABuilder](https://www.pwabuilder.com) (Trusted Web Activity) sin tocar el código.

**Antes de empezar en serio**: `node scripts/limpiar.mjs` borra pedidos, cajones, pagos, chat, noticias y fichas de prueba (conserva clientes importados, precios propios, camiones y usuarios); `--todo` deja la base vacía. Siempre guarda una copia previa en `data/backups/`.

**Copias de seguridad**: además de las diarias en el volumen, cada tanto descargá una con `railway run node -e "…"` o desde Railway → Volume → *Download*; localmente `data/backups/`.

## Modo de la app

`business.json → mode`: **`equipo`** (actual) apaga el portal de clientes: todo el mundo entra por `/admin` y la app es la herramienta de piso de administración y preventistas. `completo` vuelve a habilitar catálogo, checkout y cuentas de clientes (la E2E corre con `APP_MODE=completo`).

## Módulo de piso (administración y reparto)

Digitaliza el circuito real: pedidos por WhatsApp de noche → nota de pedidos → pesada de cajones con tara → carga por camión → remito → cobro y saldos.

- **Clientes** (Operación → Clientes): fichas al estilo GC/Atuq (código, CUIT, razón social, apodo, sucursal, zona, turno mañana/tarde, camión, dirección, teléfono opcional, estado *completa / sin CUIT / revisar*), **precios propios por producto** (las listas de mañana/tarde hechas datos), extracto y cobro. `scripts/importar-gc.mjs` importa la planilla de clientes de GC y `scripts/parsear-listas.py` lee las listas de precios en PDF y las cruza por apodo y zona (lo que no cruza queda "a revisar").
- **Camiones y preventistas** (Equipo): nombre, WhatsApp, CUIT, turno y zonas; sus clientes les quedan preasignados. Cada uno entra con su usuario.
- **Cargar pedido** (administración y preventistas, `/operacion/nuevo` y `/reparto/nuevo`): cliente de la lista, **cajas o kilos** por producto al precio propio, fecha y turno de reparto, camión, pago, observaciones para el remito, "repetir último". Administración puede **tocar el precio por kilo en la misma fila** (lápiz): queda como precio propio del cliente y se usa en ese pedido.
- **Listas de precios** (`/operacion/precios`, botón en Clientes): mayorista / intermedio / minorista por producto; precio base = pollo entero mayorista ($5.500 al 14/09/2026). Se guardan en `settings` (`PUT /api/precios/listas`) y pisan `business.json`; los precios propios por cliente pisan la lista.
- **Precios y borrado desde el pedido** (administración, tarjeta del pedido): **Precios** cambia el precio por kilo de cada renglón y recalcula (opción de guardarlo como precio del cliente); **Eliminar** borra el pedido con sus cajones (`DELETE /api/orders/:id`, queda en auditoría; lo cobrado en efectivo/transferencia vuelve como saldo a favor).
- **Pesada por cajón**: `POST /api/orders/:id/crates {productId, gross}` resta la tara (`business.tare`, 1,7 kg, editable en `PATCH /api/settings`) y acumula kilos por producto; cada cajón tiene id propio (reintentos sin duplicar), se anula con motivo y se marca cargado al camión. Recalcula el total con el precio del cliente y ajusta el saldo si el pedido ya estaba pagado.
- **Nota del día** `GET /api/dia?fecha=`; **noticias** del equipo `GET/POST /api/news`; **consolidado en Excel** `GET /api/export/consolidado?fecha=` (una fila por pedido: preventista, cliente, razón social, CUIT, descripción, cajones, kilos, neto, IVA 10,5 %, total).

- **Nota del día** (`/operacion/dia`, pantalla de inicio de administración): la hoja amarilla hecha datos: totales para faena por producto, pedidos por camión con su estado de piso, accesos a pesar, cargar, Excel, nota impresa, remitos y hoja de ruta; arriba las **noticias del equipo**.
- **Pesada** (`/operacion/pesada`, `/reparto/pesada`): primero se elige el pedido, después el producto y se tipea el **bruto** de cada cajón; la app resta la tara y muestra el **neto** en grande antes de confirmar. Lo pedido por **cajas** cuenta "cajón N de M" y acumula kilos; lo pedido por **kilos** se pesa como bulto (bruto y neto) contra lo pedido. Funciona sin señal: las pesadas quedan en el dispositivo y se envían solas.
- **Carga del camión** (`/operacion/carga`, `/reparto/carga`): se marca cada cajón que sube; **Cerrar camión** avisa si falta algo por pesar o cargar y pide motivo para salir igual; los pedidos pasan a "en camino".
- **Remito interno 10 × 15** (`/imprimir?tipo=remito&pedido=…` o `tipo=remitos&fecha=…&repartidor=…`): copia del talonario con los datos fiscales de `business.fiscal`, kilos, precio propio, total, cajas adeudadas y saldo. Se imprime uno por hoja en papel 10×15.

Pendiente: entrega con firma/foto, cola offline para cobros, cajas devueltas desde la pantalla de entrega.

## Tres aplicaciones separadas por rol

| Rol | Entra por | Ve | No ve |
|---|---|---|---|
| **Cliente** | `/ingresar`: Google, email (contraseña o **enlace temporal** por correo), **huella / Face ID / PIN del dispositivo** (passkeys) o **celular con código por WhatsApp**; o directamente al confirmar un pedido | catálogo, sus pedidos, seguimiento en el mapa con ETA, su cuenta y envases | pantallas del equipo (solo el acceso "Equipo" de la cabecera) |
| **Administración** | `/admin` → usuario y contraseña (rol administración) | tablero de pedidos, cargar pedido telefónico, pesaje, clientes (cuenta corriente, repartidor habitual), reparto y rendición, impresión, **chat interno** con cada repartidor | catálogo público, seguimiento del cliente |
| **Repartidor** | `/admin` → su usuario y contraseña (rol repartidor) | solo sus entregas: salir, GPS, navegar, cobrar, pesar, entregar con envases; clientes de su reparto para **cobrar saldos** y **recibir envases**; chat con administración | pedidos ajenos, catálogo, panel de administración |

El servidor filtra los datos por rol en cada consulta (no solo la interfaz): un repartidor no puede leer ni modificar pedidos que no le asignaron; un cliente solo ve los suyos. Los intentos de ingreso del equipo se limitan a 6 por minuto por IP (10 para clientes) y quedan registrados en `audit_log`. Los usuarios del equipo (`staff_users`: usuario, nombre, rol admin/repartidor, contraseña scrypt, activo) se administran desde **Operación → Equipo**; al arrancar se crean `admin` y un usuario por repartidor de `business.json` con `ADMIN_PASSWORD` (en demo, `pollito2026`).

## Cómo se usa

**Cliente** · entra al catálogo, elige modalidad (mayorista, intermedio o minorista), agrega kilos y confirma con nombre, WhatsApp y dirección. Puede marcar el punto exacto de entrega con **"Usar mi ubicación actual"** (GPS del dispositivo) o arrastrando el pin en el mapa; la dirección y la localidad se completan solas. Ve ese pedido, lo sigue en el mapa con **hora estimada de llegada**, recibe **avisos** (repartidor asignado, camioneta en camino con la hora, entregado) aunque cierre la app, puede cancelarlo mientras esté "recibido" y repetirlo. **El historial completo del teléfono, la cuenta corriente y los envases se ven solo con el WhatsApp verificado**: un código de un solo uso (10 minutos, 5 intentos) que se pide desde Ingresar → celular o desde Mi cuenta → "Verificar con un código". Sin verificar, una sesión (invitado o cuenta de email/Google) solo ve los pedidos que ella misma creó; conocer un número no da acceso a nada ajeno ni modifica la ficha del cliente. En **Mi cuenta** ve el **extracto de cuenta corriente** (cargos, ajustes de balanza, pagos, anulaciones y saldo acumulado), y puede crear o cambiar su contraseña y activar la huella o el Face ID del dispositivo.

**Administración** (`/admin` → usuario y contraseña; desde la app del cliente se llega con el botón **Equipo** de la cabecera, el menú móvil o el pie) · recibe un aviso por cada pedido nuevo, tablero por estado (recibidos, en preparación, en camino, entregados), asigna repartidor, registra cobros, envases y devoluciones, busca pedidos por número, cliente, teléfono, dirección o repartidor, carga pedidos telefónicos en **una sola pantalla** (Cargar pedido: buscar cliente por nombre o WhatsApp, kilos por producto en una tabla, pago y repartidor; Enter salta de producto, Ctrl+Enter confirma) y administra clientes (modalidad, cuenta corriente, **repartidor habitual** que deja los pedidos nuevos preasignados, y **extracto** de cuenta corriente con saldo después de cada movimiento). En **Equipo** edita nombre, rol y repartidor de cada usuario. Pestaña **Reparto y rendición**: hoja de ruta por repartidor y día (salida, paradas en orden, zonas, kilos, envases dejados/devueltos, saldo anterior de cada cliente calculado una vez por cliente) y rendición por medio real de cobro: **efectivo a rendir** = efectivo cobrado en la puerta por ese repartidor + cobros de cuenta corriente en efectivo; las transferencias y Mercado Pago se listan aparte y no suman al efectivo; "entregado a cuenta" cuenta solo pedidos entregados; el **saldo anterior** es el corte al inicio del día según el libro de movimientos. Debajo, el **cierre de caja** del repartidor: efectivo que debía rendir vs. recibido, diferencia, nota, quién y cuándo (se guarda en `cash_closures` y en la auditoría; se puede corregir). Botones para **imprimir la hoja de pedidos del día y la hoja de ruta** (`/imprimir`).

**Repartidor** (`/admin` → su usuario y contraseña) · ve solo sus entregas, inicia el reparto, comparte su GPS (el cliente lo ve moverse en el mapa con tiempo estimado de llegada), abre la navegación en Google Maps, registra el cobro y completa la entrega con los envases dejados.

Todos los cambios de estado llegan al instante a las pantallas abiertas (Server-Sent Events). Los botones de WhatsApp abren la conversación con administración, el repartidor asignado o el cliente; no envían mensajes automáticos.

## Lo implementado

- Catálogo de 10 productos con precios por modalidad, fotos por corte, búsqueda y filtros. Cantidades de 1 a 1000 kg en pasos de 0,5 kg. Precios y totales se calculan **siempre en el servidor**.
- Carrito persistente; en móvil, barra fija "Ver mi pedido" y hoja inferior, como en las apps de reparto.
- Sesión por teléfono (cookie HttpOnly). Los pedidos se filtran por rol: el cliente ve los suyos, el repartidor los asignados, administración todos.
- Máquina de estados recibido → preparando → en camino → entregado, más cancelación por el cliente antes de la preparación. Cobro obligatorio antes de entregar salvo cuenta corriente. Envases solo en pedidos mayoristas.
- Cuenta corriente y saldo de envases por cliente; administración habilita o quita el crédito. **Pagos a cuenta** registrados por administración o el repartidor (efectivo/transferencia) se aplican a los pedidos más antiguos; el sobrante queda como saldo a favor y se descuenta del próximo pedido a cuenta.
- **Peso real en balanza**: administración (o el repartidor desde la preparación) carga los kilos pesados por corte; el importe se recalcula con el precio por kilo, el cliente ve "pediste 20 kg · pesado 19,6 kg" y recibe el aviso.
- Repartidor: paradas ordenadas por localidad y **ruta completa en Google Maps** con todas las paradas del día.
- **Mapa profesional** (MapLibre GL + tiles vectoriales de OpenFreeMap, sin API key): camioneta que se desliza entre lecturas GPS con flecha de rumbo, ruta por calles (OSRM) recalculada al avanzar, cámara que sigue a la camioneta hasta que el usuario toca el mapa ("Centrar" la retoma), local y domicilio marcados. Si el estilo vectorial no carga, cae a OpenStreetMap raster.
- **Pagos**: efectivo al recibir; **transferencia a Mercado Pago/banco** con alias y CVU (el cliente avisa "ya transferí" con referencia y administración confirma); **Mercado Pago online** (Checkout Pro) si se configura `MP_ACCESS_TOKEN`, con webhook que acredita el pago automáticamente; cuenta corriente con pagos parciales y saldo a favor.
- **Chat interno** administración ↔ repartidor en tiempo real (SSE) con avisos push y contador de no leídos.
- **Backend**: SQLite relacional (pedidos, ítems, eventos, recorrido, envases, pagos, clientes, sesiones con vencimiento, suscripciones push, mensajes, auditoría), transacciones en todas las operaciones de dinero, migración automática desde la base anterior, copia de seguridad diaria en `data/backups` (14 días), validación explícita de cada cuerpo, límite de intentos de ingreso, `GET /api/health`.
- Mapa OpenStreetMap/Leaflet con el local, el domicilio (punto marcado por el cliente o geocodificado con Nominatim) y el repartidor en vivo. Ruta por calles y ETA con el servidor público de OSRM; el servidor calcula la hora estimada al salir y la actualiza con cada posición GPS (cada 45 s); si OSRM no responde, estima por distancia.
- Notificaciones Web Push (`web-push`, claves VAPID en `data/vapid.json`): pedido nuevo y cancelaciones a administración; repartidor asignado, salida con hora estimada y entrega al cliente; pedido asignado al repartidor.
- Hojas imprimibles (A4 apaisado): pedidos del día por repartidor con total a preparar por producto; hoja de ruta y rendición por repartidor con firmas.
- PWA: manifest con accesos directos, iconos, service worker con caché versionada de assets e imágenes; sin conexión se conserva el catálogo y se impide confirmar. No se cachea la API.
- SEO: title y description por ruta desde el servidor, canonical, Open Graph 1200×630, Twitter card, robots.txt, sitemap.xml, `llms.txt`/`llm.txt`, 404 con estado HTTP 404 y rutas privadas con `noindex`.
- Accesibilidad: HTML semántico, foco visible, etiquetas en controles, diálogos nativos, sin violaciones Axe (WCAG 2 A/AA, 2.1 AA) en las 10 rutas.

## Configuración comercial

`business.json` concentra productos, precios, localidades, repartidores, local y envíos. Reiniciar el servidor tras editarlo.

| Producto | Mayorista | Intermedio | Minorista |
|---|---:|---:|---:|
| Pollo entero | $3.500/kg | $4.000/kg | $4.500/kg |
| Cuarto trasero | $3.280 | $3.690 | $4.100 |
| Alas | $2.640 | $2.970 | $3.300 |
| Pechuga | $5.270 | $5.930 | $6.590 |
| Suprema | $7.440 | $8.370 | $9.300 |
| Menudos | $1.480 | $1.670 | $1.850 |
| Rancho | $480 | $540 | $600 |
| Pechuga con alas | $3.870 | $4.360 | $4.840 |
| Muslo | $3.780 | $4.260 | $4.730 |
| Garras del pollo | $480 | $540 | $600 |

Los precios minoristas provienen de la lista del negocio (03/09/2026); mayorista e intermedio son -20 % y -10 % redondeados a $10, pendientes de confirmación. Envío: mayorista sin cargo; intermedio y minorista $1.500. Local: San Martín, Mendoza (`business.origin`, coordenadas aproximadas para el mapa).

Variables de entorno opcionales:

```text
PORT=5173
HOST=127.0.0.1          # 0.0.0.0 para exponer en la red local
SITE_URL=http://localhost:5173   # canonicals, sitemap, OG y host permitido
ADMIN_PASSWORD=         # contraseña inicial de admin y repartidores (en demo, pollito2026)
WHATSAPP_TOKEN= / WHATSAPP_PHONE_ID=   # WhatsApp Business Cloud API: envía el código de verificación del celular
WHATSAPP_OTP_TEMPLATE=codigo_de_acceso # plantilla de autenticación aprobada en Meta (WHATSAPP_OTP_LANG=es_AR)
GEOCODER_URL=           # geocodificador compatible con la API de Nominatim (propio, LocationIQ…); por defecto el público de OSM
# En business.json: planMinKg = { mayorista: 10, intermedio: 5 } (kilos mínimos por modalidad; la modalidad de un cliente con historial la fija administración)
GOOGLE_CLIENT_ID=       # habilita "Continuar con Google" (Google Identity Services)
SMTP_URL=               # smtps://usuario:clave@smtp.ejemplo.com:465 · envía los enlaces de acceso por email
MAIL_FROM=              # remitente de los enlaces (por defecto Pollito Casero <no-reply@dominio>)
LOGIN_LIMIT=            # intentos por minuto y por IP (por defecto 10 cliente / 6 equipo)
ADMIN_WHATSAPP=5492635037286
TRANSFER_ALIAS=         # habilita "transferencia" como medio de pago
DB_PATH=data/pollito.sqlite
GEOCODING=on            # off desactiva Nominatim
ROUTING=on              # off desactiva OSRM (ETA por distancia)
PUSH=on                 # off desactiva el envío de avisos
VAPID_PUBLIC_KEY= / VAPID_PRIVATE_KEY=   # opcional; si faltan se generan en data/vapid.json
TRANSFER_ALIAS=pollito.casero.mp   # alias de Mercado Pago/banco; habilita "transferencia" (también en business.json → transfer)
TRANSFER_CVU= / TRANSFER_HOLDER=
MP_ACCESS_TOKEN=        # Checkout Pro (pago online); requiere SITE_URL https para el webhook
```

Con `business.demo: true` la contraseña inicial del equipo es `pollito2026`, el enlace de acceso por email se muestra en pantalla si no hay `SMTP_URL`, el código de WhatsApp se muestra en pantalla si no hay `WHATSAPP_TOKEN` (fuera de demo, sin proveedor, el ingreso por celular se desactiva y el cliente entra por email/Google/passkey), el pedido de ejemplo PC-1024 se siembra en la base vacía, la cuenta corriente se habilita automáticamente a los nuevos clientes mayoristas y se siembra un pedido de ejemplo (PC-1024, asignado a Franco).

## Estructura

```
server.mjs            HTTP, cookies, páginas con metadatos, estáticos, SSE
server/api.mjs        rutas de la API y reglas por rol
server/store.mjs      SQLite (pedidos, clientes, sesiones, caché de geocodificación)
server/geo.mjs        Nominatim (directo e inverso) con cola de 1 req/s
server/route.mjs      ETA con OSRM o estimación por distancia
server/push.mjs       Web Push con claves VAPID
server/mercadopago.mjs transferencia (alias/CVU) y Checkout Pro + webhook
server/validate.mjs   validación de cuerpos y límite de intentos
server/errors.mjs     ApiError
domain.mjs            precios, validación, teléfonos, resumen de cuenta (compartido con tests)
src/lib/              api + SSE, router, store (estado global), formato, push, reportes (hoja de ruta)
src/components/       carrito, tarjeta de producto, tarjeta operativa, modales, UI
src/pages/            catálogo, pedidos, seguimiento, cuenta, planes, ayuda, operación, cargar pedido, equipo, reparto, acceso, impresión
src/lib/ledger.js     libro de movimientos de cuenta corriente (derivado de pedidos y pagos), corte histórico
src/lib/report.js     hoja de pedidos, hoja de ruta y rendición por medio de cobro, por cobrar
src/Map.jsx           MapLibre GL: camioneta animada, ruta OSRM, cámara que sigue
src/lib/mapkit.js     estilo vectorial (OpenFreeMap) con respaldo raster, marcadores, interpolación
```

## Verificación

```sh
npm test               # dominio (Node test runner)
npm run test:e2e       # API + navegador: cliente, administración, repartidor, SSE, responsive, offline
npm run test:a11y      # Axe en todas las rutas (requiere npm start en otra terminal)
```

Los scripts de navegador usan Chromium de Playwright (`npx playwright install chromium`) o `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. El E2E levanta su propio servidor en el puerto 5181 con SQLite en memoria y geocodificación apagada.

## Para operar con clientes reales

1. **Cambiar las contraseñas** del equipo desde Operación → Equipo (o arrancar con `ADMIN_PASSWORD`). `business.demo` ya está en `false` (códigos y enlaces de prueba solo con `DEMO=1`). Configurar **`WHATSAPP_TOKEN` / `WHATSAPP_PHONE_ID`** con una plantilla de autenticación aprobada para que el código de verificación llegue por WhatsApp (sin eso, el ingreso por celular queda apagado y los clientes entran por email, Google o passkey).
2. **`GOOGLE_CLIENT_ID`** (consola de Google Cloud, orígenes autorizados = `SITE_URL`) para el botón de Google y **`SMTP_URL`** para que los enlaces de acceso lleguen por correo. Las passkeys (huella/Face ID) y los avisos push requieren HTTPS fuera de localhost.
3. **HTTPS y dominio** (`SITE_URL`), copias de seguridad de `data/pollito.sqlite`, `HOST=0.0.0.0` detrás de un proxy.
4. **Plantillas de WhatsApp** automáticas (API de WhatsApp Business) si se quiere avisar también por WhatsApp además de los push.
5. **Pagos online** (Mercado Pago) si se quiere cobrar antes de la entrega.
6. Confirmar precios mayorista/intermedio, zona y horarios de reparto, y las coordenadas exactas del local.
7. **Geocodificador propio o con licencia** (`GEOCODER_URL`): la búsqueda de direcciones es a pedido (botón Buscar / Enter, nunca mientras se escribe) para respetar la política del Nominatim público, pero con volumen conviene un servicio propio.

## Seguridad (resumen)

- Cookies `HttpOnly; SameSite=Lax` (+ `Secure` con HTTPS); origen verificado en toda escritura; Host permitido; `Content-Security-Policy` estricta en producción (solo OpenFreeMap/OSM, OSRM y Google Identity), `X-Frame-Options: DENY`, `nosniff`, HSTS con HTTPS.
- Contraseñas y códigos con scrypt; enlaces de acceso de un solo uso confirmados con un botón (los escáneres de correo no los consumen); códigos por WhatsApp con 5 intentos y 3 envíos por teléfono cada 15 min; límites por IP en ingresos, pedidos anónimos y geocodificación; ingreso del equipo con tiempo constante.
- Cada consulta se filtra por rol en el servidor; las sesiones del equipo se validan contra `staff_users` en cada solicitud; auditoría en `audit_log`.
- Precios: los calcula el servidor; mínimos de kilos por modalidad y modalidad ligada a la ficha del cliente.

## Diseño y activos

`DESIGN.md`, `design-contract.md` e `implementation-handoff.md` documentan la dirección visual. Fotos ilustrativas generadas para el proyecto; los cortes son recortes de una misma foto (`scripts/assets.mjs`). Ver `ASSETS.md`.
