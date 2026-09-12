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
