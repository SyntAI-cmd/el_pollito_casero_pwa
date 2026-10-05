# Sistema de diseño — El Pollito Casero (2026)

> Contrato visual implementable. Reemplaza a `DESIGN.md` y al bloque de tokens de `src/styles-2026.css` cuando se ejecute el plan.
> Evidencia y defectos: [UX_AUDIT.md](UX_AUDIT.md). Comportamiento: [PRODUCT_SPEC.md](PRODUCT_SPEC.md).

## 1. Dirección elegida

Se compararon tres direcciones una sola vez para todo el sistema:

| | A · Operativo claro | B · Panel oscuro | C · Editorial cálido (actual `DESIGN.md`) |
|---|---|---|---|
| Base | Gris claro `#F2F2F2`, paneles blancos, navegación negra `#141416`, rojo institucional solo en acción y selección | Fondo negro general, tarjetas grises, rojo y blanco como acentos (Crypto Wallet) | Fondo crema `#f8f7f4`, serif itálica en títulos, títulos de 32–54 px |
| Legibilidad al sol / galpón | Alta | Baja: reflejos, pantallas con brillo bajo | Media |
| Densidad para listas de 50+ pedidos | Alta | Media | Baja (títulos y aire editoriales) |
| Identidad del logo (cinta roja/negra sobre blanco) | El logo se apoya en blanco, como en los PDF | El logo pide una placa blanca | Correcta, pero la serif compite con la cinta |
| Costo de migración | Bajo: el CSS ya es claro | Alto: invierte todo | Nulo, pero no resuelve nada |
| **Decisión** | **Elegida** | Descartada | Descartada |

**A** gana porque el trabajo es diurno y de piso (balanza, camión, puerta del cliente), la cinta del logo es negra y roja sobre blanco, y ya es la base del CSS actual. Del oscuro de B se conserva solo la **navegación lateral negra** y superficies puntuales de resumen (total del pedido, cifra de neto).

### Principios

1. **El dato manda.** Kilos, cajas e importes son lo más grande y legible de cada bloque; los adornos no compiten con ellos.
2. **Un borde, una función.** Solo se dibuja borde cuando delimita un control o separa grupos. Nunca dos bordes concéntricos.
3. **El rojo significa marca o acción.** No es el único indicador de error ni de deuda: siempre va con texto e ícono.
4. **Honestidad de estado.** Lo guardado en el teléfono no se muestra como guardado en el servidor.
5. **Misma pieza, mismo aspecto.** Un buscador, un botón primario, una tarjeta de pedido: una sola implementación.

## 2. Logo

**Decisión del dueño (05/10/2026):** la marca principal es el **gallo completo con la cinta** — `public/brand/logo-pollito.png` (1180×800, 1,475:1, PNG con transparencia), el mismo que imprime el remito (`RemitoPdf.jsx:283` usa su reducción `logo-pollito-print.png`). Se usa en todas las superficies, incluidos favicon e íconos de la app instalada. No se recorta, no se redibuja y no se combina con el pollito genérico de `icon.svg`, que se retira.

| Lugar | Presentación | Tamaño |
|---|---|---|
| Panel lateral (escritorio) | Placa blanca (radio 12) arriba del panel negro, con «Administración» / «Reparto» debajo | 196 × 133 |
| Cabecera del celular | Sobre blanco, a la izquierda | alto 52 (≈ 77 × 52) |
| Login del equipo | Centrado sobre la tarjeta | 240 × 163 (móvil 200 × 136) |
| Página 404, instalación | Centrado | 200 × 136 |
| Ícono PWA `icon-512.png` / `icon-192.png` | Logo completo centrado sobre cuadrado blanco, margen 10 % (`purpose: any`); versión `maskable` con margen 20 % para la zona segura | 512 / 192 |
| Favicon / `apple-touch-icon` | Mismo logo completo sobre blanco | 32–180 |
| PDF | Sin cambios (`-print`) | — |

