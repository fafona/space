// Exact committed-worker / failed-natural-cycle incident. No arbitrary resume.
import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const WORKER_APPLICATION_INCIDENT=freeze({
 tool:'51ee90cc9310d8ee695b0623a3a5ec2d9afddfaa',inventory:'9026bc48358633e73ebbcaff90413f678b2b06c2d50e958736c2a76f0e094273',
 head:'8a1330a5b3fe286be8a2eb61d85e94d4b6ebc6f272a73a6fd5bac9ce32e095c8',sequence:24,pid:754409,restarts:13,
 operation:{dev:64769,ino:2624979,uid:0,mode:0o40700},controller:{pid:752163,startTicks:'1241639117'},
 environmentSha256:'7a3beb2c4a8b8d493972beb84401b6bcf4cd8385c0b786d8d997e10566466100',
 files:{
  "admission.json": "aa55c18ae58fd34b7d42de8bc022c3d724e563f53110430a6cfef90ab9238989",
  "database-preflight.json": "2152f03056b86a4baaced57897a2cbc09afee62d7b8db0e4d4ff0f957b048655",
  "dump.pm2.bak.before": "e825f398add2ef17f420518f0f83ecd3558946de571c23160670cb2a65558119",
  "dump.pm2.before": "3e999383657a2d799c6699e46971e9216386e7b1983684b1f9924edae21bde5f",
  "persistence-attempt.json": "4346a460c4f8f01dcab7afb0ec1f2100aed08267d21c2c8c12947e2f8f9eda99",
  "persistence-completed.json": "578ffd4b17e7c032e092d4a85dcb16ac761e890e6d7aaeb5131c651f260635f7",
  "unconfirmed.json": "9ed18236ab350e60e161d110f39a7b4d54d5451be955248122ea19bca33d0c6a",
  "worker-attempt.json": "6bb32d2cd3da0f7e317ddb94c2ce4b50d6047df98d0b156facc297ff4de3bff4",
  "worker-release-committed.json": "44c493ff40476a19c5a7fa74eecaab178dee116eaa4434e8b8b17fcd0c250c88",
  "worker-rpc-ack.json": "e7f34175776fc4166e27027b38a883256b53668e4e0b23b9aa6e4776445157d8",
  "worker-settled.json": "af1e923997d04aabc6485d3a73e4f771f04ef086bf4d784decb244fe67da885b"
}

});
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export const workerApplicationIncidentSha256=()=>createHash('sha256').update(JSON.stringify(stable(WORKER_APPLICATION_INCIDENT))).digest('hex');
export function assertWorkerApplicationIncident(value){
 const p=WORKER_APPLICATION_INCIDENT,need=v=>{if(!v)throw Error('worker_application_incident_changed');};
 need(value?.historyHead===p.head&&value.sequence===p.sequence&&value.tool===p.tool&&value.pid===p.pid&&value.restarts===p.restarts);
 need(isDeepStrictEqual(value.files,p.files)&&isDeepStrictEqual(value.operation,p.operation)&&value.operationEmpty===true&&value.originalControllerExited===true);
 need(value.phase==='natural-cycle'&&value.certificateCommitted===true&&value.completed===false&&value.mailEnabled===false&&value.allProcessesMatch===true&&value.savedDumpVerified===true&&value.protectedHostMatch===true);
 return true;
}
