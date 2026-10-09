import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {require as tsxRequire} from 'tsx/cjs/api';
import {retentionDisposalNativeLimits,retentionDisposalNativeManifest,retentionDisposalOldFactsSql,retentionDisposalNativeNewTables,retentionDisposalReadFacts,
 retentionDisposalNativePrerequisites,retentionDisposalNativeDependencies,retentionDisposalNativeDependencyDiagnosticSql,assertRetentionDisposalNativeDependencies,retentionDisposalNativePrerequisiteFunctionSql} from './merchant-attendance-retention-disposal-native.mjs';
import {retentionDisposalHistoricalTemplate,retentionDisposalHistoricalSeed,retentionDisposalTemplateTables,retentionDisposalNativeRpcExpression,retentionDisposalOperationalTemplate,retentionDisposalOperationalSeed,
 retentionDisposalNativeFailureSummary,retentionDisposalDependencyLimits,retentionDisposalCalendarMutation} from './fixtures/attendance-retention-disposal-native.mjs';
const source=readFileSync(new URL('./fixtures/attendance-retention-disposal-native.mjs',import.meta.url),'utf8');
const migration=readFileSync(new URL('./supabase-migrations/202610080197_merchant_attendance_retention_disposal.sql',import.meta.url),'utf8');
const id=n=>`00000197-0000-4000-8000-${String(n).padStart(12,'0')}`,site='99990197',stamp='2026-10-08T10:00:00.123456+00:00';
function sample(){
 const rows=Object.fromEntries(retentionDisposalTemplateTables.map(n=>[n,[]])),employee=id(1),auth=id(2),worker=id(3),location=id(4),role=id(5);
 rows.merchant_enterprise_employees=[{merchant_id:site,id:employee,auth_user_id:auth,email:'synthetic@example.test',role_id:role,accepted_at:stamp}];
 rows.merchant_attendance_workers=[{merchant_id:site,id:worker,employee_id:employee,worker_no:'NOW'}];
 rows.merchant_attendance_employment_periods=[{merchant_id:site,id:id(6),worker_id:worker,employee_id:employee,employee_auth_user_id:auth,starts_on:'2000-01-01',recorded_at:stamp}];
 rows.merchant_attendance_location_notice_acknowledgements=[{merchant_id:site,location_id:location,employee_id:employee,worker_id:worker,operation_id:id(7),actor_auth_user_id:auth,recorded_at:stamp}];
 for(let i=0;i<2;i++){
  const event=id(8+i),op=id(10+i),action=i===0?'clock_in':'clock_out';
  rows.merchant_attendance_events.push({merchant_id:site,id:event,operation_id:op,worker_id:worker,location_id:location,sequence:i+1,actor_employee_id:employee,
   occurred_at:stamp,received_at:stamp,action,source:'web'});
  rows.merchant_attendance_location_results.push({event_id:event,reason:'inside',needs_review:false,captured_at:stamp,accuracy_meters:10,distance_meters:0,disposal_operation_id:null});
  rows.merchant_attendance_location_clock_notices.push({merchant_id:site,event_id:event,worker_id:worker,employee_id:employee,location_id:location,command:{operationId:op,action,locationId:location}});
 }
 rows.merchant_attendance_shift_schedule_relations=[{merchant_id:site,start_event_id:id(8),worker_id:worker,employee_id:employee,employee_auth_user_id:auth,
  operation_id:id(10),status:'unselected',selection:null,slot_id:null,slot_revision:null,reason:null,slot_snapshot:null,publication_snapshot:null,cancellation_snapshot:null,occurred_at:stamp,recorded_at:stamp}];
 rows.merchant_attendance_shift_plan_adoptions=[{merchant_id:site,start_event_id:id(8),worker_id:worker,employee_id:employee,employee_auth_user_id:auth,operation_id:id(10),
  approval_operation_id:null,adoption:{status:'unselected',startEventId:id(8),workerId:worker,employeeId:employee,employeeAuthUserId:auth,recordedAt:stamp},recorded_at:stamp}];
 return rows;
}
test('197 adapter is finite/inert and projects only the added old location column',()=>{
 assert.equal(retentionDisposalNativeManifest(migration).length,2);assert.equal(retentionDisposalNativeNewTables.length,5);
 assert.deepEqual(retentionDisposalNativeLimits,{steps:190,installMs:90000,fixtureMs:90000,competitionMs:90000,extraConnections:1,newDatabases:0,externalAuthRequests:0,kdfCalls:0});
 const sql=retentionDisposalOldFactsSql(['merchants','merchant_attendance_location_results','merchant_attendance_events']);
 assert.match(sql,/to_jsonb\(x\)-'disposal_operation_id'/);assert(!sql.includes("-'captured_at'"));
 assert.throws(()=>retentionDisposalOldFactsSql(['malicious;drop table x']));
 const adapter=readFileSync(new URL('./merchant-attendance-retention-disposal-native.mjs',import.meta.url),'utf8');
 assert.match(adapter,/runAdministrativeClosureNative\(args,async ctx=>/);
 assert(adapter.indexOf('await installAndVerifyIndependentWorkersNative(ctx);')<adapter.indexOf('return installVerifyRetentionDisposalNative(ctx);'));
 assert(!/createDatabase|initdb|download|spawn\(/.test(adapter));
 const calls=[];assert.equal(retentionDisposalReadFacts({exec:s=>{calls.push(s);return 'fixed';}},'precise_full_row_hash'),'fixed');
 assert.equal(calls[0],"begin;reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';set local extra_float_digits=3;select precise_full_row_hash;rollback;");
 assert(!source.includes('d.fingerprint()'));assert(!source.includes("d.exec('select '+outside"));
});

test('197 inventories all nine old relations and eight exact direct function signatures before any new install',()=>{
 const dependencies=retentionDisposalNativeDependencies(migration);
 assert.deepEqual(dependencies.relations,['merchant_attendance_events','merchant_attendance_location_discussion','merchant_attendance_location_results',
  'merchant_attendance_location_reviews','merchant_attendance_period_artifacts','merchant_attendance_preservation_operations','merchant_attendance_settings','merchant_attendance_workers','merchants']);
 assert.equal(dependencies.functions.length,8);
 assert(dependencies.functions.includes('public.faolla_attendance_period_artifact_checked_v1(public.merchant_attendance_period_artifacts)'));
 assert(dependencies.functions.includes('public.faolla_attendance_retention_receipt_v1(jsonb,uuid,bigint,text,timestamptz)'));
 const diagnostic=retentionDisposalNativeDependencyDiagnosticSql(migration);
 assert.match(diagnostic,/to_regclass\('public\.'\|\|name\) is null/);assert.match(diagnostic,/to_regprocedure\(signature\) is null/);
 assert.doesNotMatch(diagnostic,/create|insert|update|delete|truncate/i);
 const missing={missingRelations:['merchant_attendance_location_discussion','merchant_attendance_location_reviews'],missingFunctions:[]};
 const fake=value=>({exec:()=>JSON.stringify(value)});
 assert.deepEqual(assertRetentionDisposalNativeDependencies(fake(missing),migration,{allowMissingPrerequisites:true}),missing);
 assert.throws(()=>assertRetentionDisposalNativeDependencies(fake(missing),migration));
 assert.throws(()=>assertRetentionDisposalNativeDependencies(fake({...missing,missingRelations:[...missing.missingRelations,'merchant_attendance_events']}),migration,{allowMissingPrerequisites:true}));
 assert.throws(()=>assertRetentionDisposalNativeDependencies(fake({...missing,missingFunctions:['public.missing()']}),migration,{allowMissingPrerequisites:true}));
 assert.throws(()=>retentionDisposalNativeDependencies(migration.replace('public.faolla_attendance_group_text_v1(p->>\'reason\',1,500)','public.faolla_unknown_function_v1(p->>\'reason\',1,500)')));
});

test('197 prerequisite sources are exactly original074/075, four exact function bodies/metadata and no stub or old rewrite',()=>{
 assert.deepEqual(retentionDisposalNativePrerequisites.map(p=>p.version),[202609300074,202609300075]);
 const adapter=readFileSync(new URL('./merchant-attendance-retention-disposal-native.mjs',import.meta.url),'utf8');
 for(const spec of retentionDisposalNativePrerequisites){
  const sql=readFileSync(new URL('./supabase-migrations/'+spec.file,import.meta.url),'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(sql).digest('hex'),spec.sourceHash);
  assert.equal(spec.functions.length,2);
  for(const f of spec.functions){
   const match=sql.match(new RegExp('create function public\\.'+f.name+'\\(([\\s\\S]*?)\\)\\s*returns ([\\s\\S]*?)as \\$\\$([\\s\\S]*?)\\$\\$;'));assert(match);
   assert.equal(createHash('sha256').update(match[3]).digest('hex'),f.hash);
   assert.deepEqual(match[1].split(',').map(a=>a.trim().split(' ')[0]),f.argNames);
   assert(match[2].includes('language '+f.language));assert.equal(match[2].includes('security definer'),f.rpc);
   assert.equal(match[2].includes('immutable'),f.volatility==='i');
   const query=retentionDisposalNativePrerequisiteFunctionSql(f,'attendance_race_'+'a'.repeat(32));
   for(const part of ['p.proowner::regrole::text','p.pronamespace::bigint','p.proargnames','p.pronargdefaults','pg_get_expr(p.proargdefaults,0)',
    'p.prosupport=0::oid','p.proargmodes is null','p.proallargtypes is null','a.privilege_type,a.is_grantable','p.prosrc'])assert(query.includes(part),part);
  }
 }
 assert.match(adapter,/objects,\{relation:null,type:null,functions:0\}/);
 assert.match(adapter,/boundClockMigrationBody\(native.root,spec.file\)/);
 assert.match(adapter,/jsonb_build_array\(to_jsonb\(p\),pg_get_functiondef\(p.oid\)\)/);
 assert.match(adapter,/disposal_prerequisite_changed_old_registry/);assert.match(adapter,/disposal_prerequisite_changed_old_catalog/);
 assert.match(adapter,/rows:0,rls:true,externalAcl:0/);
 assert(adapter.indexOf('const start=Date.now(),body=')<adapter.indexOf('await installRetentionDisposalNativePrerequisites(ctx,body)'));
 assert(adapter.indexOf('await installRetentionDisposalNativePrerequisites(ctx,body)')<adapter.indexOf('const oldTables=d.inventory().filter(n=>'));
 assert.match(adapter,/disposal_prerequisite_deadline/);
});

test('197 failure evidence retains first SQL state/context without serializing a large artifact',()=>{
 const summary=retentionDisposalNativeFailureSummary('actual_send',26,{sqlstate:'P0001',error:'actual_failure',context:'capture_context',
  value:{protocol:'period-closure-v2',kind:'detail',artifactText:'DO_NOT_PRINT_ARTIFACT'.repeat(100000)}});
 assert.deepEqual(summary,{sqlstate:'P0001',context:'capture_context',stage:'actual_send',steps:26,error:'actual_failure',resultProtocol:'period-closure-v2',resultKind:'detail'});
 assert(JSON.stringify(summary).length<1000);assert(!JSON.stringify(summary).includes('DO_NOT_PRINT_ARTIFACT'));
 const capped=retentionDisposalNativeFailureSummary('x'.repeat(1000),26,{sqlstate:'x'.repeat(1000),error:'x'.repeat(1000),context:'x'.repeat(10000)});
 assert.equal(capped.context.length,4000);assert.equal(capped.stage.length,200);assert.equal(capped.error.length,500);assert.equal(capped.sqlstate.length,16);
 assert(!source.includes('JSON.stringify({lastRpc,steps})'));
});
test('explicit new identity uniformly shifts complete unselected location proof without rewriting input',()=>{
 const original=sample(),before=JSON.stringify(original),t=retentionDisposalHistoricalTemplate(original);
 assert.equal(JSON.stringify(original),before);assert.equal(t.days,-3);assert.equal(t.actualHistoricalRpc,false);assert.equal(t.copiedRows,12);
 assert.notEqual(t.identity.worker,original.merchant_attendance_workers[0].id);assert.notEqual(t.identity.auth,original.merchant_enterprise_employees[0].auth_user_id);
 assert.equal(t.rows.merchant_attendance_employment_periods[0].starts_on,'2000-01-01');
 assert.equal(t.rows.merchant_attendance_events[0].occurred_at,'2026-10-05T10:00:00.123456+00:00');
 assert.equal(t.rows.merchant_attendance_location_results[0].captured_at,t.rows.merchant_attendance_events[0].occurred_at);
 assert.equal(t.rows.merchant_attendance_location_clock_notices[0].command.operationId,t.operationIds[0]);
 assert.equal(t.rows.merchant_attendance_shift_plan_adoptions[0].adoption.startEventId,t.eventIds[0]);
 assert.equal(t.rows.merchant_attendance_shift_plan_adoptions[0].adoption.employeeAuthUserId,t.identity.auth);
 const seed=retentionDisposalHistoricalSeed(t);assert.match(seed,/jsonb_array_elements_text\([^]*\)::uuid/);
 assert.match(seed,/set constraints all immediate/);assert.match(seed,/faolla_attendance_location_schedule_receipt_v1/);
 assert(!/disable trigger|session_replication_role|insert into public\.merchant_attendance_disposal_event_coverage/i.test(seed));
});
test('template refuses missing, opaque, selected or mismatched original proofs',()=>{
 const change=f=>{const s=sample();f(s);assert.throws(()=>retentionDisposalHistoricalTemplate(s));};
 change(s=>s.merchant_attendance_location_clock_notices.pop());
 change(s=>s.merchant_attendance_shift_plan_adoptions[0].adoption.sourceText='{}');
 change(s=>s.merchant_attendance_shift_schedule_relations[0].publication_snapshot={sourceFingerprint:'0'.repeat(64)});
 change(s=>s.merchant_attendance_location_clock_notices[0].command.operationId=id(90));
 change(s=>s.merchant_attendance_events[0].received_at='2026-10-08T10:00:01.123456+00:00');
 change(s=>s.merchant_attendance_location_results[0].captured_at=null);
 change(s=>s.merchant_attendance_shift_schedule_relations[0].status='linked');
});
test('managed template is a separate new identity with four genuine proof rows and ordered actual hash recomputation',()=>{
 const base=sample(),start=base.merchant_attendance_events[0],end=base.merchant_attendance_events[1],worker=base.merchant_attendance_workers[0];
 const session={merchant_id:site,worker_id:worker.id,employee_id:worker.employee_id,employee_auth_user_id:id(2),start_event_id:start.id,operation_id:start.operation_id,
  session:{channel:'location',selection:null,origins:[],occurredAt:stamp,sourceFingerprint:'a'.repeat(64),policyFingerprint:'b'.repeat(64),sessionFingerprint:'c'.repeat(64)},
  source_ref:{protocol:'attendance-operational-punch-source-ref-v1',siteId:site,layers:{enterprise:null,group:null,personal:null},groupAssignmentRef:null,baselineCorrectionPolicyRef:null,
   workerIdentity:{workerId:worker.id,employeeId:worker.employee_id,employeeAuthUserId:id(2)},at:stamp,sourceFingerprint:'a'.repeat(64)}};
 const operations=[start,end].map((e,i)=>({merchant_id:site,worker_id:worker.id,event_id:e.id,operation_id:e.operation_id,start_event_id:start.id,channel:'location',
  command:{clock:{operationId:e.operation_id,expectedWorkerId:worker.id},choice:i?{kind:'finish'}:{kind:'start',expectedPolicyFingerprint:'b'.repeat(64),selection:null}},
  operation:{eventId:e.id,operationId:e.operation_id,recordedAt:stamp,commandFingerprint:'d'.repeat(64)},origin_ref:{channel:'location',eventId:e.id}}));
 const input={base,activation:{merchant_id:site,operation_id:id(90),revision:1,action:'activate',recorded_at:stamp,command:{operationId:id(90),expectedRevision:0}},
  sessions:[session],operations,checkedOperations:operations.map(o=>o.operation)},before=JSON.stringify(input),t=retentionDisposalOperationalTemplate(input);
 assert.equal(JSON.stringify(input),before);assert.equal(t.copiedRows,16);assert.equal(t.actualHistoricalRpc,false);assert.equal(t.actualCurrentManagedRpc,true);
 assert.notEqual(t.base.identity.worker,retentionDisposalHistoricalTemplate(base).identity.worker);assert.equal(t.base.rows.merchant_attendance_workers[0].worker_no,'SYNTHETIC197-MANAGED-PAST');
 assert.equal(t.sessions[0].source_ref.workerIdentity.workerId,t.base.identity.worker);assert.equal(t.operations[0].origin_ref.eventId,t.base.eventIds[0]);
 assert.notEqual(t.activation.operation_id,input.activation.operation_id);assert.equal(t.activation.recorded_at,'2026-10-05T10:00:00.123456+00:00');
 const sql=retentionDisposalOperationalSeed(t),sourceIndex=sql.indexOf('operational_source_tuple_v1'),policyIndex=sql.indexOf('operational_punch_policy_hash_v1'),
  sessionIndex=sql.indexOf('operational_punch_session_hash_v1'),commandIndex=sql.indexOf("'commandFingerprint',public.faolla_attendance_operational_punch_hash_v1");
 assert(sourceIndex>0&&policyIndex>sourceIndex&&sessionIndex>policyIndex&&commandIndex>sessionIndex);
 for(const helper of ['operational_punch_activation_item_v1','operational_punch_session_v1','operational_punch_operation_v1'])assert(sql.includes(helper));
 const invalid=structuredClone(input);invalid.sessions[0].source_ref.layers.personal={operationId:id(98),revision:2};assert.throws(()=>retentionDisposalOperationalTemplate(invalid));
 const changed=structuredClone(input);changed.operations[0].operation={...changed.operations[0].operation,commandFingerprint:'e'.repeat(64)};assert.throws(()=>retentionDisposalOperationalTemplate(changed));
});
test('exact service transport preserves assertion UTC6, original IDs and public schedule gates',()=>{
 const a={p_site_id:site,p_auth_user_id:id(1),p_expected_worker_id:id(2),p_command:null,p_operation_id:id(3),p_assertion:null,
  p_allow_new_sessions:true,p_require_clock:false,p_selection:null,p_allow_schedule:true,p_bind_rules:false};
 const sql=retentionDisposalNativeRpcExpression('faolla_attendance_location_schedule_v1',a);assert.match(sql,/true,false,null,true,false\)$/);
 const assertion={policyFingerprint:'a'.repeat(32),algorithmVersion:1,reason:'inside',capturedAt:'2026-10-08T10:00:00.123456Z',accuracyMeters:10,distanceMeters:0};
 const write=retentionDisposalNativeRpcExpression('faolla_attendance_location_clock_v2',{...Object.fromEntries(Object.entries(a).filter(([k])=>!['p_selection','p_allow_schedule','p_bind_rules'].includes(k))),p_assertion:assertion});
 assert(write.includes(assertion.capturedAt));assert(write.includes(assertion.policyFingerprint));
 assert.throws(()=>retentionDisposalNativeRpcExpression('faolla_attendance_location_schedule_v1',{...a,unsafe:true}));
 assert.throws(()=>retentionDisposalNativeRpcExpression('faolla_attendance_location_schedule_v1',{...a,p_site_id:'00000001'}));
 assert.throws(()=>retentionDisposalNativeRpcExpression('faolla_attendance_location_schedule_v1',{...a,p_bind_rules:null}));
 const managed={p_site:site,p_auth:id(1),p_expected_worker:id(2),p_query:{mode:'prepare'},p_command:null,p_assertion:null,p_allow_new_sessions:true,
  p_require_clock:false,p_allow_operational_start:true,p_allow_schedule:true,p_bind_rules:false};
 assert.match(retentionDisposalNativeRpcExpression('faolla_attendance_operational_punch_location_v1',managed),/true,false,true,true,false\)$/);
 assert.throws(()=>retentionDisposalNativeRpcExpression('faolla_attendance_operational_punch_location_v1',{...managed,p_allow_schedule:null}));
});
test('actual location service generates only the exact eight-argument adapter and six-key range assertion',async()=>{
 const {executeAttendanceLocationClock}=tsxRequire('../src/lib/merchantAttendanceLocationClock.server.ts',import.meta.url);
 for(const at of ['2026-10-08T10:00:00.123Z','2026-10-08T10:00:00.123456Z']){
  const worker=id(2),location=id(3),operation=id(5),policy={settingsVersion:1,workerVersion:1,locationVersion:1,mode:'record_and_review',maxAgeMs:60000,algorithmVersion:1};
  const intent={operationId:operation,locationId:location,action:'clock_in',expectedSequence:0,settingsVersion:1,workerVersion:1,locationVersion:1,noticeRevision:1,safeFinish:false};
  const event={id:id(4),siteId:site,workerId:worker,locationId:location,operationId:operation,action:'clock_in',sequence:1,occurredAt:at,timeZone:'UTC',breakPaid:null};
  const prepared={siteId:site,employeeId:id(1),workerId:worker,locationId:location,state:{sequence:0,status:'off',lastEvent:null},receipt:null,replayed:false,
   noticeGate:{ready:true,reason:'ready',revision:1},finish:null,receiptGate:null,channelEnabled:true,policy,locationResult:null,
   internalPolicyFingerprint:'a'.repeat(32),internalFence:{latitude:37.3,longitude:-5.9,radiusMeters:100,maxAgeMs:60000}};
  const saved={...prepared,receipt:event,state:{sequence:1,status:'working',lastEvent:event},
   locationResult:{eventId:event.id,settingsVersion:1,workerVersion:1,locationVersion:1,algorithmVersion:1,reason:'inside',needsReview:false,capturedAt:at,accuracyMeters:10,distanceMeters:0},
   receiptGate:{noticeRevision:1,safeFinish:false,command:intent}};
  const calls=[],service={rpc:async(name,args)=>{retentionDisposalNativeRpcExpression(name,args);calls.push(args);return {data:calls.length===1?prepared:saved,error:null};}};
  const run=()=>executeAttendanceLocationClock({siteId:site,expectedWorkerId:worker,operationId:null,authUserId:id(6),moduleEnabled:true,
   command:{...intent,expectedWorkerId:worker,position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:at},positionFailure:null}},service);
  if(at.length!==24){await assert.rejects(run,e=>e.code==='attendance_unavailable');assert.equal(calls.length,1);continue;}
  const value=await run();
  assert.equal(value.receipt.id,event.id);assert.equal(calls.length,2);
  assert.deepEqual(calls[1].p_assertion,{policyFingerprint:'a'.repeat(32),algorithmVersion:1,reason:'inside',capturedAt:at,accuracyMeters:10,distanceMeters:0});
  assert(!JSON.stringify(calls).includes('latitude'));assert(!JSON.stringify(calls).includes('longitude'));
 }
});
test('actual schedule parser and service accept clock_in only and reject clock_out before any RPC',async()=>{
 const {executeAttendanceLocationSchedule}=tsxRequire('../src/lib/merchantAttendanceLocationSchedule.server.ts',import.meta.url);
 const {parseLocationScheduleBody}=tsxRequire('../src/lib/merchantAttendanceLocationSchedule.ts',import.meta.url);
 const command={operationId:id(5),expectedWorkerId:id(2),locationId:id(3),action:'clock_in',expectedSequence:0,settingsVersion:1,workerVersion:1,locationVersion:1,
  noticeRevision:1,safeFinish:false,position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:'2026-10-08T10:00:00.123Z'},positionFailure:null};
 assert.equal(parseLocationScheduleBody({siteId:site,command,selection:null}).command.action,'clock_in');
 const out={...command,action:'clock_out'};assert.throws(()=>parseLocationScheduleBody({siteId:site,command:out,selection:null}),e=>e.code==='attendance_invalid_request');
 let rpcCalls=0;await assert.rejects(()=>executeAttendanceLocationSchedule({siteId:site,expectedWorkerId:id(2),operationId:null,command:out,selection:null,
  authUserId:id(6),moduleEnabled:true,allowWrite:true,bindRules:false},{rpc:async()=>{rpcCalls++;throw Error('must not call');}}),e=>e.code==='attendance_invalid_request');
 assert.equal(rpcCalls,0);
});
test('finite fixture uses genuine current RPC, true NULL proof, immutable canonical archives and guarded replay',()=>{
 for(const fragment of ['executeAttendanceLocationSchedule','executeAttendanceLocationClock','executePeriodClosuresV2','executeRetentionDisposal','set constraints all immediate',
  'actual_three_SQL_NULLs','artifact_dependency_limit','actual_26_dependencies',"failure is not null or value ? 'error'",'written.has(key)',"->'sourceText'","->'sourceFingerprint'",
  'executeOperationalPunch','actual_193_operation_origin_source_proofs_after_disposal','faolla_attendance_operational_punch_origin_v1'])
  assert(source.includes(fragment),fragment);
 assert(!source.includes('::jsonb::text[]'));assert(!/disable trigger|session_replication_role|fake_clock|set.*retentionDays\s*:\s*0/i.test(source));
 assert.match(source,/index<retentionDisposalDependencyLimits.additionalArtifacts/);assert.match(source,/actualHistoricalRpc:false/);
});
test('old-site uncovered evidence is metadata only and does not claim a forbidden preview or public owner acceptance',()=>{
 assert(source.includes('private_old_uncovered_source_metadata_only'));
 assert(source.includes("faolla_attendance_retention_source_v1(e.merchant_id,'location_results',e.id)"));
 assert(!source.includes('faolla_attendance_disposal_preview_v1(e.merchant_id'));
 assert(source.includes('sourceMetadataOnly:true,previewActual:false,publicOwnerPath:false,coverageBlockerActual:false'));
 assert(source.includes("newSiteUncoveredPreview:{actual:false,reason:'all_forward_events_have_actual_same_tx_coverage'}"));
});