- Como el PNG es transparente con trazos negros, **siempre va sobre blanco** (por eso la placa en el panel negro).
- Área de protección: 8 % del ancho del logo en los cuatro lados.
- `<img>` siempre con `width="1180" height="800"` y alto/ancho por CSS, para reservar espacio y no deformar.
- A 16–32 px el logo completo pierde detalle: es aceptado por decisión del dueño; se genera con `sharp` (`fit: contain`, fondo `#FFFFFF`) en `scripts/assets.mjs`.

## 3. Tokens

### 3.1 Color

El rojo del logo escaneado mide `#951A1B–#9B1C1E`. Para pantalla se toma **`#A81A1A`**: misma familia, un punto más luminoso para que no se lea marrón en LCD, y 7,43:1 sobre blanco (AAA). Reemplaza `#c9262e`, `#cc242a`, `#a71825`, `#a91b25` y `#a81f26`.

| Token | HEX | Uso | Contraste verificado |
|---|---|---|---|
| `--c-brand` | `#A81A1A` | Botón primario, selección, indicador activo, enlaces de acción | 7,43 sobre `#FFF`; 6,63 sobre `#F2F2F2` |
| `--c-brand-hover` | `#891515` | Hover/pressed del primario | 9,63 sobre `#FFF` |
| `--c-brand-tint` | `#FDF2F2` | Fondo de fila/navegación seleccionada | Texto `--c-brand` encima: 6,78 |
| `--c-accent` | `#E63D3A` | Solo gráficos no textuales: punto de notificación, indicador de pestaña sobre negro | 4,46 sobre `#141416` (≥ 3 para no-texto). **Nunca texto sobre blanco** (4,12) |
| `--c-text` | `#141416` | Texto, títulos, cifras | 18,4 sobre `#FFF` |
| `--c-text-2` | `#52525B` | Ayudas, metadatos, placeholders | 7,73 sobre `#FFF`; 6,90 sobre `#F2F2F2` |
| `--c-canvas` | `#F2F2F2` | Fondo general | — |
| `--c-panel` | `#FFFFFF` | Formularios, listas, tarjetas | — |
| `--c-panel-2` | `#FAFAFA` | Cabecera de tabla, fila par, zona de totales | — |
| `--c-dark` | `#141416` | Panel lateral, bloque de total/neto | Blanco 18,4; `#A1A1AA` 7,18 |
| `--c-dark-2` | `#232327` | Hover en panel lateral | — |
| `--c-line` | `#E4E4E7` | Separadores decorativos (filas, secciones) | No requiere 3:1 |
| `--c-control` | `#71717A` | Borde de campos, casillas, selects | 4,83 sobre `#FFF`; 4,32 sobre `#F2F2F2` (≥ 3 ✓) |
| `--c-ok` / `--c-ok-bg` | `#166534` / `#EDF7F0` | Entregado, sincronizado, cobrado completo | 7,13 / 6,51 |
| `--c-warn` / `--c-warn-bg` | `#92400E` / `#FDF4E6` | Pendiente de envío, falta pesar, saldo a revisar | 7,09 / 6,50 |
| `--c-error` / `--c-error-bg` | `#B91C1C` / `#FDF2F2` | Errores de validación y de servidor | 6,47 / 5,90 |
| `--c-info` / `--c-info-bg` | `#1E40AF` / `#EFF4FF` | En camino, información neutra | 8,72 / ≥ 7 |

Error y marca son rojos cercanos: por eso **todo error lleva ícono (`CircleAlert`) y texto**, y toda deuda lleva la palabra «Debe» además del color (regla ya aprobada en remitos: deuda roja, a favor verde).

`theme-color` del manifest e `index.html`: `#141416` (coincide con la barra lateral y la barra de estado del teléfono). `background_color`: `#F2F2F2`.

### 3.2 Tipografía

DM Sans (ya instalada vía `@fontsource`, pesos 400/500/600/700). Se **elimina Instrument Serif** del shell de equipo (ahorra ~41 kB de fuentes); queda disponible solo si el portal de clientes (modo completo) la reclama.

