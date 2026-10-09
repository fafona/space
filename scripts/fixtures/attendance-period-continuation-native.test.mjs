//Pure contract/static/orchestration checks, not database or authentication proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createPeriodContinuationPrefix,periodContinuationArchiveBytes,periodContinuationNativeWriteTables,periodContinuationSerialization,verifyPeriodContinuationNative} from './attendance-period-continuation-native.mjs';

const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-period-continuation-native.mjs',import.meta.url),'utf8');
const {parsePeriodClosureV2Command,parsePeriodClosureV2Query}=require('../../src/lib/merchantAttendancePeriodClosureV2.ts');
const has=(...values)=>values.forEach(value=>assert(source.includes(value),value));
const ordered=(...values)=>{let index=-1;for(const value of values){index=source.indexOf(value,index+1);assert(index>=0,value);}};
const params={periodId:id(231600999),ownerId:id(99),employeeAuthUserId:id(174702),fingerprint:'a'.repeat(64)};
const head=()=>({state:'sealed',sealed:true,unresolvedDispute:false,revision:7,currentVersion:2,confirmedVersion:2});
const artifact=()=>{const artifactText=JSON.stringify({saved:'旧归档🙂',unchanged:true});return {artifactText,artifact:JSON.parse(artifactText),artifactBytes:Buffer.byteLength(artifactText,'utf8'),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};};

