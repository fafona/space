//Pure planning/shape/static/cleanup tests. No database, service or browser run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
import {periodContinuationCountsPlan,periodContinuationCountsArtifact,periodContinuationCountsTables,periodContinuationCountsBodyLimit,verifyPeriodContinuationCountsNative} from './attendance-period-continuation-counts-native.mjs';
const require=createRequire(import.meta.url),source=readFileSync(new URL('./attendance-period-continuation-counts-native.mjs',import.meta.url),'utf8');
const {parsePeriodClosureArtifact}=require('../../src/lib/merchantAttendancePeriodClosure.ts');
const {periodClosureUiArtifact}=require('./attendance-period-closure-ui-model.ts');
const has=(...values)=>values.forEach(v=>assert(source.includes(v),v));
const ordered=(...values)=>{let at=-1;for(const v of values){at=source.indexOf(v,at+1);assert(at>=0,v);}};
function emptyTemplate(){
 const a=periodClosureUiArtifact(),date=a.period.fromDate,end=new Date(Date.parse(date)+86400000).toISOString().replace('.000Z','.000000Z');
 a.period.throughDate=date;a.period.endAt=end;a.dayBoundaries=a.dayBoundaries.slice(0,1);
 a.report.base.throughDate=date;a.report.base.toAt=end;a.report.base.rows=[];a.report.missing=[];a.report.days=[];
 for(const values of Object.values(a.report.totals))for(const key of Object.keys(values))values[key]=0;
 a.source={sourceVersion:'attendance-period-source-v1',siteId:'12345678',workerId:a.worker.workerId,employeeId:a.worker.employeeId,employeeAuthUserId:a.worker.employeeAuthUserId,
  timeZone:'UTC',fromDate:date,throughDate:date,fromAt:a.period.startAt,toAt:end,dayBoundaries:a.dayBoundaries,
  report:{base:{items:[]},missing:[]},context:{pendingCorrections:[],missing:[],leave:[],calendar:[],plans:{items:[],sessions:[]},reviews:[]}};
 return a;
}
const saved=()=>{const artifactText='{"saved":"旧归档"}';return {artifactText,artifact:JSON.parse(artifactText),artifactBytes:Buffer.byteLength(artifactText),artifactSha256:createHash('sha256').update(artifactText).digest('hex')};};

