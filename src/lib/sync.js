/**
 * Sincronización por entidad (PC-017): en vez de volver a bajar listas completas por cada cambio,
 * se trae sólo lo que cambió y se aplica sin que una respuesta vieja pise una nueva.
 *
 * Cada consulta toma un número del reloj de la pestaña AL EMPEZAR; cada entidad recuerda el
 * número de la última información aplicada. Una respuesta sólo se aplica a las entidades que
 * no cambiaron después de que esa consulta salió.
 */
let clock = 0;
export const tick = () => ++clock;
const byId = (x) => x.id;

/** Agrega o reemplaza una entidad si la información es más nueva que la aplicada. */
export function upsertList(list, item, seq, versions, key = byId) {
  const id = key(item);
  if ((versions.get(id) || 0) > seq) return list;
  versions.set(id, seq);
  const i = list.findIndex((x) => key(x) === id);
  if (i < 0) return [item, ...list];
  if (list[i] === item) return list;
  const next = list.slice();
  next[i] = item;
  return next;
}
/** Quita una entidad (borrada, cancelada, trasladada) salvo que haya algo más nuevo. */
export function removeFromList(list, id, seq, versions, key = byId) {
  if ((versions.get(id) || 0) > seq) return list;
  versions.set(id, seq);
  const next = list.filter((x) => key(x) !== id);
  return next.length === list.length ? list : next;
}
/**
 * Aplica una lista completa pedida en `seq`. Lo que cambió después (por un evento o por la
 * respuesta de una escritura) se conserva; lo que se borró después no revive.
 */
export function mergeFull(current, incoming, seq, versions, key = byId) {
  const now = new Map(current.map((x) => [key(x), x]));
  const seen = new Set();
  const out = [];
  for (const item of incoming) {
    const id = key(item);
    seen.add(id);
    if ((versions.get(id) || 0) > seq) {
      if (now.has(id)) out.push(now.get(id));
      continue;
    }
    versions.set(id, seq);
    out.push(item);
  }
  const newer = current.filter(
    (x) => !seen.has(key(x)) && (versions.get(key(x)) || 0) > seq,
  );
  return newer.length ? [...newer, ...out] : out;
}
/**
 * Respuesta parcial (sólo los ids pedidos): se actualiza lo que vino y se saca lo pedido que no
 * vino (ya no existe o ya no corresponde a esta vista según el servidor).
 */
export function mergePartial(current, asked, incoming, seq, versions, key = byId) {
  let next = current;
  for (const item of incoming) next = upsertList(next, item, seq, versions, key);
  const got = new Set(incoming.map(key));
  for (const id of asked)
    if (!got.has(id)) next = removeFromList(next, id, seq, versions, key);
  return next;
}

/**
 * Junta ids que llegan seguidos (una ráfaga de eventos) y los consulta de una vez. Nunca hay dos
 * consultas del mismo lote a la vez; lo que llega durante una consulta va en la siguiente.
 * `add(id, true)` consulta ya y devuelve la promesa (después de una escritura).
 */
export function createBatcher(run, delay = 150) {
  let ids = new Set();
  let timer = null;
  let running = null;
  let stopped = false;
  const fire = async () => {
    timer = null;
    while (running) await running;
    if (stopped || !ids.size) return;
    // De a 100 como máximo (límite del servidor); el resto sale en la vuelta siguiente.
    const batch = [...ids].slice(0, 100);
    for (const id of batch) ids.delete(id);
    running = Promise.resolve()
      .then(() => run(batch))
      .catch(() => {});
    await running;
    running = null;
    if (ids.size && !timer && !stopped) timer = setTimeout(fire, delay);
  };
  return {
    add(id, now = false) {
      if (stopped) return Promise.resolve();
      ids.add(id);
      if (now) {
        clearTimeout(timer);
        timer = null;
        return fire();
      }
      if (!timer) timer = setTimeout(fire, delay);
      return Promise.resolve();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      ids = new Set();
    },
  };
}
/** "a,b" para una consulta por ids. */
export const idsParam = (ids) => ids.map(encodeURIComponent).join(",");