| Token | Tamaño / interlineado | Peso | Uso |
|---|---|---|---|
| `--t-display` | 32 / 38 (móvil 28 / 34) | 700 | Título de página |
| `--t-title` | 24 / 30 (móvil 20 / 26) | 700 | Sección, nombre del cliente en detalle |
| `--t-subtitle` | 18 / 24 | 600 | Título de tarjeta, encabezado de grupo |
| `--t-body` | 16 / 24 | 400 | Texto, **todos los campos** (evita zoom en iOS) |
| `--t-body-strong` | 16 / 24 | 600 | Nombre de cliente en listas |
| `--t-meta` | 14 / 20 | 400–500 | Metadatos, etiquetas de campo, celdas de tabla densa |
| `--t-caption` | 12 / 16 | 600, mayúsculas, tracking 0,04em | Encabezados de tabla y de grupo de navegación |
| `--t-figure-xl` | 40 / 44 | 700 | Neto en Pesaje, total a cobrar |
| `--t-figure` | 20 / 26 | 700 | Importes y kilos en tarjetas |

Todas las cifras: `font-variant-numeric: tabular-nums`. Kilos con una decimal (`12,4 kg`), importes con separador de miles y sin decimales salvo que existan (`$ 184.300`), según `lib/format.js`. Unidad siempre visible y en `--c-text-2`.

### 3.3 Espaciado, radios, bordes, sombras

```
Espacio:  --s-1 4  --s-2 8  --s-3 12  --s-4 16  --s-6 24  --s-8 32  --s-12 48   (px)
Radio:    --r-control 8   (botones, campos, chips de filtro)
          --r-card 12     (tarjetas, paneles, tablas)
          --r-dialog 16   (diálogos, hojas inferiores)
          --r-pill 999    (solo badges de estado y contadores)
Borde:    1px. Controles: --c-control. Separadores: --c-line. Foco: ver §5.
Sombra:   --sh-0 none                                   (paneles sobre canvas: sin sombra, con borde --c-line)
          --sh-1 0 1px 2px #1414160F                    (tarjeta elevada, barra fija)
          --sh-2 0 8px 24px -8px #14141633              (menú, popover, hoja inferior)
          --sh-3 0 24px 48px -12px #1414164D            (diálogo)
Alto táctil: --tap 44px (mínimo), --tap-lg 48px (campos y botones primarios en < 900 px)
```

Se elimina `.glass` (vidrio): cabecera y barra inferior pasan a sólidas (`--c-panel` con `--sh-1`). Los diálogos de formulario no llevan transparencia.

### 3.4 Movimiento

| Token | Valor | Uso |
|---|---|---|
| `--m-fast` | 120ms `cubic-bezier(.2,0,0,1)` | Hover, foco, cambio de color |
| `--m-base` | 180ms `cubic-bezier(.2,0,0,1)` | Desplegar tarjeta de pedido, abrir hoja inferior, toast |
| `--m-exit` | 120ms `cubic-bezier(.4,0,1,1)` | Cierres |

Se anima solo lo que explica una acción: desplegar/plegar un pedido (altura + opacidad), aparición del neto al escribir el bruto (fundido 120 ms del número, no conteo), entrada de la hoja «Más», toast. Nada en bucle salvo el indicador de «enviando…». Se conserva el bloque `prefers-reduced-motion` existente (`styles-2026.css:86`).

### 3.5 Iconografía

Lucide (`lucide-react`, ya instalado). Tamaños: 16 en campos y tablas, 18 en navegación y botones, 20 en barra inferior, 40 en estados vacíos. Trazo 2 (por defecto). Un ícono acompaña, no reemplaza, a la etiqueta; los botones solo-ícono llevan `aria-label`.

## 4. Adaptación al CSS actual

No se agrega Tailwind ni librerías. Se crea **`src/styles/tokens.css`** importado **primero** en `main.jsx`, con los tokens nuevos y **alias de compatibilidad** para que las 6 hojas existentes sigan funcionando mientras se migran:

