# Especificación de producto — Rediseño UX/UI 2026

> Qué ve y qué hace cada persona en cada pantalla después del rediseño. **El rediseño cambia presentación, no reglas.**
> Visual: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) · Evidencia: [UX_AUDIT.md](UX_AUDIT.md) · Tickets: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## 1. Problema

La app funciona y sus reglas están probadas (136 pruebas de dominio en verde), pero su presentación acumula seis hojas CSS (10.639 líneas, 632 colores literales, dos vocabularios de tokens), buscadores con doble contorno, dos títulos por pantalla, un ícono genérico en lugar del logo del negocio y contrastes por debajo de WCAG en ayudas y bordes de campos. El resultado se percibe informal y cuesta más leer pedidos, kilos e importes de un vistazo.

## 2. Objetivos y métricas

| Objetivo | Medición | Línea base | Meta |
|---|---|---|---|
| Encontrar un pedido | Tiempo desde abrir Pedidos hasta abrir el pedido buscado (N° o cliente), 5 búsquedas, 360 px y 1440 px | **A medir en RD-00** | Igual o menor que la línea base; sin errores de toque |
| Pesar una caja | Tiempo desde elegir pedido hasta «Guardar pesada», 10 pesadas en el teléfono real | A medir en RD-00 | Igual o menor |
| Cargar pedido telefónico | Tiempo para un pedido de 3 productos | A medir en RD-00 | Igual o menor |
| Consistencia | Colores literales en CSS fuera de `tokens.css` | 632 | ≤ 40 (solo PDF/ilustraciones) |
| Accesibilidad | Violaciones Axe (serias/críticas) en rutas de equipo | A medir (`test:a11y` no corrió: falta navegador) | 0 |
| Rendimiento | CSS principal gzip / JS principal gzip (`dist/` del 01/10/2026) | 28,1 kB / 138,4 kB | CSS ≤ 28,1 kB; JS sin aumento > 2 kB |

No se declara ninguna mejora porcentual hasta medirla.

## 3. Alcance

**Incluye:** tokens, logo en la interfaz, `SearchField`, campos, botones, navegación, encabezados, pedidos (lista y detalle), cargar pedido, pesaje, carga del camión, entrega/cobro, clientes, imprimir/documentos, equipo, login de equipo, ayuda; portal de clientes solo con tokens y logo (modo `completo`).

**Excluye:** cambios de API, base de datos, autenticación, permisos, estados de pedido, precios, fórmulas de importe/tara/neto/saldos/cajas, contenido y composición de los PDF, reactivar rutas retiradas (Documentos, Movimientos) o accesos del repartidor, cobros offline, mapas, tracking nuevo, pagos nuevos, migración nativa, servicios externos, publicar o desplegar.

## 4. Usuarios, roles y modos

| Rol | Producción (`APP_MODE=equipo`) | Rutas (código, `App.jsx`) |
|---|---|---|
| Administración | Sí | `/operacion` y subrutas, `/imprimir`, `/ayuda` |
| Repartidor / preventista | Sí | `/reparto`, `/reparto/clientes`, `/ayuda` — **nada más** (PC-023) |
| Cliente | **No** (portal apagado; todo va a `/admin`) | `/`, `/pedidos`, `/seguimiento`, `/cuenta`, `/planes`, `/ingresar` solo en `completo` |

La navegación muestra exactamente las rutas que hoy muestra `seccionesDe(role)`; el rediseño no agrega ni quita destinos.

## 5. Mapa de pantallas

```
/admin (Ingreso del equipo)
 ├─ Administración
 │   ├─ Operación del día: Pedidos · Cargar pedido · Pesaje · Clientes
 │   ├─ Gestión: Imprimir · Revisar entregas · Equipo
 │   └─ Por URL/enlaces internos: Carga del camión · Nota del día · Listas de precios · /imprimir
 └─ Repartidor: Mis entregas · Clientes
```

## 6. Reglas que se preservan (P0)

