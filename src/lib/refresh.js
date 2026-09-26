/** Una consulta a la vez; si cambió algo en vuelo, vuelve a consultar antes de terminar. */
export function coalescedRefresh(task) {
  let running = null;
  let dirty = false;
  return function refresh() {
    dirty = true;
    if (!running) {
      running = Promise.resolve().then(async () => {
        try {
          do {
            dirty = false;
            await task();
          } while (dirty);
        } finally {
          running = null;
        }
      });
    }
    return running;
  };
}
