# Plan de implementación — Rediseño UX/UI 2026

> Tickets en orden de ejecución. Cada uno cambia **presentación**; si un ticket necesita tocar `lib/store.jsx`, `lib/outbox.js`, `server/*` o fórmulas, se detiene y se consulta.
> Base: commit `49be3b4`. Referencias: [UX_AUDIT.md](UX_AUDIT.md) · [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) · [PRODUCT_SPEC.md](PRODUCT_SPEC.md)

## Decisiones tomadas

- **Marca (05/10/2026):** gallo completo de los remitos (`logo-pollito.png`) en toda la interfaz e íconos. Ver DESIGN_SYSTEM §2.
- **Prototipo de referencia:** [`prototipo/index.html`](prototipo/index.html), con capturas en `prototipo/capturas/`. Se aplica a la app solo con aprobación.

## Reglas de trabajo

- Una rama `redisenio-2026`, un commit por ticket; sin publicar ni desplegar.
- Antes y después de cada ticket: `npm test` (136 en verde) y capturas del ticket.
- Prohibido `!important` nuevo salvo el bloque `prefers-reduced-motion` existente.
- Sin dependencias nuevas.

## Prerrequisito de pruebas

`npm run test:e2e` y `npm run test:a11y` necesitan el navegador de Playwright, hoy ausente (`chromium_headless_shell-1243`). Opciones: `npx playwright install chromium` (descarga ~150 MB, pedir permiso) o lanzar con `channel: "msedge"` (Edge del sistema, ya usado para las capturas de esta auditoría).

## Tickets

