# Auditoría UX/UI — El Pollito Casero PWA

> Etapa 1 del rediseño: evidencia, inventario y prioridades. **No se modificó lógica ni estilos de la app.**
> Fecha: 5 de octubre de 2026 · Rama `main` · Commit auditado `49be3b4` (`fix(permisos): el segundo preventista gestiona el pedido igual que el principal`).

## 0. Cómo se hizo

| Fuente | Estado |
|---|---|
| Código: `src/App.jsx`, `src/main.jsx`, `src/components/ui.jsx`, `OrdersList.jsx`, páginas `Operations`, `QuickOrder`, `Weighing`, `Customers`, `Catalog`, `Delivery` (parcial), `lib/outbox.js`, `server/api.mjs`, `domain.mjs`, 6 hojas CSS, `public/manifest.webmanifest`, `public/sw.js`, `index.html`, `scripts/assets.mjs`, `scripts/verify.mjs` | Leído |
| `README.md`, `DESIGN.md`, `.env.example`, `Dockerfile` | Leído y contrastado con el código |
| `design-contract.md`, `REDISENO-2026.md`, `docs/produccion/*` | No leídos en detalle; ver §7 (qué conservar) |
| Ejecución | App levantada con `pollito-redisenio` (`.claude/launch.json`): base SQLite **en memoria**, `APP_MODE=equipo`, `DEMO=1`, geocodificación/rutas/push apagados, contraseña de prueba de `scripts/verify.mjs`. Sin datos reales. |
| Capturas | 22 capturas en [`baseline/`](baseline/) — 11 rutas × 1440×900 y 390×844 (Edge del sistema vía Playwright). |
| Pruebas | `npm test`: **136/136 pasan** (línea base). `npm run test:e2e` y `test:a11y` **no se ejecutaron**: falta el navegador de Playwright (`chromium_headless_shell-1243` no instalado). |
| Adjuntos | Inspeccionados: captura del buscador, Crypto Wallet, Cardy Pay (×2, incluida la paleta F2F2F2/DAD9D4/9D9C98/E63D3A/131313), barra de navegación tipo Pinterest, Tracking (George Davidson), Truck&Co (Jack R.), `Desing X- 1791235312390.md`. |

Limitación: la base en memoria arranca sin pedidos ni clientes, por lo que las capturas muestran estados vacíos. Las listas con datos se describen desde el código (`OrdersList.jsx`, `Weighing.jsx`); se marcan como **[código]** cuando no hay captura.

## 1. Hechos comprobados del producto

| Tema | Comprobado en código | Diferencia con documentación |
|---|---|---|
| Modo activo | `APP_MODE` (`.env.example:6`, `Dockerfile:16`) = **`equipo`** en producción. `App.jsx:693`: con `mode === "equipo"` todo usuario no-equipo va a `/admin`; el portal de clientes queda apagado. Servidor también bloquea (`server/api.mjs:1068`). | README describe el portal de clientes como activo; vale solo para `APP_MODE=completo` (lo usa la E2E). |
| Rol repartidor | `DRIVER_ROUTES` (`App.jsx:120`): solo `/reparto`, `/reparto/clientes`, `/ayuda` (PC-023). Cualquier otra ruta redirige y avisa «Esa sección es solo para administración». | README:87 dice que el repartidor «pesa»; README:64 cita `SIMPLE_NAV` con Cargar pedido · Pesaje · Imprimir para el repartidor. **`SIMPLE_NAV` no existe** en `App.jsx`. Se toma el código. |
| Rol administración | 14 rutas (`App.jsx:89`). En la barra: Pedidos, Cargar pedido, Pesaje, Clientes / Imprimir, Revisar entregas, Equipo (`App.jsx:454`). Fuera de la barra pero accesibles por URL: `/operacion/carga`, `/operacion/dia`, `/operacion/precios`, `/operacion/documentos`, `/operacion/movimientos`, `/imprimir`. | — |
| Offline real | Cola `pc-outbox` (`lib/outbox.js`) solo para **pesadas, anulaciones de pesada y carga del camión** (importan `send` únicamente `Weighing.jsx` y `TruckLoading.jsx`). Estados: pendiente, enviando, confirmada, requiere revisión. | README:36 «funciona con mala señal (las pesadas se guardan…)». Coincide. Cobros y entregas **no** están en la cola. |
| Borrador de Cargar pedido | No hay persistencia (`QuickOrder.jsx` no usa `localStorage`). | El brief pide «borrador preservado»: **no existe hoy**; ver PRODUCT_SPEC §8. |
| Tara | Configurable por servidor (`config.tare`, `server/api.mjs:123`), 1,7 kg por defecto; el cálculo vive en `Weighing.jsx:238` y servidor. | — |
| Logo en documentos | `HojaPdf.jsx:484` y `PedidosPdf.jsx:172` → `/brand/logo-texto-print.png`; `RemitoPdf.jsx:283` → `/brand/logo-pollito-print.png`. | README menciona `public/brand/` sin nombres. |

