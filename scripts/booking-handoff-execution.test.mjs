import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeBookingIngressDrain,executeBookingRepairActivation,BOOKING_HANDOFF_DATASET_SQL,BOOKING_HANDOFF_PURE_PROBE} from './booking-handoff-execution.mjs';
import {assertBookingHostInvocation} from './booking-handoff-host-io.mjs';
import {bookingWatchdogLeaseDigest,assertBookingWatchdogArmedLease} from './booking-handoff-watchdog.mjs';
import {retentionHash} from './online-release-retention-policy.mjs';
const h=n=>n.repeat(64),window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'};
test('preflight and activation revalidate the same immutable-application backup binding',()=>{
 const code=readFileSync(new URL('./booking-handoff-execution.mjs',import.meta.url),'utf8');
 assert.ok(code.includes("import {bookingPublicationBackupRequest,validateBookingPublicationBackupEvidence as validateAttendanceBackupEvidence} from './booking-ready-backup.mjs'"));
 assert.equal((code.match(/await validateAttendanceBackupEvidence\(bookingPublicationBackupRequest\(CANDIDATE,RELEASE\+'\/'\+CANDIDATE\)\)/g)||[]).length,2);
});
const before=()=>({systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008',generation:'20000000-0000-4000-8000-000000000002',revision:'0',protocol:2,active:false,savedBookingRowsSha256:h('a'),commands:0,mailJobs:0});
function drainFixture({failAt,neverDrained=false,eligible=0}={}){
 const events=[];let elapsed=0,polls=0;
 const step=(name,fn=()=>{})=>async(...args)=>{events.push(name);if(name===failAt)throw Error('unknown_'+name);return fn(...args);};
 return {events,operations:{nowMs:()=>Date.parse(window.startedAt)+elapsed,now:()=>new Date(Date.parse(window.startedAt)+elapsed).toISOString(),
  authorize:step('authorize'),workers:step('workers',()=>[{pid:100,startTicks:'1'}]),begin:step('begin'),install:step('install'),syntax:step('syntax'),reload:step('reload'),probeGate:step('probeGate'),
  drain:step('drain',()=>({oldWorkersRemaining:neverDrained||polls++<2?1:0,applicationConnections:0})),wait:step('wait',()=>{elapsed+=1000;}),
  automation:step('automation',()=>({automationEligibleRecords:eligible,throughAt:window.deadlineAt,datasetSha256:h('b')})),complete:step('complete')}};
}
test('real arming verifier admits the cutover drain with the file digest, and the former JSON-value digest stops before any gate install',async()=>{
 const revision='f'.repeat(40),digest='a'.repeat(64),lease={schemaVersion:1,kind:'booking-handoff-independent-watchdog',candidate:'f274ad615550c83717aa7af2ad32339608e6f8aa',toolRevision:revision,window,
  parent:{pid:1234,uid:0,startTicks:'100',executable:'/usr/bin/node',cwd:'/var/lib/faolla-online-code/'+revision,commandSha256:digest},
  deploy:{file:'/www/wwwroot/merchant-space.deploy.lock',identity:{dev:1,ino:2,uid:0,mode:0o100600,nlink:1}},operation:{directory:'/var/lib/faolla-maintenance/merchant-space/operation.lock',identity:{dev:1,ino:3,uid:0,mode:0o40700,nlink:2}},routingPlanSha256:digest,gatePlanSha256:digest};
 for(const valid of [true,false]){const f=drainFixture(),armed={schemaVersion:1,leaseSha256:valid?bookingWatchdogLeaseDigest(lease):retentionHash(lease),process:{pid:5678},at:window.startedAt};
  f.operations.authorize=()=>assertBookingWatchdogArmedLease(armed,lease);
  if(valid){await executeBookingIngressDrain(f.operations,{window});assert.equal(f.events.at(-1),'complete');assert.equal(f.events.filter(v=>v==='install').length,1);}
  else{await assert.rejects(executeBookingIngressDrain(f.operations,{window}),/arming_receipt/);assert.deepEqual(f.events,[]);}
 }
});
test('ingress drain proves old worker exit and zero connections before actual automation evidence',async()=>{
 const f=drainFixture(),receipt=await executeBookingIngressDrain(f.operations,{window});assert.equal(receipt.automationEligibleRecords,0);
 assert.equal(f.events.filter(n=>n==='install').length,1);assert.equal(f.events.filter(n=>n==='reload').length,1);
 assert.equal(f.events.filter(n=>n==='drain').length,3);assert.ok(f.events.indexOf('probeGate')>f.events.lastIndexOf('drain'));assert.equal(f.events.at(-1),'complete');
});
for(const name of ['authorize','workers','begin','install','syntax','reload','probeGate','drain','automation','complete'])test('gate failure '+name+' cannot be labelled drained or automatically replayed',async()=>{
 const f=drainFixture({failAt:name});await assert.rejects(executeBookingIngressDrain(f.operations,{window}),/unknown_/);assert.equal(f.events.filter(n=>n===name).length,1);
});
test('busy old worker and any eligible automation fail closed within the drain reserve',async()=>{
 for(const options of [{neverDrained:true},{eligible:1}]){const f=drainFixture(options);await assert.rejects(executeBookingIngressDrain(f.operations,{window}),/not_drained|automation_drain/);assert.equal(f.events.includes('complete'),false);}
});
test('new-worker 503 does not allow a protected POST to race the old open generation',async()=>{
 const f=drainFixture();let oldWorkerAlive=true,connections=1,polls=0,probes=0;
 f.operations.drain=async()=>{f.events.push('drain');if(++polls===2)oldWorkerAlive=false;if(polls===3)connections=0;
  return {oldWorkersRemaining:oldWorkerAlive?1:0,applicationConnections:connections};};
 f.operations.probeGate=async()=>{probes++;assert.equal(oldWorkerAlive,false);assert.equal(connections,0);
  // The observed incident: GET already reaches new503 while a POST can still
  // reach old200. No arbitrary sleep or retry of a business POST fixes that.
  const statuses=[503,oldWorkerAlive?200:503,connections?200:503];assert.deepEqual(statuses,[503,503,503]);};
 await executeBookingIngressDrain(f.operations,{window});assert.equal(probes,1);assert.equal(polls,3);
 assert.equal(f.events.filter(n=>n==='reload').length,1);
});
test('old workers or connections never draining forbid all gate probes and all later work',async()=>{
 for(const observed of [{oldWorkersRemaining:1,applicationConnections:0},{oldWorkersRemaining:0,applicationConnections:1}]){
  const f=drainFixture();f.operations.drain=async()=>observed;
  await assert.rejects(executeBookingIngressDrain(f.operations,{window}),/ingress_not_drained/);
  assert.equal(f.events.includes('probeGate'),false);assert.equal(f.events.includes('automation'),false);assert.equal(f.events.includes('complete'),false);
 }
});
test('a non503 gate response AFTER drain is still terminal, with no automatic POST replay',async()=>{
 const f=drainFixture();let calls=0;f.operations.probeGate=async()=>{calls++;throw Error('protected_route_not503');};
 await assert.rejects(executeBookingIngressDrain(f.operations,{window}),/protected_route_not503/);assert.equal(calls,1);
 assert.equal(f.events.includes('automation'),false);assert.equal(f.events.includes('complete'),false);
});
function activationFixture(failAt){
 const events=[],original=before(),rebased={...original,savedBookingRowsSha256:h('b')},activation={before:rebased,after:{...rebased,active:true}},
  repair={schemaVersion:1,kind:'booking-rule-missing-options',beforeSavedRowsSha256:original.savedBookingRowsSha256,afterSavedRowsSha256:rebased.savedBookingRowsSha256,planSha256:h('c'),backupSealSha256:h('d')};
 let committed=false;const step=(name,fn=()=>{})=>async(...args)=>{events.push(name);if(name===failAt)throw Error('unknown_'+name);return fn(...args);};
 const operations={now:()=>window.startedAt,authorize:step('authorize'),snapshot:step('snapshot',()=>committed?activation.after:original),
  admission:step('admission',()=>({planSha256:h('c'),backupSealSha256:h('d')})),begin:step('begin'),commit:step('commit',()=>{committed=true;return JSON.stringify(activation)+'\n'+JSON.stringify(repair);}),complete:step('complete')};
 return {operations,events,activation,repair};
}
test('single SQL commit returns independently bound repair and authority receipts, then fresh actual database proof',async()=>{
 const f=activationFixture(),result=await executeBookingRepairActivation(f.operations);assert.deepEqual(result,{activation:f.activation,repair:f.repair});
 assert.equal(f.events.filter(n=>n==='commit').length,1);assert.ok(f.events.indexOf('begin')<f.events.indexOf('commit'));assert.equal(f.events.at(-1),'complete');
});
for(const name of ['authorize','snapshot','admission','begin','commit','complete'])test('unknown activation '+name+' is terminal and never retries SQL',async()=>{
 const f=activationFixture(name);await assert.rejects(executeBookingRepairActivation(f.operations),/unknown_/);assert.equal(f.events.filter(n=>n===name).length,1);assert.ok(f.events.filter(n=>n==='commit').length<=1);
});
test('ambiguous output, unexpected authority change or mismatched repair cannot produce completed receipts',async()=>{
 for(const mutate of [f=>f.operations.commit=async()=>'',f=>f.activation.after.commands=1,f=>f.repair.beforeSavedRowsSha256=h('f'),f=>f.repair.planSha256=h('f')]){
  const f=activationFixture();mutate(f);await assert.rejects(executeBookingRepairActivation(f.operations));assert.equal(f.events.includes('complete'),false);
 }
});
test('pure application probe and preflight query have no application startup, mutation or data output path',()=>{
 assert.match(BOOKING_HANDOFF_DATASET_SQL,/repeatable read read only/);assert.doesNotMatch(BOOKING_HANDOFF_DATASET_SQL,/\b(?:update|insert|delete|alter|drop)\b/i);
 assert.match(BOOKING_HANDOFF_PURE_PROBE,/pure_probe_network_forbidden/);assert.doesNotMatch(BOOKING_HANDOFF_PURE_PROBE,/\.server|instrumentation|loadEnvConfig|process\.env/);
 if(process.platform!=='linux'||process.getuid?.()!==0)assert.throws(()=>assertBookingHostInvocation({lock:true,toolRevision:'f'.repeat(40)}),/linux_root/);
 const source=readFileSync(new URL('./booking-handoff-execution.mjs',import.meta.url),'utf8');assert.match(source,/acquireProductionMigrationLock/);
 assert.doesNotMatch(source,/session_replication_role|disable trigger|truncate |restartProcessId|pm2.*restart|--force|--skip/);
});