- Contratos de `/api/*`, cookies de sesión, `store.jsx`, `outbox.js`, `pending.js`, `sync.js`: **sin cambios**.
- Estados de pedido: recibido → preparando → en camino → entregado; cancelado.
- Importe: lo calcula el servidor; la interfaz lo muestra. Ninguna cifra nueva se calcula en componentes visuales.
- Pesaje: `tara_total = cajas × config.tare` (1,7 kg por defecto); en bolsa sin tara; id de operación estable para idempotencia.
- Cajas en la entrega: saldo anterior + le dejamos − nos entrega = queda; devolver más que lo dejado sí; saldo a favor no.
- Remito: deuda en rojo, a favor en verde descontado del total.
- Repartidor: transferencia y cheque exigen foto; la entrega no se cierra sin al menos una foto.

## 7. Conectividad (comprobado en código)

| Acción | Sin conexión | Estado visible |
|---|---|---|
| Pesar / anular pesada | Se guarda en el teléfono (`pc-outbox`) y se envía sola | Guardado en este teléfono → Pendiente de enviar → Sincronizado / Requiere revisión |
| Carga del camión (marcar cargado, cerrar camión) | Ídem | Ídem |
| Cargar pedido | **Requiere conexión** | Botón «Cargar pedido» deshabilitado con «Sin conexión: el pedido no se puede guardar todavía» |
| Completar entrega / cobro / fotos | **Requiere conexión** | Botón deshabilitado con el motivo; no se promete cobro offline |
| Consultar pedidos, clientes | Lo último cargado (service worker) | Banda «Sin conexión · datos de las HH:MM» si el store expone la hora; si no, solo «Sin conexión» |

Nunca se muestra «Guardado» con tilde verde para algo que solo está en el teléfono.

## 8. Pantallas

Formato por pantalla: información visible · acción principal · secundarias · estados · permisos · escritorio / móvil.

### 8.1 Ingreso del equipo (`/admin`)

- **Visible:** gallo completo de los remitos (240 px escritorio, 200 px móvil), «Ingreso del equipo», Usuario, Contraseña, aviso de bloqueo por intentos. Se retira el pollito genérico.
- **Acción:** «Ingresar». **Errores:** debajo del campo, con ícono; el de credenciales arriba del botón.
- **Escritorio:** foto/video de fondo actual atenuado, tarjeta 440 px. **Móvil:** sin video (ahorra datos), tarjeta a ancho completo.

### 8.2 Pedidos (`/operacion`)

- **Visible:** encabezado con fecha de reparto y 3 cifras compactas (Pedidos abiertos · Por cobrar · Envases en la calle) en una fila; buscador; filtros; lista.
- **Acción principal:** «Cargar pedido». **Secundarias:** Imprimir, Publicar noticia, Filtros, marcar Cargado, Abrir.
- **Búsqueda:** mismos campos que hoy (N°, cliente, teléfono, dirección, preventista) y mismo filtrado en `Operations.jsx`. Hoy el texto buscado **no** va a la URL; se conserva así. Llevarlo a `?q=` (con `replace`, sin ensuciar el historial) queda como ticket opcional RD-05b, porque es comportamiento nuevo. Filtros existentes sin cambios.
- **Estados:** cargando (5 filas esqueleto), vacío sin búsqueda («No hay pedidos para el 05/10/2026» + «Cargar pedido»), sin resultados («Ningún pedido coincide con "…"» + «Limpiar búsqueda»), error (banda + Reintentar).
- **Permisos:** solo admin.

**Escritorio ≥ 1440 px** — lista + detalle:

