# Rendimiento

## Cómo se mide

```bash
node scripts/benchmark-production.mjs test-results/pc000-baseline.json
```

El banco llama a la API directamente (sin HTTP ni navegador), con SQLite en memoria, datos
sintéticos y el servicio de rutas simulado: tarda 100 ms y después falla. Entorno aislado por
`scripts/test-env.mjs` (lista permitida de variables, directorio temporal, integraciones
apagadas). 20 repeticiones por operación; con esa cantidad los percentiles son orientativos.

Lo que mide es **trabajo de servidor**: no incluye red, ni render del navegador, ni el teclado
del celular. Esos se miden aparte y todavía están pendientes en dispositivo real.

## Línea base PC-000 — 23/09/2026

Node v24.21.0, Windows, base `b4df34b` (antes) contra la rama `codex/produccion-tickets`
(después). Escenario de 1000 pedidos y 1000 clientes.

| Operación | Antes p50 / p95 | Después p50 / p95 |
| --- | --- | --- |
| Iniciar reparto (rutas lentas: 100 ms y falla) | **111,82 / 115,75 ms** | **0,39 / 0,50 ms** |
| Guardar saldo | 0,29 / 0,80 ms | 0,30 / 0,62 ms |
| Confirmar pesada | 0,47 / 0,57 ms | 0,52 / 0,84 ms |
| Listar pedidos | 62,19 / 68,39 ms | 82,41 / 112,76 ms |
| Listar clientes | 62,35 / 69,53 ms | 100,06 / 123,44 ms |

Escala completa del "después":

| Escenario | Listar pedidos p50/p95 · bytes | Listar clientes p50/p95 · bytes |
| --- | --- | --- |
| 50 pedidos / 100 clientes | 3,35 / 5,76 ms · 44 KB | 3,66 / 5,70 ms · 40 KB |
| 200 pedidos / 1000 clientes | 11,50 / 14,41 ms · 177 KB | 22,13 / 31,48 ms · 398 KB |
| 1000 pedidos / 1000 clientes | 82,41 / 112,76 ms · **887 KB** | 100,06 / 123,44 ms · **398 KB** |

Las escrituras (saldo, pesada, inicio) se mantienen por debajo de 1 ms en las tres escalas.

## Qué dicen estos números

**Causa confirmada y corregida (PC-001).** El inicio de reparto esperaba `estimate()` dentro del
bloqueo del pedido. `server/route.mjs` usa `AbortSignal.timeout(6000)`: con el servicio de rutas
caído, cada inicio podía quedar hasta 6 segundos colgado. Medido con un servicio que tarda
100 ms, el inicio pasó de **111,82 ms a 0,39 ms** (p50). Con el timeout real de 6000 ms la
diferencia es mucho mayor; no lo medimos con 6 s para no alargar el ensayo sin necesidad.

**Cuello principal que queda (PC-017).** Listar pedidos con 1000 registros arma **887 KB** y
consume 82–113 ms solo del lado del servidor, antes de la red. Listar clientes, 398 KB. Y el
store del navegador vuelve a pedir **las dos listas completas** después de cada operación. Ese
es el trabajo redundante a atacar: no es la base de datos.

**SQLite no está saturado.** Las escrituras son sub-milisegundo con 1000 pedidos. No hay
evidencia que justifique migrar a PostgreSQL, cambiar de plan ni de región (ver PC-021).

**Diferencia de las dos primeras filas.** "Listar pedidos" y "listar clientes" figuran más
lentos en el "después", pero **ninguno de los dos endpoints cambió** en esta rama: es ruido de
la máquina de ensayo entre corridas. No lo cuento como regresión ni como mejora; se vuelve a
medir en PC-017 con corridas alternadas.

## Pendiente de medir

- Tiempos de navegador: toque → primer feedback, INP, renders y tareas largas.
- Teclado y desplazamiento en un teléfono Android real (la emulación no lo acredita).
- Latencia real contra Railway: región, CPU/RAM del servicio y red de los equipos.
- Generación de PDF y carga inicial con caché fría y caliente.

## Hosting

Dockerfile y `railway.json` con una réplica y volumen en `/data`. El servicio real
(`pollito-casero-production.up.railway.app`) responde, pero **todavía no se midió su CPU, RAM,
región ni latencia desde los equipos de la operación**. No se recomienda gasto sin esos datos.