```css
:root {
  --c-brand: #A81A1A; --c-brand-hover: #891515; --c-brand-tint: #FDF2F2;
  --c-text: #141416;  --c-text-2: #52525B;
  --c-canvas: #F2F2F2; --c-panel: #FFFFFF; --c-panel-2: #FAFAFA;
  --c-dark: #141416;  --c-line: #E4E4E7;  --c-control: #71717A;
  /* … resto de §3 … */

  /* Alias: el vocabulario viejo apunta al nuevo (se borran al terminar RD-13) */
  --red: var(--c-brand);   --rojo: var(--c-brand);   --rojo-fuerte: var(--c-brand-hover);
  --black: var(--c-text);  --tinta: var(--c-text);   --tinta-2: var(--c-text-2);
  --tinta-3: var(--c-text-2);                         /* corrige D-07 */
  --muted: var(--c-text-2); --line: var(--c-line);   --borde: var(--c-line);
  --borde-fuerte: var(--c-control);                  /* corrige D-07 */
  --fondo: var(--c-canvas); --tarjeta: var(--c-panel);
}
```

Como `styles.css` y `styles-2026.css` redefinen `:root`, el bloque de tokens de esas hojas se **borra** en el mismo ticket (no se sobrescribe con mayor especificidad). Los componentes nuevos se escriben en `src/styles/components.css`, importado **al final**, y usan `:where()` para que su especificidad sea predecible.

## 5. Componentes

### 5.1 Foco (todas las piezas)

Una sola regla, reemplaza `styles.css:71` y `styles-2026.css:79`:

```css
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--c-brand); outline-offset: 2px;
}
```

Excepción: dentro de `SearchField` y `Field` con adorno, el foco lo muestra el contenedor (§5.3).

### 5.2 Botones

| Variante | Fondo / texto / borde | Uso |
|---|---|---|
| `primary` | `--c-brand` / blanco / — | Una por vista: «Cargar pedido», «Guardar pesada», «Confirmar entrega» |
| `secondary` | blanco / `--c-text` / `--c-control` | «Imprimir», «Filtros» |
| `ghost` | transparente / `--c-text` / — | Acciones de fila, «Limpiar» |
| `danger` | blanco / `--c-error` / `--c-error` | «Anular pesada», «Salir» |
| `icon` | ghost cuadrado 44×44 | Limpiar búsqueda, plegar menú |

Alto 44 px (48 px en < 900 px), radio 8, padding 0 16, gap 8, `--t-body` 600. Estados: hover (`primary` → `--c-brand-hover`; otros → fondo `#F4F4F5`), pressed igual a hover (se **elimina** `button:active { font-weight:400; color:#696969 }` de `styles.css:80`, D-09), disabled (opacidad 0,45, `cursor:not-allowed`), loading (ícono `Loader2` girando a la izquierda, etiqueta conservada, `aria-busy="true"`, el botón no cambia de ancho).

### 5.3 SearchField

Reemplaza los cinco buscadores de la tabla D-01.

**Anatomía**

```
┌──────────────────────────────────────────────┐   ← único borde: lo dibuja el CONTENEDOR
│ [🔍]  Buscar pedidos                    [ × ] │      .sf  (1px --c-control, radio 8, alto 44/48)
└──────────────────────────────────────────────┘
  lupa 16px     input (sin borde, sin fondo,      botón limpiar 44×44 ghost,
  --c-text-2    sin margen, sin radio, sin        visible solo con texto
  aria-hidden   outline propio)
```

**API (React)**

```jsx
<SearchField
  label="Buscar pedidos"          // obligatorio: <label> visible o sr-only (prop labelHidden)
  value={q} onChange={setQ}       // controlado; no cambia la lógica de filtrado de la pantalla
  placeholder="N°, cliente, teléfono o dirección"
  onEnter={pickFirst}             // opcional (Cargar pedido elige el primer cliente)
  inputRef={searchRef}            // opcional (Cargar pedido enfoca al abrir)
  status="idle|loading|empty|error"  // opcional, solo texto auxiliar debajo
/>
```

**Neutralización local del input** — sin `!important`, ganando por especificidad explícita y no por orden de carga:

