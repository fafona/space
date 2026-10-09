import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
import {assertAttendanceRecoveryArchive,attendanceRecoveryReadProbeSql,runAttendanceRecoveryReadProbe,
 createAttendanceRecoveryBusinessPlan,captureAttendanceRecoveryBusinessBaseline,verifyAttendanceRecoveryNativeChecks} from './merchant-attendance-recovery-native-checks.mjs';

const who={schema:'attendance_race_'+'a'.repeat(32),siteId:'99990001',owner:id(99),workerId:id(201),employeeId:id(101),employeeAuthUserId:id(1),periodId:id(20701)};
const names=['merchants','merchant_attendance_outage_relation_operations'];
const snapshot=()=>({periods:[{periodId:who.periodId,workerId:who.workerId,fromDate:'2026-10-01',throughDate:'2026-10-01',version:1}],
 periodOperations:[{periodId:who.periodId,operationId:id(20702),actor:who.owner,access:'owner'}],
 outages:[{operationId:id(223100001),actor:who.owner,access:'owner'}],
 relations:[{declarationId:id(223102004),relatedDeclarationId:id(223102006),operationId:id(223102010),actor:who.owner,revision:1,action:'apply'},
  {declarationId:id(223102004),relatedDeclarationId:id(223102006),operationId:id(223102011),actor:who.owner,revision:2,action:'revoke'},
  {declarationId:id(223104006),relatedDeclarationId:id(223104004),operationId:id(223104012),actor:who.owner,revision:1,action:'apply'}],
 identity:{workerId:who.workerId,employeeId:who.employeeId,employeeAuthUserId:who.employeeAuthUserId},security:{}});
const packet=()=>({value:{synthetic:true},error:null,sqlState:null,before:'a'.repeat(32),after:'a'.repeat(32)});