test('inert export refuses non-owned context before opening anything',async()=>{
 assert.equal(typeof verifyPeriodContinuationNative,'function');await assert.rejects(verifyPeriodContinuationNative({}),/continuation_synthetic_owned_context_required/);
 assert.doesNotMatch(source,/process\.argv|process\.env|listen\(|spawn\(|initdb|CREATE DATABASE|pg_dump|playwright/i);
});
test('prefix explicitly builds92 entries and18 reused version references from sealed7/2 to99/20',()=>{
 const p=createPeriodContinuationPrefix(head(),params);assert.equal(p.syntheticEntries,92);assert.equal(p.syntheticVersionReferences,18);
 assert.equal(p.targetRevision,99);assert.equal(p.targetVersion,20);assert.equal(new Set(p.rows.map(r=>r.command.operationId)).size,92);
 assert.deepEqual(p.rows.slice(0,4).map(r=>r.command.action),['reopen','send','confirm','seal']);
 assert.deepEqual(p.rows.slice(-20).map(r=>r.command.action),Array(20).fill('respond'));
 assert.deepEqual(p.rows.map(r=>r.revision),Array.from({length:92},(_,i)=>8+i));
 assert.equal(p.rows.at(-1).version,20);
});
test('every synthetic row independently satisfies the actual strict V2 command parser and CAS continuity',()=>{
 let revision=7,version=2;const p=createPeriodContinuationPrefix(head(),params);
 for(const row of p.rows){
  const access=row.command.action==='confirm'?'self':'owner',q=parsePeriodClosureV2Query({siteId:'99990001',access,workerId:id(174703),
   fromDate:'2026-10-05',throughDate:'2026-10-05',mode:'detail',periodId:params.periodId,operationId:null,version:null,cursor:null});
  assert.deepEqual(parsePeriodClosureV2Command(q,row.command),row.command);
  assert.equal(row.command.expectedRevision,revision);assert.equal(row.command.expectedVersion,version);
  revision++;if(row.command.action==='send')version++;assert.equal(row.revision,revision);assert.equal(row.version,version);
  assert.equal(row.actorId,access==='self'?params.employeeAuthUserId:params.ownerId);
  assert.equal(row.command.expectedFingerprint,['send','confirm','seal'].includes(row.command.action)?params.fingerprint:null);
  assert.match(row.command.reason,/not actual historical employee confirmation/);
 }
});
test('prefix refuses invalid state, impossible room, malformed fingerprint and missing consent state',()=>{
 for(const change of [h=>h.sealed=false,h=>h.state='open',h=>h.unresolvedDispute=true,h=>h.revision=99,h=>h.revision=0,
  h=>h.currentVersion=21,h=>h.currentVersion=0,h=>h.currentVersion=2.5,h=>h.confirmedVersion=null,h=>h.revision=50]){
  const h=head();change(h);assert.throws(()=>createPeriodContinuationPrefix(h,params));
 }
 assert.throws(()=>createPeriodContinuationPrefix(head(),{...params,fingerprint:'invalid'}));
 assert.throws(()=>createPeriodContinuationPrefix(head(),{...params,ownerId:'bad'}));
});
test('already-version20 prefix appends only non-resolving owner explanations',()=>{
 const p=createPeriodContinuationPrefix({...head(),revision:97,currentVersion:20,confirmedVersion:20},params);
 assert.equal(p.syntheticEntries,2);assert.equal(p.syntheticVersionReferences,0);
 assert(p.rows.every(r=>r.command.action==='respond'&&r.actorId===params.ownerId&&r.version===20&&r.command.expectedFingerprint===null));
});
test('archive proof pins exact UTF8 bytes, SHA and full parsed object',()=>{
 const saved=artifact();assert.equal(periodContinuationArchiveBytes(saved).artifactBytes,Buffer.byteLength(saved.artifactText));
 assert(saved.artifactBytes>saved.artifactText.length);
 for(const changed of [{...saved,artifactBytes:saved.artifactText.length},{...saved,artifactSha256:'0'.repeat(64)},{...saved,artifact:{unchanged:false}}])assert.throws(()=>periodContinuationArchiveBytes(changed));
});
test('only three closure ledger tables writable; original artifacts, metadata, quota and sources remain protected',()=>{
 assert.deepEqual(periodContinuationNativeWriteTables,['merchant_attendance_period_closures','merchant_attendance_period_versions','merchant_attendance_period_entries']);
 assert(Object.isFrozen(periodContinuationNativeWriteTables));
 has('names.filter(n=>!periodContinuationNativeWriteTables.includes(n))','continuation_write_changed_other_facts','continuation_prefix_other_facts_changed',
  'select old_rows.value','except select to_jsonb(current_row)','continuation_fixed_head_frame_changed');
 assert.doesNotMatch(source,/disable trigger|drop (?:schema|table|trigger|function)|alter table|truncate|delete from/i);
 const writes=[...source.matchAll(/(?:insert into|update) public\.(merchant_\w+)/gi)].map(x=>x[1]);
 assert.deepEqual([...new Set(writes)].sort(),[...periodContinuationNativeWriteTables].sort());
});
test('one inherited connection with fixed UTC, bounded steps and original timeout limits',()=>{
 assert.equal(source.match(/native\.connect\(\)/g)?.length,1);assert.doesNotMatch(source,/d\.exec\(/);
 assert.match(periodContinuationSerialization,/reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';set local extra_float_digits=3;/);
 has("assert(++steps<=100", "set local lock_timeout='3s';set local statement_timeout='10s';", "label==='begin'?'begin;'", 'scope.sql(',
  'assert.equal(scope.sql(json(args)),json(args)');
});
test('immutable head guard uses an alias distinct from the prefix DO row variable',()=>{
 has('to_jsonb(existing_head_record)-${immutableHead}',
  'from public.merchant_attendance_period_closures existing_head_record',
  'where existing_head_record.merchant_id=${site} and existing_head_record.period_id=${pid}');
});
test('real service executes all RPCs under service role, captures errors and enforces zero-write reads/replays',()=>{
 has('executePeriodClosuresV2({query,command,authUserId:actor(query.access),moduleEnabled:allow},service)',
  "assert current_user='service_role'",'v:=${expression};set constraints all immediate;set constraints all deferred',
  'get stacked diagnostics e=message_text,sqlstate_value=returned_sqlstate,context_value=pg_exception_context',
  'continuation_read_replay_rejection_changed_facts','output.error===\'attendance_operation_not_found\'',
  "args.p_query.mode==='preview'",'sameOperationChangedBodyRejected:true');
 ordered('createPeriodContinuationPrefix(head.period',"await step('synthetic_capacity_prefix'",'set constraints all immediate;set constraints all deferred;perform public.faolla_attendance_period_summary_v2(c)',
  'continuation_prefix_other_facts_changed',"perform set_config('faolla.continuation231_old'");
});
test('capacity success proves both page boundaries, old raw receipts, retention source and unchanged budget',()=>{
 has('assert.deepEqual(historyPageSizes,[50,50,1])','assert.deepEqual(versionPageSizes,[20,1])',
  'assert.equal(new Set(history.map(x=>x.operationId)).size,101)',"e.code==='attendance_period_protocol_required'",
  'assert.deepEqual(oldRecovered.operation,originalReceipt.operation)','assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),originalBytes)',
  'assert.deepEqual(retainedAfter.data.item.source,retainedBefore.data.item.source)',
  'retainedAfter.data.item.sourceFingerprint,retainedBefore.data.item.sourceFingerprint',
  'continuation_same_source_reuse_charged_budget','continuation_capacity_or_replay_charged_budget',
  'actualHistoricalRequests:false','syntheticAuth:true,realAuth:false,browser:false');
});

//Run the actual failure/cleanup orchestration with a fake connection that fails
//its FIRST step; it never supplies fabricated successful business responses.
function failingHarness(mutate=false,closeFails=false){
 const events=[],saved=artifact(),owned={schema:'attendance_race_'+'a'.repeat(32)},state={facts:'facts',defs:'defs',catalog:'catalog'};
 const names=[...periodContinuationNativeWriteTables,'merchant_attendance_period_storage','merchant_attendance_period_artifact_metadata'];
 const d={syntheticOnly:true,owned,site:'99990001',owner:params.ownerId,guard:'--owned\n',inventory:()=>names,
  fingerprint:()=>state.facts,definitions:()=>state.defs,tableCatalog:()=>state.catalog};
 const ctx={d,h:{syntheticOnly:true,workerId:id(174703),employeeAuthUserId:params.employeeAuthUserId},periodId:params.periodId,
  pq:(mode,access,periodId)=>({siteId:d.site,access,workerId:id(174703),fromDate:'2026-10-05',throughDate:'2026-10-05',mode,periodId,operationId:null,version:null}),
  periodArchive:()=>saved,archive:()=>saved,oldArchive:saved,scope:{schema:owned.schema,sql:s=>s},
  native:{query:()=>'',pass:()=>events.push('pass'),connect:()=>{events.push('connect');return {
   step:async sql=>{events.push(sql);if(mutate)state.facts='changed';throw Error('synthetic first-step failure');},
   close:async()=>{events.push('close');if(closeFails)throw Error('synthetic close failure');}};}}};
 const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\nverifyPeriodContinuationNative;';
 const fn=runInNewContext(code,{assert,Buffer,JSON,createHash,id,moduleUrl:'file:///synthetic/fixture.mjs',
  assertLifecycleSandbox:()=>owned,quote:v=>"'"+v+"'",json:v=>"'"+JSON.stringify(v)+"'::jsonb",outageNativeFingerprintSql:()=>"'facts'",
  createRequire:()=>()=>({parsePeriodClosureV2Query:q=>q,parsePeriodClosureV2Command:(_q,c)=>c})},{timeout:1000});
 return {events,run:()=>fn(ctx)};
}
test('failed first transaction step still closes owned connection and does not claim success',async()=>{
 const h=failingHarness();await assert.rejects(h.run(),e=>{
  assert.match(e.message,/period_continuation_native_failed:.*period_continuation:begin:synthetic first-step failure/s);
  assert.equal(e.errors.length,1);assert.equal(e.cause,e.errors[0]);return true;
 });
 assert.equal(h.events[0],'connect');assert.match(h.events[1],/^begin;reset role;set local time zone 'UTC'/);
 assert.equal(h.events.at(-1),'close');assert(!h.events.includes('pass'));
});
test('original fact corruption and cleanup errors remain explicit instead of being swallowed',async()=>{
 const h=failingHarness(true,true);await assert.rejects(h.run(),e=>{
  assert.equal(e.errors.length,3);assert.match(e.message,/synthetic close failure/);assert.match(e.message,/continuation_rollback_facts/);return true;
 });assert(h.events.includes('close'));assert(!h.events.includes('pass'));
});
test('fixed archives are only read before the transaction and after connection close',()=>{
 ordered('const fixed=periodContinuationArchiveBytes(await periodArchive())','const failures=[],connection=native.connect()',
  "await step('rollback','rollback;')",'await connection.close()',"['old207',async()=>periodContinuationArchiveBytes(await periodArchive()),fixed]",
  "native.pass('231 real service continuation");
 assert.equal(source.match(/await periodArchive\(\)/g)?.length,2);
});
