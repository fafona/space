// Exact committed-worker / failed-natural-cycle incident. No arbitrary resume.
import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const WORKER_DATABASE_INCIDENT=freeze({
 tool:'4bda265740c592053de1ab36ca5458bd4a062379',inventory:'ba03ae351cd757294ddbf595bed8770511e39fd7bdcbf436f696002a1c49f238',
 head:'2562a37b2273bb08662678ec7a1be845b398f65d397709656d0b49e3256d9492',sequence:23,pid:567958,restarts:12,
 operation:{dev:64769,ino:2624979,uid:0,mode:0o40700},controller:{pid:566611,startTicks:'1241117465'},
 environmentSha256:'7a3beb2c4a8b8d493972beb84401b6bcf4cd8385c0b786d8d997e10566466100',
 files:{
  'admission.json':'37f02a86f0ebd728b9d73117c20d3e47d2c3744f64d23388e6ed362ac89da5c9',
  'dump.pm2.bak.before':'35e135859762c8abdbfbe9ee3a29873a89240c414f5e51392494fb9c458a08a5',
  'dump.pm2.before':'e825f398add2ef17f420518f0f83ecd3558946de571c23160670cb2a65558119',
  'persistence-attempt.json':'50bd065eb280863d6a540332f3fa029169466517b6bd3e777c91a5248308fe07',
  'persistence-completed.json':'03b2a776238e8230d6956e8a6c9bcac3f79bb3857092de29e24a1e814903ee4f',
  'unconfirmed.json':'13c2fcff1bca05197ecbe5b0bdf3c43fe236a590591a6db9ba9803e0014ed148',
  'worker-attempt.json':'b4ceb2113fc8ceaa4937fc4047c48a70a7e4cd1b9946b495cc89aa947adcc90f',
  'worker-release-committed.json':'f9d858a1930663ff76aa6c38497f28759f75d172573005575962b80b7daca5cf',
  'worker-rpc-ack.json':'e7f34175776fc4166e27027b38a883256b53668e4e0b23b9aa6e4776445157d8',
  'worker-settled.json':'c074529bdf60fb506c9735ddea1df690aec07672e7cd742272a144f22c7346b8'
 }
});
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const workerDatabaseIncidentSha256=()=>createHash('sha256').update(JSON.stringify(stable(WORKER_DATABASE_INCIDENT))).digest('hex');
export function assertWorkerDatabaseIncident(value){
 const p=WORKER_DATABASE_INCIDENT,need=v=>{if(!v)throw Error('worker_database_incident_changed');};
 need(value?.historyHead===p.head&&value.sequence===p.sequence&&value.tool===p.tool&&value.pid===p.pid&&value.restarts===p.restarts);
 need(isDeepStrictEqual(value.files,p.files)&&isDeepStrictEqual(value.operation,p.operation)&&value.operationEmpty===true&&value.originalControllerExited===true);
 need(value.phase==='natural-cycle'&&value.certificateCommitted===true&&value.completed===false&&value.mailEnabled===false&&value.allProcessesMatch===true&&value.savedDumpVerified===true&&value.protectedHostMatch===true);
 return true;
}
