# Remitos A6 — 23/09/2026

Solicitud: reemplazar cuatro remitos por A4 por un remito de página completa para papel A6.

Implementación: PDF de 105 × 148 mm vertical, una página por pedido, margen de 4 mm, sin marcas de corte. Se amplía el ancho útil y la letra de los productos; se conservan cálculos, saldo, cajas, logo y opciones de ocultar importes. Pantallas y cantidad de hojas actualizadas.

Verificación: compilación correcta; PDF sintético con cinco pedidos produce cinco páginas de 297.638 × 419.528 puntos (A6). Primera página renderizada y revisada con logo, productos, saldo anterior, total y firma. Muestra local: test-results/remitos-a6.pdf. Falta prueba física en la impresora del usuario.

Impresión: papel A6 vertical, una página por hoja; ajustar al área imprimible si la impresora lo necesita.