```
┌ Panel negro ─┬──────────────────────────────────────────────────────────────────────────────┐
│ [cinta logo] │ Pedidos                                    05/10/2026 ▾   [Imprimir] [+ Cargar pedido] │
│              │ 42 abiertos · $ 1.284.300 por cobrar · 318 envases en la calle                        │
│ OPERACIÓN    ├──────────────────────────────────────────────┬───────────────────────────────┤
│ ▌Pedidos  42 │ [🔍 Buscar pedidos              ×] [Filtros 2]│ #1043 · Almacén Don Pepe      │
│  Cargar      │ Todos · Mañana · Tarde                        │ En preparación · Franco       │
│  Pesaje      │ N°   Cliente        Kg     Importe  Estado  ☐ │ ─────────────────────────────  │
│  Clientes    │ 1043 Don Pepe       38,2  184.300  Prep.   ☑ │ 3 cajas pollo     38,2 kg      │
│ GESTIÓN      │ 1044 Granja Sur     a pesar   —    Recib.  ☐ │ Total           $ 184.300      │
│  Imprimir    │ …                                             │ Saldo anterior  Debe $ 12.000  │
│  Entregas    │                                               │ [Editar] [Remito] [Entregar]   │
│  Equipo      │                                               │                               │
└──────────────┴──────────────────────────────────────────────┴───────────────────────────────┘
```

Entre 1024 y 1439 px: solo tabla; «Abrir» despliega la fila (comportamiento actual).

**Móvil 360–767 px:**

```
┌──────────────────────────────┐
│ [cinta]                  (M) │
│ Pedidos · 05/10              │
│ 42 abiertos  $1,28 M  318 env│  ← una fila, desplazable si no entra
│ [🔍 Buscar pedidos        ×] │
│ [Filtros 2]  Todos·Mañ·Tarde │
│ ┌──────────────────────────┐ │
│ │#1043 Don Pepe   [Prep.]  │ │
│ │Palmira · Franco          │ │
│ │3 cajas · 38,2 kg $184.300│ │
│ │☐ Cargado    [Ver pedido▾]│ │
│ └──────────────────────────┘ │
│        [+ Cargar pedido]     │  ← flotante sobre la barra, no la tapa
├──────────────────────────────┤
│ Pedidos Nuevo Pesaje Clien Más│
└──────────────────────────────┘
```

### 8.3 Detalle de pedido (modal `order-detail` / fila abierta)

- **Visible:** N°, cliente, estado, preventista(s), turno, productos con unidad pedida (cajas o kg) y neto pesado, total, pago, saldo anterior (Debe/A favor), envases, notas, comprobantes.
- **Acción principal:** de las acciones que el detalle ya ofrece para cada estado, se destaca una como botón primario (p. ej. «Confirmar entrega» en `OrderDetail.jsx:325`); no se agregan acciones ni atajos nuevos.
- **Secundarias:** Editar, Precios, Cancelar (danger, con confirmación), Compartir, Imprimir ticket.
- **Móvil:** hoja inferior, acciones pegadas abajo.

### 8.4 Cargar pedido (`/operacion/nuevo`)

- **Visible:** Cliente (buscador con sugerencias), Fecha de reparto, Turno, Vehículo, Preventista, Segundo preventista, Zona, Pago, Remito; tabla de productos (Producto · Unidad · Cantidad · Precio); resumen.
- **Acción:** «Cargar pedido» (Ctrl+Enter conservado). **Secundarias:** «Limpiar», «¿Cliente nuevo? Crealo acá».
- **Errores:** al lado de cada campo (cliente sin elegir, cantidad 0). El importe dice «a confirmar con el pesaje» cuando corresponde (texto actual `QuickOrder.jsx:474`).
- **Borrador:** hoy **no existe**. Se propone como ticket opcional RD-08b (guardar en `sessionStorage` el formulario sin enviar, borrar al confirmar). Requiere aprobación porque agrega comportamiento; no forma parte del rediseño base.

```
Escritorio ≥ 1024
┌─────────────────────────────────────────────────────────────────────┐
│ Cargar pedido                                            [↺ Limpiar] │
├─────────────────────────────────┬───────────────────────────────────┤
│ CLIENTE                         │ RESUMEN                           │
│ Buscar cliente                  │ Almacén Don Pepe · Palmira        │
│ [🔍 Apodo, zona, razón social ×]│ Saldo anterior   Debe $ 12.000    │
│ ¿Cliente nuevo? Crealo acá      │ ─────────────────────────────     │
│ ENTREGA                         │ 3 cajas pollo                     │
│ 📅 Fecha        ⏱ Turno         │ 10 kg alas                        │
│ [05/10/2026 ]  [Según cliente▾] │ Importe: a confirmar con pesaje   │
│ 🚚 Vehículo     👤 Preventista   │                                   │
│ [Sin vehículo▾][Asignar después▾]│ [ Cargar pedido  Ctrl+Enter ]    │
│ PRODUCTOS                       │                                   │
│ Producto     Unidad  Cant. Precio│                                  │
│ Pollo entero [cajas▾] [ 3] $…    │                                  │
└─────────────────────────────────┴───────────────────────────────────┘
Móvil: una columna, resumen como barra fija inferior con total y botón.
```

