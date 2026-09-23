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