test('inert export refuses unowned contexts without creating a connection',async()=>{
 await assert.rejects(verifyPeriodContinuationCountsNative({}),/counts_owned_synthetic_context_required/);
 assert.doesNotMatch(source,/process\.argv|process\.env|listen\(|spawn\(|initdb|CREATE DATABASE|pg_dump|playwright/i);
});
test('counts use independent worker/site baselines, including another workers existing periods',()=>{
 const p=periodContinuationCountsPlan(2,3);assert.equal(p.first,198);assert.equal(2+p.first+1,201);
 assert.equal(p.second,798);assert.equal(3+p.first+1+p.second,1000);assert.equal(p.total,996);
 assert.equal(p.rows.length,996);assert.equal(new Set(p.rows.map(r=>r.periodId)).size,996);assert.equal(new Set(p.rows.map(r=>r.operationId)).size,996);
 assert.equal(p.rows[0].date,'2001-01-01');assert(p.rows.at(-1).date<p.actual[0].date);
 assert.deepEqual(p.actual.map(t=>t.date),['2010-01-01','2010-01-02']);
 for(let i=1;i<p.rows.length;i++)assert.equal(Date.parse(p.rows[i].date)-Date.parse(p.rows[i-1].date),86400000);
});
test('count plan rejects occupied limits, impossible site counts and nonintegers',()=>{
 for(const values of [[200,200],[-1,0],[2,1],[2,800],[1.5,2],[2,2.5],[0,-1]])assert.throws(()=>periodContinuationCountsPlan(...values));
 assert.equal(periodContinuationCountsPlan(0,0).total,999);
});
test('empty-day transformation is nonmutating and passes actual strict archive parser',()=>{
 const template=emptyTemplate(),before=structuredClone(template);parsePeriodClosureArtifact(template);
 const a=periodContinuationCountsArtifact(template,'2001-01-02');parsePeriodClosureArtifact(a);
 assert.deepEqual(template,before);assert.equal(a.period.fromDate,'2001-01-02');assert.equal(a.period.throughDate,'2001-01-02');
 assert.equal(a.period.startAt,'2001-01-02T00:00:00.000000Z');assert.equal(a.period.endAt,'2001-01-03T00:00:00.000000Z');
 assert.equal(a.source.fromAt,a.period.startAt);assert.equal(a.source.toAt,a.period.endAt);
 assert.equal(a.report.base.asOf,template.report.base.asOf);assert.equal(a.worker.employeeAuthUserId,template.worker.employeeAuthUserId);
});
test('day transformation handles a boundary equal to the templates original start without cascading replacements',()=>{
 const template=emptyTemplate(),date=new Date(Date.parse(template.period.fromDate)-86400000).toISOString().slice(0,10);
 const a=periodContinuationCountsArtifact(template,date);assert.equal(a.period.endAt,template.period.startAt);parsePeriodClosureArtifact(a);
});
test('nonempty source, civil-day ambiguity and invalid dates fail closed instead of stripping records',()=>{
 for(const patch of [a=>a.period.timeZone='Europe/Madrid',a=>a.dayBoundaries[0].skipped=true,a=>a.report.base.rows=[{}],
  a=>a.source.context.leave=[{}],a=>a.source.report.base.items=[{}],a=>a.source.report.missing=[{}],
  a=>a.period.endAt='2026-09-02T01:00:00.000000Z']){const a=emptyTemplate();patch(a);assert.throws(()=>periodContinuationCountsArtifact(a,'2001-01-01'));}
 for(const date of ['2001-02-29','2001-13-01','bad'])assert.throws(()=>periodContinuationCountsArtifact(emptyTemplate(),date));
});
test('only closure storage six tables are allowed; no identities, raw facts or old rows are rewritten',()=>{
 assert.equal(periodContinuationCountsTables.length,6);assert(Object.isFrozen(periodContinuationCountsTables));
 assert.deepEqual([...new Set([...source.matchAll(/insert into public\.(merchant_\w+)/g)].map(m=>m[1]))].sort(),
  ['merchant_attendance_period_artifacts','merchant_attendance_period_closures','merchant_attendance_period_entries','merchant_attendance_period_versions']);
 assert.doesNotMatch(source,/(?:update|delete from) public\.|disable trigger|drop (?:schema|table|trigger|function)|alter table|truncate/i);
 has('select old_row.value','except select to_jsonb(current_row)','counts_old_row_changed:',"where r.merchant_id<>${site}",
  'counts_exact_quota_sum','counts_write_changed_other_facts','counts_prefix_other_facts_changed');
});
test('single bounded connection retains25s inherited lifetime,3s locks,10s SQL and1.5M step cap',()=>{
 assert.equal(source.match(/native\.connect\(\)/g)?.length,1);assert.doesNotMatch(source,/d\.exec\(|setTimeout|lifetime|120000/);
 has("assert(++steps<=100", "set local lock_timeout='3s';set local statement_timeout='10s';", 'text.length<1500000','offset+=80',
  'periodContinuationSerialization+d.guard',"label==='begin'?'begin;'",'scope.sql(json(args)),json(args)');
});
test('all synthetic chains have normal head artifact version entry order and enabled quota/FK guards',()=>{
 ordered('insert into public.merchant_attendance_period_closures','insert into public.merchant_attendance_period_artifacts',
  'insert into public.merchant_attendance_period_versions','insert into public.merchant_attendance_period_entries',
  'perform public.faolla_attendance_period_summary_v2(c)','set constraints all immediate;set constraints all deferred;${oldGuard}');
 has("source_hash:=encode(sha256(convert_to((body->'source')::text,'UTF8')),'hex')",'parsePeriodClosureArtifact(artifact)',
  'Synthetic231 complete capacity prefix, not an actual historical request',"1,1,'review',false,null,false",'counts_prefix_nonoverlap');
});
test('8MiB includes actual PostgreSQL UTF8 serialized prefix and both real fresh inserts',()=>{
 assert.equal(periodContinuationCountsBodyLimit,8388608);
 has("size_value:=octet_length(convert_to(text_value,'UTF8'))",'counts_added_bodies_8mib_cap','counts_actual_insert_body_cap',
  "current_setting('faolla.counts231_initial_bytes')::bigint",'counts_all_added_bodies_8mib_cap','quotaEqualsArtifactSum:true');
});
test('actual crossing sends use real service source projection and independent exact counters',()=>{
 has('executePeriodClosuresV2({query,command,authUserId:d.owner,moduleEnabled:allow},service)',
  "assert current_user='service_role'",'counts_read_replay_rejection_not_zero_write',"await run(q('preview',target.date))",
  "before_worker_crossing')).worker,200","after_worker_crossing')).worker,201","before_site_crossing')).site,1000",'finalCounts.site,1001');
 assert.equal(source.match(/await actualSend\(/g)?.length,2);
});
test('actual25+1 pages bind unique original26IDs, then saved civil frame export and flagoff receipts',()=>{
 has('first.items.length,25','second.items.length,1','second.nextCursor,null','new Set(listed.map(x=>x.periodId)).size,26',
  'prepared.slice(0,26).map(x=>x.periodId).sort()',"q('export',chosen.fromDate,chosen.periodId,{version:1})",
  'assert.deepEqual(recovered.operation,receipt.saved.operation)','assert.deepEqual(recovered.artifact,receipt.saved.artifact)',
  'actualHistoricalRequests:false','syntheticAuth:true,actualServiceSql:true,newWorkers:0,browser:false');
});

function failHarness(mutate=false){
 const events=[],archive=saved(),owned={schema:'attendance_race_'+'c'.repeat(32)},state={facts:'facts'};
 const d={syntheticOnly:true,owned,site:'99990001',owner:id(99),guard:'--owned\n',inventory:()=>periodContinuationCountsTables,
  fingerprint:()=>state.facts,definitions:()=>'defs',tableCatalog:()=>'catalog'};
 const ctx={d,h:{syntheticOnly:true,workerId:id(174701),employeeId:id(174702),employeeAuthUserId:id(174703)},
  archive:()=>archive,oldArchive:archive,periodArchive:()=>archive,scope:{schema:owned.schema,sql:s=>s},
  native:{query:()=>'',pass:()=>events.push('pass'),connect:()=>{events.push('connect');return {
   step:async sql=>{events.push(sql);if(mutate)state.facts='changed';throw Error('synthetic first step failure');},close:async()=>events.push('close')};}}};
 const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\nverifyPeriodContinuationCountsNative;';
 const fn=runInNewContext(code,{assert,Buffer,JSON,Date,Map,id,moduleUrl:'file:///synthetic/counts.mjs',periodContinuationArchiveBytes,periodContinuationSerialization,
  quote:v=>"'"+v+"'",json:JSON.stringify,assertLifecycleSandbox:()=>owned,outageNativeFingerprintSql:()=>"'facts'",createRequire:()=>()=>({})},{timeout:1000});
 return {events,run:()=>fn(ctx)};
}
test('failure still closes the one transaction and restores every baseline before any success claim',async()=>{
 const h=failHarness();await assert.rejects(h.run(),e=>{assert.match(e.message,/period_continuation_counts:begin:synthetic first step failure/);assert.equal(e.errors.length,1);return true;});
 assert.equal(h.events[0],'connect');assert.match(h.events[1],/^begin;reset role;set local time zone 'UTC'/);assert.equal(h.events.at(-1),'close');assert(!h.events.includes('pass'));
});
test('baseline drift remains an independent explicit error after cleanup',async()=>{
 const h=failHarness(true);await assert.rejects(h.run(),e=>{assert.equal(e.errors.length,2);assert.match(e.message,/counts_rollback_facts/);return true;});
 assert(h.events.includes('close'));assert(!h.events.includes('pass'));
});
