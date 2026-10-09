//Pure/static/failure orchestration only; no PostgreSQL or successful fake SQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {periodContinuationCapacityLimit,periodContinuationCapacityMaxArtifact,periodContinuationCapacityWriteTables,
 periodContinuationCapacityRemaining,periodContinuationCapacityCallHash,verifyPeriodContinuationCapacityNative} from './attendance-period-continuation-capacity-native.mjs';

const source=readFileSync(new URL('./attendance-period-continuation-capacity-native.mjs',import.meta.url),'utf8');
const names=['merchants',...periodContinuationCapacityWriteTables,'merchant_attendance_events'];
const params={site:'99990001',periodId:id(231800999),rpc:'faolla_attendance_period_closure_v2',operationId:id(231800001),action:'send'};
const has=(...values)=>values.forEach(value=>assert(source.includes(value),value));
const order=(...values)=>{let at=-1;for(const value of values){at=source.indexOf(value,at+1);assert(at>=0,value);}};
const saved=()=>{const artifactText=JSON.stringify({saved:'原始归档',unchanged:true});return {artifactText,artifact:JSON.parse(artifactText),
 artifactBytes:Buffer.byteLength(artifactText),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};};

test('inert import and non-owned context cannot acquire a connection',async()=>{
 assert.equal(typeof verifyPeriodContinuationCapacityNative,'function');await assert.rejects(verifyPeriodContinuationCapacityNative({}),/capacity_synthetic_owned_context_required/);
 assert.doesNotMatch(source,/process\.argv|process\.env|listen\(|spawn\(|initdb|create database|pg_dump|playwright/i);
});
test('quota is unchanged64MiB and physical new artifact is bounded256KiB',()=>{
 assert.equal(periodContinuationCapacityLimit,64*1024*1024);assert.equal(periodContinuationCapacityMaxArtifact,256*1024);
 for(const size of [1,1024,262144]){
  assert.equal(periodContinuationCapacityRemaining(size)+size,periodContinuationCapacityLimit);
  assert.equal(periodContinuationCapacityRemaining(size,1)+size,periodContinuationCapacityLimit+1);
 }
 for(const size of [0,-1,1.5,262145,NaN,Infinity,'32',null])assert.throws(()=>periodContinuationCapacityRemaining(size));
 for(const extra of [-1,2,0.5,NaN,'0',null])assert.throws(()=>periodContinuationCapacityRemaining(1024,extra));
});
test('send allowance excludes only the exact site/period/operation and site quota row',()=>{
 const sql=periodContinuationCapacityCallHash(names,params);
 assert(sql.includes(`t.period_id='${params.periodId}' and t.operation_id='${params.operationId}'`));
 assert(sql.includes(`t.period_id='${params.periodId}' and t.artifact_id='${params.operationId}'`));
 assert(sql.includes(`from public.merchant_attendance_period_storage t where t.merchant_id<>'${params.site}'`));
 assert(sql.includes('from public.merchant_attendance_events t )'));assert(sql.includes('from public.merchant_attendance_leave_entries t )'));
 assert(!sql.includes('231809999'));
});
test('leave cancellation allows only its exact new entry, never old request or period changes',()=>{
 const sql=periodContinuationCapacityCallHash(names,{...params,rpc:'faolla_attendance_leave_v1',action:'cancel'});
 assert(sql.includes(`from public.merchant_attendance_leave_entries t where not(t.merchant_id='${params.site}' and t.operation_id='${params.operationId}')`));
 for(const table of periodContinuationCapacityWriteTables.filter(n=>n!=='merchant_attendance_leave_entries'))assert(sql.includes(`from public.${table} t )`),table);
});
test('reopen allowance does not permit artifacts/metadata/quota and reads exclude nothing',()=>{
 const reopen=periodContinuationCapacityCallHash(names,{...params,action:'reopen'});
 for(const table of ['merchant_attendance_period_artifacts','merchant_attendance_period_artifact_metadata','merchant_attendance_period_storage'])assert(reopen.includes(`from public.${table} t )`));
 const read=periodContinuationCapacityCallHash(names,{...params,operationId:null,action:null});assert(!read.includes('where '));
 assert.throws(()=>periodContinuationCapacityCallHash(['bad;drop'],params));
 assert.throws(()=>periodContinuationCapacityCallHash([],params));
 assert.throws(()=>periodContinuationCapacityCallHash(['merchants','merchants'],params));
});
test('same connection stores other-table baseline INSIDE BEGIN and no synchronous external query while active',()=>{
 const body=source.slice(source.indexOf(' try{\n  const profile='),source.indexOf('\n finally{'));
 has("set_config('faolla.capacity231_other',${otherHash},true)","${otherHash}=current_setting('faolla.capacity231_other')");
 assert.doesNotMatch(body,/d\.(?:fingerprint|definitions|tableCatalog|exec|inventory)\(|native\.query\(|await (?:periodArchive|archive)\(/);
 assert.equal(source.match(/native\.connect\(\)/g)?.length,1);
 order('const facts=d.fingerprint()', 'connection=native.connect()',"await step('rollback','rollback;')",'await connection.close()',"['facts',()=>d.fingerprint(),facts]");
});
test('original limits and service role remain; all rejects, reads and replays have full zero-write guard',()=>{
 has("assert(++steps<=100", "set local lock_timeout='3s';set local statement_timeout='10s';", "assert current_user='service_role'",
  'v:=${expression};set constraints all immediate;set constraints all deferred',
  'get stacked diagnostics e=message_text,sql_state=returned_sqlstate,stack_context=pg_exception_context',
  'capacity_read_replay_rejection_changed_facts','capacity_write_outside_exact_operation','capacity_old_row_changed:',
  'except select to_jsonb(current_row)','capacity_fixed_head_frame_changed','capacity_argument_literal_schema_rewrite');
 assert.doesNotMatch(source,/disable trigger|drop (?:schema|table|trigger)|alter table|truncate|delete from/i);
 const directWrites=[...source.matchAll(/(?:insert into|update) public\.(merchant_\w+)/gi)].map(m=>m[1]);
 assert.deepEqual(directWrites,['merchant_attendance_period_storage']);
 assert(Object.isFrozen(periodContinuationCapacityWriteTables));
});
test('real quota scenario keeps v1/v2 rejection codes distinct and exact artifact bytes come from actual submitted JSONB',()=>{
 has("legacy(q(),command('send',head,changed.preview.artifact.sourceFingerprint)),e=>e.code==='attendance_period_limit'",
  "run(q(),command('send',head,changed.preview.artifact.sourceFingerprint)),e=>e.code==='attendance_period_storage_limit'",
  "select octet_length(convert_to(${json(args.p_artifact)}::text,'UTF8'))",'periodContinuationCapacityRemaining(bytes,shortage)',
  "head=await run(q(),command('reopen',head),false)","head=await legacy(q(),reuse)","action:'cancel'",'parseLeaveResult(leaveRaw.data,leaveQuery,cancellation,d.owner)',
  'assert.notEqual(changed.preview.artifact.sourceFingerprint,originalFingerprint)',
  'artifacts:firstBudget.artifacts+1,metadata:firstBudget.metadata+1');
 order("await inject(periodContinuationCapacityLimit,'inject_full_projection')",'head=await legacy(q(),reuse)',"action:'cancel'",'shortage=1;', 'shortage=0;');
});
test('all quota mutation is explicitly disclosed and old fixed bodies survive saved read/replay/export',()=>{
 has('injectedQuotaProjection:true,physicallyFilledBudget:false','listAndLifetimeCardinalityCoverage:false',
  'syntheticAuth:true,realAuth:false,browser:false','actualLeaveRpcAndStrictProjection:true',
  'assert.deepEqual(recovered.operation,acceptedReceipt)','assert.deepEqual(replay.operation,acceptedReceipt)',
  'assert.deepEqual(oldRecovered.operation,reuseReceipt)',"q('export','owner',{version:originalVersion})",'assert.deepEqual(await snapshot(\'budget_after_saved_reads\'),fullBudget)',
  'assert.deepEqual(periodContinuationArchiveBytes(lastRpc.value),fixed)','capacity_injection_other_site','capacity_injection_changed_facts');
});

function failureHarness({mutate=false,closeFails=false}={}){
 const events=[],artifact=saved(),owned={schema:'attendance_race_'+'a'.repeat(32)},state={facts:'facts',defs:'defs',catalog:'catalog'};
 const d={syntheticOnly:true,owned,site:params.site,owner:id(99),guard:'--owned\n',inventory:()=>names,
  fingerprint:()=>{events.push('external_facts');return state.facts;},definitions:()=>state.defs,tableCatalog:()=>state.catalog};
 const ctx={d,h:{syntheticOnly:true,workerId:id(174703),employeeId:id(174701),employeeAuthUserId:id(174702)},periodId:params.periodId,
  pq:(mode,access,periodId)=>({siteId:d.site,access,workerId:id(174703),fromDate:'2026-10-05',throughDate:'2026-10-05',mode,periodId,operationId:null,version:null}),
  periodArchive:()=>artifact,archive:()=>artifact,oldArchive:artifact,scope:{schema:owned.schema,sql:s=>s},native:{query:()=>'',pass:()=>events.push('pass'),
   connect:()=>{events.push('connect');return {step:async sql=>{events.push(sql);if(mutate)state.facts='changed';throw Error('synthetic first-step failure');},
    close:async()=>{events.push('close');if(closeFails)throw Error('synthetic close failure');}};}}};
 const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\nverifyPeriodContinuationCapacityNative;';
 const fn=runInNewContext(code,{assert,Buffer,JSON,id,moduleUrl:'file:///synthetic/capacity.mjs',
  assertLifecycleSandbox:()=>owned,quote:v=>"'"+v+"'",json:v=>"'"+JSON.stringify(v)+"'::jsonb",outageNativeFingerprintSql:()=>"'facts'",
  periodContinuationArchiveBytes,periodContinuationSerialization,createRequire:()=>()=>({parsePeriodClosureV2Query:q=>q,parsePeriodClosureV2Command:(_q,c)=>c})},{timeout:1000});
 return {events,run:()=>fn(ctx)};
}
test('first-step failure closes connection BEFORE external preservation checks and does not claim success',async()=>{
 const h=failureHarness();await assert.rejects(h.run(),e=>{assert.match(e.message,/period_capacity_native_failed:.*period_capacity:begin:synthetic first-step failure/s);assert.equal(e.errors.length,1);return true;});
 const start=h.events.indexOf('connect'),closed=h.events.indexOf('close');assert(start>=0&&closed>start);
 assert.match(h.events[start+1],/^begin;reset role;set local time zone 'UTC'/);
 assert.equal(h.events.indexOf('external_facts',start),closed+1);assert(!h.events.includes('pass'));
});
test('cleanup failure and unchanged-baseline failure both stay visible with root cause',async()=>{
 const h=failureHarness({mutate:true,closeFails:true});await assert.rejects(h.run(),e=>{
  assert.equal(e.errors.length,3);assert.equal(e.cause,e.errors[0]);assert.match(e.message,/synthetic close failure/);assert.match(e.message,/capacity_rollback_facts/);return true;
 });assert(h.events.includes('close'));assert(!h.events.includes('pass'));
});
