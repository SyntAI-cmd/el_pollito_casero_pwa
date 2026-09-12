# Activos de Pollito Casero

Imágenes ilustrativas generadas para este proyecto (herramienta `imagegen` en la etapa 1); no son fotografías del stock del negocio. `scripts/assets.mjs` regenera todo.

- `source-images/pollo.png` → `public/images/pollo.webp` (hero y tarjeta de pollo entero).
- `source-images/trozado.png` → `public/images/trozado.webp` y seis recortes 3:2 de 768×512 para las tarjetas: `cuarto-trasero` (patas), `muslo` (muslos), `pechuga`, `suprema`, `alas`, `pechuga-con-alas`. Las regiones están definidas en `scripts/assets.mjs`.
- Menudos, rancho y garras no tienen foto todavía: la tarjeta muestra un marcador tipográfico. **Para agregarlas basta con guardar `public/images/menudos.webp`, `public/images/rancho.webp` y `public/images/garras.webp`** (768×512 recomendado): el servidor las detecta al reiniciar sin tocar `business.json`. Si tenés JPG/PNG, convertilas con `npx sharp-cli` o pedímelo.
- `public/og.png`: Open Graph 1200×630. `public/icon.svg`, `icon-192.png`, `icon-512.png`: propuesta de marca para la PWA.

## Prompts originales

**Entero**: photorealistic editorial food photograph, raw whole chicken on white butcher paper over a dark charcoal counter, rosemary, lemon, peppercorns, soft daylight, 3:2, no text.

**Trozado**: photorealistic commercial food photograph, raw chicken pieces (two drumsticks, skin-on thighs, breast portions, wings) on white butcher paper and pale stone counter, rosemary, gentle side daylight, 3:2, no text.