```css
.sf { display:flex; align-items:center; gap:var(--s-2); min-height:var(--tap);
      padding-inline:var(--s-3) var(--s-1); background:var(--c-panel);
      border:1px solid var(--c-control); border-radius:var(--r-control); color:var(--c-text-2); }
.sf:focus-within { border-color:var(--c-brand); box-shadow:0 0 0 3px #A81A1A29; }
/* (0,3,1): supera a la regla global input:not():not() (0,2,1) sin depender del orden de carga;
   el selector se escribe así a propósito. */
.sf input.sf-input[type] { all:unset; flex:1; min-width:0; height:100%;
      font:inherit; font-size:16px; color:var(--c-text); }
.sf input.sf-input[type]::placeholder { color:var(--c-text-2); }
.sf input.sf-input[type]::-webkit-search-cancel-button { display:none; }
.sf input.sf-input[type]:focus-visible { outline:none; } /* el foco lo pinta .sf:focus-within */
```

Y en el mismo ticket: la regla global de campos se reescribe con `:where()` (`:where(input:not([type=checkbox],[type=radio]), select, textarea)`, especificidad 0) y el `margin: 7px 0 2px` de `styles.css:1838` se mueve a `.field > input`. Las reglas `.search-field input { padding-…: …px !important }` de `styles-roles.css:1110/1288` se limitan a `.address-search .search-field`.

**Estados**

| Estado | Visual | Comportamiento |
|---|---|---|
| Reposo | Un borde `--c-control` | — |
| Hover | Borde `--c-text` | — |
| Foco | Borde `--c-brand` + anillo 3px `#A81A1A29` (temporal, no es el defecto) | — |
| Con texto | Aparece botón × | × limpia, devuelve el foco al input, anuncia «Búsqueda borrada» |
| Cargando | Lupa → `Loader2` girando | `aria-busy` en la lista asociada |
| Sin resultados | Texto bajo la lista: «Ningún pedido coincide con "…"» + «Limpiar búsqueda» | Distinto de cargando y de error |
| Error | Mensaje con ícono bajo el campo | No borra lo escrito |
| Deshabilitado | Fondo `--c-panel-2`, texto `--c-text-2` | `disabled` en el input |

**Teclado:** Tab entra al input; Esc con texto limpia (sin texto, no hace nada para no cerrar diálogos padres); Enter ejecuta `onEnter` si existe; el × es alcanzable con Tab. `type="search"`, `enterKeyHint="search"`, `autoComplete="off"`.

### 5.4 Field (input, select, textarea, fecha)

Anatomía vertical: etiqueta (`--t-meta` 500, con ícono opcional **en la misma línea**, 16 px, gap 6) → control → ayuda o error.

- Control: alto 44 (48 en < 900 px), borde `--c-control`, radio 8, `--t-body`, padding 0 12. Fecha, select y texto **miden lo mismo** (D-05).
- Error: borde `--c-error`, mensaje `CircleAlert` + texto `--c-error` debajo, `aria-invalid="true"`, `aria-describedby` al mensaje.
- Unidad dentro del control a la derecha («kg», «cajas», «$») en `--c-text-2`, como sufijo no editable.
- Campos numéricos: `inputMode="decimal"`, alineación a la derecha, cifras tabulares.

### 5.5 Filtros

Botón `secondary` «Filtros» con contador (`badge` neutro) que abre un panel en línea (escritorio) u hoja inferior (móvil). Los filtros rápidos (Todos / Mañana / Tarde; Para entregar / Entregados) son **chips segmentados**: alto 36 (44 táctil con padding), radio pill, seleccionado `--c-text` fondo y blanco texto, `aria-pressed`. «Limpiar filtros» como `ghost` cuando hay alguno activo.

### 5.6 Pedido en lista

**Escritorio (≥ 1024 px): tabla densa** — se conserva la de `OrdersList.jsx`.

| Columna | Contenido | Alineación |
|---|---|---|
| N° | `#1043` `--t-meta` 600 tabular | izq. |
| Cliente | Nombre `--t-body-strong` + zona `--t-meta --c-text-2` | izq. |
| Productos | «3 cajas pollo · 10 kg alas» truncado a 2 líneas | izq. |
| Kg | neto pesado o «a pesar» (`--c-warn`) | der. |
| Importe | `$ 184.300` o «s/precio» | der. |
| Preventista | nombre (+ segundo) | izq. |
| Pago | método | izq. |
| Estado | `StatusBadge` | izq. |
| Cargado | casilla 20 px en área táctil 44 | centro |
| — | «Abrir» ghost | der. |

