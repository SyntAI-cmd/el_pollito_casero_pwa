# Retiro de Secciones «Documentos» y «Movimientos» en Producción

Fecha de aplicación: 25/09/2026.

## Motivo y Alcance
A solicitud de la operación, las secciones **Documentos** y **Movimientos** se retiran de la navegación activa de producción:
- **No se están utilizando** en la rutina operativa diaria de carga, pesaje y reparto.
- La subida masiva de documentos en segundo plano y el visor global de auditoría de movimientos agregaban complejidad visual y tráfico innecesario en dispositivos móviles.

## Cambios Realizados
1. **Navegación (`src/App.jsx`):**
   - Se removieron los accesos directos de **Documentos** y **Movimientos** del menú de navegación de administración (`/operacion/documentos`, `/operacion/movimientos`).
   - Se removió el acceso directo de **Documentos** del menú de reparto (`/reparto/documentos`).
2. **Archivos preservados:**
   - El código fuente de las páginas (`src/pages/Documents.jsx`, `src/pages/Movimientos.jsx`) y el servicio de almacenamiento de backend (`server/documents.mjs`, `server/auditoria.mjs`) se mantienen en el repositorio para su futura reactivación cuando la operación decida habilitarlos nuevamente.
