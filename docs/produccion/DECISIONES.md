# Decisiones

- Mantener React, Node HTTP y SQLite. No hay evidencia de saturación que justifique cambiar servidor o contratar recursos.
- Publicación a GitHub y Railway autorizada por el pedido directo del usuario. Verificar servicio, volumen y recuperación antes de publicar.
- Los tickets se entregan con estado real: una prueba física o plantilla pendiente no se acredita con un build.
- Plantilla de hoja de ruta: **recibida el 23/09/2026** (`Hoja_de_ruta_Pollito_Casero (1).pdf`),
  copiada a `docs/produccion/plantilla-hoja-ruta.png`. PC-016 se implementó contra ella.
- Cajas en el pesaje: se agrega `crates.boxes` (cuántas cajas retornables representa cada
  pesada). Un lote de N cajas genera N filas de 1; una bolsa genera una fila de 0. Las filas
  anteriores valen 1, que es lo que significaban: no se reinterpreta ningún bulto histórico.
- Datos sintéticos, base en memoria y archivos en directorio temporal para pruebas. Variables operativas no se heredan.

## Comprobación de migración antes de publicar (23/09/2026)

Se armó una copia **consistente** de la base de ensayo con `VACUUM INTO` (copiar solo el archivo
`.sqlite` de una base activa deja afuera el WAL: el primer intento falló justo por eso), se le
quitaron las columnas nuevas para dejarla en el esquema anterior, se le agregaron una pesada y un
movimiento con el formato viejo, y se abrió con el código nuevo.

Resultado: las columnas se crean solas, quedan **41 pedidos y 144 clientes intactos**, la pesada
vieja **sigue valiendo 1 caja** (no se reinterpreta como bolsa) y el movimiento viejo se lee,
conserva su autor y queda marcado como histórico.

## Actualización masiva de precios (08/10/2026)

- Se actualizan las fuentes que ya existen, con una operación auditada (`price_updates` +
  `price_update_items`), en vez de un multiplicador global o versiones de listas: los pedidos ya
  guardan su precio por renglón y la carga de pedidos usa el precio propio del cliente, así que
  un multiplicador dinámico habría que aplicarlo en cada lugar que lee precios.
- Fuentes: cada lista por modalidad (una vez por producto y modalidad) y cada precio propio
  existente en `customer_prices`. No hay descuentos en el modelo. No se crean filas nuevas.
- Referencia: setting `priceReference`, configurado a mano por administración. No se usa el
  "precio base" de la lista mayorista porque la carga de pedidos no usa listas y ese valor puede
  estar desactualizado (en la base local: $5.500 contra precios propios de pollo entero de $3.480 a $5.500).
- Cálculo en centavos con enteros: precio × (B + D) / B a dos decimales; después el redondeo
  comercial elegido (10/50/100, al más cercano o hacia arriba). La referencia nueva es B + D, sin redondeo.
- Alcance: productos de categoría entero/trozado (incluye los agregados desde un pedido, que se
  pueden destildar). "Otro" nunca. Envases, cajas y fletes no son precios por kilo y no se tocan.
- Reversión: solo la última operación, restaurando los valores guardados; bloqueada si algún
  precio o la referencia cambió después.
- Borradores: la carga de pedidos ya relee el cliente antes de confirmar; si cambiaron sus precios,
  ahora lo dice explícitamente y obliga a revisar.