Fila 52 px, separador `--c-line`, hover `--c-panel-2`, fila abierta con barra izquierda 3 px `--c-brand`. Cabecera sticky.

**Móvil (< 768 px): tarjeta desplegable** (`<details>`-like con botón).

```
┌───────────────────────────────────────────┐
│ #1043 · Almacén Don Pepe        [En prep.]│  ← N°, cliente, estado: siempre visibles
│ Palmira · Franco                          │
│ 3 cajas · 38,2 kg               $ 184.300 │  ← cifras a la derecha, tabulares
│ ☐ Cargado               [ Ver pedido ▾ ] │
├───────────────────────────────────────────┤  ← al desplegar (180 ms)
│ Productos, pago, saldo, envases, acciones │
└───────────────────────────────────────────┘
```

Una tarjeta = un panel blanco con borde `--c-line`, radio 12, padding 16; **sin tarjetas dentro de tarjetas**: el detalle desplegado usa separadores.

### 5.7 Tabla

Cabecera `--t-caption` `--c-text-2` sobre `--c-panel-2`; celdas `--t-meta`; numéricas a la derecha; contenedor `overflow-x:auto` **solo** para tablas de consulta (precios, extractos), nunca para acciones esenciales. En < 768 px las tablas operativas pasan a tarjeta.

### 5.8 Badges de estado

Cápsula, `--t-meta` 600, padding 2×8, punto de 6 px + texto (el texto siempre presente).

| Estado (`lib/format.js`) | Fondo / texto |
|---|---|
| Pedido recibido | `#F4F4F5` / `--c-text` |
| En preparación | `--c-warn-bg` / `--c-warn` |
| En camino | `--c-info-bg` / `--c-info` |
| Entregado | `--c-ok-bg` / `--c-ok` |
| Cancelado | `#F4F4F5` / `--c-text-2`, texto tachado no; ícono `X` |

### 5.9 Cifras: importes, kilos, cajas

Componente `<Figure value unit label tone />`: etiqueta arriba (`--t-meta`), valor (`--t-figure` o `--t-figure-xl`), unidad pequeña. Tonos: neutro, `debt` (rojo + «Debe»), `credit` (verde + «A favor»). Nunca se calcula en el componente: recibe lo que ya calcula la pantalla.

### 5.10 Diálogos y hojas

`dialog` nativo (ya se usa; `main.jsx` lo detecta para no recargar). Escritorio: centrado, máx. 560 px, radio 16, `--sh-3`. Móvil: hoja inferior a ancho completo, radio 16 arriba, alto máx. `calc(var(--vh) - 24px)` usando `useVisibleHeight`, barra de acciones **pegada abajo** con `padding-bottom: env(safe-area-inset-bottom)`. Cerrar con Esc y con botón «Cerrar» visible; el foco vuelve al disparador.

### 5.11 Mensajes, cargas, vacíos, errores

| Tipo | Forma |
|---|---|
| Toast (`Toast` en `App.jsx`) | Abajo centrado, `--c-dark` fondo, blanco texto, 4 s, `role="status"`. En móvil sobre la barra inferior. |
| Aviso en línea | Banda con ícono y texto en el tono correspondiente, dentro del flujo (no flotante). |
| Cargando | Esqueletos de fila con la forma final (no spinners de página entera). `Cargando…` textual solo en `Suspense`. |
| Vacío | Ícono 40 + título + una frase + acción si existe: «Nada por pesar el 05/10/2026» / «Cambiar fecha». |
| Error | Ícono `CircleAlert`, qué pasó, qué hacer, botón «Reintentar». Nunca solo color. |

### 5.12 Conexión y sincronización

Se generaliza el patrón ya presente en Pesaje (`Weighing.jsx:548`):

