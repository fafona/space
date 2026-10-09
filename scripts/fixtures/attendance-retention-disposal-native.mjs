// 197 finite, LOCAL synthetic acceptance. The actual current location RPC and
// explicit past-due new-identity seed are different evidence; never conflate.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {retentionDisposalNativeLimits,retentionDisposalOldFactsSql,retentionDisposalReadFacts} from '../merchant-attendance-retention-disposal-native.mjs';

const require=createRequire(import.meta.url),uid=n=>id(197900000+n);
export const retentionDisposalNativeSite='99990197';
export const retentionDisposalDependencyLimits=Object.freeze({additionalArtifacts:25,bytes:2097152});
export function retentionDisposalCalendarMutation(siteId,day,operationId,settingsVersion){
 return {query:{siteId,locationId:null,fromDate:null,throughDate:null,entryId:null,operationId:null,beforeAt:null,beforeId:null},
  command:{operationId,action:'create',reason:'Synthetic197 capacity',kind:'holiday',title:'Synthetic197 holiday',fromDate:day,throughDate:day,
   expectedSettingsVersion:settingsVersion,locationId:null,expectedLocationVersion:null,timeZone:'UTC'}};
}
export const retentionDisposalTemplateTables=Object.freeze([
 'merchant_enterprise_employees','merchant_attendance_workers','merchant_attendance_employment_periods',
 'merchant_attendance_location_notice_acknowledgements','merchant_attendance_events','merchant_attendance_location_results',
 'merchant_attendance_location_clock_notices','merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions',
]);
const identities=Object.freeze({role:uid(1),location:uid(2),employee:uid(3),worker:uid(4),auth:uid(5)});
const shiftDate=(value,days)=>new Date(Date.parse(value.slice(0,10)+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)+value.slice(10);
// Keep the first actual SQL error/context observable. Never serialize a 2MiB
// artifact ahead of diagnostics, which formerly truncated away the root cause.
export function retentionDisposalNativeFailureSummary(stage,steps,lastRpc){
 const bounded=(value,limit)=>typeof value==='string'?value.slice(0,limit):null;
 return {sqlstate:bounded(lastRpc?.sqlstate,16),context:bounded(lastRpc?.context,4000),stage:bounded(stage,200),steps,
  error:bounded(lastRpc?.error,500),resultProtocol:bounded(lastRpc?.value?.protocol,100),resultKind:bounded(lastRpc?.value?.kind,100)};
}
export function retentionDisposalHistoricalTemplate(input,{idOffset=0}={}){
 assert([0,10000].includes(idOffset),'disposal_template_finite_identity_namespace');
 assert.deepEqual(Object.keys(input).sort(),[...retentionDisposalTemplateTables].sort());
 const rows=structuredClone(input),employee=rows.merchant_enterprise_employees[0],worker=rows.merchant_attendance_workers[0];
 assert.equal(rows.merchant_enterprise_employees.length,1);assert.equal(rows.merchant_attendance_workers.length,1);
 assert.equal(rows.merchant_attendance_events.length,2);assert.equal(rows.merchant_attendance_location_results.length,2);
 assert.equal(rows.merchant_attendance_employment_periods.length,1);assert.equal(rows.merchant_attendance_location_notice_acknowledgements.length,1);
 assert.equal(rows.merchant_attendance_location_clock_notices.length,2);
 assert.deepEqual(rows.merchant_attendance_events.map(e=>e.action),['clock_in','clock_out']);
 assert.equal(rows.merchant_attendance_shift_schedule_relations.length,1);assert.equal(rows.merchant_attendance_shift_plan_adoptions.length,1);
 assert.equal(rows.merchant_attendance_shift_schedule_relations[0].status,'unselected');
 for(const key of ['selection','slot_id','slot_revision','reason','slot_snapshot','publication_snapshot','cancellation_snapshot'])
  assert.equal(rows.merchant_attendance_shift_schedule_relations[0][key],null,'disposal_unselected_no_opaque_source');
 assert.equal(rows.merchant_attendance_shift_plan_adoptions[0].approval_operation_id,null);
 assert.equal(rows.merchant_attendance_shift_plan_adoptions[0].adoption.status,'unselected');
 assert.equal(employee.id,worker.employee_id);assert.equal(worker.merchant_id,retentionDisposalNativeSite);
 assert(Object.values(rows).every(r=>Array.isArray(r)&&r.length<=2));assert(Object.values(rows).flat().length<=16);
 assert(Buffer.byteLength(JSON.stringify(rows),'utf8')<=65536);
 const noOpaque=value=>{if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){
  assert(!/(?:fingerprint|source_text|sourceText|artifactText)/i.test(key),'disposal_template_opaque_proof_unsupported');noOpaque(v);
 }};noOpaque(rows);
 for(const [i,event] of rows.merchant_attendance_events.entries()){
  const notice=rows.merchant_attendance_location_clock_notices.find(n=>n.event_id===event.id),result=rows.merchant_attendance_location_results.find(r=>r.event_id===event.id);
  assert(notice&&result);assert.equal(notice.command.operationId,event.operation_id);assert.equal(notice.command.action,event.action);
  assert.equal(event.sequence,i+1);assert.equal(event.source,'web');assert.equal(event.occurred_at,event.received_at);
  assert.equal(result.reason,'inside');assert.equal(result.needs_review,false);assert.equal(result.disposal_operation_id,null);
  for(const k of ['captured_at','accuracy_meters','distance_meters'])assert.notEqual(result[k],null);
 }
 const remap=new Map();let serial=1000+idOffset;
 const add=value=>{assert.match(value,/^[a-f0-9-]{36}$/);if(!remap.has(value))remap.set(value,uid(++serial));};
 for(const v of [employee.id,employee.auth_user_id,worker.id])add(v);
 for(const row of rows.merchant_attendance_employment_periods)add(row.id);
 for(const row of rows.merchant_attendance_events){add(row.id);add(row.operation_id);}
 for(const row of rows.merchant_attendance_location_notice_acknowledgements)add(row.operation_id);
 const map=value=>typeof value==='string'?(remap.get(value)??(/^20\d\d-\d\d-\d\d(?:$|[T ])/.test(value)&&value!=='2000-01-01'?shiftDate(value,-3):value)):
  Array.isArray(value)?value.map(map):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,map(v)])):value;
 const mapped=map(rows);mapped.merchant_enterprise_employees[0].email=idOffset===0?'synthetic197-past@example.test':'synthetic197-managed-past@example.test';
 mapped.merchant_attendance_workers[0].worker_no=idOffset===0?'SYNTHETIC197-PAST':'SYNTHETIC197-MANAGED-PAST';
 assert(Object.values(mapped).flat().every(r=>r.merchant_id===retentionDisposalNativeSite||r.event_id));
 return {rows:mapped,days:-3,copiedRows:Object.values(mapped).flat().length,actualHistoricalRpc:false,
  identity:{worker:mapped.merchant_attendance_workers[0].id,employee:mapped.merchant_enterprise_employees[0].id,auth:mapped.merchant_enterprise_employees[0].auth_user_id},
  eventIds:mapped.merchant_attendance_events.map(e=>e.id),operationIds:mapped.merchant_attendance_events.map(e=>e.operation_id)};
}
// A second, finite template path comes only from a genuine current managed
// location start/finish. No saved opaque 191 publication or assignment is copied.
export function retentionDisposalOperationalTemplate(input){
 assert.deepEqual(Object.keys(input).sort(),['activation','base','checkedOperations','operations','sessions']);
 const base=retentionDisposalHistoricalTemplate(input.base,{idOffset:10000});
 assert.equal(input.sessions.length,1);assert.equal(input.operations.length,2);assert.equal(input.checkedOperations.length,2);
 assert.equal(input.activation.action,'activate');assert.equal(input.activation.revision,1);assert.equal(input.activation.command.expectedRevision,0);
 const old=input.base,remaps=new Map();
 const pair=(a,b)=>remaps.set(a,b);
 for(const table of ['merchant_enterprise_employees','merchant_attendance_workers','merchant_attendance_employment_periods']){
  for(const [i,row] of old[table].entries())for(const key of ['id','auth_user_id'])if(row[key])pair(row[key],base.rows[table][i][key]);
 }
 for(const [i,e] of old.merchant_attendance_events.entries()){pair(e.id,base.eventIds[i]);pair(e.operation_id,base.operationIds[i]);}
 for(const [i,n] of old.merchant_attendance_location_notice_acknowledgements.entries())pair(n.operation_id,base.rows.merchant_attendance_location_notice_acknowledgements[i].operation_id);
 pair(input.activation.operation_id,uid(22001));
 const session=input.sessions[0],ref=session.source_ref;
 assert.equal(ref.protocol,'attendance-operational-punch-source-ref-v1');assert.deepEqual(ref.layers,{enterprise:null,group:null,personal:null});
 assert.equal(ref.groupAssignmentRef,null);assert.equal(ref.baselineCorrectionPolicyRef,null);
 assert.equal(session.session.channel,'location');assert.equal(session.session.selection,null);assert.deepEqual(session.session.origins,[]);
 assert.equal(session.start_event_id,old.merchant_attendance_events[0].id);
 for(const [i,op] of input.operations.entries()){
  assert.equal(op.channel,'location');assert.equal(op.event_id,old.merchant_attendance_events[i].id);
  assert.equal(op.start_event_id,session.start_event_id);assert.deepEqual(op.operation,input.checkedOperations[i]);
  assert.equal(op.command.clock.operationId,old.merchant_attendance_events[i].operation_id);
  assert.equal(op.origin_ref.eventId,op.event_id);assert.equal(op.origin_ref.channel,'location');
 }
 const map=v=>typeof v==='string'?(remaps.get(v)??(/^20\d\d-\d\d-\d\d(?:$|[T ])/.test(v)?shiftDate(v,-3):v)):
  Array.isArray(v)?v.map(map):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,map(x)])):v;
 const mapped=map({activation:input.activation,sessions:input.sessions,operations:input.operations});
 assert(Buffer.byteLength(JSON.stringify(mapped),'utf8')<=65536);
 return {base,...mapped,actualCurrentManagedRpc:true,actualHistoricalRpc:false,copiedRows:base.copiedRows+4};
}
export function retentionDisposalOperationalSeed(template){
 assert.equal(template.actualCurrentManagedRpc,true);assert.equal(template.actualHistoricalRpc,false);
 const {base}=template;
 return retentionDisposalHistoricalSeed(base)+`
 do $rd197_managed_seed$ declare a public.merchant_attendance_operational_punch_activations%rowtype;
  s public.merchant_attendance_operational_punch_sessions%rowtype;o public.merchant_attendance_operational_punch_operations%rowtype;
  value jsonb;src jsonb;t jsonb;checked jsonb:='[]';begin
  assert not exists(select 1 from public.merchant_attendance_operational_punch_activations where merchant_id=${quote(retentionDisposalNativeSite)});
  a:=jsonb_populate_record(null::public.merchant_attendance_operational_punch_activations,${json(template.activation)});
  a.command_fingerprint:=public.faolla_attendance_operational_punch_hash_v1(public.faolla_attendance_operational_punch_activation_command_v1(a.merchant_id,a.actor_auth_user_id,a.command));
  perform public.faolla_attendance_operational_punch_activation_item_v1(a);insert into public.merchant_attendance_operational_punch_activations select(a).*;
  s:=jsonb_populate_record(null::public.merchant_attendance_operational_punch_sessions,${json(template.sessions[0])});
  assert s.source_ref->'layers'='{"enterprise":null,"group":null,"personal":null}'::jsonb;
  src:=s.source_ref||jsonb_build_object('protocol','attendance-operational-rule-source-v1','sourceFingerprint',repeat('0',64));
  src:=jsonb_set(src,'{sourceFingerprint}',to_jsonb(public.faolla_attendance_operational_punch_hash_v1(public.faolla_attendance_operational_source_tuple_v1(src))));
  s.source_ref:=public.faolla_attendance_operational_punch_source_ref_v1(src);
  s.session:=s.session||jsonb_build_object('sourceFingerprint',src->'sourceFingerprint');
  s.session:=jsonb_set(s.session,'{policyFingerprint}',to_jsonb(public.faolla_attendance_operational_punch_policy_hash_v1(s.merchant_id,'location',s.session,src)));
  s.session:=jsonb_set(s.session,'{sessionFingerprint}',to_jsonb(public.faolla_attendance_operational_punch_session_hash_v1(s.merchant_id,s.session)));
  insert into public.merchant_attendance_operational_punch_sessions select(s).*;perform public.faolla_attendance_operational_punch_session_v1(s);
  for value in select x from jsonb_array_elements(${json(template.operations)}) x order by (x->'operation'->>'sequence')::bigint loop
   o:=jsonb_populate_record(null::public.merchant_attendance_operational_punch_operations,value);
   if o.command->'choice'->>'kind'='start' then o.command:=jsonb_set(o.command,'{choice,expectedPolicyFingerprint}',s.session->'policyFingerprint');end if;
   t:=public.faolla_attendance_operational_punch_command_v1('location',o.command);
   o.operation:=o.operation||jsonb_build_object('sessionFingerprint',s.session->'sessionFingerprint','sourceFingerprint',s.session->'sourceFingerprint',
    'commandFingerprint',public.faolla_attendance_operational_punch_hash_v1(jsonb_build_array('attendance-operational-punch-command-v1',o.merchant_id,'location',
     o.operation->>'actorAuthUserId',jsonb_build_array(o.worker_id,o.operation->>'employeeId',o.operation->>'employeeAuthUserId'),t->0,t->1)));
   insert into public.merchant_attendance_operational_punch_operations select(o).*;
   checked:=checked||jsonb_build_array(jsonb_build_array(public.faolla_attendance_operational_punch_operation_v1(o),o.origin_ref));
  end loop;
  perform set_config('faolla.rd197_managed_proof',jsonb_build_object('operations',checked,'session',public.faolla_attendance_operational_punch_session_v1(s),'sourceRef',s.source_ref)::text,true);
 end;$rd197_managed_seed$;set constraints all immediate;set constraints all deferred;`;
}
export function retentionDisposalHistoricalSeed(template){
 assert.equal(template.days,-3);assert.equal(template.actualHistoricalRpc,false);
 const {rows,identity}=template;assert.equal(identity.worker,rows.merchant_attendance_workers[0].id);
 return `do $rd197_seed_pre$ begin assert current_user='postgres';
  assert not exists(select 1 from public.merchant_attendance_workers where id=${quote(identity.worker)});
  assert not exists(select 1 from public.merchant_enterprise_employees where id=${quote(identity.employee)} or auth_user_id=${quote(identity.auth)});
 end;$rd197_seed_pre$;
 ${retentionDisposalTemplateTables.map(table=>`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},${json(rows[table])});`).join('\n')}
 set constraints all immediate;set constraints all deferred;
 do $rd197_seed_checked$ declare chain_value jsonb;rel public.merchant_attendance_shift_schedule_relations%rowtype;begin
  chain_value:=public.faolla_attendance_employment_chain_v1(${quote(retentionDisposalNativeSite)},${quote(identity.worker)},${quote(identity.employee)},${quote(identity.auth)});
  assert chain_value->'valid'='true'::jsonb and chain_value->'limited'='false'::jsonb;
  select * into strict rel from public.merchant_attendance_shift_schedule_relations where start_event_id=${quote(template.eventIds[0])};
  perform public.faolla_attendance_location_schedule_receipt_v1(rel,${quote(identity.auth)});
  assert (select count(*) from public.merchant_attendance_disposal_event_coverage where event_id=any(array(select jsonb_array_elements_text(${json(template.eventIds)})::uuid)))=2;
 end;$rd197_seed_checked$;`;
}
export function retentionDisposalNativeRpcExpression(name,args){
 const exact=keys=>assert.deepEqual(Object.keys(args).sort(),keys.sort());
 assert.equal(args.p_site_id??args.p_site??args.p_query?.siteId,retentionDisposalNativeSite);
 if(name==='faolla_attendance_operational_punch_activation_v1'){
  exact(['p_query','p_auth_user_id','p_command','p_allow_activate']);assert.equal(typeof args.p_allow_activate,'boolean');
  return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_activate})`;
 }
 if(name==='faolla_attendance_operational_punch_location_v1'){
  exact(['p_site','p_auth','p_expected_worker','p_query','p_command','p_assertion','p_allow_new_sessions','p_require_clock','p_allow_operational_start','p_allow_schedule','p_bind_rules']);
  for(const k of ['p_allow_new_sessions','p_require_clock','p_allow_operational_start','p_allow_schedule','p_bind_rules'])assert.equal(typeof args[k],'boolean');
  return `public.${name}(${[quote(args.p_site),quote(args.p_auth),quote(args.p_expected_worker),json(args.p_query),json(args.p_command),json(args.p_assertion),
   args.p_allow_new_sessions,args.p_require_clock,args.p_allow_operational_start,args.p_allow_schedule,args.p_bind_rules].join(',')})`;
 }
 if(['faolla_attendance_retention_disposal_v1','faolla_attendance_retention_v1'].includes(name)){
  exact(['p_query','p_auth_user_id','p_command','p_allow_write']);assert.equal(typeof args.p_allow_write,'boolean');
  return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write})`;
 }
 if(name==='faolla_attendance_period_closure_source_v1'){
  exact(['p_query','p_auth_user_id']);return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)})`;
 }
 if(name==='faolla_attendance_period_closure_v2'){
  exact(['p_query','p_auth_user_id','p_command','p_artifact','p_allow_write']);assert.equal(typeof args.p_allow_write,'boolean');
  return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${json(args.p_artifact)},${args.p_allow_write})`;
 }
 const schedule=name==='faolla_attendance_location_schedule_v1';
 assert(schedule||name==='faolla_attendance_location_clock_v2'||name==='faolla_attendance_location_clock_bound_v1');
 exact(['p_site_id','p_auth_user_id','p_expected_worker_id','p_command','p_operation_id','p_assertion','p_allow_new_sessions','p_require_clock',
  ...(schedule?['p_selection','p_allow_schedule','p_bind_rules']:[])]);
 for(const k of ['p_allow_new_sessions','p_require_clock',...(schedule?['p_allow_schedule','p_bind_rules']:[])])assert.equal(typeof args[k],'boolean');
 return `public.${name}(${[quote(args.p_site_id),quote(args.p_auth_user_id),quote(args.p_expected_worker_id),json(args.p_command),quote(args.p_operation_id),
  json(args.p_assertion),args.p_allow_new_sessions,args.p_require_clock,...(schedule?[json(args.p_selection),args.p_allow_schedule,args.p_bind_rules]:[])].join(',')})`;
}

