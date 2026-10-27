import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {executeBookingIngressDrain,executeBookingRepairActivation,BOOKING_HANDOFF_DATASET_SQL,BOOKING_HANDOFF_PURE_PROBE} from './booking-handoff-execution.mjs';
import {assertBookingHostInvocation} from './booking-handoff-host-io.mjs';
const h=n=>n.repeat(64),window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-26T10:00:00.000Z',deadlineAt:'2026-10-26T10:10:00.000Z'};
test('preflight and activation revalidate the same immutable-application backup binding',()=>{
 const code=readFileSync(new URL('./booking-handoff-execution.mjs',import.meta.url),'utf8');
 assert.ok(code.includes("import {validateBookingPublicationBackupEvidence as validateAttendanceBackupEvidence} from './booking-registry-backup.mjs'"));
 assert.equal((code.match(/await validateAttendanceBackupEvidence\(\{target:CANDIDATE/g)||[]).length,2);
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
test('ingress drain proves old worker exit and zero connections before actual automation evidence',async()=>{
 const f=drainFixture(),receipt=await executeBookingIngressDrain(f.operations,{window});assert.equal(receipt.automationEligibleRecords,0);
 assert.equal(f.events.filter(n=>n==='install').length,1);assert.equal(f.events.filter(n=>n==='reload').length,1);
 assert.equal(f.events.filter(n=>n==='drain').length,3);assert.ok(f.events.indexOf('probeGate')<f.events.indexOf('drain'));assert.equal(f.events.at(-1),'complete');
});
for(const name of ['authorize','workers','begin','install','syntax','reload','probeGate','drain','automation','complete'])test('gate failure '+name+' cannot be labelled drained or automatically replayed',async()=>{
 const f=drainFixture({failAt:name});await assert.rejects(executeBookingIngressDrain(f.operations,{window}),/unknown_/);assert.equal(f.events.filter(n=>n===name).length,1);
});
test('busy old worker and any eligible automation fail closed within the drain reserve',async()=>{
 for(const options of [{neverDrained:true},{eligible:1}]){const f=drainFixture(options);await assert.rejects(executeBookingIngressDrain(f.operations,{window}),/not_drained|automation_drain/);assert.equal(f.events.includes('complete'),false);}
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