### 8.5 Pesaje (`/operacion/pesada`)

- **Lista:** fecha, filtros de turno (Todos/Mañana/Tarde), Preventista, Estado de pesada, buscador, tarjetas por pedido con N°, cliente, cajas pedidas, avance («2 de 3 cajas»), estado de cola.
- **Pesando un pedido:** producto elegido, cantidad de cajas juntas, **Peso bruto**, tara, **Peso neto** destacado, «Guardar pesada»; debajo, cajones ya pesados (bruto → neto) con «Anular».
- **Estados de cola:** ver §7. «Requiere revisión» con el motivo del servidor y acciones existentes (Reintentar / Descartar).
- **Permisos:** solo admin (el repartidor ya no pesa; PC-023).

```
Móvil — pesando
┌──────────────────────────────┐
│ ← #1043 · Don Pepe           │
│ Franco · Palmira · tara 1,7  │
│ ☁ 2 pendientes · enviando…   │  ← estado honesto de la cola
│ Producto: [Pollo entero   ▾] │
│ Listo: 1 de 3 cajas · 12,6 kg│
│ Cajas juntas   [ − 2 + ]     │
│ Peso bruto total de 2 cajas  │
│ [        28,8          kg ]  │  ← 40 px, teclado propio
│ − 3,4 kg tara (2 × 1,7)      │
│ ┌──────────────────────────┐ │
│ │ PESO NETO      25,4 kg   │ │  ← bloque oscuro --c-dark, cifra 40 px
│ │ 12,7 kg por caja         │ │
│ └──────────────────────────┘ │
│ [     Guardar pesada       ] │
│ Pesadas: #1 bruto 14,3 → 12,6│
└──────────────────────────────┘
Escritorio: lista de pedidos a la izquierda (380 px), panel de pesada a la derecha.
```

Se unifica el nombre: «Pesaje» en navegación y título (hoy «Pesada.»).

### 8.6 Carga del camión (`/operacion/carga`)

- **Título:** «Carga del camión» (no el vehículo); subtítulo «Toyota Hino A974NR · 05/10/2026 · Franco + Maxi · salida 07:30».
- **Visible:** vehículo, fecha, preventistas (máx. 2), hora de salida, lista de pedidos con casilla Cargado, cajones arriba / total, kg.
- **Acción:** «Cerrar camión». Usa la cola offline (§7).

### 8.7 Entregas (`/reparto` y `/operacion/entregas`)

- **Visible:** cifras (Entregas pendientes · Kilos a repartir · Cobrado hoy), filtros Para entregar / Entregados, tarjetas de pedido, «Clientes con saldo o envases».
- **Completar entrega (modal `delivery`):** tres bloques separados — **Dinero** (total, cobrado por método, saldo), **Cajas** (saldo anterior, le dejamos, nos entrega, saldo que queda), **Comprobantes** (fotos). Botón «Confirmar entrega» deshabilitado con el motivo mientras falte la foto o la conexión.
- **Permisos:** el repartidor ve solo sus pedidos (lo filtra el servidor); el segundo preventista gestiona igual que el principal (commit `49be3b4`).