export async function verifyRetentionDisposalNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx;assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const {executeAttendanceLocationSchedule}=require('../../src/lib/merchantAttendanceLocationSchedule.server.ts');
 const {executeAttendanceLocationClock}=require('../../src/lib/merchantAttendanceLocationClock.server.ts');
 const {executeOperationalPunch}=require('../../src/lib/merchantAttendanceOperationalPunch.server.ts');
 const {executeOperationalPunchActivation}=require('../../src/lib/merchantAttendanceOperationalPunchActivation.server.ts');
 const {operationalPunchUiCommand}=require('../../src/lib/merchantAttendanceOperationalPunchUi.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const {projectPeriodClosureSource}=require('../../src/lib/merchantAttendancePeriodClosure.server.ts');
 const {executeRetention}=require('../../src/lib/merchantAttendanceRetention.server.ts');
 const {executeRetentionDisposal}=require('../../src/lib/merchantAttendanceRetentionDisposalExecution.server.ts');
 const names=d.inventory(),baseline=retentionDisposalReadFacts(d,outageNativeFingerprintSql(names)),definitions=d.definitions(),catalog=d.tableCatalog();
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const siteId=retentionDisposalNativeSite,site=quote(siteId),owner=quote(d.owner),all=outageNativeFingerprintSql(names);
 const outside=retentionDisposalOldFactsSql(names.filter(n=>n!=='faolla_schema_migrations'),Object.fromEntries(names.map(n=>[n,
  n==='merchants'?`x.id<>${site}`:n==='merchant_attendance_location_results'?`exists(select 1 from public.merchant_attendance_events e where e.id=x.event_id and e.merchant_id<>${site})`:`x.merchant_id<>${site}`])));
 const prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:retentionDisposalNativeLimits.fixtureMs});
 let activeConnection=connection,steps=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,mainRollbackRestored=false,template=null;
 let phaseStarted=Date.now(),captureSetup=true,competitionCommitted=false,competitionConnection=null,waiterConnection=null,lockPolls=0;
 const setupSql=[],groups=[],competitionPromises=[],busyConnections=new Set(),originalOutside=retentionDisposalReadFacts(d,outside),next=()=>uid(++serial);
 const step=async(label,sql,target=activeConnection)=>{stage=label;assert(++steps<=retentionDisposalNativeLimits.steps,'disposal_max190_steps');
  assert(Date.now()-phaseStarted<retentionDisposalNativeLimits.fixtureMs,'disposal_fixture_deadline');
  const statement=(label==='begin'?'begin;':'')+prefix+sql;if(captureSetup)setupSql.push(statement);
  busyConnections.add(target);try{return await target.step(scope.sql(statement));}finally{busyConnections.delete(target);}};
 const call=async(label,expression,{write=false,replay=false,role='service_role',prepare='',before='',target=activeConnection,facts=all}={})=>{
  const r=JSON.parse(await step(label,`do $rd197_call$ declare old_hash text;value jsonb;prepared_command jsonb;prepared_value jsonb;failure text;state_value text;context_value text;begin
   old_hash:=${facts};${prepare}begin set local role ${role};assert current_user=${quote(role)};
    ${before}value:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics failure=message_text,state_value=returned_sqlstate,context_value=pg_exception_context;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${facts}=old_hash,'rd197_read_reject_replay_wrote';end if;
   assert ${outside}=current_setting('faolla.rd197_outside'),'rd197_original_rows_changed';
   perform set_config('faolla.rd197_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_value,'context',context_value)::text,true);
  end;$rd197_call$;select current_setting('faolla.rd197_result')::jsonb;`,target));lastRpc=r;
  if(r.error||r.value?.error)rejections++;else if(write)writes++;else reads++;return r;
 };
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(r));assert(!r.value?.error,JSON.stringify(r));return r.value;};
 const written=new Set();
 const service={rpc:async(name,args)=>{const operation=args.p_command?.operationId,key=operation?name+':'+operation:null;
  const r=await call('rpc_'+name+'_'+(args.p_command?.action??args.p_query?.mode??'read'),retentionDisposalNativeRpcExpression(name,args),{write:!!args.p_command,replay:key!==null&&written.has(key)});
  if(key&&!r.error&&!r.value?.error)written.add(key);
  return {data:r.value,error:r.error?{message:r.error}:null};}};
 const save=async name=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${all};`);};
 const restore=async(name,hash)=>assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${all};`),hash);
 const query=eventId=>({siteId,mode:'preview',eventId,operationId:null});
 const disposal=(eventId,command=null,allowWrite=true,actor=d.owner)=>executeRetentionDisposal({query:query(eventId),command,authUserId:actor,allowWrite},service);
 const recover=(operationId,actor=d.owner)=>executeRetentionDisposal({query:{siteId,mode:'recover',eventId:null,operationId},command:null,authUserId:actor,allowWrite:false},service);
 const approveCommand=p=>({action:'approve',operationId:next(),eventId:p.eventId,fields:p.fields,previewAt:p.asOf,
  expectedSourceFingerprint:p.sourceFingerprint,expectedPolicyFingerprint:p.policyFingerprint,expectedDependencyFingerprint:p.dependencyFingerprint,
  expectedHoldFingerprint:p.holdFingerprint,expectedPreviewFingerprint:p.previewFingerprint,reason:'Synthetic197 explicit one-event approval'});
 const executeCommand=a=>({action:'execute',operationId:next(),eventId:a.eventId,approvalOperationId:a.operationId});
 const reject=async(promise,code)=>{await assert.rejects(promise,e=>e.code===code);assert.equal(lastRpc.error,code,JSON.stringify(lastRpc));};
 const retention=(q,command=null)=>executeRetention({query:q,command,authUserId:d.owner,allowWrite:true},service);
 const policy=async days=>{const q={siteId,mode:'policies'},r=await retention(q);return retention(q,{siteId,action:'set_policy',operationId:next(),category:'location_results',
  expectedRevision:r.data.items.find(x=>x.category==='location_results').revision,retentionDays:days,reason:'Synthetic197 explicit policy'});};
 const hold=async(category,recordId,action='hold')=>{const q={siteId,mode:'record',category,recordId},r=await retention(q);return retention(q,{siteId,action,operationId:next(),category,recordId,
  expectedRevision:r.data.item.preservation.revision,expectedSourceFingerprint:r.data.item.sourceFingerprint,reason:'Synthetic197 explicit '+action});};
 const pq=(p,day,pid=null,mode='detail',access='owner',fromDate=day)=>({siteId,access,workerId:p.worker,fromDate,throughDate:day,mode,periodId:pid,operationId:null,version:null,cursor:null});
 const period=(q,command=null,p)=>executePeriodClosuresV2({query:q,command,authUserId:q.access==='owner'?d.owner:p.auth,moduleEnabled:true},service);
 const pc=(action,pid,r=null,fp=null)=>({action,periodId:pid,operationId:next(),expectedRevision:r?.period.revision??0,expectedVersion:r?.period.currentVersion??0,
  expectedFingerprint:['send','confirm','seal'].includes(action)?r?.artifact.sourceFingerprint??fp:null,reason:'Synthetic197 actual period '+action});
 const locationInput=(p,operationId=null,command=null)=>({siteId,expectedWorkerId:p.worker,operationId,command,authUserId:p.auth,moduleEnabled:true});
 const schedule=(p,command=null,operationId=null)=>executeAttendanceLocationSchedule({...locationInput(p,operationId,command),...(command?{selection:null}:{}),allowWrite:true,bindRules:false},service);
 const locationCommand=(p,r,action)=>({operationId:next(),expectedWorkerId:p.worker,locationId:r.clock.locationId,action,expectedSequence:r.clock.state.sequence,
  settingsVersion:r.clock.policy.settingsVersion,workerVersion:r.clock.policy.workerVersion,locationVersion:r.clock.policy.locationVersion,noticeRevision:r.clock.noticeGate.revision,safeFinish:false,
  position:{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()},positionFailure:null});
 const captureExpression=p=>`jsonb_build_object(${retentionDisposalTemplateTables.map(n=>{
  const filter=n==='merchant_enterprise_employees'?`id=${quote(p.employee)}`:n==='merchant_attendance_workers'?`id=${quote(p.worker)}`:
   ['merchant_attendance_location_results','merchant_attendance_location_clock_notices'].includes(n)?`event_id in(select id from public.merchant_attendance_events where merchant_id=${site} and worker_id=${quote(p.worker)})`:
    `worker_id=${quote(p.worker)}`;
  return `${quote(n)},(select coalesce(jsonb_agg(to_jsonb(x) order by ${n==='merchant_attendance_events'?'sequence':'to_jsonb(x)::text'}),'[]') from public.${n} x where ${n==='merchant_attendance_location_results'?'':`merchant_id=${site} and `}${filter})`;
 }).join(',')})`;
 const capture=async p=>JSON.parse(await step('capture_current_rpc_template',`select ${captureExpression(p)};`));
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $rd197_begin$ begin assert current_user='postgres';
   assert not exists(select 1 from public.merchants where id=${site});
   assert exists(select 1 from public.faolla_schema_migrations where version=202610080197);
   perform set_config('faolla.rd197_outside',${outside},true);end;$rd197_begin$;select 1;`);
  await step('new_synthetic_identity',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic197 disposal acceptance','synthetic197@example.test');
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(identities.role)},${site},'Synthetic197 self role',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request','attendance.self.export']);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values(${quote(identities.employee)},${site},${quote(identities.auth)},'synthetic197-now@example.test','Synthetic197 present member',${quote(identities.role)},'active',clock_timestamp(),1);select 1;`);
  const admin=async(kind,values)=>ok('admin_'+kind,`public.faolla_attendance_admin_v1(${site},${owner},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,{write:true,
   prepare:`prepared_command:=jsonb_build_object('kind',${quote(kind)},'operationId',${quote(next())},'expectedVersion',coalesce((select version from public.merchant_attendance_settings where merchant_id=${site}),0),'values',${json(values)});`});
  await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
  await admin('location',{id:identities.location,name:'Synthetic197 synthetic fence',timeZone:'UTC',active:true});
  await admin('worker',{id:identities.worker,employeeId:identities.employee,workerNo:'SYNTHETIC197-NOW',displayName:'Synthetic197 present worker',locationId:identities.location,active:true,startsOn:'2000-01-01'});
  await step('disclosed_new_location_fence',`update public.merchant_attendance_settings set location_clock_enabled=true where merchant_id=${site} and not location_clock_enabled;
   update public.merchant_attendance_locations set latitude=37.3,longitude=-5.9,radius_meters=100 where merchant_id=${site} and id=${quote(identities.location)} and latitude is null and longitude is null and radius_meters is null;select 1;`);
  const values={purpose:'Synthetic197 location check',notice:'Synthetic197 no real GPS',contact:'Synthetic owner',alternative:'Administrative review',retentionDays:90,latitude:37.3,longitude:-5.9,radiusMeters:100};
  await ok('location_draft',`public.faolla_attendance_location_policy_draft_v1(${site},${owner},${quote(identities.location)},prepared_command,null,true)`,{write:true,prepare:`prepared_command:=jsonb_build_object('operationId',${quote(next())},'expectedRevision',0,
   'expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),'expectedLocationVersion',(select version from public.merchant_attendance_locations where id=${quote(identities.location)}),'values',${json(values)});`});
  const notice={access:'owner',locationId:identities.location,expectedWorkerId:null,operationId:null};
  await ok('location_publish',`public.faolla_attendance_location_notice_v1(${site},${owner},${json(notice)},prepared_command,true)`,{write:true,prepare:`prepared_command:=jsonb_build_object('action','publish','operationId',${quote(next())},'expectedRevision',0,'draftRevision',1,
   'expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}),'expectedLocationVersion',(select version from public.merchant_attendance_locations where id=${quote(identities.location)}),'reason','Synthetic197 actual notice');`});
  await ok('location_ack',`public.faolla_attendance_location_notice_v1(${site},${quote(identities.auth)},${json({...notice,access:'self',expectedWorkerId:identities.worker})},${json({action:'acknowledge',operationId:next(),expectedRevision:1})},true)`,{write:true});
  captureSetup=false;
  const prepared=await schedule(identities),startCommand=locationCommand(identities,prepared,'clock_in');
  const first=await schedule(identities,startCommand),endCommand=locationCommand(identities,first,'clock_out');
  // The schedule endpoint accepts explicit clock-in only. A normal finish must
  // retain the existing location clock service, not force clock_out into it.
  await executeAttendanceLocationClock(locationInput(identities,null,endCommand),service);
  const currentCoverage=JSON.parse(await step('actual_current_rpc_coverage',`select jsonb_build_object('events',(select count(*) from public.merchant_attendance_events where merchant_id=${site}),
   'covered',(select count(*) from public.merchant_attendance_disposal_event_coverage where merchant_id=${site}),
   'inside',(select count(*) from public.merchant_attendance_location_results where event_id in(select id from public.merchant_attendance_events where merchant_id=${site}) and reason='inside' and captured_at is not null));`));
  assert.deepEqual(currentCoverage,{events:2,covered:2,inside:2});await policy(1);
  const notDue=(await disposal(first.clock.receipt.id)).data.preview;assert(notDue.blockers.includes('not_due'));
  groups.push('normal_current_location_schedule_rpc_forward_capture_and_not_due');
  template=retentionDisposalHistoricalTemplate(await capture(identities));
  await step('explicit_new_past_due_identity',retentionDisposalHistoricalSeed(template)+'select 1;');
  const p=template.identity,eventId=template.eventIds[0],day=template.rows.merchant_attendance_events[0].occurred_at.slice(0,10);
  const preview=await period(pq(p,day,null,'preview'),null,p);assert.deepEqual(preview.preview.blockers,[]);
  const pid=next();let head=await period(pq(p,day,pid),pc('send',pid,null,preview.preview.artifact.sourceFingerprint),p);
  head=await period(pq(p,day,pid,'detail','self'),pc('confirm',pid,head),p);head=await period(pq(p,day,pid),pc('seal',pid,head),p);
  head=await period(pq(p,day,pid),pc('reopen',pid,head),p);head=await period(pq(p,day,pid),pc('send',pid,head),p);
  assert.equal(head.period.currentVersion,2);
  const archiveId=JSON.parse(await step('actual_two_versions_one_reverse_ref',`select jsonb_build_object('versions',(select count(*) from public.merchant_attendance_period_versions where merchant_id=${site} and period_id=${quote(pid)}),
   'artifacts',(select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id=${quote(pid)}),
   'refs',(select count(*) from public.merchant_attendance_disposal_artifact_event_refs where merchant_id=${site} and event_id=${quote(eventId)}),
   'artifactId',(select artifact_id from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id=${quote(pid)}),
   'complete',(select bool_and(status='complete') from public.merchant_attendance_disposal_artifact_coverage where merchant_id=${site}));`));
  assert.equal(archiveId.versions,2);assert.equal(archiveId.artifacts,1);assert.equal(archiveId.refs,1);assert.equal(archiveId.complete,true);
  const ready=(await disposal(eventId)).data.preview;assert.deepEqual(ready.blockers,[]);assert.equal(ready.coverage.eventCovered,true);
  assert.deepEqual(ready.basis.dependencies.artifacts.items.map(a=>a.artifactId),[archiveId.artifactId]);
  groups.push('disclosed_past_due_new_identity_normal_send_two_versions_reused_artifact_exact_reverse_refs');
  // The private preview deliberately has the same hard synthetic-site gate as
  // the public RPC. Do not widen it to make an old-site acceptance fixture pass.
  // This is only an authentic old source hash / capture metadata read; it does
  // NOT prove the preview's dependency_coverage_unknown or public owner path.
  const oldMetadata=await ok('private_old_uncovered_source_metadata_only',`(select jsonb_build_object('siteId',e.merchant_id,'eventId',e.id,
   'eventCovered',exists(select 1 from public.merchant_attendance_disposal_event_coverage c where c.event_id=e.id),
   'sourceFingerprint',public.faolla_attendance_disposal_sha_v1(jsonb_build_object('siteId',e.merchant_id,'category','location_results','recordId',e.id,
    'source',public.faolla_attendance_retention_source_v1(e.merchant_id,'location_results',e.id)))) from public.merchant_attendance_events e
   join public.merchant_attendance_location_results l on l.event_id=e.id where e.merchant_id<>${site} and not exists(select 1 from public.merchant_attendance_disposal_event_coverage c where c.event_id=e.id) order by e.id limit 1)`,{role:'postgres'});
  const oldUncovered={actual:oldMetadata!==null,sourceMetadataOnly:true,previewActual:false,publicOwnerPath:false,coverageBlockerActual:false,
   reason:oldMetadata===null?'no_preboundary_location_in_owned_baseline':'old_site_preview_outside_hard_synthetic_gate_not_tested'};
  if(oldMetadata!==null){assert.equal(oldMetadata.eventCovered,false);assert.match(oldMetadata.sourceFingerprint,/^[a-f0-9]{64}$/);assert.notEqual(oldMetadata.siteId,siteId);}
  const malformed=await ok('private_nested_json_decoder_negative',`to_jsonb(public.faolla_attendance_disposal_json_v1('not-json') is null and public.faolla_attendance_disposal_json_v1((${json({sourceText:JSON.stringify({eventId:uid(98)})})})::text) is not null)`,{role:'postgres'});
  assert.equal(malformed,true);
  for(const [category,recordId,blocker] of [['events',eventId,'event_held'],['period_artifact',archiveId.artifactId,'artifact_held'],['location_results',eventId,'historical_location_snapshot']]){
   const name='hold_'+category,hash=await save(name);await hold(category,recordId);
   assert((await disposal(eventId)).data.preview.blockers.includes(blocker));
   if(category==='location_results'){await hold(category,recordId,'release');assert((await disposal(eventId)).data.preview.blockers.includes(blocker));}
   await restore(name,hash);
  }
  groups.push('actual_event_artifact_holds_and_released_location_snapshot_block');
  const approval=approveCommand((await disposal(eventId)).data.preview);
  await reject(disposal(eventId,approval,false),'attendance_retention_disposal_disabled');
  await reject(disposal(eventId,{...approval,operationId:next(),expectedSourceFingerprint:'0'.repeat(64)}),'attendance_retention_disposal_changed');
  const approved=await disposal(eventId,approval);assert.equal(approved.data.receipt.action,'approve');
  const execution=executeCommand(approval);
  let branch=await save('policy_change');await policy(2);await reject(disposal(eventId,execution),'attendance_retention_disposal_changed');await restore('policy_change',branch);
  branch=await save('hold_change');await hold('events',eventId);await reject(disposal(eventId,execution),'attendance_retention_disposal_changed');await restore('hold_change',branch);
  branch=await save('owner_change');await step('new_synthetic_owner_only',`update public.merchants set user_id=${quote(uid(99))} where id=${site};select 1;`);
  await reject(disposal(eventId,execution),'attendance_access_denied');assert.deepEqual((await recover(approval.operationId)).data.receipt,approved.data.receipt);await restore('owner_change',branch);
  groups.push('owner_approval_flagoff_and_stale_source_policy_hold_owner_rejected');
  branch=await save('actual_26_dependencies');
  // V2 forbids overlapping *new* periods. Keep the one existing frame/pid,
  // change its source through the real123 calendar writer, then send a fresh
  // immutable version through183. No forged refs, direct source rows or hashes.
  // Each SQL step below contains TWO separately reported domain RPCs, in an
  // explicit statement order under service_role: calendar create -> source GET.
  const dependencyDomainRpcs={calendarWrites:0,sourceReads:0,periodSendAttempts:0},calendarOperations=[],sourceFingerprints=new Set([head.artifact.sourceFingerprint]);
  let dependencyBytes=0,capacityHead=head;
  for(let index=0;index<retentionDisposalDependencyLimits.additionalArtifacts;index++){
   const q=pq(p,day,pid),sourceQuery={siteId,access:'owner',workerId:p.worker,fromDate:day,throughDate:day,periodId:pid};
   const mutation=retentionDisposalCalendarMutation(siteId,day,next(),1);
   const item=await ok('same_period_real_calendar_then_source_'+(index+1),`jsonb_build_object('calendar',prepared_value,'command',prepared_command,'raw',public.faolla_attendance_period_closure_source_v1(${json(sourceQuery)},${owner}))`,
    {write:true,prepare:`prepared_command:=${json(mutation.command)}||jsonb_build_object('expectedSettingsVersion',(select version from public.merchant_attendance_settings where merchant_id=${site}));`,
     before:`prepared_value:=public.faolla_attendance_calendar_v1(${json(mutation.query)},${owner},prepared_command,true);`});
   dependencyDomainRpcs.calendarWrites++;dependencyDomainRpcs.sourceReads++;calendarOperations.push(mutation.command.operationId);
   assert.equal(item.calendar.receipt.command.operationId,mutation.command.operationId);assert.equal(item.command.expectedSettingsVersion,item.calendar.settingsVersion);
   const source=projectPeriodClosureSource(item.raw,{...q,mode:'preview',operationId:null,version:null});
   dependencyBytes+=Buffer.byteLength(JSON.stringify(item.raw),'utf8');assert(dependencyBytes<=retentionDisposalDependencyLimits.bytes,'disposal_sources_cumulative_2MiB');
   assert.deepEqual(source.blockers,[]);assert(!sourceFingerprints.has(source.artifact.sourceFingerprint),'disposal_genuine_new_source_required');sourceFingerprints.add(source.artifact.sourceFingerprint);
   assert.deepEqual(source.artifact.source.context.calendar.map(c=>c.operationId).sort(),[...calendarOperations].sort());
   const command={...pc('send',pid,capacityHead),expectedFingerprint:source.artifact.sourceFingerprint};
   if(index===0){
    const captureFault=await save('capture_constraint_fault');
    await step('owned_new_reference_capture_fault',`alter table public.merchant_attendance_disposal_artifact_event_refs add constraint synthetic197_capture_fault check(event_id<>${quote(eventId)}::uuid) not valid;select 1;`);
    const denied=await service.rpc('faolla_attendance_period_closure_v2',{p_query:q,p_auth_user_id:d.owner,p_command:command,p_artifact:source.artifact,p_allow_write:true});
    dependencyDomainRpcs.periodSendAttempts++;
    assert(denied.error);assert.equal(lastRpc.sqlstate,'23514');await restore('capture_constraint_fault',captureFault);
   }
   const result=await service.rpc('faolla_attendance_period_closure_v2',{p_query:q,p_auth_user_id:d.owner,p_command:command,p_artifact:source.artifact,p_allow_write:true});
   dependencyDomainRpcs.periodSendAttempts++;
   assert.equal(result.error,null,JSON.stringify(lastRpc));assert.equal(result.data.kind,'detail');
   assert.equal(result.data.period.periodId,pid);assert.equal(result.data.period.currentVersion,index+3);assert.equal(result.data.period.revision,capacityHead.period.revision+1);
   assert.equal(result.data.artifact.sourceFingerprint,source.artifact.sourceFingerprint);capacityHead=result.data;
   if(index===0)await reject(disposal(eventId,execution),'attendance_retention_disposal_changed');
  }
  //Internal preservation assertion, not a service-role business RPC. These
  //private tables intentionally remain unreadable to service_role directly.
  const capacity=await ok('actual_same_period_27_versions_26_artifacts_refs',`jsonb_build_object(
   'versions',(select count(*) from public.merchant_attendance_period_versions where merchant_id=${site} and period_id=${quote(pid)}),
   'artifacts',(select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id=${quote(pid)}),
   'refs',(select count(*) from public.merchant_attendance_disposal_artifact_event_refs where merchant_id=${site} and event_id=${quote(eventId)}),
   'complete',(select count(*) from public.merchant_attendance_disposal_artifact_coverage c join public.merchant_attendance_period_artifacts a using(merchant_id,artifact_id) where a.merchant_id=${site} and a.period_id=${quote(pid)} and c.status='complete'),
   'calendar',(select count(*) from public.merchant_attendance_calendar_entries where merchant_id=${site}))`,{role:'postgres'});
  assert.deepEqual(capacity,{versions:27,artifacts:26,refs:26,complete:26,calendar:25});assert.deepEqual(dependencyDomainRpcs,{calendarWrites:25,sourceReads:25,periodSendAttempts:26});
  const limited=(await disposal(eventId)).data.preview;
  assert(limited.blockers.includes('artifact_dependency_limit'));assert.equal(limited.coverage.artifactLimitExceeded,true);
  assert.equal(limited.basis.dependencies.artifacts.coverage,'over_limit');assert.equal(limited.basis.dependencies.artifacts.items.length,25);
  await restore('actual_26_dependencies',branch);
  groups.push('capture_constraint_failure_atomicity_25_same_period_actual_calendar_source_sends_stale_approval_then_26_reverse_dependencies_block');
  // A real location-row CHECK fails AFTER the execution ledger insertion. The
  // public RPC subtransaction must roll both back, not leave a receipt-only win.
  branch=await save('execution_fault');
  await step('owned_execution_update_fault',`alter table public.merchant_attendance_location_results add constraint synthetic197_update_fault check(disposal_operation_id is distinct from ${quote(execution.operationId)}::uuid) not valid;select 1;`);
  await assert.rejects(()=>disposal(eventId,execution));assert.equal(lastRpc.sqlstate,'23514');assert.equal((await recover(execution.operationId)).data.receipt,null);
  await restore('execution_fault',branch);groups.push('actual_update_after_ledger_failure_atomic_rollback');
  // Exact original period/source and archive bytes exclude location precision.
  const immutable=JSON.parse(await step('pre_disposal_exact_originals',`select jsonb_build_object('events',(select jsonb_agg(to_jsonb(e) order by sequence) from public.merchant_attendance_events e where worker_id=${quote(p.worker)}),
   'source',(select jsonb_build_array(s->'sourceText',s->'sourceFingerprint') from (select public.faolla_attendance_period_closure_source_v1(${json({siteId,access:'owner',workerId:p.worker,fromDate:day,throughDate:day,periodId:pid})},${owner}) s) fixed_source),
   'archives',(select jsonb_agg(jsonb_build_array(artifact_id,artifact_text,artifact_bytes,artifact_sha256) order by artifact_id) from public.merchant_attendance_period_artifacts where merchant_id=${site}));`));
  const executed=await disposal(eventId,execution);assert.equal(executed.data.receipt.action,'execute');
  const nulls=JSON.parse(await step('actual_three_SQL_NULLs_and_exact_originals',`select jsonb_build_object('nulls',(select captured_at is null and accuracy_meters is null and distance_meters is null and disposal_operation_id=${quote(execution.operationId)} from public.merchant_attendance_location_results where event_id=${quote(eventId)}),
   'events',(select jsonb_agg(to_jsonb(e) order by sequence) from public.merchant_attendance_events e where worker_id=${quote(p.worker)}),
   'source',(select jsonb_build_array(s->'sourceText',s->'sourceFingerprint') from (select public.faolla_attendance_period_closure_source_v1(${json({siteId,access:'owner',workerId:p.worker,fromDate:day,throughDate:day,periodId:pid})},${owner}) s) fixed_source),
   'archives',(select jsonb_agg(jsonb_build_array(artifact_id,artifact_text,artifact_bytes,artifact_sha256) order by artifact_id) from public.merchant_attendance_period_artifacts where merchant_id=${site}));`));
  assert.equal(nulls.nulls,true);const {nulls:_nulls,...after}=nulls;void _nulls;assert.deepEqual(after,immutable);
  const reread=await executeAttendanceLocationClock(locationInput(p,template.operationIds[0]),service);
  assert.equal(reread.locationResult.disposal.operationId,execution.operationId);
  const scheduled=await schedule(p,null,template.operationIds[0]);assert.equal(scheduled.clock.locationResult.disposal.operationId,execution.operationId);assert(scheduled.association&&scheduled.adoption);
  assert.deepEqual((await recover(execution.operationId)).data.receipt,executed.data.receipt);
  // Replay has its own complete, SAME-connection all-facts assertion in call().
  const replayed=await disposal(eventId,execution);assert.deepEqual(replayed.data.receipt,executed.data.receipt);
  assert((await disposal(eventId)).data.preview.blockers.includes('already_disposed'));
  const retained=await retention({siteId,mode:'record',category:'location_results',recordId:eventId});assert.equal(retained.data.item.source.disposal.operationId,execution.operationId);
  groups.push('actual_three_NULLs_immutable_raw_events_period_source_archives_strict_clock_schedule_retention_and_recover');
  // The actual 193 managed channel has its own complete command/origin proof.
  // It cannot be represented by the legacy schedule receipt above. Its current
  // RPC facts are first captured, then rolled back before a NEW past identity is
  // inserted with explicitly recomputed source/policy/session/command hashes.
  const managedHash=await save('managed_location_original'),managedNow={employee:uid(30),auth:uid(31),worker:uid(32)},managedAck=next();
  await step('new_current_managed_identity',`
   insert into public.merchant_enterprise_employees select (jsonb_populate_record(null::public.merchant_enterprise_employees,to_jsonb(x)||${json({id:managedNow.employee,auth_user_id:managedNow.auth,email:'synthetic197-managed-now@example.test'})})).* from public.merchant_enterprise_employees x where merchant_id=${site} and id=${quote(identities.employee)};
   insert into public.merchant_attendance_workers select (jsonb_populate_record(null::public.merchant_attendance_workers,to_jsonb(x)||${json({id:managedNow.worker,employee_id:managedNow.employee,worker_no:'SYNTHETIC197-MANAGED-NOW'})})).* from public.merchant_attendance_workers x where merchant_id=${site} and id=${quote(identities.worker)};
   insert into public.merchant_attendance_employment_periods select (jsonb_populate_record(null::public.merchant_attendance_employment_periods,to_jsonb(x)||${json({id:next(),worker_id:managedNow.worker,employee_id:managedNow.employee,employee_auth_user_id:managedNow.auth})})).* from public.merchant_attendance_employment_periods x where merchant_id=${site} and worker_id=${quote(identities.worker)};
   insert into public.merchant_attendance_location_notice_acknowledgements select (jsonb_populate_record(null::public.merchant_attendance_location_notice_acknowledgements,to_jsonb(x)||${json({operation_id:managedAck,worker_id:managedNow.worker,employee_id:managedNow.employee,actor_auth_user_id:managedNow.auth})}||jsonb_build_object('command',jsonb_set(x.command,'{operationId}',to_jsonb(${quote(managedAck)}::text))))).* from public.merchant_attendance_location_notice_acknowledgements x where merchant_id=${site} and worker_id=${quote(identities.worker)};set constraints all immediate;set constraints all deferred;select 1;`);
  await executeOperationalPunchActivation({query:{siteId,mode:'current'},command:{siteId,action:'activate',operationId:next(),expectedRevision:0,reason:'Synthetic197 actual managed location activation'},authUserId:d.owner,allowActivate:true},service);
  const managed=(person,command=null,operationId=null)=>executeOperationalPunch({siteId,channel:'location',authUserId:person.auth,expectedWorkerId:person.worker,
   query:command?{mode:'recover',operationId:command.clock.operationId}:operationId?{mode:'recover',operationId}:{mode:'prepare'},command,
   moduleEnabled:command!==null||operationId===null,allowOperationalStart:command!==null||operationId===null,allowSchedule:true,bindRules:false,
   position:command?{latitude:37.3,longitude:-5.9,accuracyMeters:10,capturedAt:new Date().toISOString()}:null,positionFailure:null},service);
  const managedPrepared=await managed(managedNow),managedStart=operationalPunchUiCommand(managedPrepared,'clock_in',next(),null,null,false);
  const managedStarted=await managed(managedNow,managedStart);assert.equal(managedStarted.clock.locationResult.reason,'inside');
  const managedWorking=await managed(managedNow),managedEnd=operationalPunchUiCommand(managedWorking,'clock_out',next(),null,null,false);
  const managedFinished=await managed(managedNow,managedEnd);assert.equal(managedFinished.clock.locationResult.reason,'inside');
  const managedCapture=JSON.parse(await step('capture_actual_193_managed_templates',`select jsonb_build_object('base',${captureExpression(managedNow)},
   'activation',(select to_jsonb(a) from public.merchant_attendance_operational_punch_activations a where merchant_id=${site}),
   'sessions',(select jsonb_agg(to_jsonb(s) order by start_event_id) from public.merchant_attendance_operational_punch_sessions s where merchant_id=${site} and worker_id=${quote(managedNow.worker)}),
   'operations',(select jsonb_agg(to_jsonb(o) order by (operation->>'sequence')::bigint) from public.merchant_attendance_operational_punch_operations o where merchant_id=${site} and worker_id=${quote(managedNow.worker)}),
   'checkedOperations',(select jsonb_agg(public.faolla_attendance_operational_punch_operation_v1(o) order by (operation->>'sequence')::bigint) from public.merchant_attendance_operational_punch_operations o where merchant_id=${site} and worker_id=${quote(managedNow.worker)}));`));
  const managedPast=retentionDisposalOperationalTemplate(managedCapture);
  await step('rollback_actual_current_managed_before_new_past_seed','rollback to savepoint managed_location_original;select 1;');
  await step('explicit_past_managed_identity_full_proof',retentionDisposalOperationalSeed(managedPast)+'select 1;');
  const managedTarget=managedPast.base.eventIds[0],managedApproval=approveCommand((await disposal(managedTarget)).data.preview);
  await disposal(managedTarget,managedApproval);const managedExecution=executeCommand(managedApproval);await disposal(managedTarget,managedExecution);
  const managedRecovered=await managed(managedPast.base.identity,null,managedPast.base.operationIds[0]);
  assert.equal(managedRecovered.operation.eventId,managedTarget);assert.equal(managedRecovered.clock.locationResult.disposal.operationId,managedExecution.operationId);
  const managedProof=JSON.parse(await step('actual_193_operation_origin_source_proofs_after_disposal',`select jsonb_build_object('unchanged',current_setting('faolla.rd197_managed_proof')::jsonb=jsonb_build_object(
   'operations',(select jsonb_agg(jsonb_build_array(public.faolla_attendance_operational_punch_operation_v1(o),public.faolla_attendance_operational_punch_origin_v1(e,'location')) order by e.sequence)
    from public.merchant_attendance_operational_punch_operations o join public.merchant_attendance_events e on e.id=o.event_id where o.merchant_id=${site} and o.worker_id=${quote(managedPast.base.identity.worker)}),
   'session',(select public.faolla_attendance_operational_punch_session_v1(s) from public.merchant_attendance_operational_punch_sessions s where merchant_id=${site} and worker_id=${quote(managedPast.base.identity.worker)}),
   'sourceRef',(select source_ref from public.merchant_attendance_operational_punch_sessions where merchant_id=${site} and worker_id=${quote(managedPast.base.identity.worker)})),
   'covered',(select count(*)=2 from public.merchant_attendance_disposal_event_coverage where merchant_id=${site} and worker_id=${quote(managedPast.base.identity.worker)}));`));
  assert.deepEqual(managedProof,{unchanged:true,covered:true});await restore('managed_location_original',managedHash);
  groups.push('actual_193_managed_location_RPC_new_past_template_three_NULLs_original_GET_operation_origin_source_hashes_unchanged');
  await step('final_constraints',`set constraints all immediate;select 1;`);await step('rollback','rollback;');mainRollbackRestored=true;
  assert.equal(retentionDisposalReadFacts(d,all),baseline);assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  // Separate, explicitly approved finite competition. Only NEW synthetic rows
  // are committed so the second connection can actually see them. They remain
  // within the parent's owned disposable schema; no append-only row is deleted.
  await connection.close();phaseStarted=Date.now();
  competitionConnection=native.connect({lifetimeMs:retentionDisposalNativeLimits.competitionMs});activeConnection=competitionConnection;
  await step('competition_new_synthetic_setup',setupSql.join('\n')+retentionDisposalHistoricalSeed(template)+'select 1;');
  await policy(1);
  const approveA=approveCommand((await disposal(template.eventIds[0])).data.preview),approveB=approveCommand((await disposal(template.eventIds[1])).data.preview);
  await disposal(approveA.eventId,approveA);await disposal(approveB.eventId,approveB);
  const executeA=executeCommand(approveA),executeB=executeCommand(approveB);
  const eventHoldCommand=async targetId=>{
   const r=await retention({siteId,mode:'record',category:'events',recordId:targetId});
   return {siteId,action:'hold',operationId:next(),category:'events',recordId:targetId,expectedRevision:r.data.item.preservation.revision,
    expectedSourceFingerprint:r.data.item.sourceFingerprint,reason:'Synthetic197 exact lock race hold'};
  };
  const holdA=await eventHoldCommand(executeA.eventId),holdB=await eventHoldCommand(executeB.eventId);
  await step('competition_seed_commit','set constraints all immediate;commit;');competitionCommitted=true;
  assert.equal(retentionDisposalReadFacts(d,outside),originalOutside,'rd197_committed_seed_changed_original_rows');
  waiterConnection=native.connect({lifetimeMs:retentionDisposalNativeLimits.competitionMs});
  const lockWitness=async(holderPid,waiter)=>{
   assert(Number.isSafeInteger(holderPid)&&holderPid>0);assert.match(waiter.name,/^attendance_race_[a-f0-9]{32}$/);
   const end=Date.now()+2500;let witness=null,polls=0;
   while(Date.now()<end&&polls++<100){lockPolls++;
    witness=JSON.parse(native.query(`select coalesce((select jsonb_build_object('waiterPid',pid,'holderPid',${holderPid},'blockers',pg_blocking_pids(pid)) from pg_stat_activity
     where application_name=${quote(waiter.name)} and wait_event_type='Lock' and ${holderPid}=any(pg_blocking_pids(pid))),'null'::jsonb);`));
    if(witness)return witness;await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert.fail('rd197_exact_settings_lock_blocker_not_witnessed');
  };
  const disposalExpression=c=>retentionDisposalNativeRpcExpression('faolla_attendance_retention_disposal_v1',{p_query:query(c.eventId),p_auth_user_id:d.owner,p_command:c,p_allow_write:true});
  const holdExpression=c=>retentionDisposalNativeRpcExpression('faolla_attendance_retention_v1',{p_query:{siteId,mode:'record',category:'events',recordId:c.recordId},p_auth_user_id:d.owner,p_command:c,p_allow_write:true});
  const beginRace=async()=>{
   const begin=`begin;set local lock_timeout='3s';set local statement_timeout='10s';select set_config('faolla.rd197_outside',${quote(originalOutside)},true);select pg_backend_pid();`;
   await step('race_holder_begin',begin);await step('race_waiter_begin',begin,waiterConnection);
  };
  await beginRace();const held=await ok('race_hold_first',holdExpression(holdA),{write:true});assert.equal(held.receipt.command.action,'hold');
  const holderPid=Number(await step('race_exact_holder_pid','select pg_backend_pid();'));
  // Only the holder's exact preservation operation can become visible while
  // the waiter is blocked. Every other full row, including attempted execution
  // and target location precision, must still match on a rejected waiter.
  const withoutHolderHold=`(select md5(jsonb_object_agg(n,rows order by n)::text) from (${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from public.${n} x${n==='merchant_attendance_preservation_operations'?` where not(merchant_id=${site} and operation_id=${quote(holdA.operationId)})`:''}) rows`).join(' union all ')}) exact_race_facts)`;
  const waitingExecute=call('race_execute_waits',disposalExpression(executeA),{write:true,target:waiterConnection,facts:withoutHolderHold});
  waitingExecute.catch(()=>{});competitionPromises.push(waitingExecute);
  const witnessA=await lockWitness(holderPid,waiterConnection);await step('race_hold_commits','set constraints all immediate;commit;');
  const denied=await waitingExecute;assert.equal(denied.error,'attendance_retention_disposal_changed');await step('race_execute_rollback','rollback;',waiterConnection);
  await beginRace();const disposed=await ok('race_execute_first',disposalExpression(executeB),{write:true});assert.equal(disposed.data.receipt.action,'execute');
  const holderPidB=Number(await step('race_exact_holder_pid_b','select pg_backend_pid();'));
  const waitingHold=call('race_hold_waits',holdExpression(holdB),{write:true,target:waiterConnection});
  waitingHold.catch(()=>{});competitionPromises.push(waitingHold);
  const witnessB=await lockWitness(holderPidB,waiterConnection);await step('race_execute_commits','set constraints all immediate;commit;');
  const heldAfter=await waitingHold;assert.equal(heldAfter.error,null,JSON.stringify(heldAfter));assert.equal(heldAfter.value.receipt.command.action,'hold');
  await step('race_later_hold_commits','set constraints all immediate;commit;',waiterConnection);
  const final=JSON.parse(await step('competition_actual_two_orders_final',`select jsonb_build_object(
   'firstNotDisposed',(select disposal_operation_id is null and captured_at is not null from public.merchant_attendance_location_results where event_id=${quote(executeA.eventId)}),
   'secondDisposed',(select disposal_operation_id=${quote(executeB.operationId)} and captured_at is null and accuracy_meters is null and distance_meters is null from public.merchant_attendance_location_results where event_id=${quote(executeB.eventId)}),
   'eventHolds',(select count(*) from public.merchant_attendance_preservation_operations where merchant_id=${site} and category='events' and action='hold'),
   'executions',(select count(*) from public.merchant_attendance_disposal_executions where merchant_id=${site}));`));
  assert.deepEqual(final,{firstNotDisposed:true,secondDisposed:true,eventHolds:2,executions:1});
  assert.equal(retentionDisposalReadFacts(d,outside),originalOutside);groups.push('actual_committed_owned_synthetic_settings_lock_hold_execute_both_orders');
  return {phase:197,groups,steps,reads,writes,rejections,actualLocationRpc:true,actualPeriodSend:true,pastDueSyntheticSeed:{newIdentity:true,shiftDays:template.days,rows:template.copiedRows,actualHistoricalRpc:false},
   actualSqlNullUpdate:true,mainRollbackRestored,dependencyCapacity:{domainRpcs:dependencyDomainRpcs,sourceBytes:dependencyBytes,...capacity},oldUncovered,newSiteUncoveredPreview:{actual:false,reason:'all_forward_events_have_actual_same_tx_coverage'},
   extractorNegative:{nestedJsonDecoderActual:true,unknownFormatLegalWriterClaim:false,captureConstraintAtomicityActual:true},competition:{actual:true,committedSyntheticFixture:true,cleanupOwnedByParent:true,lockWitnesses:[witnessA,witnessB],lockPolls},oldFactsUnchanged:true,oldArchivesUnchanged:true,
   limits:retentionDisposalNativeLimits,realAuth:false,realGps:false,externalAuthRequests:0,newCluster:false,production:false};
 }catch(error){throw new Error('retention_disposal_native_stage:'+stage+':'+JSON.stringify(retentionDisposalNativeFailureSummary(stage,steps,lastRpc))+':'+String(error?.stack??error).slice(0,2200),{cause:error});}
 finally{try{if(!mainRollbackRestored)await connection.step('rollback;');}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{
   await connection.close();for(const extra of [competitionConnection,waiterConnection])if(extra){
    if(busyConnections.has(extra))await extra.close();
    else try{await extra.step('rollback;');}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await extra.close();}
   }
   await Promise.allSettled(competitionPromises);
  }
  if(!competitionCommitted)assert.equal(retentionDisposalReadFacts(d,all),baseline,'rd197_main_rollback');else assert.equal(retentionDisposalReadFacts(d,outside),originalOutside,'rd197_competition_originals');
  assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);
 }
}