| Estado | Ícono | Texto | Dónde |
|---|---|---|---|
| Sin conexión (global) | `WifiOff` | «Sin conexión. Las pesadas y la carga se guardan en este teléfono; cobros y pedidos nuevos esperan señal.» | Banda en `Notices` |
| Guardado en el dispositivo | `Smartphone` | «Guardado en este teléfono» | Fila de la pesada / carga |
| Pendiente de enviar | `CloudUpload` | «3 pendientes de enviar · enviando…» | Cabecera de Pesaje y Carga |
| Sincronizado | `Check` | «Todo guardado en el servidor» | Ídem |
| Requiere revisión | `CircleAlert` | «1 pesada requiere revisión» + acción | Ídem |

Solo en Pesaje y Carga del camión (las únicas con cola). En Entrega y Cargar pedido, sin conexión el botón principal se deshabilita con el motivo visible.

### 5.13 Navegación

**Escritorio (≥ 1024 px): panel lateral negro** `--c-dark`, ancho 244 / plegado 68 (conserva `localStorage menu-plegado`). Logo cinta blanca arriba; grupos «Operación del día» / «Gestión» con `--t-caption` `#A1A1AA`; ítem 44 px, ícono 18 + texto blanco; **activo**: fondo `#FFFFFF14`, barra izquierda 3 px `--c-accent`, texto blanco 600, `aria-current="page"`. Contador de pedidos abiertos: badge `--c-accent` (no texto).

**Cabecera de contexto** (escritorio): una sola, blanca, 64 px: **el `<h1>` de la página** (se elimina el `<h1>` duplicado del `PageHead`; D-03), subtítulo de contexto (fecha, cantidad), acciones de página a la derecha.

**Móvil (< 1024 px):** cabecera 56 px con cinta (132 px) + avatar; barra inferior sólida blanca de 4 + «Más» (se conserva lógica). Activo: ícono y texto `--c-brand`, indicador 3 px arriba. Alto 64 + safe area. Se oculta al bajar y con teclado abierto (comportamiento existente).

### 5.14 Acciones de documento

Grupo de botones con ícono: «Descargar remito» (`Download`), «Compartir» (`Share2`), «Imprimir» (`Printer`). En vista previa (`/imprimir`), barra fija superior con «Volver». El contenido del PDF no cambia.

## 6. Responsive

Se reducen 16 cortes a **4**, definidos por contenido:

| Corte | Motivo |
|---|---|
| `< 480` | Teléfonos chicos (360): una columna, chips con scroll interno permitido (no son acción esencial) |
| `< 768` | Tablas operativas → tarjetas; diálogos → hojas inferiores |
| `< 1024` | Panel lateral → barra inferior; formularios a una columna |
| `≥ 1440` | Pedidos: lista + detalle lado a lado; ancho máximo de contenido 1360 |

Se verifican 360, 390, 768, 1024, 1440 y zoom 200 % (1280 px a 200 % ≈ 640 px CSS: debe comportarse como móvil sin perder acciones).

- **Teclado móvil:** campos de 16 px; al enfocar, `scrollIntoView({block:"center"})` (ya existe `ensureFieldVisible` en QuickOrder); barra inferior oculta; barras de acciones de hojas suben con `--vh`.
- **Safe areas:** `env(safe-area-inset-*)` en cabecera, barra inferior, hojas y toast (tokens `--safe-t/--safe-b` existentes).
- **Barras fijas:** el contenido reserva `padding-bottom: calc(64px + var(--safe-b) + 16px)` para que la barra inferior nunca tape el último botón.

## 7. QA visual anti-genérico (checklist de cierre)

- [ ] Ningún control muestra dos bordes concéntricos en reposo.
- [ ] Radios: solo 8 / 12 / 16 / pill, cada uno en su rol.
- [ ] El rojo aparece en ≤ 1 botón por vista; el resto de la jerarquía se hace con peso y tamaño.
- [ ] Las cifras son el elemento más grande de su bloque.
- [ ] No hay vidrio, gradientes ni sombras sobre paneles que ya tienen borde.
- [ ] Ningún error, deuda o estado se comunica solo por color.
- [ ] El logo es el gallo completo de los remitos en todas las superficies.
