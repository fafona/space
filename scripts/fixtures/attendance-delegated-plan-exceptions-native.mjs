//209 INERT, caller-owned local SQL only. One new site, one outer rollback.
//Six disclosed merchant/role/identity seeds and 33 append-only synthetic
//historical rows: 099/140 reject past publication/approval. These are NOT real
//past publications, approvals or clock requests. Cases, all decisions, grants,
//leave and171 adoption are created only by their actual guarded RPCs. Separate
//future099+136 publication and146 approval are real RPCs, never backdated.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {managementAuditNativeCatalogSql} from './attendance-management-audit-native.mjs';
import {delegatedRevisionsNativeCleanup} from './attendance-delegated-revisions-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(209600000+n);
export const delegatedPlanExceptionsNativeSite='99990209';
export const delegatedPlanExceptionsNativeIds=Object.freeze({role:uid(1),selfRole:uid(2),delegate:uid(3),delegateAuth:uid(4),employee:uid(5),
 employeeAuth:uid(6),other:uid(7),otherAuth:uid(8),worker:uid(9),location:uid(10),otherLocation:uid(11),replacementAuth:uid(12)});
export const delegatedPlanExceptionsNativeGroupBudgets=Object.freeze([
 ['actual099_136_future_publication_146_approval_and_default_cutoff',14,17],
 ['disclosed33_past_templates_actual170_174_NULL_owner_decisions',9,11],
 ['actual202_includePending_actual209_confirmed_excused_and_lost_reply',11,14],
 ['self_cross_actor_worker_location_whole_source_scope_and_identity',9,13],
 ['CAS_independent_gates_actual122_171_not_applicable_and170_clearance',25,28],
 ['real_revoke_epoch_pause_auth_rebind_minimum_original_receipt',10,18],
 ['owned_AFTER23514_three_ledgers_notifications_atomic_same_number_retry',7,15],
 ['paused_flags_off_originals_appendonly_full_rollback',5,9],
].map(([name,rpcs,steps])=>Object.freeze({name,rpcs,steps})));
const rpcNames=Object.freeze({
 faolla_attendance_delegated_plan_exceptions_v1:['p_query','p_auth_user_id','p_command','p_allow_write','p_allow_posthoc','p_allow_clearance','p_capture_notifications'],
 faolla_attendance_management_delegations_v1:['p_query','p_auth_user_id','p_command','p_allow_grant'],
 faolla_attendance_admin_v1:['p_site_id','p_auth_user_id','p_query','p_command','p_operation_id'],
 faolla_attendance_schedule_evidenced_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
 faolla_attendance_rules_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
 faolla_attendance_plan_rule_approvals_v1:['p_query','p_auth_user_id','p_command','p_module_enabled'],
 faolla_attendance_plan_exception_posthoc_review_v1:['p_query','p_auth_user_id','p_command','p_allow_write','p_allow_posthoc','p_allow_clearance','p_capture_notifications'],
 faolla_attendance_plan_exception_clearance_v1:['p_query','p_auth_user_id','p_command','p_allow_write','p_allow_clearance','p_capture_notifications'],
 faolla_attendance_plan_posthoc_adoption_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
 faolla_attendance_leave_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
});
export function delegatedPlanExceptionsNativeRpcExpression(name,args){
 const fields=rpcNames[name];assert(fields,'exceptions209_public_RPC_allowlist');assert.deepEqual(Object.keys(args).sort(),[...fields].sort());
 assert.match(args.p_query?.siteId??args.p_site_id,/^9999[0-9]{4}$/);assert.match(args.p_auth_user_id,/^[0-9a-f-]{36}$/);
 for(const key of fields)if(key.startsWith('p_allow_')||key.startsWith('p_capture_')||key==='p_module_enabled')assert.equal(typeof args[key],'boolean');
 const value=v=>v===null?'null':typeof v==='boolean'?String(v):typeof v==='string'?quote(v):json(v);
 return `public.${name}(${fields.map(field=>field+'=>'+value(args[field])).join(',')})`;
}
export function delegatedPlanExceptionsNativeDecision(result,outcome,operationId){
 assert(['confirmed','excused','follow_up','cleared','not_applicable'].includes(outcome));const review=result.kind==='context'?result.context.review:result;
 assert(review.detail?.current);const d=review.detail,p=require('../../src/lib/merchantAttendanceDelegatedPlanExceptions.ts');
 const c=p.parseDelegatedPlanExceptionsCommand({operationId,expectedRevision:d.revision,expectedFingerprint:d.current.fingerprint,
  employeeId:d.worker.employeeId,employeeAuthUserId:d.worker.employeeAuthUserId,outcome,note:'Synthetic209 actual old lawful '+outcome});
 if(result.kind==='context')p.delegatedPlanExceptionsCommandForContext(result,c);return c;
}
export function delegatedPlanExceptionsNativeLegacyReviewArgs(siteId,owner,workerId,slotId,command=null,mode=command?'decide':'detail'){
 assert.equal(siteId,delegatedPlanExceptionsNativeSite);for(const value of [owner,workerId,slotId])assert.match(value,/^[0-9a-f-]{36}$/);
 assert(['detail','decide','recover'].includes(mode));assert(mode==='detail'?command===null:command!==null);
 if(command!==null)assert.match(command.operationId,/^[0-9a-f-]{36}$/);
 return {p_query:{siteId,access:'owner',mode,workerId,slotId,operationId:command?.operationId??null,beforeAt:null,beforeId:null},
  p_auth_user_id:owner,p_command:mode==='recover'?null:command,p_allow_write:true,p_allow_posthoc:true,p_allow_clearance:true,p_capture_notifications:true};
}
export function delegatedPlanExceptionsNativeFaultSql(operationId,site=delegatedPlanExceptionsNativeSite){
 assert.match(operationId,/^[0-9a-f-]{36}$/);assert.equal(site,delegatedPlanExceptionsNativeSite);
 return `create function public.synthetic209_owned_late_exception_fault_v1() returns trigger language plpgsql set search_path=pg_catalog as $owned209_fault$
 begin if new.merchant_id=${quote(site)} and new.operation_id=${quote(operationId)} then raise exception using errcode='23514',message='synthetic209_late_sidecar_failure',constraint='synthetic209_owned_late_exception_fault';end if;return new;end;$owned209_fault$;
 create trigger synthetic209_owned_late_exception_fault after insert on public.merchant_attendance_management_delegation_operations
 for each row execute function public.synthetic209_owned_late_exception_fault_v1();select 1;`;
}
//Only immutable historical INPUT facts. The review case/entry/notification and
//management sidecar tables never appear in this INSERT template.
export function delegatedPlanExceptionsNativeHistorySql(site,owner,p){
 assert.equal(site,delegatedPlanExceptionsNativeSite);for(const v of [owner,...Object.values(p)])assert.match(v,/^[0-9a-f-]{36}$/);
 return `do $ex209_history$ declare s public.merchant_attendance_settings%rowtype;w public.merchant_attendance_workers%rowtype;
 e public.merchant_enterprise_employees%rowtype;loc public.merchant_attendance_locations%rowtype;v public.merchant_attendance_schedule_slots%rowtype;
 relation public.merchant_attendance_shift_schedule_relations%rowtype;seed integer;r bigint;a timestamptz;b timestamptz;t timestamptz;
 clock_start timestamptz;clock_finish timestamptz;event_location uuid;pair jsonb;context jsonb;rule_source jsonb;source_hash text;adoption jsonb;
 pub uuid;slot uuid;approval uuid;rule_pub uuid;ev_start uuid;ev_end uuid;op_start uuid;op_end uuid;
 fmt3 constant text:='YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';fmt6 constant text:='YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
 begin
 assert current_user='postgres';perform 1 from public.merchants where id=${quote(site)} and user_id=${quote(owner)} for share;assert found;
 select * into s from public.merchant_attendance_settings where merchant_id=${quote(site)} for update;
 select * into w from public.merchant_attendance_workers where merchant_id=${quote(site)} and id=${quote(p.worker)} for update;
 select * into e from public.merchant_enterprise_employees where merchant_id=${quote(site)} and id=w.employee_id for share;
 select * into loc from public.merchant_attendance_locations where merchant_id=${quote(site)} and id=w.default_location_id for share;
 assert w.active and e.status='active' and w.employee_id=${quote(p.employee)} and e.auth_user_id=${quote(p.employeeAuth)} and loc.id=${quote(p.location)} and loc.time_zone='UTC';
 assert not exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(site)} and worker_id=w.id);
 for seed in 0..3 loop
 pub:=(array[${[uid(200),uid(220),uid(240),uid(260)].map(quote).join(',')}]::uuid[])[seed+1];
 slot:=(array[${[uid(201),uid(221),uid(241),uid(261)].map(quote).join(',')}]::uuid[])[seed+1];
 approval:=(array[${[uid(202),uid(222),uid(242),uid(262)].map(quote).join(',')}]::uuid[])[seed+1];
 rule_pub:=(array[${[uid(203),uid(223),uid(243),uid(263)].map(quote).join(',')}]::uuid[])[seed+1];
 ev_start:=(array[${[uid(204),uid(224),uid(244),uid(264)].map(quote).join(',')}]::uuid[])[seed+1];
 ev_end:=(array[${[uid(205),uid(225),uid(245),uid(265)].map(quote).join(',')}]::uuid[])[seed+1];
 op_start:=(array[${[uid(206),uid(226),uid(246),uid(266)].map(quote).join(',')}]::uuid[])[seed+1];
 op_end:=(array[${[uid(207),uid(227),uid(247),uid(267)].map(quote).join(',')}]::uuid[])[seed+1];
 a:=(((clock_timestamp() at time zone 'UTC')::date-(case seed when 0 then 5 when 1 then 4 when 2 then 2 else 3 end))::timestamp+interval '8 hours') at time zone 'UTC';
 b:=a+interval '2 hours';t:=a-interval '48 hours';pair:=jsonb_build_array(to_char(a at time zone 'UTC',fmt3),to_char(b at time zone 'UTC',fmt3));
 select coalesce(max(revision),0)+1 into r from public.merchant_attendance_schedule_commands where merchant_id=${quote(site)};
 assert not exists(select 1 from public.merchant_attendance_schedule_slots where merchant_id=${quote(site)} and worker_id=w.id and start_at<b and end_at>a);
 insert into public.merchant_attendance_schedule_commands(merchant_id,revision,operation_id,actor_auth_user_id,query,command,recorded_at)
 values(${quote(site)},r,pub,${quote(owner)},jsonb_build_object('siteId',${quote(site)},'access','owner','workerId',w.id,'fromDate',to_char(a at time zone 'UTC','YYYY-MM-DD'),'throughDate',to_char(a at time zone 'UTC','YYYY-MM-DD'),'operationId',null),
 jsonb_build_object('operationId',pub,'expectedRevision',r-1,'expectedSettingsVersion',s.version,'reason','Synthetic209 historical template, not actual past publication','action','publish','locationId',loc.id,'timeZone','UTC','slots',jsonb_build_array(pair)),t);
 insert into public.merchant_attendance_schedule_slots(merchant_id,id,revision,worker_id,employee_id,worker_name,location_id,location_name,time_zone,work_date,start_at,end_at)
 values(${quote(site)},slot,r,w.id,e.id,w.display_name,loc.id,loc.name,'UTC',(a at time zone 'UTC')::date,a,b) returning * into v;
 insert into public.merchant_attendance_schedule_publication_evidence(merchant_id,revision,operation_id,actor_auth_user_id,worker_id,employee_id,employee_auth_user_id,identity_status,worker_version,location_id,location_version,settings_version,time_zone,slots,published_at,recorded_at,capture_policy)
 values(${quote(site)},r,pub,${quote(owner)},w.id,e.id,e.auth_user_id,'bound',w.version,loc.id,loc.version,s.version,'UTC',jsonb_build_array(jsonb_build_object('id',v.id,'workDate',to_char(v.work_date,'YYYY-MM-DD'),'startAt',pair->0,'endAt',pair->1)),t,t,'publish-identity-context-v1');
 context:=public.faolla_attendance_self_schedule_slot_v1(v);assert context->'slot'->'hasPublicationEvidence'='true'::jsonb;
 if seed<3 then
 rule_source:=jsonb_build_object('protocol','plan-rule-point-v1','policy','owner-approved-plan-start-v1','siteId',${quote(site)},'workerId',w.id,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,
 'workerVersion',w.version,'settingsVersion',s.version,'timeZone','UTC','slot',jsonb_build_object('id',v.id,'revision',v.revision,'locationId',loc.id,'locationVersion',loc.version,'timeZone','UTC','startAt',pair->0,'endAt',pair->1),
 'assignment',null,'group',null,'personal',jsonb_build_object('revision',0,'approval',null),'enterprise',jsonb_build_object('revision',2,'publication',jsonb_build_object('operationId',rule_pub,'revision',2,
 'actorId',${quote(owner)},'recordedAt',to_char((a-interval '72 hours') at time zone 'UTC',fmt6),'effectiveAt',to_char((a-interval '24 hours') at time zone 'UTC',fmt3),
 'rules',jsonb_build_object('lateGraceMinutes',jsonb_build_object('mode','value','minutes',0),'earlyGraceMinutes',jsonb_build_object('mode','value','minutes',10)))));
 rule_source:=rule_source||jsonb_build_object('fields',public.faolla_attendance_plan_rule_fields_v1(rule_source));assert public.faolla_attendance_plan_rule_source_v1(rule_source);
 source_hash:=encode(sha256(convert_to(rule_source::text,'UTF8')),'hex');
 insert into public.merchant_attendance_plan_rule_artifacts(merchant_id,source_id,worker_id,slot_id,employee_id,employee_auth_user_id,source,source_sha256,source_bytes)
 values(${quote(site)},approval,w.id,v.id,e.id,e.auth_user_id,rule_source,source_hash,octet_length(convert_to(rule_source::text,'UTF8')));
 insert into public.merchant_attendance_plan_rule_operations(merchant_id,operation_id,worker_id,slot_id,revision,actor_auth_user_id,employee_id,employee_auth_user_id,command,source_id,observed_at,recorded_at)
 values(${quote(site)},approval,w.id,v.id,1,${quote(owner)},e.id,e.auth_user_id,jsonb_build_object('operationId',approval,'expectedRevision',0,'expectedFingerprint',source_hash,'employeeId',e.id,'employeeAuthUserId',e.auth_user_id,
 'reason','Synthetic209 historical template, not actual past approval'),approval,a-interval '1 hour',a-interval '1 hour');
 insert into public.merchant_attendance_plan_rule_streams(merchant_id,slot_id,worker_id,employee_id,employee_auth_user_id,revision) values(${quote(site)},v.id,w.id,e.id,e.auth_user_id,1);
 clock_start:=a+case when seed=2 then interval '15 minutes' else interval '0 minutes' end;clock_finish:=b-case when seed=2 then interval '25 minutes' else interval '0 minutes' end;
 event_location:=case when seed=0 then ${quote(p.otherLocation)}::uuid else loc.id end;
 insert into public.merchant_attendance_events(id,merchant_id,worker_id,location_id,operation_id,sequence,action,source,break_paid,occurred_at,received_at,time_zone,actor_employee_id)
 values(ev_start,${quote(site)},w.id,event_location,op_start,seed*2+1,'clock_in','web',null,clock_start,clock_start,'UTC',e.id),
 (ev_end,${quote(site)},w.id,event_location,op_end,seed*2+2,'clock_out','web',null,clock_finish,clock_finish,'UTC',e.id);
 insert into public.merchant_attendance_shift_schedule_relations(merchant_id,start_event_id,worker_id,operation_id,sequence,location_id,occurred_at,event_time_zone,employee_id,employee_auth_user_id,worker_version,location_version,settings_version,selection,slot_id,slot_revision,schedule_revision,status,reason,slot_snapshot,publication_snapshot,cancellation_snapshot,recorded_at,binding_policy)
 values(${quote(site)},ev_start,w.id,op_start,seed*2+1,event_location,clock_start,'UTC',e.id,e.auth_user_id,w.version,loc.version,s.version,jsonb_build_object('slotId',v.id,'revision',r),v.id,r,r,
 case when seed=0 then 'unverified' else 'linked' end,case when seed=0 then 'location_changed' else null end,context->'slot',context->'publication',null,clock_start,'employee-explicit-clock-in-v1') returning * into relation;
 adoption:=public.faolla_attendance_shift_plan_adoption_v1(relation,e.auth_user_id,null,true,'self');
 assert adoption->>'status'=case when seed=0 then 'unverified' else 'adopted' end and (seed=0 or adoption->'approval'->>'operationId'=approval::text);
 insert into public.merchant_attendance_shift_plan_adoptions(merchant_id,start_event_id,worker_id,operation_id,employee_id,employee_auth_user_id,channel,slot_id,approval_operation_id,adoption,recorded_at)
 values(${quote(site)},ev_start,w.id,op_start,e.id,e.auth_user_id,'self',v.id,case when seed=0 then null else approval end,adoption,clock_start);
 end if;end loop;
 end;$ex209_history$;set constraints all immediate;set constraints all deferred;
 select jsonb_object_agg(v.id::text,public.faolla_attendance_self_schedule_slot_v1(v)->'slot') from public.merchant_attendance_schedule_slots v
 where v.merchant_id=${quote(site)} and v.id in(${[uid(201),uid(221),uid(241),uid(261)].map(quote).join(',')});`;
}
export async function verifyDelegatedPlanExceptionsNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'exceptions209_owned_synthetic_context');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {createDelegatedPlanExceptionsService}=require('../../src/lib/merchantAttendanceDelegatedPlanExceptions.server.ts');
 const {executeManagementDelegation}=require('../../src/lib/merchantAttendanceManagementDelegation.server.ts');
 const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
 const {executeRules}=require('../../src/lib/merchantAttendanceRules.server.ts');
 const {executePlanRuleApprovals}=require('../../src/lib/merchantAttendancePlanRuleApprovals.server.ts');
 const {parseScheduleResult}=require('../../src/lib/merchantAttendanceSchedule.ts');
 const {parsePlanExceptionResult}=require('../../src/lib/merchantAttendancePlanExceptions.ts');
 const {executeLeave}=require('../../src/lib/merchantAttendanceLeave.server.ts');
 const {projectPlanPosthocResult}=require('../../src/lib/merchantAttendancePlanPosthoc.server.ts');
 const p=delegatedPlanExceptionsNativeIds,siteId=delegatedPlanExceptionsNativeSite,site=quote(siteId),owner=quote(d.owner),names=d.inventory();
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),oldPeriod=periodContinuationArchiveBytes(await periodArchive());
 const all=outageNativeFingerprintSql(names),prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000}),deadline=Date.now()+120000;
 const originals=`(select jsonb_object_agg(n,rows) from(${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${n} x) rows`).join(' union all ')}) original_rows)`;
 const preserve=names.map(n=>`assert not exists(select previous.value from jsonb_array_elements(current_setting('faolla.ex209_originals')::jsonb->${quote(n)}) previous(value) except select to_jsonb(x) from public.${n} x),'ex209_old_row_changed:${n}';`).join('\n');
 const external=names.map(n=>`assert not exists(select to_jsonb(x) from public.${n} x where coalesce(to_jsonb(x)->>'merchant_id',case when ${quote(n)}='merchants' then to_jsonb(x)->>'id' end,'')<>${site}
 except select previous.value from jsonb_array_elements(current_setting('faolla.ex209_originals')::jsonb->${quote(n)}) previous(value)),'ex209_external_scope_added:${n}';`).join('\n');
 const notifications=names.filter(n=>/notification|reminder/.test(n));assert(notifications.length>0);const notificationHash=outageNativeFingerprintSql(notifications);
 const rawNames=names.filter(n=>/merchant_attendance_(?:events|states|location_results|location_clock_notices|rule_bindings)$/.test(n));assert(rawNames.includes('merchant_attendance_events'));
 const raw=outageNativeFingerprintSql(rawNames),config=['merchant_attendance_settings','merchant_attendance_config_operations','merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_employment_periods'];
 const authorityTables=['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'];
 const reviewTables=['merchant_attendance_plan_exception_cases','merchant_attendance_plan_exception_entries','merchant_attendance_plan_exception_reads',...notifications];
 const groups=[],replayOps=new Set(),records=[];let steps=0,rpcs=0,reads=0,writes=0,rejections=0,serial=300,stage='begin',lastRpc=null,pendingStep=null,primaryError=null,
 profile,version=0,defaultGrant,includeGrant,future,slots,rawBaseline,legacyConfirmed,legacyExcused,confirmedCommand,confirmedReceipt,excusedCommand,excusedReceipt,
 normalCommand,normalReceipt,notApplicableCommand,notApplicableReceipt,atomicCommand,atomicReceipt,dropReplyOperation=null;
 const next=()=>uid(++serial),equal=(a,b,label)=>assert.equal(a===b,true,label);
 const step=async(label,sql)=>{stage=label;assert(++steps<=140,'ex209_max140_SQLsteps');assert(Date.now()<deadline,'ex209_max120s');const dispatched=connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));pendingStep=dispatched;
  try{return await dispatched;}finally{if(pendingStep===dispatched)pendingStep=null;}};
 const failure=error=>new Error('delegated_plan_exceptions_native_stage:'+stage+':steps='+steps+':rpcs='+rpcs+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc),{cause:error});
 const call=async(label,expression,{write=false,replay=false,prepare='',allowed=null}={})=>{
  assert(++rpcs<=90,'ex209_max90_actual_RPCs');const outside=allowed===null?null:outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)));
  const result=JSON.parse(await step(label,`do $ex209_call$ declare before_hash text;outside_hash text;value jsonb;prepared_command jsonb;failure text;state_code text;context_text text;constraint_text text;begin
   before_hash:=${all};${outside?'outside_hash:='+outside+';':''}${prepare}begin set local role service_role;assert current_user='service_role';value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context,constraint_text=constraint_name;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=before_hash,'ex209_read_rejection_replay_wrote';end if;
   ${outside?'assert '+outside+"=outside_hash,'ex209_unrelated_table_changed';":''}${preserve}${external}
   perform set_config('faolla.ex209_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text,'constraint',constraint_text)::text,true);
  end;$ex209_call$;select current_setting('faolla.ex209_result')::jsonb;`));
  lastRpc={error:result.error??result.value?.error??null,sqlstate:result.sqlstate,constraint:result.constraint,
   context:result.context?.split('\n').filter(s=>/^(?:PL\/pgSQL|SQL) function /.test(s)).map(s=>s.slice(0,240)).slice(0,8)??[],kind:result.value?.kind??null,protocol:result.value?.protocol??null};
  if(lastRpc.error)rejections++;else if(write&&!replay)writes++;else reads++;return result;
 };
 const service={rpc:async(name,args)=>{
  const c=args.p_command,allowed=name==='faolla_attendance_admin_v1'?config:name==='faolla_attendance_management_delegations_v1'?authorityTables:
   name==='faolla_attendance_delegated_plan_exceptions_v1'?[...reviewTables,...authorityTables]:name.startsWith('faolla_attendance_plan_exception_')?reviewTables:null;
  const result=await call('actual_'+name+'_'+(c?.action??c?.outcome??c?.kind??args.p_query?.mode??'read'),delegatedPlanExceptionsNativeRpcExpression(name,args),
   {write:c!==undefined&&c!==null,replay:c!==undefined&&c!==null&&replayOps.has(c.operationId),allowed});
  if(name==='faolla_attendance_delegated_plan_exceptions_v1'&&c?.operationId===dropReplyOperation&&result.error===null){dropReplyOperation=null;throw Error('synthetic209_lost_POST_response');}
  return {data:result.value,error:result.error?{message:result.error}:null};
 }};
 const environment={FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_ENABLED:'1',FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_SITE_IDS:siteId,
  FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_ENABLED:'1',FAOLLA_ATTENDANCE_PLAN_POSTHOC_REVIEW_SITE_IDS:siteId,
  FAOLLA_ATTENDANCE_PLAN_CLEARANCE_ENABLED:'1',FAOLLA_ATTENDANCE_PLAN_CLEARANCE_SITE_IDS:siteId,
  FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_ENABLED:'1',FAOLLA_ATTENDANCE_EVENT_NOTIFICATIONS_CAPTURE_SITES:siteId};
 const node=createDelegatedPlanExceptionsService(service,{environment:()=>environment}),offNode=createDelegatedPlanExceptionsService(service,{environment:()=>({})}),
  baseNode=createDelegatedPlanExceptionsService(service,{environment:()=>({FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_ENABLED:'1',FAOLLA_ATTENDANCE_DELEGATED_PLAN_EXCEPTIONS_SITE_IDS:siteId})});
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(lastRpc));assert(!r.value?.error,JSON.stringify(lastRpc));return r.value;};
 const deny=(promise,code)=>assert.rejects(promise,e=>e?.code===code||e?.message===code);
 const group=async(index,run)=>{const beforeRpcs=rpcs,beforeSteps=steps;await run();const spec=delegatedPlanExceptionsNativeGroupBudgets[index],actual={name:spec.name,rpcs:rpcs-beforeRpcs,steps:steps-beforeSteps};
  assert(actual.rpcs<=spec.rpcs&&actual.steps<=spec.steps,'ex209_group_budget:'+JSON.stringify(actual));groups.push(actual);native.pass('209 group'+(index+1)+' '+JSON.stringify(actual));};
 const save=label=>step('save_'+label,`savepoint ${label};select ${all};`),restore=async(label,hash)=>equal(await step('restore_'+label,`rollback to savepoint ${label};release savepoint ${label};select ${all};`),hash,'ex209_savepoint_full_facts_not_restored');
 const cq=(grantId,slotId)=>({siteId,grantId,mode:'context',workerId:p.worker,slotId}),rq=(grantId,operationId)=>({siteId,grantId,mode:'recover',operationId});
 const run=(slotId,command=null,grantId=includeGrant,actor=p.delegateAuth)=>node.execute({query:cq(grantId,slotId),command,authUserId:actor,allowWrite:true});
 const recover=(command,grantId=includeGrant,actor=p.delegateAuth)=>offNode.recover({query:rq(grantId,command.operationId),expectedCommand:command,authUserId:actor});
 const raw209=(slotId,command=null,patch={})=>delegatedPlanExceptionsNativeRpcExpression('faolla_attendance_delegated_plan_exceptions_v1',{
  p_query:cq(includeGrant,slotId),p_auth_user_id:p.delegateAuth,p_command:command,p_allow_write:true,p_allow_posthoc:true,p_allow_clearance:true,p_capture_notifications:true,...patch});
 const foundation=command=>executeManagementDelegation({query:{siteId,mode:'write'},command,authUserId:d.owner,allowGrant:true},service);
 const scopeValue=(includePending=false,patch={})=>({kind:'formal_exception',workerId:p.worker,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,locationIds:[p.location],includePending,...patch});
 const grantCommand=(includePending=false,patch={})=>({action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,
  delegatedAction:'plan_exception_decide',scope:scopeValue(includePending),validFrom:profile.from,validUntil:profile.until,reason:'Synthetic209 explicit one-worker formal exception authority',...patch});
 const grant=async(includePending=false)=>{const c=grantCommand(includePending),r=await foundation(c);assert.equal(r.receipt.grantId,c.operationId);return c.operationId;};
 const admin=async(kind,values)=>{const r=await executeAttendanceAdmin({siteId,view:'settings',cursor:null,search:'',operationId:null,command:{kind,values,operationId:next(),expectedVersion:version},authUserId:d.owner},service);version=r.version;return r;};
 const oldReview=async(slotId,command=null,mode=command?'decide':'detail')=>{
  const args=delegatedPlanExceptionsNativeLegacyReviewArgs(siteId,d.owner,p.worker,slotId,command,mode);
  const raw=await service.rpc('faolla_attendance_plan_exception_posthoc_review_v1',args);assert.equal(raw.error,null,JSON.stringify(lastRpc));
  //Recover is read-only: only its query carries the original number. Keep the
  //complete expected command for the strict DTO receipt comparison, not RPC.
  return parsePlanExceptionResult(raw.data,args.p_query,{authUserId:d.owner},command);};
 const keep=async(slotId,outcome)=>{const current=await run(slotId),command=delegatedPlanExceptionsNativeDecision(current,outcome,next()),receipt=(await run(slotId,command)).receipt;
  assert(receipt);assert.equal(receipt.actorId,p.delegateAuth);assert.equal(receipt.reference.decisionRevision,command.expectedRevision+1);records.push({command,receipt,slotId});return {command,receipt};};
 const status=value=>ok('actual209_delegate_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,
  prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(p.delegate)},'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(p.delegate)}),
   'actor_type','owner','actor_id',${owner},'status',${quote(value)},'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $ex209_begin$ begin assert current_user='postgres';assert not exists(select 1 from public.merchants where id=${site});
   assert to_regprocedure('public.synthetic209_owned_late_exception_fault_v1()') is null;perform set_config('faolla.ex209_originals',${originals}::text,true);end;$ex209_begin$;select 1;`);
  await group(0,async()=>{
   profile=JSON.parse(await step('six_explicit_synthetic_identity_role_rows',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic209 formal exception','synthetic209@example.test');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
    (${quote(p.role)},${site},'Synthetic209 formal reviewer',array['enterprise.view','attendance.plan_exception.review']),
    (${quote(p.selfRole)},${site},'Synthetic209 ordinary employee',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request','attendance.self.leave']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
    ${[['delegate','delegateAuth','role'],['employee','employeeAuth','selfRole'],['other','otherAuth','selfRole']].map(([e,a,r],i)=>`(${quote(p[e])},${site},${quote(p[a])},'synthetic209-${i}@example.test','Synthetic209 member ${i}',${quote(p[r])},'active',clock_timestamp(),1)`).join(',')};
    select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'day',((clock_timestamp() at time zone 'UTC')::date+8)::text);`));
   await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
   for(const locationId of[p.location,p.otherLocation])await admin('location',{id:locationId,name:'Synthetic209 location',timeZone:'UTC',active:true});
   await admin('worker',{id:p.worker,employeeId:p.employee,workerNo:'SYNTHETIC209',displayName:'Synthetic209 current employee',locationId:p.location,active:true,startsOn:'2000-01-01'});
   const rulesQuery={siteId,groupId:null,operationId:null,beforeRevision:null},rules={lateGraceMinutes:{mode:'value',minutes:0},earlyGraceMinutes:{mode:'value',minutes:10},openSpanWarningMinutes:{mode:'inherit'},completedBreakMinimumMinutes:{mode:'inherit'}};
   await executeRules({query:rulesQuery,command:{operationId:next(),action:'save_draft',expectedRevision:0,reason:'Synthetic209 real future rule draft',expectedSettingsVersion:version,expectedGroupRevision:null,timeZone:'UTC',rules},authUserId:d.owner,allowWrite:true},service);
   await executeRules({query:rulesQuery,command:{operationId:next(),action:'publish',expectedRevision:1,reason:'Synthetic209 real future rule publication',expectedSettingsVersion:version,expectedGroupRevision:null,timeZone:'UTC',effectiveOn:profile.day},authUserId:d.owner,allowWrite:true},service);
   defaultGrant=await grant(false);
   const q={siteId,access:'owner',workerId:p.worker,fromDate:profile.day,throughDate:profile.day,operationId:null},c={operationId:next(),expectedRevision:0,expectedSettingsVersion:version,reason:'Synthetic209 actual099 future136 publication',action:'publish',locationId:p.location,timeZone:'UTC',slots:[[profile.day+'T08:00:00.000Z',profile.day+'T10:00:00.000Z']]};
   const raw=await ok('actual099_136_publish',delegatedPlanExceptionsNativeRpcExpression('faolla_attendance_schedule_evidenced_v1',{p_query:q,p_auth_user_id:d.owner,p_command:c,p_allow_write:true}),{write:true});
   const schedule=parseScheduleResult(raw,{...q,operationId:c.operationId},false);assert.deepEqual(schedule.receipt.command,c);future=schedule.entries[0];assert(future);
   const aq={siteId,workerId:p.worker,slotId:future.id,mode:'preview',operationId:null},preview=await executePlanRuleApprovals({query:aq,authUserId:d.owner,moduleEnabled:true},service);assert(preview.preview.eligible);
   const ac={operationId:next(),expectedRevision:preview.revision,expectedFingerprint:preview.preview.fingerprint,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,reason:'Synthetic209 actual146 future rule approval'};
   const approved=await executePlanRuleApprovals({query:{...aq,mode:'approve',operationId:ac.operationId},command:ac,authUserId:d.owner,moduleEnabled:true},service);assert.equal(approved.approval.operationId,ac.operationId);
   const context=await run(future.id,null,defaultGrant);assert(context.context.canDecide);assert(!context.context.canConclude);
   const fc=delegatedPlanExceptionsNativeDecision(context,'follow_up',next()),fr=(await run(future.id,fc,defaultGrant)).receipt;
   records.push({command:fc,receipt:fr,slotId:future.id,grantId:defaultGrant});
  });
  await group(1,async()=>{
   slots=JSON.parse(await step('33_disclosed_historical_inputs_no_case_or_decision',delegatedPlanExceptionsNativeHistorySql(siteId,d.owner,p)));
   for(const [slotId,outcome]of[[uid(241),'confirmed'],[uid(241),'excused'],[uid(221),'follow_up'],[uid(261),'follow_up']]){
    const current=await oldReview(slotId),command=delegatedPlanExceptionsNativeDecision(current,outcome,next()),result=await oldReview(slotId,command);
    assert.equal(result.receipt.item.outcome,outcome);assert.equal(result.receipt.item.actorId,d.owner);
    if(outcome==='confirmed')legacyConfirmed=command;if(outcome==='excused')legacyExcused=command;
   }
   const recovered=await oldReview(uid(241),legacyConfirmed,'recover');assert.equal(recovered.receipt.operationId,legacyConfirmed.operationId);
   rawBaseline=await step('historical_raw_input_baseline_NULL_owner_no_sidecar',`do $ex209_legacy$ begin assert not exists(select 1 from public.merchant_attendance_management_delegation_operations where merchant_id=${site} and operation_id in(${quote(legacyConfirmed.operationId)},${quote(legacyExcused.operationId)}));${preserve}${external}end;$ex209_legacy$;select ${raw};`);
  });
  await group(2,async()=>{
   await deny(run(uid(241),null,defaultGrant),'attendance_management_delegation_scope_invalid');includeGrant=await grant(true);
   const context=await run(uid(241));assert(context.context.canConclude);confirmedCommand=delegatedPlanExceptionsNativeDecision(context,'confirmed',next());dropReplyOperation=confirmedCommand.operationId;
   await deny(run(uid(241),confirmedCommand),'attendance_delegated_plan_exceptions_invalid');assert.equal(dropReplyOperation,null);
   confirmedReceipt=(await recover(confirmedCommand)).receipt;records.push({command:confirmedCommand,receipt:confirmedReceipt,slotId:uid(241)});
   assert.equal(confirmedReceipt.reference.decisionRevision,3);
   const saved=await keep(uid(241),'excused');excusedCommand=saved.command;excusedReceipt=saved.receipt;
  });
  await group(3,async()=>{
   await deny(run(uid(241),null,includeGrant,p.otherAuth),'attendance_access_denied');
   assert.equal((await call('actual209_wrong_target_worker',raw209(uid(241),null,{p_query:{...cq(includeGrant,uid(241)),workerId:uid(999)}}))).error,'attendance_management_delegation_scope_invalid');
   assert.equal((await call('actual209_wrong_merchant_grant',raw209(uid(241),null,{p_query:{...cq(includeGrant,uid(241)),siteId:d.site}}))).error,'attendance_access_denied');
   assert.equal((await call('actual209_missing_real_slot',raw209(uid(998)))).error,'attendance_management_delegation_scope_invalid');
   await deny(foundation(grantCommand(true,{delegateEmployeeId:p.employee,delegateAuthUserId:p.employeeAuth})),'attendance_invalid_request');
   await deny(foundation(grantCommand(true,{scope:scopeValue(true,{employeeAuthUserId:p.otherAuth})})),'attendance_management_delegation_scope_invalid');
   await deny(foundation(grantCommand(true,{scope:scopeValue(true,{locationIds:[p.otherLocation]})})),'attendance_management_delegation_scope_invalid');
   await deny(run(uid(201)),'attendance_management_delegation_scope_invalid'); //main slot is in scope, actual session is not
   const branch=await save('ex209_target_bind');
   await step('synthetic_new_target_auth_rebinding_only',`update public.merchant_enterprise_employees set auth_user_id=${quote(p.replacementAuth)} where merchant_id=${site} and id=${quote(p.employee)};select 1;`);
   await deny(run(uid(241)),'attendance_access_denied');await restore('ex209_target_bind',branch);
  });
  await group(4,async()=>{
   const current=await run(uid(241)),pending=delegatedPlanExceptionsNativeDecision(current,'confirmed',next());
   for(const [patch,code]of[[{expectedRevision:pending.expectedRevision+1},'attendance_version_conflict'],[{expectedFingerprint:'0'.repeat(64)},'attendance_plan_exception_review_source_changed'],
    [{employeeAuthUserId:p.otherAuth},'attendance_plan_exception_review_identity_changed']])assert.equal((await call('actual209_old_guard_'+Object.keys(patch)[0],raw209(uid(241),{...pending,operationId:next(),...patch}),{write:true,allowed:[...reviewTables,...authorityTables]})).error,code);
   await deny(offNode.execute({query:cq(includeGrant,uid(241)),command:pending,authUserId:p.delegateAuth,allowWrite:true}),'attendance_delegated_plan_exceptions_disabled');
   assert.equal((await call('actual209_SQL_write_flagoff',raw209(uid(241),null,{p_allow_write:false}))).error,'attendance_delegated_plan_exceptions_disabled');
   assert.equal((await call('actual209_no_adopt_owner_decision',raw209(uid(241),{...pending,operationId:legacyExcused.operationId}),{write:true,allowed:[...reviewTables,...authorityTables]})).error,'attendance_operation_conflict');
   const nc=await run(uid(221));assert(nc.context.canClear);normalCommand=delegatedPlanExceptionsNativeDecision(nc,'cleared',next());
   const clearMasked=await baseNode.execute({query:cq(includeGrant,uid(221)),command:null,authUserId:p.delegateAuth,allowWrite:true});assert.equal(clearMasked.context.canClear,false);
   assert.equal((await call('actual209_independent_clearance_flagoff',raw209(uid(221),normalCommand,{p_allow_clearance:false}),{write:true,allowed:[...reviewTables,...authorityTables]})).error,'attendance_plan_exception_clearance_disabled');
   normalReceipt=(await run(uid(221),normalCommand)).receipt;records.push({command:normalCommand,receipt:normalReceipt,slotId:uid(221)});
   const lq=(access,requestId=null)=>({siteId,access,requestId,operationId:null,beforeAt:null,beforeId:null}),leave=(access,command=null,requestId=null)=>executeLeave({query:lq(access,requestId),command,authUserId:access==='owner'?d.owner:p.employeeAuth,allowWrite:true},service);
   const settings=await leave('self'),requestId=next(),leaveSlot=slots[uid(261)];
   await leave('self',{operationId:requestId,action:'submit',reason:'Synthetic209 full leave',expectedWorkerId:p.worker,expectedSettingsVersion:settings.settingsVersion,timeZone:'UTC',startAt:leaveSlot.startAt,endAt:leaveSlot.endAt});
   await leave('owner',{operationId:next(),action:'approve',requestId,expectedRevision:1,reason:'Synthetic209 actual122 full leave approval'},requestId);
   const aq={siteId,workerId:p.worker,slotId:uid(261),mode:'detail',operationId:null};
   const adopt=async c=>{const args={p_query:aq,p_auth_user_id:d.owner,p_command:c,p_allow_write:true},raw=await service.rpc('faolla_attendance_plan_posthoc_adoption_v1',args);assert.equal(raw.error,null,JSON.stringify(lastRpc));return projectPlanPosthocResult(raw.data,aq,d.owner,c);};
   const available=await adopt(null);assert(available.preview.eligible);await adopt({action:'apply',operationId:next(),expectedRevision:available.revision,expectedFingerprint:available.preview.fingerprint,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,reason:'Synthetic209 actual171 leave-aware source without work',sources:[]});
   const full=await run(uid(261));assert(full.context.canNotApplicable);notApplicableCommand=delegatedPlanExceptionsNativeDecision(full,'not_applicable',next());
   const posthocMasked=await baseNode.execute({query:cq(includeGrant,uid(261)),command:null,authUserId:p.delegateAuth,allowWrite:true});assert.equal(posthocMasked.context.canNotApplicable,false);
   assert.equal((await call('actual209_independent_posthoc_flagoff',raw209(uid(261),notApplicableCommand,{p_allow_posthoc:false}),{write:true,allowed:[...reviewTables,...authorityTables]})).error,'attendance_plan_exception_posthoc_disabled');
   notApplicableReceipt=(await run(uid(261),notApplicableCommand)).receipt;records.push({command:notApplicableCommand,receipt:notApplicableReceipt,slotId:uid(261)});
   atomicCommand=delegatedPlanExceptionsNativeDecision(await run(uid(241)),'confirmed',next());
  });
  await group(5,async()=>{
   const revoke=await save('ex209_revoke');await foundation({action:'revoke',operationId:next(),grantId:includeGrant,expectedRevision:1,reason:'Synthetic209 actual revoke'});
   await deny(run(uid(241)),'attendance_access_denied');assert.deepEqual((await recover(confirmedCommand)).receipt,confirmedReceipt);await restore('ex209_revoke',revoke);
   const epoch=await save('ex209_epoch');await status('disabled');await deny(run(uid(241)),'attendance_access_denied');assert.deepEqual((await recover(excusedCommand)).receipt,excusedReceipt);
   await step('actual209_delegate_epoch_captured',`do $ex209_epoch$ begin assert exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(p.delegate)} and generation=1 and paused);end;$ex209_epoch$;select 1;`);await restore('ex209_epoch',epoch);
   const rebind=await save('ex209_delegate_bind');await step('synthetic_original_delegate_auth_binding_changed',`update public.merchant_enterprise_employees set auth_user_id=${quote(p.replacementAuth)} where merchant_id=${site} and id=${quote(p.delegate)};select 1;`);
   await deny(recover(confirmedCommand),'attendance_access_denied');await deny(recover(confirmedCommand,includeGrant,p.otherAuth),'attendance_access_denied');
   assert.equal((await call('actual209_rebound_original_complete_POST_refused',raw209(uid(241),confirmedCommand,{p_allow_write:false,p_allow_posthoc:false,p_allow_clearance:false,p_capture_notifications:false}),{write:true,replay:true,allowed:[...reviewTables,...authorityTables]})).error,'attendance_access_denied');
   await restore('ex209_delegate_bind',rebind);
   const receipt=(await recover(normalCommand)).receipt;assert.deepEqual(receipt,normalReceipt);assert.deepEqual(Object.keys(receipt).sort(),['operationId','actorId','grantId','action','reference','commandFingerprint','businessFingerprint','recordedAt'].sort());
  });
  await group(6,async()=>{
   const beforeCatalog=await step('owned_fault_catalog_before','select '+managementAuditNativeCatalogSql(d.owned.oid)+';'),branch=await save('ex209_fault');
   await step('unique209_owned_AFTER23514',delegatedPlanExceptionsNativeFaultSql(atomicCommand.operationId));const notificationsBefore=await step('all_notification_tables_before_fault','select '+notificationHash+';');
   await deny(run(uid(241),atomicCommand),'attendance_delegated_plan_exceptions_invalid');assert.equal(lastRpc.error,'synthetic209_late_sidecar_failure');assert.equal(lastRpc.sqlstate,'23514');assert.equal(lastRpc.constraint,'synthetic209_owned_late_exception_fault');
   assert.equal((await recover(atomicCommand)).receipt,null);
   await step('failed209_case_entry_sidecar_notification_complete_rollback',`do $ex209_atomic$ begin assert not exists(select 1 from public.merchant_attendance_plan_exception_entries where merchant_id=${site} and operation_id=${quote(atomicCommand.operationId)});
    assert not exists(select 1 from public.merchant_attendance_plan_exception_cases where merchant_id=${site} and case_id=${quote(atomicCommand.operationId)});
    assert not exists(select 1 from public.merchant_attendance_management_delegation_operations where merchant_id=${site} and operation_id=${quote(atomicCommand.operationId)});
    assert ${notificationHash}=${quote(notificationsBefore)};end;$ex209_atomic$;select 1;`);await restore('ex209_fault',branch);
   await step('owned209_fault_catalog_exact_restored',`do $ex209_catalog$ begin assert to_regprocedure('public.synthetic209_owned_late_exception_fault_v1()') is null;assert ${managementAuditNativeCatalogSql(d.owned.oid)}=${quote(beforeCatalog)};end;$ex209_catalog$;select 1;`);
   atomicReceipt=(await run(uid(241),atomicCommand)).receipt;records.push({command:atomicCommand,receipt:atomicReceipt,slotId:uid(241)});
  });
  await group(7,async()=>{
   await admin('settings',{timeZone:'UTC',enabled:false,webClockEnabled:true,webBreakPaid:false});await deny(run(uid(241)),'attendance_access_denied');
   assert.deepEqual((await recover(confirmedCommand)).receipt,confirmedReceipt);assert.deepEqual((await recover(atomicCommand)).receipt,atomicReceipt);
   replayOps.add(notApplicableCommand.operationId);try{assert.deepEqual((await offNode.execute({query:cq(includeGrant,uid(261)),command:notApplicableCommand,authUserId:p.delegateAuth,allowWrite:false})).receipt,notApplicableReceipt);}finally{replayOps.delete(notApplicableCommand.operationId);}
   await step('actual209_three_ledgers_real_actor_immutable_source_proof',`do $ex209_final$ declare authority public.merchant_attendance_management_delegation_operations%rowtype;denied boolean;begin
    assert (select count(*) from public.merchant_attendance_management_delegation_operations where merchant_id=${site})=${records.length};
    assert (select count(*) from public.merchant_attendance_plan_exception_entries where merchant_id=${site} and actor_auth_user_id=${quote(p.delegateAuth)})=${records.length};
    assert (select count(*) from public.merchant_attendance_event_notifications where merchant_id=${site} and operation_id in(${records.map(r=>quote(r.command.operationId)).join(',')}))=${records.length};
    for authority in select * from public.merchant_attendance_management_delegation_operations where merchant_id=${site} loop assert authority.actor_auth_user_id=${quote(p.delegateAuth)} and authority.delegate_employee_id=${quote(p.delegate)} and authority.delegate_generation=0;
    perform public.faolla_attendance_delegated_plan_exceptions_operation_v1(authority,false);end loop;
    assert not exists(select 1 from public.merchant_attendance_management_delegation_operations where merchant_id=${site} and operation_id in(${quote(legacyConfirmed.operationId)},${quote(legacyExcused.operationId)}));
    denied:=false;begin update public.merchant_attendance_plan_exception_entries set revision=revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    denied:=false;begin update public.merchant_attendance_management_delegation_operations set business_revision=business_revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    assert ${raw}=${quote(rawBaseline)},'ex209_raw_inputs_changed';${preserve}${external}end;$ex209_final$;select 1;`);
  });
  assert.equal(groups.length,8);assert(rpcs<=90&&steps<140);await step('rollback','rollback;');
  return {phase:209,groups,steps,rpcs,reads,writes,rejections,newSite:siteId,identitySeedRows:6,syntheticHistoricalInputRows:33,connections:1,races:0,
   actualFuture099_136Publication:true,actualFuture146Approval:true,actualLegacy170_174NullOwner:true,actual202Grants:true,actual209NodeAndRpc:true,
   actualConfirmedExcusedFollowUpClearedNotApplicable:true,actual122LeaveAnd171Adoption:true,actualScopeAndPublishedAtBoundary:true,
   actualRevokeAndEpochPause:true,originalAuthRebindRejected:true,minimalReceiptRecovery:true,lostReplyRecovery:true,late23514AtomicFailure:true,
   allNotificationTablesProtected:true,oldFactsDefinitionsCatalogArchivesUnchanged:true,rollbackRestored:true,realAuth:false,browser:false,kdf:false,production:false,
   actualPastPublication:false,actualPastApproval:false,actualHistoricalClockRequests:false,newSealBusinessCases:0,
   missingCoverage:['33 disclosed guarded append-only history inputs are not real past publication/approval/clock requests. No new seal, wall-time expiry, notification delivery, real Auth or lock race is claimed; existing150 seal guards remain exact dependencies.']};
 }catch(error){primaryError=failure(error);throw primaryError;}
 finally{try{await delegatedRevisionsNativeCleanup(connection,pendingStep,[['facts',()=>equal(d.fingerprint(),baseline,'ex209_full_rollback_facts')],
  ['definitions',()=>equal(d.definitions(),definitions,'ex209_full_rollback_function_OID_ACL')],['catalog',()=>equal(d.tableCatalog(),catalog,'ex209_full_rollback_catalog')],
  ['archive155',async()=>assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155)],['archive207',async()=>assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),oldPeriod)],
 ],primaryError);}catch(error){throw failure(error);}}
}
