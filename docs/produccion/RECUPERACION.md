# Publicación, rollback y recuperación

Comandos de Railway desde **PowerShell** (en Git Bash, `/data` se convierte en una ruta de
Windows y los comandos fallan). Nada de esto borra datos; los pasos que cambian la base real
están marcados y requieren decisión explícita.

## 1. Antes de publicar: copia verificada del volumen

```powershell
railway ssh -- node scripts/verificar-integridad.mjs /data/pollito.sqlite --guardar=/data/backups/antes-de-publicar-2026-09-27.sqlite
```

- Hace una copia consistente con la API de backup de SQLite (respeta el WAL; no se copia el
  archivo suelto mientras el servidor escribe) y corre `quick_check`, `integrity_check`,
  `foreign_key_check`, la consistencia neto = bruto − tara de cada cajón y una restauración de
  prueba, **todo sobre la copia**. El original no se modifica (se compara su hash antes y después).
- Guarda la copia sólo si todo dio `ok` y el destino no existe.
- Requiere la imagen nueva (el script entra en ella con esta entrega). Con la imagen actual,
  usar la copia diaria que ya hace el servidor al arrancar (`/data/backups/pollito-AAAA-MM-DD-…`).
- Además, descargar una copia fuera del volumen (Railway → Volume → Download) y guardarla en la PC.

Resultado esperado: `"resultado": "ok"`. Si dice `REVISAR` o `ERROR`: **no publicar**, guardar la
salida completa y seguir la sección 5.

## 2. Publicar

```powershell
git switch perf/pesaje-confiabilidad   # rama de esta entrega
npm ci; npm test; npm run build        # 116/116
railway up --detach
```

Verificación inmediata (sin crear datos en producción):

1. `GET /api/health` → `ok: true, schema: 5` y la misma cantidad de pedidos que antes.
2. `/admin` sirve un `index-*.js` distinto de `index-BrdVv1hc.js` (versión nueva).
3. Cualquier `GET /api/config` trae `Server-Timing: app;dur=…` y `Content-Encoding: gzip`.
4. En el teléfono: abrir Pesaje; la app se actualiza sola cuando no hay pesadas pendientes
   (si hay pendientes, espera a que se envíen). No borrar datos del sitio ni reinstalar.

## 3. Rollback (compatible con los datos)

No hay migraciones de base en esta entrega: la versión anterior abre la base tal cual.

```powershell
# Opción A: Railway → Deployments → deployment anterior → Redeploy.
# Opción B: desde la PC
git worktree add ..\pollito-0a46d00 0a46d00
cd ..\pollito-0a46d00; npm ci; railway up --detach
```

Cola del teléfono: `pc-outbox` conserva el mismo formato. **Probado**: la cola de `0a46d00`
envía una sola vez lo que dejó la nueva (con sus campos de reintento), lo saca de la cola y no toca
`pc-outbox-revision` (las rechazadas quedan guardadas aunque la versión vieja no las muestre).

## 4. Pesadas en el teléfono

- **"N pendientes de enviar"**: están guardadas en el teléfono y se envían solas al volver la
  señal o al volver a la pantalla. No cerrar sesión ni borrar datos del sitio.
- **"esperando que vuelvas a ingresar"**: la sesión venció. Entrar con **el mismo usuario**; se
  envían solas. Con otro usuario no se envían (PC-019).
- **"requiere revisión"**: el servidor la rechazó (pedido cancelado, datos inválidos). Se ve el
  motivo; *Reintentar* la vuelve a enviar con el mismo id (sin duplicar); *Descartar* la saca
  del teléfono (sólo por decisión de una persona).
- **Aviso rojo "El teléfono no pudo guardar…"**: almacenamiento lleno o bloqueado. La pesada se
  envía igual con señal; no cerrar la app hasta ver "Todo guardado en el servidor".
- Reabrir la app sin señal ahora muestra la última nota y lo pendiente (antes volvía al ingreso).

## 5. Sospecha de corrupción de la base (NO modificar nada todavía)

1. Identificar el archivo exacto, de dónde salió y cómo se copió. Una copia del archivo suelto
   de una base WAL en uso no prueba nada: puede estar incompleta.
2. Preservar evidencia: copiar `pollito.sqlite`, `-wal` y `-shm` juntos a una carpeta aparte, sin
   abrirlos con otro programa.
3. Correr la sección 1 (sin `--guardar`) y guardar la salida.
4. Si `integrity_check` falla en la base activa: comparar con la última copia `ok` de
   `/data/backups` usando el mismo script, y contar pesadas/pedidos/saldos del día en ambas.
5. **Restaurar requiere aprobación explícita**: detener el servicio, mover (no borrar) los tres
   archivos a `/data/corrupta-<fecha>/`, copiar la copia verificada como `/data/pollito.sqlite`,
   arrancar, verificar `/api/health` y los totales del día, y recargar a mano lo posterior a la
   copia desde remitos y pesadas pendientes de los teléfonos (que se reenvían solas sin duplicar
   lo que el servidor ya tenga, por su id).

## 6. Verificación local reproducible

```bash
npm test
node scripts/verify-pesaje-offline.mjs   # sin red, recarga, vuelve la red
node scripts/verify-pc-sync.mjs          # PC sin descargas completas, saldo al día
node scripts/verify-sync-pdf.mjs         # PDF y archivado
node scripts/bench-pesaje.mjs            # medición de pesaje
node scripts/bench-carga.mjs .           # caché fría/caliente
docker build -t pollito-casero:prueba .  # misma imagen que Railway
```