test('26 dependencies use25 actual calendar changes and fresh sends of one existing period, not unreachable overlapping periods',()=>{
 const calendar=tsxRequire('../src/lib/merchantAttendanceCalendar.ts',import.meta.url);
 assert.deepEqual(retentionDisposalDependencyLimits,{additionalArtifacts:25,bytes:2097152});
 for(let n=0;n<25;n++){
  const mutation=retentionDisposalCalendarMutation(site,'2026-10-01',id(4000+n),7);
  assert.deepEqual(calendar.parseCalendarBody(mutation),mutation);assert.equal(mutation.command.kind,'holiday');assert.equal(mutation.command.expectedSettingsVersion,7);
  assert.equal(mutation.command.fromDate,mutation.command.throughDate);assert.equal(mutation.query.locationId,null);
 }
 for(const fragment of ['const q=pq(p,day,pid)',"same_period_real_calendar_then_source_",'faolla_attendance_calendar_v1(',
  "prepared_value:=public.faolla_attendance_calendar_v1",'dependencyDomainRpcs.calendarWrites++','dependencyDomainRpcs.sourceReads++','dependencyDomainRpcs.periodSendAttempts++',
  'sourceFingerprints.has(source.artifact.sourceFingerprint)','expectedFingerprint:source.artifact.sourceFingerprint',
  'capacityHead=result.data','versions:27,artifacts:26,refs:26,complete:26,calendar:25','retentionDisposalDependencyLimits.bytes',"set local statement_timeout='10s'"])
  assert(source.includes(fragment),fragment);
 const expansion=source.slice(source.indexOf("branch=await save('actual_26_dependencies')"),source.indexOf("await restore('actual_26_dependencies'"));
 assert(!expansion.includes('shiftDate('));assert(!expansion.includes('periodId:next()'));assert(!expansion.includes('fromDate:shiftDate'));
 assert(expansion.includes('same_period_27_versions_26_artifacts_refs'));assert(!expansion.includes('insert into public.merchant_attendance_calendar'));
 assert(!/statement_timeout='(?:[2-9]\d|\d{3,})s'/.test(source));
});

test('internal capacity verification uses only the owned postgres diagnostic role, without widening business ACLs',()=>{
 const start=source.indexOf("const capacity=await ok('actual_same_period_27_versions_26_artifacts_refs'");
 assert(start>=0);const verification=source.slice(start,source.indexOf('assert.deepEqual(capacity',start));
 assert(verification.includes("{role:'postgres'}"));
 for(const name of ['merchant_attendance_period_versions','merchant_attendance_period_artifacts','merchant_attendance_disposal_artifact_event_refs','merchant_attendance_disposal_artifact_coverage'])assert(verification.includes(name));
 assert(!/grant |alter .*owner|security definer|create function/i.test(verification));
 const service=source.slice(source.indexOf('const service={rpc:'),source.indexOf('const save='));
 assert(!service.includes("role:'postgres'"));
});