test('inert import exports no process, filesystem-write, database-start or source mutation path',()=>{
 const source=readFileSync(new URL('./merchant-attendance-recovery-native-checks.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/node:(?:child_process|net)|writeFile|mkdir|createDatabase|pg_ctl|initdb|--clean/);
 assert.doesNotMatch(source,/\b(?:insert into|update public|delete from|truncate|alter table|drop table|create table)\b/i);
 assert.match(source,/command:null|p_command,null/);assert.match(source,/freshCommandsSent:0/);
});
test('probe runs real service-role read in explicitly bounded rollback transaction with fact hashes',()=>{
 const sql=attendanceRecoveryReadProbeSql({...who,names,expression:"public.faolla_attendance_outage_v1('{}'::jsonb,'"+id(99)+"',null,false)"});
 assert.match(sql,/^begin;/);assert.match(sql,/set local time zone 'UTC'/);assert.match(sql,/set local datestyle='ISO, YMD'/);
 assert.match(sql,/statement_timeout='15s'/);assert.match(sql,/lock_timeout='3s'/);assert.match(sql,/set local role service_role/);
 assert.match(sql,/before_hash=after_hash/);assert.match(sql,/get stacked diagnostics/);assert.match(sql,/rollback;$/);
 assert.doesNotMatch(sql,/commit;|read only/i);assert.match(sql,/nspowner::regrole::text='postgres'/);
});
test('probe rejects unowned schema and invalid inventory before invoking executor',async()=>{
 let calls=0;const exec=()=>{calls++;return JSON.stringify(packet());};
 await assert.rejects(runAttendanceRecoveryReadProbe(exec,{schema:'public',names,expression:'1'}));
 await assert.rejects(runAttendanceRecoveryReadProbe(exec,{schema:who.schema,names:['merchants;drop database x'],expression:'1'}));
 assert.equal(calls,0);
});
test('probe handles synchronous/asynchronous executors, and refuses mutations or malformed result',async()=>{
 const options={schema:who.schema,names,expression:'1'};
 assert.deepEqual(await runAttendanceRecoveryReadProbe(()=>JSON.stringify(packet()),options),packet());
 assert.deepEqual(await runAttendanceRecoveryReadProbe(async()=>JSON.stringify(packet()),options),packet());
 await assert.rejects(runAttendanceRecoveryReadProbe(()=>JSON.stringify({...packet(),after:'b'.repeat(32)}),options),/changed_facts/);
 await assert.rejects(runAttendanceRecoveryReadProbe(()=>JSON.stringify({...packet(),extra:true}),options));
 await assert.rejects(runAttendanceRecoveryReadProbe(()=>JSON.stringify({...packet(),error:'attendance_access_denied',sqlState:null}),options));
});
test('archive validation preserves exact UTF8 text including whitespace and non-ASCII',()=>{
 const artifact={name:'合成 😀',version:1},artifactText=' { "name": "合成 😀", "version": 1 }\n';
 const value={artifact,artifactText,artifactBytes:Buffer.byteLength(artifactText),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};
 assert.deepEqual(assertAttendanceRecoveryArchive(value),{artifactText,artifactBytes:value.artifactBytes,artifactSha256:value.artifactSha256});
 assert.throws(()=>assertAttendanceRecoveryArchive({...value,artifactText:JSON.stringify(artifact)}));
 assert.throws(()=>assertAttendanceRecoveryArchive({...value,artifactBytes:artifactText.length}),/bytes/);
 assert.throws(()=>assertAttendanceRecoveryArchive({...value,artifactSha256:'0'.repeat(64)}),/sha/);
 assert.throws(()=>assertAttendanceRecoveryArchive({...value,artifact:{...artifact,version:2}}),/json/);
});
test('plan uses original query direction and command-free recover for every original operation',()=>{
 const raw=snapshot(),plan=createAttendanceRecoveryBusinessPlan(who,raw);
 const relation=plan.filter(p=>p.kind==='relations'&&p.pick==='receipt');assert.equal(relation.length,raw.relations.length);
 for(let i=0;i<relation.length;i++){
  assert.equal(relation[i].query.declarationId,raw.relations[i].declarationId);assert.equal(relation[i].query.relatedDeclarationId,raw.relations[i].relatedDeclarationId);
  assert.equal(relation[i].query.operationId,raw.relations[i].operationId);assert.equal(relation[i].query.mode,'recover');assert.equal(relation[i].actor,raw.relations[i].actor);
 }
 assert(plan.every(p=>!Object.hasOwn(p,'command')));
 assert.equal(plan.filter(p=>p.pick==='operation').length,1);assert.equal(plan.filter(p=>p.kind==='outage'&&p.pick==='receipt').length,1);
});
test('plan compares current revoked head for owner and actual self without treating older apply as live',()=>{
 const plan=createAttendanceRecoveryBusinessPlan(who,snapshot()),heads=plan.filter(p=>p.pick==='current');assert.equal(heads.length,4);
 const revoked=heads.filter(p=>p.headAction==='revoke');assert.equal(revoked.length,2);assert(revoked.every(p=>p.headRevision===2));
 assert.deepEqual(revoked.map(p=>[p.query.access,p.actor]),[['owner',who.owner],['self',who.employeeAuthUserId]]);
});
test('plan tests unauthorized owner, reversed original direction and actual rolled-back operation absence',()=>{
 const errors=createAttendanceRecoveryBusinessPlan(who,snapshot()).filter(p=>p.pick==='error');assert.equal(errors.length,3);
 assert.deepEqual(errors.map(p=>p.error),['attendance_access_denied','attendance_operation_conflict','attendance_outage_relations_not_found']);
 const rolled=errors[2];assert.equal(rolled.query.operationId,id(223104011));assert.equal(rolled.query.declarationId,id(223104004));
 assert.equal(rolled.query.relatedDeclarationId,id(223104006));
});
test('no empty history, missing revoke, swapped identity or absent223 rollback witness passes as coverage',()=>{
 for(const key of ['periods','periodOperations','outages','relations'])assert.throws(()=>createAttendanceRecoveryBusinessPlan(who,{...snapshot(),[key]:[]}));
 const raw=snapshot();raw.relations=raw.relations.filter(o=>o.action!=='revoke');assert.throws(()=>createAttendanceRecoveryBusinessPlan(who,raw),/revoked_relation/);
 const bad=snapshot();bad.identity.employeeAuthUserId=id(88);assert.throws(()=>createAttendanceRecoveryBusinessPlan(who,bad));
 const missing=snapshot();missing.relations=missing.relations.filter(o=>o.operationId!==id(223104012));assert.throws(()=>createAttendanceRecoveryBusinessPlan(who,missing),/rollback_winner/);
 const huge=snapshot();huge.outages=Array.from({length:101},()=>huge.outages[0]);assert.throws(()=>createAttendanceRecoveryBusinessPlan(who,huge),/bounded/);
});
test('capture and target verifier refuse non-synthetic or pre223 context before any database access',async()=>{
 let calls=0;const exec=()=>{calls++;throw Error('must not call');};
 await assert.rejects(captureAttendanceRecoveryBusinessBaseline({d:{syntheticOnly:false},native:{query:exec}}));
 await assert.rejects(verifyAttendanceRecoveryNativeChecks({d:{syntheticOnly:true},h:{syntheticOnly:true}},{restoredExec:exec,baseline:{}}));
 assert.equal(calls,0);
});
test('source/target definition explicitly distinguishes unpopulated security facts from runtime denial coverage',()=>{
 const source=readFileSync(new URL('./merchant-attendance-recovery-native-checks.mjs',import.meta.url),'utf8');
 for(const required of ['not_installed','not_populated','saved_state_equal','runtimeDenialTested:false','pauseGeneration:',
  'realAuthentication:false','callerOwnsRestoreAndCleanup:true','assert.deepEqual(actual,baseline.expected[i]',
  "assert.equal(args.p_allow_write,false)","projectOutageRelationsResult(raw,probe.query,probe.actor,null)"])
  assert(source.includes(required),required);
 assert(!source.includes('d.guard'),'source-OID-specific guard must not be copied into restored target');
});
