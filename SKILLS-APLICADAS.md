# Uso de skills en esta implementación

Se revisó el inventario local de skills de diseño. Se aplicaron las guías compatibles con el encargo; no se ejecutaron todas las herramientas ni todos los estilos simultáneamente. La identidad roja, negra y blanca solicitada prevalece sobre paletas o stacks de otros proyectos.

| Skill leída | Aplicación |
|---|---|
| frontend-design | Dirección propia, catálogo con imagen editorial y tipografía expresiva |
| frontend-design-jakkusakura | Tokens, jerarquía y responsive |
| open-design-reference-design-contract | Contrato, DESIGN.md y handoff antes de implementar |
| open-design-impeccable-design-polish | Inspección visual desktop/móvil, tamaño de texto, errores, navegación móvil y estados vacíos |
| open-design-emilkowalski-motion | Transiciones breves y reduced-motion, sin animación continua |
| react-best-practices | Lecturas iniciales en paralelo, mapa lazy, persistencia inicial lazy, componentes de navegación estables |
| web-design-guidelines | Guía actual consultada, semántica, etiquetas, foco, diálogo nativo, metadata, dimensiones de imágenes |
| awesome-webapp-testing | Inspección de DOM y capturas antes del flujo E2E con Playwright; scripts adaptados a Node |
| ui-ux-pro-max | Guía disponible de controles, iconos, responsive; su buscador no está instalado |
| imagegen | Fotografía propia de entero y trozado |
| fuck-slop | Revisión de microcopy en español, sin grandilocuencia ni testimonios inventados |
| seo-review | Revisada; se tomaron las comprobaciones técnicas pertinentes. Su plantilla extensa es específica de artículos de JavaScript, no de pedidos |
| open-design-design-brief | Revisada; vocabulario de paletas cerrado incompatible con rojo de marca. Se usó reference-design-contract como contrato adaptable |
| open-design-minimalist-skill | Referencia editorial y separación clara; no se adoptó su prohibición de rojo/Lucide ni su paleta como reemplazo de la marca |
| open-design-brutalist-skill | Evaluada y descartada como estilo dominante: interfaz militar no apropiada para compras de pollo |
| open-design-gpt-tasteskill | Evaluada; scroll cinematográfico y randomización no corresponden al flujo de pedidos |
| awesome-brand-guidelines | Evaluada y descartada: exige identidad OpenAI, ajena a Pollito Casero |

Las fichas `open-design-ui-skills`, `open-design-color-expert` y `open-design-copywriting` fueron leídas y son entradas de catálogo: no contienen el workflow completo anunciado. El inventario muestra lo mismo en otras fichas `open-design-*` (Apple HIG, artifacts-builder, creative-director, design-consultation, design-md, design-review, frontend-dev, frontend-skill, plan-design-review, platform-design, shadcn-ui, theme-factory, threejs, web-artifacts-builder, wpds). No se afirma haber ejecutado herramientas ausentes.

Otras skills del inventario se reservaron por alcance: Adobe Fonts requiere su integración; brand-extract/brandkit requieren material de marca adicional; image-to-code y web-clone corresponden a capturas o clonación; canvas-design a una pieza gráfica; FamilyBudget a otro repositorio; Three.js a 3D. No se reemplazó el objetivo por esos workflows.

Referencias consultadas: https://www.ubereats.com/ar y https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md. PedidosYa devolvió 403, por lo que no se atribuyen observaciones visuales a esa página. Rappi y Glovo se tomaron como referencias funcionales nombradas por el usuario, sin afirmar inspección visual.

## Etapa 2 (continuación con Claude Code)

- `web-design-guidelines` / `design-review`: revisión visual con capturas en 390 y 1440 px de catálogo, seguimiento, operación y reparto; corrección de placeholders rotos, contraste y semántica de pestañas (Axe sin violaciones en 10 rutas).
- `react-best-practices`: `main.jsx` monolítico (1782 líneas) dividido en `lib/` (router, store, api, formato), `components/` y `pages/`; mapa y rutas cargadas de forma diferida; estado global con contexto.
- `fuck-slop`: microcopy revisado (descripciones de cortes con concordancia correcta, voseo, sin promesas inventadas).
- Referencias de producto (Uber, PedidosYa, Rappi): barra de carrito fija en móvil con total, hoja inferior, tablero de operación por estado, seguimiento con ETA y marcador del repartidor en vivo.