```
Móvil — Completar entrega
┌──────────────────────────────┐
│ Completar entrega        ✕   │
│ #1043 · Almacén Don Pepe     │
│ DINERO                       │
│ Total del pedido   $ 184.300 │
│ Saldo anterior  Debe $ 12.000│
│ Cobra  [Efectivo ▾] [$     ] │
│ + Otro medio (mixto)         │
│ Queda           Debe $ 0     │
│ CAJAS                        │
│ Saldo anterior          8    │
│ Le dejamos       [ − 3 + ]   │
│ Nos entrega      [ − 5 + ]   │
│ Saldo que queda         6    │
│ COMPROBANTES                 │
│ [📷 Foto del remito firmado] │
│ ⚠ Falta la foto del remito   │
├──────────────────────────────┤
│ [   Confirmar entrega      ] │  ← pegado abajo, sobre safe area
└──────────────────────────────┘
```

### 8.8 Clientes (`/operacion/clientes`, `/reparto/clientes`)

- Un solo título («Clientes» + «120 fichas · 3 por revisar»); se quita la tarjeta envolvente (D-04).
- Buscador (apodo, razón social, CUIT, teléfono), Filtros, «Nuevo cliente» (primario), Plantilla e Importar Excel (secundarios, solo admin como hoy).
- Escritorio: tabla (Cliente · Zona · Modalidad · Saldo · Envases · Preventista). Móvil: tarjetas con saldo «Debe/A favor» y envases.

### 8.9 Imprimir y documentos (`/operacion/imprimir`, `/imprimir`)

- Título «Imprimir», fecha como control; tarjetas por documento (Hoja de pedidos, Hoja de ruta, Hoja de viaje, Remitos, Rendición) con «Ver», «Descargar», «Compartir».
- Vista previa: barra superior con Volver + acciones; PDF sin cambios.

### 8.10 Equipo, Nota del día, Listas de precios, Ayuda

Solo tokens, encabezado único, tablas según §5.7 del sistema. Sin cambios de flujo.

### 8.11 Portal de clientes (solo `APP_MODE=completo`)

Tokens, logo y `SearchField` en Catálogo. Sin rediseño de flujo. Verificado por la E2E existente.

## 9. Requisitos y criterios de aceptación

| ID | Requisito | Criterio verificable |
|---|---|---|
| UX-01 | Unificar buscadores | En las 5 pantallas de D-01, `getComputedStyle(input).borderTopWidth === "0px"` y el contenedor tiene 1 borde; foco visible; × limpia y devuelve el foco; Esc limpia; búsqueda por los mismos campos que hoy (test E2E) |
| UX-02 | Logo original | Ninguna `<img src="/icon.svg">` en shell de equipo/login; los `<img>` del logo apuntan a `public/brand/logo-*.png` con `width/height` reales; captura comparada con el PDF |
| UX-03 | Pedidos legibles | A 360 px: N°, cliente, estado e importe visibles sin desplegar; `scrollWidth ≤ innerWidth` |
| UX-04 | Detalle progresivo | Productos, cobros y acciones secundarias alcanzables en ≤ 1 toque desde la tarjeta |
| UX-05 | Cargar pedido | Etiquetas e íconos en una línea; controles de la misma fila con el mismo alto; error junto al campo |
| UX-06 | Pesaje | Bruto, tara y neto con etiqueta y unidad; `npm test` (pesaje, pesaje-pendientes, outbox) en verde sin modificar pruebas |
| UX-07 | Entrega y cobro | Dinero, cajas y comprobantes en bloques separados; validaciones actuales intactas (`cajas-entrega.test.mjs`, `entrega-lote.test.mjs`) |
| UX-08 | Conectividad honesta | Con red cortada (DevTools offline) una pesada muestra «Guardado en este teléfono / Pendiente», nunca «Todo guardado en el servidor» |
| UX-09 | Navegación por rol | Repartidor ve exactamente Mis entregas, Clientes, Ayuda, Salir (`permisos-repartidor.test.mjs` + E2E) |
| UX-10 | Consistencia | Un `<h1>` por pantalla; ≤ 40 HEX fuera de `tokens.css`; Axe 0 serias/críticas en rutas de equipo |
| UX-11 | Contraste | Texto ≥ 4,5:1, bordes de control ≥ 3:1 (tabla de DESIGN_SYSTEM §3.1) |
| UX-12 | Responsive | Sin pérdida de acciones a 360, 390, 768, 1024, 1440 y zoom 200 % |