## 2. Defectos confirmados

### D-01 · Buscador con doble contorno — **CONFIRMADO, causa identificada**

**Síntoma** (captura del usuario y [`baseline/operacion_pesada-desktop.png`](baseline/operacion_pesada-desktop.png)): caja exterior redondeada y una segunda caja dentro.

**Medición en ejecución** (`getComputedStyle`, `/operacion/pesada`, 1440 px):

| Elemento | Borde | Radio | Margen | Padding | Alto |
|---|---|---|---|---|---|
| `.search-field` (wrapper) | 1px `#d3d6db` | 12px | 0 0 12px | 0 12px | 52,6px |
| `input` interno | **1px `#d3d6db`** | **12px** | **7px 0 2px** | 0 **84px** 0 36px | 42px |

**Causa (especificidad CSS, verificada):**

1. `src/styles-2026.css:221-240` define el patrón correcto: el wrapper dibuja el borde y `.search-field input { border: 0; padding: 0; background: none }`.
2. Pero la regla global de campos `src/styles-2026.css:202` `input:not([type="checkbox"]):not([type="radio"])` tiene especificidad **(0,2,1)** — cada `:not([attr])` suma un selector de atributo — y gana sobre `.search-field input` **(0,1,1)**. Resultado: el input recupera borde, radio y fondo. Lo mismo ocurre en móvil con `src/styles-ui.css:989`.
3. `src/styles.css:1838` agrega `margin: 7px 0 2px` a todo `input`, que nadie anula dentro del buscador → el wrapper crece a 52,6 px y la caja interna queda desplazada.
4. `src/styles-roles.css:1110` y `:1288` (`padding-left: 36px !important; padding-right: 84px !important`) se escribieron para el buscador de **direcciones** con botón «Buscar», pero el selector `.search-field input` aplica a **todos** los buscadores. El placeholder de Clientes se corta en móvil ([`baseline/operacion_clientes-mobile.png`](baseline/operacion_clientes-mobile.png): «Apodo, razón social, (»).
5. `src/styles-roles.css:1099-1108` vuelve a declarar `.search-field` con la lupa en `position:absolute`, en conflicto con el `display:flex; gap` de `styles-2026.css`.

**Inventario de buscadores:**

| Pantalla | Archivo:línea | Estructura | Doble contorno | Etiqueta accesible |
|---|---|---|---|---|
| Pesaje | `Weighing.jsx:441` | `.search-field.weigh-search` + input | Sí | `aria-label` ✓ |
| Clientes (admin y repartidor) | `Customers.jsx:123` | `.search-field.wide` | Sí + placeholder cortado | `aria-label` ✓ |
| Cargar pedido · cliente | `QuickOrder.jsx:553` | `<label>` → `.search-field` | Sí (visible con foco rojo exterior, ver [`operacion_nuevo-desktop.png`](baseline/operacion_nuevo-desktop.png)) | label + `aria-label` duplicados |
| Pedidos | `Operations.jsx:268` | input suelto, sin lupa | No (un solo borde) pero **sin lupa y sin limpiar** | `aria-label` ✓ |
| Catálogo (modo completo) | `Catalog.jsx:135` | `label.catalog-search` (otro sistema, `styles.css:660`) | No verificado (modo apagado) | `sr-only` ✓ |
| Dirección (Modals) | `styles-roles.css:1270` | `.search-field` + `.search-button` | Usa el padding 84px a propósito | — |

Ninguno ofrece botón propio de limpiar (solo el nativo de `type="search"` en Chromium; QuickOrder usa `type` texto, sin limpiar). La búsqueda de Pedidos/Pesaje no se sincroniza con la URL salvo la fecha (`?fecha=` en Pesaje).

### D-02 · Identidad: la app no usa el logo original — **CONFIRMADO**

- `public/icon.svg` es un **pollito dibujado genérico** (cuadrado rojo `#cc242a` con silueta blanca), no el logo del negocio. Se usa en: panel lateral (`App.jsx:491`), login de equipo (`Access.jsx:41`), página 404, favicon (`index.html:25`) y genera `icon-192/512.png` (`scripts/assets.mjs:40-42`), es decir el **ícono de la PWA instalada**.
- El logo original existe en `public/brand/`: `logo-pollito.png` (1180×800, gallo + cinta) y `logo-texto.png` (1200×362, cinta «EL POLLITO CASERO / VENTA POR MAYOR Y MENOR»), más versiones `-print` (240×163 y 240×72) que usan los PDF. Proporciones coinciden (1,475 vs 1,472; 3,315 vs 3,333): las `-print` son reducciones del mismo activo.
- Hoy conviven: el login muestra cinta original **y** el pollito genérico ([`admin-desktop.png`](baseline/admin-desktop.png)); el celular muestra la cinta original arriba ([`operacion-mobile.png`](baseline/operacion-mobile.png)); el escritorio muestra solo el genérico ([`operacion_nuevo-desktop.png`](baseline/operacion_nuevo-desktop.png)).
- Rojo del logo medido sobre píxeles de `logo-texto.png`: **#951A1B–#9B1C1E** (activo escaneado); en `logo-pollito.png` **#8B181A–#94191D**. Ninguno coincide con el rojo de la app (`#c9262e`) ni con el del manifest (`#cc242a`).

### D-03 · Dos `<h1>` por pantalla — **CONFIRMADO**

Todas las rutas de equipo renderizan `<h1>` en la cabecera (`App.jsx:602`) **y** otro en `PageHead` (`ui.jsx:9`). Ejemplos medidos: «Pesaje» + «Pesada.», «Clientes» + «Clientes.». En `/operacion/carga`, `/dia`, `/precios` la cabecera dice «Pollito Casero» porque esas rutas no están en la barra (`App.jsx:572`). Además, el nombre de la sección no coincide con el título («Pesaje» vs «Pesada.»).

### D-04 · Clientes repite su título — **CONFIRMADO**

`/operacion/clientes` muestra «Clientes.» (PageHead), y dentro de una tarjeta otra vez «Clientes» + «0 fichas» (`Customers.jsx:116`) → tarjeta dentro de página sin función ([`operacion_clientes-mobile.png`](baseline/operacion_clientes-mobile.png)).

### D-05 · Etiquetas de campo con ícono en renglón propio — **CONFIRMADO**

En Cargar pedido (escritorio) el ícono de Lucide queda arriba de la etiqueta («📅 / Fecha de reparto»), y los campos con y sin ícono quedan desalineados verticalmente (Turno vs Fecha) — [`operacion_nuevo-desktop.png`](baseline/operacion_nuevo-desktop.png). Alturas mezcladas: fecha 42 px, selects 48 px en la misma fila.

### D-06 · Sistema de estilos fragmentado — **CONFIRMADO (medido)**

| Hoja | Líneas | HEX literales | `!important` | `@media` |
|---|---|---|---|---|
| `styles.css` | 2.884 | 142 | 9 | 10 |
| `styles-app.css` | 825 | 67 | 3 | 4 |
| `styles-ops.css` | 1.314 | 97 | 5 | 6 |
| `styles-roles.css` | 2.936 | 209 | 10 | 18 |
| `styles-ui.css` | 1.065 | 52 | 9 | 15 |
| `styles-2026.css` | 1.615 | 65 | 10 | 16 |
| **Total** | **10.639** | **632** | **46** | **69** |

- Dos vocabularios de tokens: `--red/--black/--muted/--line` (`styles.css:7`) y `--rojo/--tinta/--borde` (`styles-2026.css:16`). Rojos en uso: `#c9262e`, `#cc242a`, `#a71825`, `#a91b25`, `#a81f26`. Grises casi iguales: `#d0d0d0`, `#d1d1d1`, `#cecece`, `#e4e4e4`, `#e7e7e7`, `#ebebeb`, `#ededed`…
- 16 cortes de pantalla distintos (900, 760, 740, 720, 980, 700, 480, 1200, 520, 440, 1400, 1100, 620, 1500…). Los más usados: 900 (15) y 760 (10).
- Tres reglas de foco compiten: `styles.css:71` (3px `#a71825`, offset 4), `styles-2026.css:79` (2px rojo, offset 2, `:where` → especificidad 0) y anulaciones locales (`outline:none`).
- Radios de 6, 8, 12, 18 px y 999 px sin criterio documentado; el cuerpo del chrome se llama `--oscuro` pero vale `#ffffff`.

### D-07 · Contraste insuficiente en tokens actuales — **CONFIRMADO (cálculo WCAG)**

| Par | Ratio | Mínimo | Resultado |
|---|---|---|---|
| `--tinta-3 #868D97` sobre blanco (placeholders, ayudas) | 3,35 | 4,5 texto | **Falla** |
| `--borde-fuerte #D3D6DB` sobre blanco (borde de campos) | 1,46 | 3,0 límite de control (1.4.11) | **Falla** |
| `#C9262E` sobre blanco (rojo actual, texto) | 5,53 | 4,5 | Pasa |
| `#E63D3A` (referencia) sobre blanco | 4,12 | 4,5 | Falla como texto |

### D-08 · Encabezado de Carga del camión — **CONFIRMADO**

`/operacion/carga` usa el nombre del vehículo como `<h1>` («Toyota Hino A974NR (Camión).») y la cabecera dice «Pollito Casero». La hora de salida queda alineada con el título de la tarjeta, no con los preventistas ([`operacion_carga-desktop.png`](baseline/operacion_carga-desktop.png)).

### D-09 · Botón activo cambia tipografía — **CONFIRMADO (código)**

`styles.css:80` `button:not(:disabled):active { font-weight: 400; color: #696969 }`: al tocar un botón rojo su texto pasa a gris sobre rojo (contraste ≈ 1,9) durante la pulsación. Hipótesis de impacto: perceptible en celular como «parpadeo».

### D-10 · Indicador «Demo» en producción visual — **HIPÓTESIS**

Se ve porque esta ejecución usa `DEMO=1`; en producción `business.json` tiene `"demo": false`. No es defecto.

## 3. Lo que funciona y se conserva

- Respuesta a reducción de movimiento (`styles-2026.css:86`).
- Barra inferior de 4 + «Más» que se oculta al bajar y con teclado abierto (`App.jsx:421`, `useHideOnScroll`, `useKeyboardOpen`).
- `useVisibleHeight` para que los diálogos no queden bajo el teclado.
- Recarga del service worker diferida si hay escritura, diálogo o cola pendiente (`main.jsx:48`).
- Pedidos en tabla en escritorio y tarjetas en móvil (`OrdersList.jsx:33`); sin scroll horizontal medido en ninguna ruta (390 px y 1440 px: `scrollWidth ≤ innerWidth`).
- Estado de la cola visible en Pesaje: «N pendientes · enviando…», «Todo guardado en el servidor», «Requiere revisión» (`Weighing.jsx:548-558`, `:861`). Es el patrón honesto que se generaliza.
- Teclado numérico propio para pesaje (`Teclado.jsx`) y preferencia guardada.
- Carga diferida de páginas pesadas; PDF en worker (1,27 MB fuera del bundle principal).

## 4. Matriz de pantallas

Modo: **E** = equipo (producción), **C** = solo `APP_MODE=completo`. Prioridad: P0 preservar, P1 flujo operativo, P2 consistencia.

| Ruta | Rol | Modo | Tarea principal | Componentes | Problema | Evidencia | Prio | Propuesta |
|---|---|---|---|---|---|---|---|---|
| `/admin` | anónimo | E/C | Ingresar | `Access.jsx` | Logo original + pollito genérico juntos; video de fondo; contraste correcto | D-02, `admin-*.png` | P1 | Solo logo original; formulario sin cambios |
| `/operacion` | admin | E | Ver y operar pedidos del día | `Operations.jsx`, `OrdersList.jsx`, `OrderCard`, `News` | Buscador sin lupa ni limpiar; 4 métricas de igual peso antes de la lista; doble h1 | D-01, D-03, `operacion-*.png` | P1 | `SearchField`; métricas compactas en una fila; lista primero |
| `/operacion/nuevo` | admin | E | Cargar pedido telefónico | `QuickOrder.jsx` | Doble contorno; íconos sobre etiquetas; alturas mixtas; sin borrador | D-01, D-05 | P1 | `SearchField`, `Field` con ícono en línea, grilla 2 columnas |
| `/operacion/pesada` | admin | E | Pesar cajas | `Weighing.jsx`, `Teclado` | Doble contorno; «Pesaje» vs «Pesada.» | D-01, D-03 | P0/P1 | `SearchField`; bloque Bruto/Tara/Neto (ver spec) |
| `/operacion/clientes` | admin | E | Fichas, saldos, envases | `Customers.jsx`, `Saldos` | Doble contorno; título duplicado; placeholder cortado | D-01, D-04 | P1 | `SearchField`; quitar tarjeta envolvente |
| `/operacion/imprimir` | admin | E | Generar PDF | `PrintHub.jsx` | h1 = fecha («05/10/2026.») | `operacion_imprimir-*.png` | P2 | Título «Imprimir» + fecha como subtítulo |
| `/operacion/entregas` | admin | E | Revisar entregas | `Delivery.jsx` | — (sin datos) | `operacion_entregas-*.png` | P1 | Ver spec Entrega |
| `/operacion/equipo` | admin | E | Usuarios, vehículos | `Operations.jsx` (tab), `Team.jsx`, `Vehicles` | Doble h1 | D-03 | P2 | Tokens + tabla |
| `/operacion/carga` | admin | E | Armar salida y cargar | `TruckLoading.jsx` | h1 = vehículo; cabecera genérica | D-08 | P1 | Título «Carga del camión» |
| `/operacion/dia` | admin | E | Nota del día | `DaySheet.jsx` | Cabecera «Pollito Casero» | D-03 | P2 | Título en cabecera |
| `/operacion/precios` | admin | E | Listas de precios | `PriceLists.jsx` | Cabecera «Pollito Casero» | D-03 | P2 | Ídem |
| `/operacion/documentos`, `/movimientos` | admin | E | Retirados de la barra (ver `docs/produccion/DECISION-RETIRO-DOCUMENTOS-MOVIMIENTOS.md`) | — | No se reactivan | — | — | Solo tokens |
| `/imprimir` | admin | E | Vista previa PDF | `Print.jsx`, `PdfPreview` | — | — | P2 | Barra de acciones de documento |
| `/reparto` | repartidor | E | Mis entregas, cobro, cajas | `Delivery.jsx`, `PaymentPanel`, `CajasBox`, `Receipts` | [código] | — | P0/P1 | Ver spec Entrega |
| `/reparto/clientes` | repartidor | E | Clientes y saldos | `DriverCustomers` → `Customers` | Mismo D-01/D-04 | D-01 | P1 | Igual que admin |
| `/ayuda` | todos | E | Ayuda | `Help.jsx` | — | — | P2 | Tokens |
| `/`, `/pedidos`, `/seguimiento`, `/cuenta`, `/planes`, `/ingresar` | cliente | **C** | Portal | `Catalog`, `Orders`, `Tracking`, `Account`, `Plans`, `Login` | Apagado en producción | `App.jsx:693` | P2 | Solo tokens y logo; sin rediseño de flujo |

## 5. Referencias: qué se toma y qué no

| Referencia | Se toma | Se descarta |
|---|---|---|
| Captura del buscador | Define el defecto D-01 | — |
| Cardy Pay + paleta | Jerarquía tipográfica, base gris clara `#F2F2F2`, negro `#131313` como superficie puntual, rojo como único acento, navegación inferior compacta | Saldos ficticios, gráficos ondulados, avatares de destinatarios |
| Crypto Wallet | Cifras grandes y tabulares, bloques separados por superficie (claro/oscuro) | Fondo oscuro general, rayados decorativos, cápsulas en todo |
| Barra tipo Pinterest | Estado activo inequívoco (fondo + punto/indicador) | Volumen 3D, curvas, sombras pesadas |
| Tracking (George Davidson) | Lista ↔ detalle lado a lado en escritorio, filtros con contador, acciones arriba a la derecha del detalle | Camión ilustrado, mapa propio (fuera de alcance) |
| Truck&Co (Jack R.) | Encabezado de contexto con 3 cifras operativas, tabla densa para planificación | Camión gigante, Gantt, violeta |
| `Desing X-….md` | Tres direcciones comparadas una vez, copy real, movimiento funcional, QA multiplataforma y anti-genérico | Animaciones que «reaccionen al cursor» sin función |

## 6. Prioridades

1. **P0** — No tocar: contratos API, `store.jsx`, `outbox.js`, cálculos de tara/neto/importe, permisos (`App.jsx` rutas y redirecciones), PDF.
2. **P1** — D-01 buscador, D-02 logo, D-03 encabezados, D-05 campos, D-07 contraste, Pedidos/Pesaje/Cargar pedido/Entrega responsive.
3. **P2** — D-06 consolidación de hojas, D-08, D-09, pantallas restantes y portal (modo completo) solo con tokens.

## 7. Documentos previos

| Documento | Decisión |
|---|---|
| `DESIGN.md` (rojo `#cc242a`, fondo cálido `#f8f7f4`, Georgia/serif editorial, 32–54 px) | **Reemplazar** por un puntero a `docs/redesign/DESIGN_SYSTEM.md` al implementar. Conservar: voseo, anti-patrones, botones ≥ 44 px, reduced motion. |
| `design-contract.md`, `REDISENO-2026.md`, `SKILLS-APLICADAS.md` | Revisar y marcar como históricos al cerrar el ticket RD-14; no borrar. |
| `styles-2026.css` encabezado («vidrio suave solo en la navegación») | El vidrio se elimina; ver DESIGN_SYSTEM §3. |
| `README.md` líneas 64 y 87 | Corregir accesos del repartidor y quitar `SIMPLE_NAV` (ticket RD-14). |
| `docs/produccion/*` | Se conservan; son decisiones de negocio, no de estilo. |