| ID | Problema | Archivos | Depende | Solución | Aceptación | Validación | Riesgo |
|---|---|---|---|---|---|---|---|
| **RD-00** Línea base | Sin mediciones de tarea, bundle ni Axe | `scripts/` (script nuevo de capturas, basado en el usado en esta auditoría), `docs/redesign/baseline/` | — | Capturas 360/390/768/1024/1440 de todas las rutas con datos de prueba sembrados por API en base `:memory:`; `npm run build` y tamaños gzip; Axe; cronometrar las 3 tareas de PRODUCT_SPEC §2 | Tabla de línea base completa en PRODUCT_SPEC §2 | Archivos en `baseline/` | Bajo |
| **RD-01** Tokens | 2 vocabularios, 632 HEX, contrastes D-07 | nuevo `src/styles/tokens.css`; `main.jsx` (orden de import); bloques `:root` de `styles.css:6-17`, `styles-2026.css:16-68`, `styles-ui.css` | RD-00 | Tokens de DESIGN_SYSTEM §3 + alias de compatibilidad; borrar `:root` viejos; `theme-color` en `index.html` y manifest | Ninguna pantalla cambia de layout; rojos unificados en `#A81A1A`; placeholders ≥ 4,5:1 | Capturas antes/después; `npm test` | Medio: cambios de color masivos → revisar cada ruta |
| **RD-02a** Logo en interfaz | D-02 | `App.jsx` (`SideRail`, `staff-bar`, `NotFound`), `Access.jsx`, `Login.jsx` | RD-01 | Gallo completo según DESIGN_SYSTEM §2; quitar `icon.svg` del shell | UX-02 | Captura junto al PDF de remito | Bajo |
| **RD-02b** Íconos PWA | Ícono genérico instalado | `scripts/assets.mjs`, `public/icon-*.png`, `public/icon.svg`, `index.html`, manifest | RD-02a | Generar desde `logo-pollito.png` completo sobre blanco; cambiar `CACHE` lo hace el build (`__BUILD_ID__`) | Ícono nuevo tras reinstalar; **no se borran colas ni datos locales** | Instalar en Android de prueba | Medio: caché de íconos del sistema |
| **RD-03** Base de campos y foco | Especificidad (0,2,1) de la regla global; margen 7px; 3 reglas de foco; D-09 | `styles-2026.css:202`, `styles-ui.css:989`, `styles.css:37-80`, `:1838` | RD-01 | Reescribir con `:where()`; margen a `.field`; una regla de foco; quitar `:active` gris | Inputs de toda la app con el mismo alto por breakpoint; foco visible en Tab | Recorrido con teclado en 4 pantallas | Medio: campos que dependían del margen |
| **RD-04** `SearchField` | D-01 | nuevo `src/components/SearchField.jsx`; `styles/components.css`; `Weighing.jsx:441`, `Customers.jsx:123`, `QuickOrder.jsx:553`, `Operations.jsx:268`, `Catalog.jsx:135`; acotar `styles-roles.css:1099-1120,1270-1290` a `.address-search` | RD-03 | Componente de DESIGN_SYSTEM §5.3; cada pantalla conserva su `value/onChange/onKeyDown/ref` | UX-01 en las 5 pantallas; buscador de direcciones intacto | E2E nueva `buscadores` (escribir, limpiar, Esc, Enter en Cargar pedido); captura | Bajo |
| **RD-05** Shell y navegación | D-03; vidrio; rail claro | `App.jsx` (`StaffShell`, `SideRail`, `TabBar`, `app-head`), `ui.jsx` (`PageHead` → sin `<h1>` cuando hay cabecera), CSS de rail/tabbar | RD-02a | Panel negro, cabecera de contexto con único `<h1>`, títulos para carga/día/precios en el mapa de secciones (solo nombres, no rutas nuevas) | Un `<h1>` por ruta; mismas rutas visibles por rol | E2E roles + `permisos-repartidor.test.mjs` | Medio: `PageHead` lo usan muchas páginas |
| **RD-06** Botones, badges, cifras | Variantes dispersas | `styles/components.css`; `ui.jsx` (`StatusBadge`, nuevo `Figure`) | RD-03 | DESIGN_SYSTEM §5.2, §5.8, §5.9 | Botón primario único por vista; estados con texto | Capturas | Bajo |
| **RD-07** Pedidos y detalle | Lectura de la lista | `Operations.jsx`, `OrdersList.jsx`, `OrderCard.jsx`, `OrderDetail.jsx` | RD-04..06 | Métricas en una fila; tabla densa; tarjeta móvil; lista+detalle ≥ 1440 (el detalle reutiliza la fila desplegada existente) | UX-03, UX-04 | Capturas 360/1440 con 50 pedidos de prueba; nombres largos; importes de 8 cifras | Medio |
| **RD-08** Cargar pedido | D-05 | `QuickOrder.jsx`, CSS `.qo-*` | RD-04 | Grilla de 2 columnas + resumen; ícono en línea con etiqueta; barra fija móvil | UX-05; Ctrl+Enter y Enter intactos | E2E de carga existente | Medio |
| RD-08b *(opcional)* | Sin borrador | `QuickOrder.jsx` | RD-08 + aprobación | `sessionStorage` del formulario | — | — | Comportamiento nuevo |
| **RD-09** Pesaje | Jerarquía bruto/tara/neto | `Weighing.jsx` (solo JSX/clases), CSS `.weigh-*`, `.floor-*` | RD-04, RD-06 | Wireframe PRODUCT_SPEC §8.5; estados de cola §5.12 | UX-06, UX-08 | `pesaje*.test.mjs`, `outbox-confiabilidad.test.mjs`, `scripts/verify-pesaje-offline.mjs`; teléfono real | **Alto**: pantalla de piso; no tocar handlers |
| **RD-10** Carga del camión | D-08 | `TruckLoading.jsx` (JSX), CSS | RD-05 | Título y subtítulo; estados de cola | Encabezado correcto; «Cerrar camión» intacto | E2E carga | Medio |
| **RD-11** Entrega y cobro | Bloques mezclados | `Delivery.jsx`, `Modals.jsx` (`delivery`/`return`, ~líneas 1150-1300), `PaymentPanel.jsx`, `CajasBox.jsx`, `Receipts.jsx` | RD-06 | Bloques Dinero / Cajas / Comprobantes; botón con motivo | UX-07 | `cajas-entrega`, `entrega-lote`, `receipt-evidence` tests; teléfono real | **Alto**: cobros |
| **RD-12** Clientes, Imprimir, Equipo, Día, Precios, Ayuda, portal | D-04, consistencia | `Customers.jsx`, `PrintHub.jsx`, `Print.jsx`, `Team.jsx`, `DaySheet.jsx`, `PriceLists.jsx`, `Help.jsx`, páginas de cliente | RD-05, RD-06 | Encabezado único, tablas, tokens | UX-10 | Capturas; E2E modo completo | Bajo |
| **RD-13** Limpieza de CSS | 6 hojas, alias | `src/styles*.css` | RD-01..12 | Borrar reglas muertas y alias; mover a `styles/` por dominio; cortes a 480/768/1024/1440 | ≤ 40 HEX fuera de tokens; CSS gzip ≤ 28,1 kB | `npm run build`; capturas completas | Medio |
| **RD-14** QA y documentos | Docs contradictorios | `DESIGN.md`, `README.md:64,87`, `design-contract.md` | RD-13 | `DESIGN.md` → puntero a este sistema; corregir README; marcar históricos | Sin dos contratos visuales | Lectura | Bajo |

## QA de cierre

1. `npm run build` · `npm test` · `npm run test:e2e` · `npm run test:a11y` — reportar salida real.
2. Capturas antes/después: todas las rutas × 360/390/768/1024/1440, roles admin y repartidor, modo equipo; modo completo para el portal.
3. Casos de borde: nombre de cliente de 60 caracteres, pedido con 15 productos, importe `$ 12.345.678`, lista vacía / cargando / error, red lenta (DevTools «Slow 3G»), sin conexión en Pesaje y Carga.
4. Teclado: Tab por shell, buscador, formulario de Cargar pedido, diálogo de entrega; Esc cierra; foco vuelve.
5. Zoom 200 % en 1280 px.
6. Service worker: tras el build, la versión nueva se instala sin perder `pc-outbox` (probar con una pesada pendiente).
7. Comparar bundle y tiempos de tarea contra RD-00. No afirmar «más rápido» sin esa comparación.
