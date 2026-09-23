# Rediseño integral y corrección funcional — El Pollito Casero

Qué se cambió, qué se corrigió, cómo se probó y qué queda por decidir.

---

## 1. Errores que interrumpían el trabajo (prioridad 1)

| Problema | Qué pasaba | Cómo quedó |
| --- | --- | --- |
| **Pedidos no abría** | `Operations.jsx` usaba `orderShift()` sin importarlo: la pantalla de Pedidos tiraba `ReferenceError` al filtrar. | Importado. La pantalla abre y filtra. |
| **No se podía editar un pedido por kilos** | Al reabrir el pedido, el servidor recalculaba precios con `kg: 0` (los kilos pedidos viven en `ordered` hasta que pasa la balanza) y devolvía *"Los kilos deben ser un número válido"*. Afectaba a cambiar preventista, fecha, turno u observaciones. | `server/floor.mjs` devuelve los kilos pedidos al recalcular. Editar funciona con y sin pesada. |
| **Dos teclados en el pesaje** | El teclado de la app y el del teléfono aparecían juntos y se tapaban. | En el celular el campo va con `inputMode="none"`: el del teléfono no se abre. El de la app es un control real, con coma, borrar un dígito, **Limpiar** y **Confirmar**. Hay un enlace para volver al teclado del teléfono, la preferencia se recuerda, y en escritorio sigue andando el teclado físico. No se bloquea la selección de texto de la app. |
| **La ventana de saldos se cerraba sola** | Cada corrección se guardaba y cerraba la ventana. | Ahora se encadenan varias correcciones: cada una entra en **cambios pendientes**, con *estado anterior · cambios pendientes · resultado previsto*. Se guarda todo junto con **Guardar estado**, la ventana queda abierta y confirma. Si algo falla, lo cargado no se pierde. Cerrar con cambios pendientes pregunta *seguir editando* o *descartar*. |
| **Se duplicaban ajustes al reintentar** | Un reintento aplicaba el ajuste dos veces. | Cada guardado lleva un identificador de operación: repetirlo no vuelve a aplicar nada. |
| **La ficha del pedido mostraba datos viejos** | Cambiar el preventista guardaba bien, pero la ficha abierta seguía mostrando el valor anterior. | La ficha lee el pedido vivo del store. |
| **El preventista elegido al cargar se ignoraba** | Un preventista elegía a quién asignarle el pedido y el servidor lo descartaba en silencio. | Se respeta la elección (es lo mismo que ya permitía *Editar pedido* sobre un pedido propio o sin asignar). |
| **La barra inferior tapaba el buscador** | Con el teclado abierto, el campo y los resultados quedaban fuera de pantalla. | El buscador se fija arriba mientras se escribe, la lista se desplaza sola y elegir un cliente no cierra el teclado. |
| **El chat tapaba la barra** | El botón del chat se superponía a la navegación. | Queda por encima de la barra, y desaparece con el teclado abierto. |

---

## 2. Cajas (envases): definición y consistencia

Las cajas **no son dinero** y se llevan por separado en toda la app.

```
saldo de cajas = cajas adeudadas anteriores + cajas salientes − cajas devueltas
```

- **Anteriores**: lo que el cliente ya debía. Se **graba en el pedido** al confirmar la entrega (`boxBalanceBefore`), así queda el corte real y no un número deducido por resta.
- **Salientes**: cajas entregadas al cliente. Se cuentan **al confirmar la entrega**, no al cargar el camión: subir mercadería al reparto no genera deuda de cajas.
- **Devueltas**: cada devolución queda con fecha, usuario y pedido (`box_movements`).
- **Correcciones a mano**: ahora también dejan rastro (`boxAdjustments`: fecha, quién, cuántas, motivo). En fichas viejas, lo que ya estaba cargado entra como un movimiento inicial, para que el saldo se pueda reconstruir.

Caso confirmado por el negocio, con prueba automática: `10 + 30 − 5 = 35`.

Dónde se ve: en la **ficha del pedido** (las cuatro cifras y el resultado), en las **tarjetas de cliente** (saldo de cajas separado del importe) y en la **hoja de ruta** (cuatro columnas).

Saldos negativos: **no se llevan a cero solos**. Si quedó negativo se muestra con un aviso para revisar. Las devoluciones nuevas que dejarían el saldo por debajo de cero se rechazan con un mensaje (ver decisiones pendientes).

---

## 3. Sistema visual

- Hoja nueva `src/styles-2026.css`, que carga última y concentra colores, formas, sombras y espaciados, más las piezas reutilizables (botones, campos, buscador, tarjetas, tablas, etiquetas, filtros, estados vacíos, menús y ventanas).
- **Se eliminaron los fondos marrones**: los 237 colores cálidos poco saturados de las hojas viejas pasaron a gris neutro conservando su claridad. El rojo de marca, los verdes y los ámbar de aviso quedaron intactos.
- Fondo gris muy claro, tarjetas blancas, texto negro, rojo solo para la acción principal y lo seleccionado. Vidrio suave en la navegación, con alternativa sólida donde no hay desenfoque.
- Foco siempre visible, controles de 44 px o más, y respeto por *reducir movimiento*. Sin brillos permanentes ni animaciones decorativas.

