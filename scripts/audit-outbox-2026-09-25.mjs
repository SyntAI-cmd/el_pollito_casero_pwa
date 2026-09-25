// Reproducciones aisladas: no usa red, navegador ni datos del negocio.
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = (await readFile('src/lib/outbox.js', 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const reports = [];
function fixture() {
  const data = new Map();
  const state = { handler: async () => ({}) };
  const context = vm.createContext({
    api: (...args) => state.handler(...args),
    stored: (key, fallback) => data.has(key) ? JSON.parse(data.get(key)) : fallback,
    persist: (key, value) => data.set(key, JSON.stringify(value)),
    dueñoDe: () => 'staff:a', VERSION_DATOS: 1,
  });
  vm.runInContext(source + '\nglobalThis.subject={send,flush,setDueño,pending,rechazadas};', context);
  return { ...context.subject, state };
}
const network = () => Object.assign(Error('red simulada'), {network:true});
const turn = () => new Promise(r => setImmediate(r));
{
  const q = fixture(); q.setDueño({}); await turn();
  q.state.handler = async () => { throw network(); };
  await q.send('/orders/A/crates', {id:'A'});
  let release;
  q.state.handler = (path) => path.includes('/A/') ? new Promise(r => release=r) : Promise.reject(network());
  const draining = q.flush();
  await q.send('/orders/B/crates', {id:'B'});
  assert.equal(q.pending().length, 2);
  release({}); await draining;
  assert.equal(q.pending().length, 0);
  reports.push({case:'pesada nueva durante reenvío', result:'REPRODUCIDO: B desaparece de la cola sin enviarse'});
}
{
  const q = fixture(); q.setDueño({}); await turn();
  q.state.handler = async () => {throw network();};
  await q.send('/orders/A/crates', {id:'A'});
  q.state.handler = async () => {throw Object.assign(Error('servidor temporalmente no disponible'), {status:503});};
  await q.flush();
  assert.equal(q.pending().length, 0); assert.equal(q.rechazadas.length, 1);
  reports.push({case:'503 transitorio al reenviar',result:'REPRODUCIDO: se elimina de pendientes y queda solo en memoria como rechazo'});
}
{
  const q = fixture(); q.setDueño({}); await turn();
  let reject;
  q.state.handler = () => new Promise((resolve,r) => reject=r);
  const sending = q.send('/orders/A/crates', {id:'A'});
  assert.equal(q.pending().length, 0);
  reject(network()); await sending;
  assert.equal(q.pending().length, 1);
  reports.push({case:'petición en vuelo',result:'REPRODUCIDO: no se persiste hasta que falla la red; cerrar antes deja la operación sin respaldo local'});
}
await writeFile('test-results/auditoria-2026-09-25-outbox.json', JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports,null,2));
