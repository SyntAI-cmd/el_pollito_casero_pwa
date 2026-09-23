import { testEnv } from './test-env.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
Object.assign(process.env, await testEnv({ ROUTING: 'on' }));
for(const k of ['DRIVE_CLIENT_ID','DRIVE_CLIENT_SECRET','DRIVE_REFRESH_TOKEN','MP_ACCESS_TOKEN','SMTP_URL','WHATSAPP_TOKEN']) delete process.env[k];
const {openStore}=await import('../server/store.mjs');
const {createApi,createEvents}=await import('../server/api.mjs');
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{await new Promise(r=>setTimeout(r,100)); throw Error('OSRM sintético caído');};
const session={role:'admin',staffId:'synthetic-admin',name:'Ensayo'};
const results=[];
for(const [orders,customers] of [[50,100],[200,1000],[1000,1000]]){
 const store=await openStore(':memory:');
 const api=createApi({store,events:createEvents(),dataDir:process.env.DATA_DIR});
 const call=(method,path,body={})=>api({method,path,body,session,query:new URLSearchParams(),ip:'127.0.0.1'});
 store.drivers.save({name:'Ensayo',active:true,zones:[]});
 for(let i=0;i<customers;i++) store.customers.save({phone:`synthetic-${i}`,name:`Cliente sintético ${i}`,plan:'mayorista',credit:true,created:new Date().toISOString(),location:{lat:-33.08,lng:-68.47}});
 const ids=[];
 for(let i=0;i<orders;i++){
  const r=await call('POST','/api/orders',{customer:`synthetic-${i%customers}`,key:`sample-${i}`,driver:'Ensayo',deliveryDate:'2026-09-23',items:[{id:'entero',kg:40}],payment:'cuenta'});
  ids.push(r.body.id);
 }
 const measure=async(name,fn)=>{
  const ms=[],bytes=[];
  for(let i=0;i<20;i++){const start=performance.now();const r=await fn(i);ms.push(performance.now()-start);bytes.push(Buffer.byteLength(JSON.stringify(r.body)));}
  ms.sort((a,b)=>a-b);results.push({orders,customers,name,n:20,p50:+ms[9].toFixed(2),p95:+ms[18].toFixed(2),responseBytes:Math.round(bytes.reduce((a,b)=>a+b)/20)});
 };
 await measure('listar pedidos',()=>call('GET','/api/orders'));
 await measure('listar clientes (base de búsqueda local)',()=>call('GET','/api/customers'));
 await measure('guardar saldo',i=>call('PATCH','/api/customers/synthetic-0/saldos',{balance:10000+i,boxes:10,note:'Ensayo aislado',opId:`op-${i}`}));
 await measure('confirmar pesada',i=>call('POST',`/api/orders/${ids[i]}/crates`,{id:`crate-${i}`,productId:'entero',boxes:2,gross:43.4}));
 await measure('iniciar reparto OSRM demora 100 ms y falla',i=>call('PATCH',`/api/orders/${ids[i]}`,{status:'en_camino'}));
 await new Promise(r=>setTimeout(r,150));
 store.close();
}
globalThis.fetch=originalFetch;
await mkdir('test-results',{recursive:true});
const path=process.argv[2]||'test-results/pc000-baseline.json';
await writeFile(path,JSON.stringify({node:process.version,platform:process.platform,kind:'API directa, SQLite memoria, sin HTTP/navegador, fetch OSRM simulado 100ms',results},null,2));
console.log(JSON.stringify(results,null,2));
