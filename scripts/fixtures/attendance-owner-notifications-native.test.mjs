//236 pure/static and mocked failure orchestration only. Never starts PostgreSQL.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext,runInThisContext} from 'node:vm';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {ownerNotificationsNativeArgs} from '../merchant-attendance-owner-notifications-native.mjs';
import {ownerNotificationsNativeTables,ownerNotificationsNativePlan,ownerNotificationsNativeHash,ownerNotificationsNativeQuery,
 assertOwnerNotificationSource,verifyOwnerNotificationsNative} from './attendance-owner-notifications-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';

const source=readFileSync(new URL('./attendance-owner-notifications-native.mjs',import.meta.url),'utf8');
const runner=readFileSync(new URL('../merchant-attendance-owner-notifications-native.mjs',import.meta.url),'utf8');
const site='99990001',table=n=>'merchant_attendance_'+n,quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const json=value=>quote(JSON.stringify(value))+'::jsonb';
const has=(...texts)=>texts.forEach(text=>assert(source.includes(text),text));
const order=(...texts)=>{let at=-1;for(const text of texts){at=source.indexOf(text,at+1);assert(at>=0,text);}};

test('imports are inert and unowned contexts stop before services or connections',async()=>{
 await assert.rejects(verifyOwnerNotificationsNative({}),/owner_notifications_owned_synthetic_context_required/);
 assert.doesNotMatch(source,/process\.argv|spawn\(|listen\(|initdb|pg_ctl|CREATE DATABASE|playwright|chromium|closeAll\(/);
 order("'owner_notifications_owned_synthetic_context_required'",'assertLifecycleSandbox','const {executePlanExceptions}=require');
});
test('runner requires explicit local reuse directory and normalizes reverse arguments',()=>{
 const directory='D:/owned-only/synthetic';
 assert.deepEqual(ownerNotificationsNativeArgs(['--run-local','--directory',directory]),['--run-local','--directory',directory]);
 assert.deepEqual(ownerNotificationsNativeArgs(['--directory',directory,'--run-local']),['--run-local','--directory',directory]);
 for(const args of [[],['--run-local'],['--run-local','--directory','relative'],['--run-local','--directory',directory,'--new-cluster'],
  ['--run-local','--directory',directory+'\n'],['--directory','--run-local',directory]])assert.throws(()=>ownerNotificationsNativeArgs(args));
});
test('wrapper installs only188 additively, reenters and delegates original lifecycle cleanup',()=>{
 assert(runner.includes('runPeriodDelegatedClosureNative(ownerNotificationsNativeArgs(args),async ctx=>'));
 assert.equal((runner.match(/d\.exec\(boundClockMigrationBody/g)||[]).length,2);
 assert(runner.includes('pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef'));
 assert(runner.includes('const oldFunctions=d.exec(functionHashSql)'));
 assert(runner.includes('finally{'));assert(runner.includes('owner_notifications_fixture_not_rolled_back'));
 assert(runner.includes('periodContinuationArchiveBytes(periodArchive()),sealed'));
 assert.doesNotMatch(runner,/spawn\(|connect\(|pg_ctl|closeAll\(|create database|drop schema/i);
});
test('bounded real event plan gives26 messages and isolates same UUID in two source categories',()=>{
 const p=ownerNotificationsNativePlan();assert.equal(p.note,p.disputeV1);assert.equal(p.page.length,23);
 assert.equal(1+2+p.page.length,26);assert.equal(2+3+p.page.length,28);
 const ids=Object.values(p).flat();assert.equal(ids.length-new Set(ids).size,1);
 assert(ids.every(value=>/^00000000-0000-4000-8000-0002364\d{5}$/.test(value)));
 assert.deepEqual(ownerNotificationsNativeTables,[table('owner_notifications'),table('owner_notification_reads'),table('owner_notification_operations')]);
});
test('outside hash masks only exact period head and exact operation rows, preserving nullable rows',()=>{
 const periodId=id(207),names=[table('events'),table('period_closures'),table('period_entries')];
 const sql=ownerNotificationsNativeHash(names,{site,periodId,exceptions:{[table('period_entries')]:`t.merchant_id=${quote(site)} and t.operation_id=${quote(id(1))}`}});
 assert(sql.includes(`case when t.merchant_id='${site}' and t.period_id='${periodId}'`));assert(sql.includes('is not true'));
 assert(sql.includes('from public.merchant_attendance_events t)'));
 for(const field of ['revision','current_version','state','sealed','confirmed_version','unresolved_dispute','updated_at'])assert(sql.includes(quote(field)));
 assert(!sql.includes(quote('employee_auth_user_id')));assert(!sql.includes(quote('start_at')));
 assert.throws(()=>ownerNotificationsNativeHash(['bad;drop'],{site,periodId}));
 assert.throws(()=>ownerNotificationsNativeHash(names,{site:'bad',periodId}));
 assert.throws(()=>ownerNotificationsNativeHash(['merchants','merchants'],{site,periodId}));
 assert.throws(()=>ownerNotificationsNativeHash([],{site,periodId}));
});
test('queries use only explicit exact list/detail/recover fields and no source authorization',()=>{
 assert.deepEqual(ownerNotificationsNativeQuery(site),{siteId:site,mode:'list',notificationId:null,operationId:null,beforeAt:null,beforeId:null});
 assert.deepEqual(ownerNotificationsNativeQuery(site,'recover',{notificationId:id(1),operationId:id(2)}),
  {siteId:site,mode:'recover',notificationId:id(1),operationId:id(2),beforeAt:null,beforeId:null});
});
test('saved navigation proves both historical identities and exact source frame, never a copied body',()=>{
 const identity={siteId:site,workerId:id(1),employeeId:id(2),employeeAuthUserId:id(3),caseId:id(4),slotId:id(5),periodId:id(6),fromDate:'2026-10-01',throughDate:'2026-10-02'};
 const note={workerId:id(1),employeeId:id(2),employeeAuthUserId:id(3),sourceCategory:'plan_exception',sourceId:id(4),target:{slotId:id(5)}};
 const period={...note,sourceCategory:'period',sourceId:id(6),target:{periodId:id(6),fromDate:'2026-10-01',throughDate:'2026-10-02'}};
 assertOwnerNotificationSource(note,identity);assertOwnerNotificationSource(period,identity);
 for(const item of [{...note,employeeAuthUserId:id(9)},{...note,target:{slotId:id(6)}},{...note,note:'must not copy'},
  {...period,target:{...period.target,fromDate:'2026-10-02'}},{...period,sourceCategory:'unknown'}])assert.throws(()=>assertOwnerNotificationSource(item,identity));
});

function footprint(){
 const p=ownerNotificationsNativePlan(),owner=id(90),h={workerId:id(91),employeeId:id(92),employeeAuthUserId:id(93)},periodId=id(94),stamp='2026-10-08T12:00:00.000001+00:00';
 const state={caseId:id(95),slotId:id(96),accepted:new Map(),previous:null,periodHead:{merchant_id:site,period_id:periodId,...Object.fromEntries(Object.entries(h).map(([k,v])=>[({workerId:'worker_id',employeeId:'employee_id',employeeAuthUserId:'employee_auth_user_id'})[k],v])),
  from_date:'2026-10-01',through_date:'2026-10-02',time_zone:'UTC',start_at:stamp,end_at:stamp,opened_at:stamp,updated_at:stamp,revision:4,current_version:1,confirmed_version:1,sealed:true,state:'sealed',unresolved_dispute:false}};
 const proof={owner,period:{...state.periodHead,revision:5,unresolved_dispute:true},rows:Object.fromEntries(['plan_exception_entries','period_entries','owner_notifications','owner_notification_reads','owner_notification_operations'].map(n=>[table(n),[]]))};
 for(const [category,operationId,expectedRevision]of [['plan_exception',p.note,2],['period',p.disputeV1,4]]){
  const command={operationId,expectedRevision};state.accepted.set(category+':'+operationId,{category,command,capture:true});
  proof.rows[table(category==='period'?'period_entries':'plan_exception_entries')].push({operation_id:operationId,command,actor_auth_user_id:h.employeeAuthUserId,revision:expectedRevision+1,
   recorded_at:stamp,...(category==='period'?{action:'dispute'}:{kind:'note'})});
  proof.rows[table('owner_notifications')].push({notification_id:category==='period'?id(97):id(98),source_category:category,operation_id:operationId,source_revision:expectedRevision+1,
   source_id:category==='period'?periodId:state.caseId,recipient_auth_user_id:owner,employee_id:h.employeeId,employee_auth_user_id:h.employeeAuthUserId,worker_id:h.workerId,occurred_at:stamp,
   target:category==='period'?{periodId,fromDate:'2026-10-01',throughDate:'2026-10-02'}:{slotId:state.slotId}});
 }
 const code=source.slice(source.indexOf(' const check=proof=>{'),source.indexOf('\n const argKeys='));
 const check=runInThisContext('(function(assert,table,state,d,h,periodId,fingerprintFields){'+code+'\nreturn check;})',{timeout:1000})
  (assert,table,state,{owner},h,periodId,['merchant_id','period_id','worker_id','employee_id','employee_auth_user_id','from_date','through_date','time_zone','start_at','end_at','opened_at']);
 return {proof,state,check};
}
test('pure source footprint requires original command, actor, source revision/time/target and sealed head',()=>{
 const {proof,check}=footprint();check(proof);check(structuredClone(proof));
 const changes=[p=>p.rows[table('period_entries')][0].actor_auth_user_id=id(999),p=>p.rows[table('owner_notifications')][0].recipient_auth_user_id=id(999),
  p=>p.rows[table('owner_notifications')][0].occurred_at='wrong',p=>p.rows[table('owner_notifications')][1].target.throughDate='wrong',
  p=>p.period.current_version++,p=>p.period.confirmed_version=null,p=>p.period.sealed=false,p=>p.period.unresolved_dispute=false,p=>p.period.start_at='wrong',
  p=>p.period.revision++,p=>p.period.updated_at='wrong',p=>p.rows[table('period_entries')].pop()];
 for(const change of changes){const m=footprint();change(m.proof);assert.throws(()=>m.check(m.proof));}
});
test('new immutable rows also remain protected after they have been observed',()=>{
 const m=footprint();m.state.previous=structuredClone(m.proof);m.proof.rows[table('period_entries')][0].unexpected='changed';assert.throws(()=>m.check(m.proof));
});
test('capture uses all three real Node services and actual service_role RPC, never fabricated source inserts',()=>{
 has('executePlanExceptions({query:','executePeriodClosures:executePeriodClosuresV2)(input,{rpc})','executeOwnerNotifications({query:q,command:c,authUserId:d.owner,allowWrite:allow},{rpc})');
});

test('source and capture faults have full zero-write proof and bounded rolled-back DDL injection',()=>{
 has("'faolla_attendance_plan_exception_owner_event_v1'","'faolla_attendance_period_closure_owner_event_v1'","'faolla_attendance_period_closure_owner_event_v2'",
  "assert current_user='service_role'",'set constraints all immediate;set constraints all deferred',
  "assert ${fullHash}=on_before,'owner_notifications_read_replay_rejection_wrote'",'owner_notifications_operation_scope_changed',
  'add constraint owner236_test_capture_failure check(false) not valid',"raise exception 'owner236_probe_rollback'",'owner_notifications_probe_not_rolled_back');
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:period_entries|plan_exception_entries|owner_notifications)/i);
 assert.doesNotMatch(source,/disable trigger|drop (?:schema|table|trigger)|truncate|delete from|session_replication_role/i);
 order('capture(false)','const originalNote=', 'capture(true)',"'capture_failure_atomic'",'for(const operationId of p.page)');
});
test('owner handoff, changed identity and flag-off recovery are scoped rollback probes not automatic transfer',()=>{
 has("'handoff_old_owner_no_body'","'handoff_old_owner_no_mark'","'handoff_new_owner_no_old_message'","'handoff_original_minimal_receipt'",
  "'handoff_new_owner_wrong_receipt'","'source_auth_changed'","'source_paused'","'new_owner_fresh_event'",'newOwnerList.items.length,1',
  "off.error?.message,'attendance_platform_paused'",'sourceBefore.data.sourceFingerprint,sourceAfter.data.sourceFingerprint');
 const directUpdates=[...source.matchAll(/update public\.(\w+)/g)].map(m=>m[1]);
 assert.deepEqual(directUpdates,['merchants','merchant_enterprise_employees','merchant_enterprise_employees']);
});
test('single connection budget preserves UTC comparisons and excludes external reads while locked',()=>{
 assert.equal((source.match(/native\.connect\(\)/g)||[]).length,1);
 has('const connection=native.connect(),prefix=periodContinuationSerialization+d.guard','assert(++steps<=100',"set local lock_timeout='3s';set local statement_timeout='10s';");
 const body=source.slice(source.indexOf(' try{\n  capture(false)'),source.indexOf('\n finally{'));
 assert.doesNotMatch(body,/d\.(?:fingerprint|definitions|tableCatalog|exec|inventory)\(|native\.query\(|await (?:periodArchive|archive)\(/);
 order('const facts=d.fingerprint()','const connection=native.connect()',"await step('rollback','rollback;')",'await connection.close()',"['facts',()=>d.fingerprint(),facts]");
});

function failureHarness({mutate=false,closeFails=false}={}){
 const events=[],text='{"test":"failure-only"}',artifact={artifactText:text,artifact:JSON.parse(text),artifactBytes:Buffer.byteLength(text),artifactSha256:createHash('sha256').update(text).digest('hex')};
 const owned={schema:'attendance_race_'+'a'.repeat(32)},values={facts:'facts'},names=[...ownerNotificationsNativeTables,table('period_closures'),table('period_entries'),table('plan_exception_entries')];
 const d={syntheticOnly:true,owned,site,owner:id(99),guard:'--owned\n',inventory:()=>names,fingerprint:()=>{events.push('facts');return values.facts;},definitions:()=>{events.push('definitions');return 'defs';},tableCatalog:()=>{events.push('catalog');return 'catalog';}};
 const ctx={d,h:{syntheticOnly:true,workerId:id(101),employeeId:id(102),employeeAuthUserId:id(103)},periodId:id(104),pq:()=>({fromDate:'2026-10-01',throughDate:'2026-10-02'}),
  periodArchive:()=>{events.push('archive207');return artifact;},archive:()=>{events.push('archive155');return artifact;},oldArchive:artifact,scope:{schema:owned.schema,sql:s=>s},
  native:{query:()=>'',pass:()=>events.push('pass'),connect:()=>{events.push('connect');return {step:async sql=>{events.push(sql);if(mutate)values.facts='changed';throw Error('synthetic first-step failure');},
   close:async()=>{events.push('close');if(closeFails)throw Error('synthetic close failure');}};}}};
 const environment={FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED:'prior',OTHER:'untouched'},process={env:environment};
 const code=source.replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'').replaceAll('import.meta.url','moduleUrl')+'\nverifyOwnerNotificationsNative;';
 const fn=runInNewContext(code,{assert,Buffer,JSON,id,process,moduleUrl:'file:///synthetic/owner-notifications.mjs',assertLifecycleSandbox:()=>owned,
  quote,json,outageNativeFingerprintSql:()=>"'facts'",periodContinuationArchiveBytes,periodContinuationSerialization,createRequire:()=>()=>({})},{timeout:1000});
 return {events,environment,run:()=>fn(ctx)};
}
test('first-step failure closes owned connection, restores capture flags then runs all old-row/archive guards',async()=>{
 const h=failureHarness();await assert.rejects(h.run(),e=>{assert.match(e.message,/owner_notifications_native_failed:.*synthetic first-step failure/s);assert.equal(e.errors.length,1);return true;});
 assert.deepEqual(h.environment,{FAOLLA_ATTENDANCE_OWNER_NOTIFICATIONS_CAPTURE_ENABLED:'prior',OTHER:'untouched'});
 const start=h.events.indexOf('connect'),close=h.events.indexOf('close');assert(close>start);assert.match(h.events[start+1],/^begin;reset role;set local time zone 'UTC'/);
 assert.deepEqual(h.events.slice(close+1),['facts','definitions','catalog','archive155','archive207']);assert(!h.events.includes('pass'));
});
test('cleanup and baseline failures preserve original failure instead of masking or blindly repairing',async()=>{
 const h=failureHarness({mutate:true,closeFails:true});await assert.rejects(h.run(),e=>{assert.equal(e.errors.length,3);assert.equal(e.cause,e.errors[0]);
  assert.match(e.message,/synthetic close failure/);assert.match(e.message,/owner_notifications_rollback_facts/);return true;});
 assert(!h.events.includes('pass'));assert.doesNotMatch(source.slice(source.indexOf('\n finally{')),/update public|\.step\(/);
});