## 4. Navegación

**Escritorio**: la barra superior saturada se reemplazó por un **panel lateral plegable** (se recuerda plegado) con las secciones agrupadas por función — *Operación del día* y *Gestión* — y **perfil, ayuda y salir separados abajo**. Arriba, un encabezado compacto con el nombre de la sección.

**Celular**: barra inferior de **cinco casilleros iguales** (Pedidos · Nuevo · Pesaje · Clientes · Más), con icono y palabra completa, sin botón central agrandado. Se esconde al bajar y vuelve al subir sin mover el contenido, y desaparece con el teclado abierto o con una ventana encima. Respeta el área segura y todas las pantallas reservan espacio al final.

## 5. Vista de pedido

Tres niveles, sin repetir la fila de la tabla dentro de la tarjeta:

1. **Resumen**: N° de pedido/remito, cliente, sucursal, estado.
2. **Detalle**: dirección, contacto, productos con *pedido vs pesado*, totales separados (**Total del pedido / Saldo anterior / Total adeudado**, sin contar dos veces el pedido a cuenta), cajas y comprobantes.
3. **Acciones**: **una sola acción principal** según el estado; editar, comprobantes, remito, cobro y compartir como secundarias; eliminar aparte, con confirmación.

La **asignación de preventista** tiene su propio espacio, con *Sin asignar* bien visible, y se puede cambiar desde el celular con la misma capacidad que en escritorio.

## 6. Clientes con sucursales

El cartel grande de "SUCURSAL" se reemplazó por una **etiqueta compacta junto al nombre**. Orden: nombre comercial o sucursal, empresa, dirección y localidad, datos fiscales y contacto. La búsqueda también encuentra por sucursal.

## 7. Filtros

Buscador siempre visible; el resto agrupado en **Filtros** con contador. Panel desplegable en escritorio y hoja inferior en el celular, con **Aplicar** y **Limpiar**. Los filtros puestos se muestran como etiquetas y se quitan de a una. Siempre se ve **cuántos resultados hay** y un estado claro cuando no hay coincidencias. La búsqueda se conserva al abrir y cerrar el panel.

Se agregaron filtros independientes de **saldo monetario** (todos · con deuda · sin deuda · saldo a favor) y de **cajas** (todas · con pendientes · sin pendientes).

## 8. Indicadores sin función

Se quitaron "En vivo", los puntos luminosos y la campana decorativa. Quedan los mensajes con función real: guardado, error, cargando y **pendiente de sincronizar** (pesadas sin señal y documentos sin enviar).

## 9. Hoja de ruta y rendición

Rehecha según las anotaciones pedidas. Casilleros por pedido: **pedido/remito · cliente y zona · total del pedido · deuda previa · cajas previas · salientes · devueltas · saldo de cajas · efectivo · transferencia · cheque · saldo final**.

- **Gastos** con concepto, importe y comprobante, y la aclaración de que no aumentan la deuda del cliente.
- Fórmula de rendición a la vista: `diferencia = efectivo cobrado − gastos pagados en efectivo − efectivo entregado`, sin contar los gastos dos veces.
- **Observaciones al dorso**, aprovechando el frente para lo operativo; firmas y resumen se mantienen.
- **Dos páginas por parte**, listas para doble faz. Si el reparto no entra, se divide en partes numeradas (*Parte 1 de 2*), sin cortar clientes ni achicar el texto.
- La **deuda previa de un cliente se lleva una sola vez**, aunque tenga varios pedidos (el resto dice *"Incl. anterior"*).

Ejemplo generado y revisado: `Hoja_ruta_ejemplo.pdf` (adjunto).

## 10. Archivo documental en Google Drive

Módulo nuevo `server/documents.mjs` + pantalla **Documentos**.

- Los remitos, hojas de ruta y comprobantes se guardan **primero en el servidor** y se encolan para Drive.
- Carpeta destino configurable; dentro se ordenan por **mes / tipo**.
- **Sin duplicados**: el identificador es el hash del contenido, y antes de subir se reserva el ID del archivo en Drive, así un corte de red no crea una copia al reintentar. Hay prueba automática de ese caso.
- **Estados reales**: pendiente, subiendo, enviado o error con su motivo, y botón para reintentar. Reintentos con espera creciente.
- Cada documento queda relacionado con su pedido o reparto, y solo lo ve administración o el preventista de ese reparto.
- **Sin conexión**: el archivo queda en el servidor y se envía cuando vuelve la conectividad o cuando se configuran las credenciales; nunca se pierde.
- Las credenciales van por variables de entorno, **nunca en el código ni en variables `VITE_`**.

### Configuración de Drive

