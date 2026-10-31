import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {WORKER_DATABASE_INCIDENT as P,workerDatabaseIncidentSha256,assertWorkerDatabaseIncident} from './release-toolchain-worker-database-contract.mjs';
import {assertBookingWorkerDatabaseHeld,withBookingWorkerDatabaseLocks} from './online-release-retention-writer.mjs';
const valid=()=>({files:structuredClone(P.files),historyHead:P.head,sequence:P.sequence,tool:P.tool,pid:P.pid,restarts:P.restarts,operation:structuredClone(P.operation),operationEmpty:true,originalControllerExited:true,phase:'natural-cycle',certificateCommitted:true,completed:false,mailEnabled:false,allProcessesMatch:true,savedDumpVerified:true,protectedHostMatch:true});
test('only the exact committed and paused incident can be admitted; its pins are immutable',()=>{
 assert.equal(assertWorkerDatabaseIncident(valid()),true);assert.match(workerDatabaseIncidentSha256(),/^[a-f0-9]{64}$/);assert.throws(()=>{P.operation.ino++;},TypeError);assert.throws(()=>{P.files.extra='forged';},TypeError);
 for(const mutate of [v=>v.historyHead='0'.repeat(64),v=>v.sequence++,v=>v.tool='0'.repeat(40),v=>v.pid++,v=>v.restarts++,v=>v.operation.ino++,v=>v.operationEmpty=false,v=>v.originalControllerExited=false,v=>v.phase='worker-restart',v=>v.certificateCommitted=false,v=>v.completed=true,v=>v.mailEnabled=true,v=>v.allProcessesMatch=false,v=>v.savedDumpVerified=false,v=>v.protectedHostMatch=false,v=>delete v.files['unconfirmed.json'],v=>v.files['admission.json']='0'.repeat(64)]){const changed=valid();mutate(changed);assert.throws(()=>assertWorkerDatabaseIncident(changed));}
});
test('serialized records and tokens never grant formal continuation or archive authority',async()=>{
 for(const token of [{},{deployFd:3,operationDirectory:'/var/lib/faolla-maintenance/merchant-space/operation.lock'},valid()])assert.throws(()=>assertBookingWorkerDatabaseHeld(token));
 await assert.rejects(withBookingWorkerDatabaseLocks({toolRevision:P.tool},async()=>{throw Error('must-not-enter');}));
});
test('worker config uses the same attested source file and never persists the credential to the process manager',()=>{
 const worker=readFileSync(new URL('./booking-atomic-worker.mjs',import.meta.url),'utf8'),host=readFileSync(new URL('./release-toolchain-worker-release-host.mjs',import.meta.url),'utf8');assert.ok(worker.includes("DATABASE_ENV_SHA256='"+P.environmentSha256+"'"));assert.match(worker,/privateText\(SOURCE\+'\/\.env\.local'\)/);assert.match(worker,/process\.env\[name\]=value/);assert.doesNotMatch(worker,/loadEnvConfig|dotenv\.config|writeFileSync/);assert.match(host,/probeWorkerDatabaseBeforeRestart/);assert.match(host,/databaseContinuation\?2:1/);
});
test('foreign probe source is refused before any process or filesystem operation',async()=>{
 const {probeWorkerDatabaseBeforeRestart}=await import('./release-toolchain-worker-database.mjs');await assert.rejects(probeWorkerDatabaseBeforeRestart('/tmp/foreign',{}),/source_changed/);
});
