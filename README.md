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

## Cómo se usa

**Cliente** · entra al catálogo, elige modalidad (mayorista, intermedio o minorista), agrega kilos y confirma con nombre, WhatsApp y dirección. Puede marcar el punto exacto de entrega con **"Usar mi ubicación actual"** (GPS del dispositivo) o arrastrando el pin en el mapa; la dirección y la localidad se completan solas. Con ese teléfono queda identificado: ve sus pedidos, los sigue en el mapa con **hora estimada de llegada**, recibe **avisos** (repartidor asignado, camioneta en camino con la hora, entregado) aunque cierre la app, puede cancelar mientras estén "recibidos", repetirlos y consultar su cuenta corriente y envases. Desde otro dispositivo recupera todo con "Ingresar con mi teléfono".

**Administración** (`/admin` → PIN; también "Soy de Pollito Casero" en el menú) · recibe un aviso por cada pedido nuevo, tablero por estado (recibidos, en preparación, en camino, entregados), asigna repartidor, registra cobros, envases y devoluciones, carga pedidos telefónicos desde el catálogo y administra clientes (modalidad, cuenta corriente y **repartidor habitual**, que deja los pedidos nuevos preasignados). Pestaña **Reparto y rendición**: hoja de ruta por repartidor y día (salida, paradas en orden, zonas, kilos, cobros, envases dejados/devueltos, saldo anterior de cada cliente habitual y **saldo a rendir**). Botones para **imprimir la hoja de pedidos del día y la hoja de ruta** (`/imprimir`).

**Repartidor** (`/acceso` → Repartidor → nombre + PIN) · ve solo sus entregas, inicia el reparto, comparte su GPS (el cliente lo ve moverse en el mapa con tiempo estimado de llegada), abre la navegación en Google Maps, registra el cobro y completa la entrega con los envases dejados.

Todos los cambios de estado llegan al instante a las pantallas abiertas (Server-Sent Events). Los botones de WhatsApp abren la conversación con administración, el repartidor asignado o el cliente; no envían mensajes automáticos.

## Lo implementado

- Catálogo de 10 productos con precios por modalidad, fotos por corte, búsqueda y filtros. Cantidades de 1 a 1000 kg en pasos de 0,5 kg. Precios y totales se calculan **siempre en el servidor**.
- Carrito persistente; en móvil, barra fija "Ver mi pedido" y hoja inferior, como en las apps de reparto.
- Sesión por teléfono (cookie HttpOnly). Los pedidos se filtran por rol: el cliente ve los suyos, el repartidor los asignados, administración todos.
- Máquina de estados recibido → preparando → en camino → entregado, más cancelación por el cliente antes de la preparación. Cobro obligatorio antes de entregar salvo cuenta corriente. Envases solo en pedidos mayoristas.
- Cuenta corriente y saldo de envases por cliente; administración habilita o quita el crédito. **Pagos a cuenta** registrados por administración o el repartidor (efectivo/transferencia) se aplican a los pedidos más antiguos; el sobrante queda como saldo a favor y se descuenta del próximo pedido a cuenta.
- **Peso real en balanza**: administración (o el repartidor desde la preparación) carga los kilos pesados por corte; el importe se recalcula con el precio por kilo, el cliente ve "pediste 20 kg · pesado 19,6 kg" y recibe el aviso.
- Repartidor: paradas ordenadas por localidad y **ruta completa en Google Maps** con todas las paradas del día.
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
STAFF_PIN=1234          # PIN de administración y reparto (en demo, 1234)
ADMIN_WHATSAPP=5492635037286
TRANSFER_ALIAS=         # habilita "transferencia" como medio de pago
DB_PATH=data/pollito.sqlite
GEOCODING=on            # off desactiva Nominatim
ROUTING=on              # off desactiva OSRM (ETA por distancia)
PUSH=on                 # off desactiva el envío de avisos
VAPID_PUBLIC_KEY= / VAPID_PRIVATE_KEY=   # opcional; si faltan se generan en data/vapid.json
```

Con `business.demo: true` el PIN por defecto es 1234, la cuenta corriente se habilita automáticamente a los nuevos clientes mayoristas y se siembra un pedido de ejemplo (PC-1024, asignado a Franco).

## Estructura

```
server.mjs            HTTP, cookies, páginas con metadatos, estáticos, SSE
server/api.mjs        rutas de la API y reglas por rol
server/store.mjs      SQLite (pedidos, clientes, sesiones, caché de geocodificación)
server/geo.mjs        Nominatim (directo e inverso) con cola de 1 req/s
server/route.mjs      ETA con OSRM o estimación por distancia
server/push.mjs       Web Push con claves VAPID
domain.mjs            precios, validación, teléfonos, resumen de cuenta (compartido con tests)
src/lib/              api + SSE, router, store (estado global), formato, push, reportes (hoja de ruta)
src/components/       carrito, tarjeta de producto, tarjeta operativa, modales, UI
src/pages/            catálogo, pedidos, seguimiento, cuenta, planes, ayuda, operación, reparto, acceso, impresión
src/Map.jsx           Leaflet + ruta OSRM
```

## Verificación

```sh
npm test               # dominio (Node test runner)
npm run test:e2e       # API + navegador: cliente, administración, repartidor, SSE, responsive, offline
npm run test:a11y      # Axe en todas las rutas (requiere npm start en otra terminal)
```

Los scripts de navegador usan Chromium de Playwright (`npx playwright install chromium`) o `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. El E2E levanta su propio servidor en el puerto 5181 con SQLite en memoria y geocodificación apagada.

## Para operar con clientes reales

1. **Verificar el teléfono** al ingresar (código por WhatsApp Business API u OTP por SMS). Hoy la identidad es el número declarado, suficiente para la demo pero no para producción.
2. **PIN por persona** para administración y repartidores (o cuentas con contraseña), y `STAFF_PIN` fuerte mientras tanto.
3. **HTTPS y dominio** (`SITE_URL`), copias de seguridad de `data/pollito.sqlite`, `HOST=0.0.0.0` detrás de un proxy.
4. **Plantillas de WhatsApp** automáticas (API de WhatsApp Business) si se quiere avisar también por WhatsApp además de los push.
5. **Pagos online** (Mercado Pago) si se quiere cobrar antes de la entrega.
6. Confirmar precios mayorista/intermedio, zona y horarios de reparto, y las coordenadas exactas del local.

## Diseño y activos

`DESIGN.md`, `design-contract.md` e `implementation-handoff.md` documentan la dirección visual. Fotos ilustrativas generadas para el proyecto; los cortes son recortes de una misma foto (`scripts/assets.mjs`). Ver `ASSETS.md`.