1. En Google Cloud Console, crear un proyecto y habilitar la **Google Drive API**.
2. Crear credenciales **OAuth de aplicación de escritorio** y anotar *client id* y *client secret*.
3. Autorizar **una vez** con la cuenta que tiene acceso a la carpeta, con alcance `https://www.googleapis.com/auth/drive.file`, y guardar el **refresh token**.
4. Compartir la carpeta destino con esa cuenta, con permiso de **edición**.
5. Cargar en Railway (Variables):

   ```
   DRIVE_FOLDER_ID=1ocqnaKCa0U4C4ukOgtH4OvEt9-azQ1lX
   DRIVE_CLIENT_ID=…
   DRIVE_CLIENT_SECRET=…
   DRIVE_REFRESH_TOKEN=…
   ```

6. Reiniciar. En **Documentos** debería dejar de decir *"Drive pendiente de conexión"*; con **Reintentar envíos** se manda lo que quedó encolado.

Mientras no estén las credenciales, **la app funciona igual**: guarda todo en el servidor y lo deja pendiente, a la vista.

---

## 11. Cómo se probó

```bash
npm test                          # 29 pruebas de dominio, cajas, hoja de ruta y Drive
node scripts/verificar-rediseno.mjs   # 74 comprobaciones en navegador real
node scripts/capturas.mjs <carpeta>   # capturas a 360, 390, 768, 1280 y 1440 px
```

`verificar-rediseno.mjs` comprueba, contra la base de prueba:

- **360, 390, 768, 1280 y 1440 px**: sin desplazamiento horizontal en ninguna pantalla, y todo lo que se toca con 44 px o más en celular y tablet.
- La barra inferior **no tapa** el final de ninguna pantalla.
- **Android con el teclado abierto**: el campo de búsqueda y los resultados siguen a la vista, la barra se aparta, y se elige un cliente sin que se cierre el teclado.
- **Pesaje**: un solo teclado; decimales, borrar, limpiar y vuelta al teclado del teléfono.
- **Saldos**: tres correcciones encadenadas sin cerrar, resultado previsto correcto, aviso al cerrar con cambios pendientes, guardado que deja la ventana abierta y actualiza el estado anterior.
- **Pedido**: abrir la ficha **no cambia ningún estado** (se compara la lista completa antes y después), una sola acción principal, y el preventista asignado desde el celular persiste al recargar y reabrir.
- **Filtros**: buscar + filtrar + quitar etiqueta, con la cantidad de resultados coherente y la búsqueda conservada.
- **Sin indicadores decorativos**.

Resultado: **74 de 74 en verde** y **29 de 29** pruebas unitarias.

---

## 12. Decisiones pendientes (necesitan tu confirmación)

1. **Cajas `0 + 10 − 10 = 0`, pero el pedido original decía 10.** No se implementó ninguna excepción, como pediste. La app muestra las cuatro cifras para que se vea de dónde sale cada una. Hace falta saber qué representa cada movimiento en ese caso: ¿las 10 devueltas son de ese mismo reparto (y entonces el saldo 0 está bien) o son de un reparto anterior (y habría que imputarlas a otro pedido)?
2. **Devoluciones mayores al saldo.** Hoy se rechaza la devolución nueva que dejaría el saldo negativo, con un mensaje. Los saldos negativos que ya existan se muestran, nunca se llevan a cero. Confirmar si preferís permitirlas y dejar el negativo a la vista.
3. **"Sin deuda"** se definió como **saldo exactamente 0**; el saldo a favor es un filtro aparte. Confirmar.
4. **Cajas anteriores en pedidos viejos.** Los pedidos entregados antes de esta versión no tienen el corte grabado y muestran *"Sin registro histórico"* en lugar de inventar un número. De acá en adelante, cada entrega lo graba.
5. **Preventista al cargar el pedido.** Ahora se respeta la elección del preventista (antes se descartaba en silencio). Es lo mismo que ya permitía *Editar pedido*. Confirmar que es lo que querés.
6. **Migración de documentos ya existentes a Drive.** No se hizo ningún inventario ni migración de los PDF viejos: solo se archivan los que se generan desde ahora. Si querés migrar lo anterior, hay que inventariarlo primero y verificar la copia antes de tocar nada.

## 13. Verificaciones que no se pudieron ejecutar

- **Teléfono Android real y PWA instalada**: se probó con emulación de dispositivo en Chrome (Pixel 5, teclado simulado achicando la ventana), no con un equipo físico.
- **Subida real a Drive**: no hay credenciales cargadas. Se probó la lógica con un servidor simulado, incluido el caso de corte de red sin duplicar el archivo.
- **Impresión en papel**: el PDF se revisó página por página, pero no se imprimió ni se probó el doble faz en una impresora real.
- **Datos de producción**: todo corrió contra una base de prueba con 144 clientes y 41 pedidos. No se tocó la base de Railway.

## 14. Migración necesaria

Ninguna manual. Al arrancar, el servidor crea la tabla `documents` si no existe. `boxAdjustments` y `boxBalanceBefore` se guardan en los campos de datos existentes de cliente y pedido, sin cambiar el esquema. La primera corrección de cajas de una ficha vieja agrega sola el movimiento inicial que falta.
