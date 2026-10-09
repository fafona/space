//208 INERT: eight finite real-Node/real-RPC groups, one owned connection and
//one outer ROLLBACK. Only six disclosed synthetic merchant/identity/role rows
//are seeded directly. No fabricated event, request, effect, decision or grant.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {managementAuditNativeCatalogSql} from './attendance-management-audit-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(208600000+n);
export const delegatedRevisionsNativeSite='99990208';
export const delegatedRevisionsNativeIds=Object.freeze({role:uid(1),selfRole:uid(2),delegate:uid(3),delegateAuth:uid(4),
 employee:uid(5),employeeAuth:uid(6),other:uid(7),otherAuth:uid(8),worker:uid(9),location:uid(10),otherLocation:uid(11)});
export const delegatedRevisionsNativeGroupBudgets=Object.freeze([
 ['real_current_clock_correction_and_first_owner_approval',15,20],['legacy_NULL_owner_continuous_approve_reject',10,14],
 ['actual202_two_actions_actual208_Node_and_lost_reply',16,21],['scope_identity_self_and_includePending_boundaries',12,17],
 ['old_CAS_evidence_base_action_flags_and_no_legacy_adoption',9,12],['real_grant_revoke_epoch_pause_original_actor_recovery',13,18],
 ['owned_AFTER23514_all_ledgers_notifications_rollback_same_number_retry',9,15],['paused_flagoff_original_receipts_appendonly_full_rollback',5,13],
].map(([name,rpcs,steps])=>Object.freeze({name,rpcs,steps})));
const rpcNames=Object.freeze({
 faolla_attendance_delegated_revisions_v1:['p_query','p_auth_user_id','p_command','p_allow_write'],
 faolla_attendance_management_delegations_v1:['p_query','p_auth_user_id','p_command','p_allow_grant'],
 faolla_attendance_admin_v1:['p_site_id','p_auth_user_id','p_query','p_command','p_operation_id'],
 faolla_attendance_self_v1:['p_site_id','p_auth_user_id','p_command','p_operation_id'],
 faolla_attendance_self_bound_v1:['p_site_id','p_auth_user_id','p_command','p_operation_id'],
 faolla_attendance_correction_controls_v2:['p_site_id','p_auth_user_id','p_command','p_operation_id','p_before_revision','p_allow_write'],
 faolla_attendance_correction_self_v3:['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled'],
 faolla_attendance_correction_decide_v2:['p_site_id','p_auth_user_id','p_request_id','p_command','p_operation_id','p_allow_write'],
 faolla_attendance_revision_self_v2:['p_site_id','p_auth_user_id','p_query','p_command','p_platform_enabled'],
 faolla_attendance_revision_owner_review_v3:['p_site_id','p_auth_user_id','p_request_id'],
 faolla_attendance_revision_decide_v2:['p_site_id','p_auth_user_id','p_request_id','p_command','p_operation_id','p_allow_write'],
});
export function delegatedRevisionsNativeRpcExpression(name,args){
 const fields=rpcNames[name];assert(fields,'revisions208_public_RPC_allowlist');assert.deepEqual(Object.keys(args).sort(),[...fields].sort());
 assert.match(args.p_query?.siteId??args.p_site_id,/^9999[0-9]{4}$/);assert.match(args.p_auth_user_id,/^[0-9a-f-]{36}$/);
 for(const key of fields)if(key.startsWith('p_allow_')||key==='p_platform_enabled')assert.equal(typeof args[key],'boolean');
 const value=v=>v===null?'null':typeof v==='boolean'?String(v):typeof v==='string'?quote(v):json(v);
 return `public.${name}(${fields.map(field=>field+'=>'+value(args[field])).join(',')})`;
}
export function delegatedRevisionsNativeDecision(result,action,operationId){
 assert(['approve','reject'].includes(action));const review=result.kind==='context'?result.context.review:result;
 const p=require('../../src/lib/merchantAttendanceDelegatedRevisions.ts');
 const command=p.parseDelegatedRevisionsCommand({action,operationId,requestId:review.requestId,expectedRevision:review.review.submittedRevision,
  expectedEvidence:review.evidenceToken,expectedBaseOperationId:review.current.operationId,reason:'Synthetic208 explicit continuous revision '+action});
 if(result.kind==='context')p.delegatedRevisionsCommandForContext(result,command);return command;
}
export function delegatedRevisionsNativeSubmit(prepared,operationId,proposal){
 return require('../../src/lib/merchantAttendanceRevisionCycle.ts').parseRevisionCycleCommand({action:'submit',operationId,expectedRevision:prepared.revision,
  expectedBaseOperationId:prepared.current.lineage.rootOperationId,expectedEffectiveOperationId:prepared.current.operationId,
  expectedPolicyRevision:prepared.currentRules.policy.revision,reason:'Synthetic208 real employee continuous revision',proposal});
}
export function delegatedRevisionsNativeFaultSql(operationId,site=delegatedRevisionsNativeSite){
 assert.match(operationId,/^[0-9a-f-]{36}$/);assert.equal(site,delegatedRevisionsNativeSite);
 return `create function public.synthetic208_owned_late_revision_fault_v1() returns trigger language plpgsql set search_path=pg_catalog as $owned208_fault$
 begin if new.merchant_id=${quote(site)} and new.operation_id=${quote(operationId)} then raise exception using errcode='23514',message='synthetic208_late_sidecar_failure',constraint='synthetic208_owned_late_revision_fault';end if;return new;end;$owned208_fault$;
 create trigger synthetic208_owned_late_revision_fault after insert on public.merchant_attendance_management_delegation_operations
 for each row execute function public.synthetic208_owned_late_revision_fault_v1();select 1;`;
}
//Closing this owned session rolls back any unfinished transaction. Never send
//another SQL command while a timed-out Node request may still have one pending.
export async function delegatedRevisionsNativeCleanup(connection,pending,protections,primary=null){
 const failures=[],settled=pending?pending.then(()=>null,error=>error):null;
 try{await connection.close();}catch(error){failures.push({label:'close',error});}
 if(settled){const error=await settled;if(error)failures.push({label:'pending',error});}
 for(const [label,check]of protections){try{await check();}catch(error){failures.push({label,error});}}
 if(failures.length){
  const detail=failures.map(({label,error})=>label+':'+String(error?.message??error).slice(0,1000)).join('|');
  if(primary){const note='\ndelegated_revisions_native_cleanup_secondary:'+detail;primary.message+=note;primary.stack=(primary.stack??primary.message)+note;}
  else throw new AggregateError(failures.map(item=>item.error),'delegated_revisions_native_cleanup_failed:'+detail);
 }
}
export async function verifyDelegatedRevisionsNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'revisions208_owned_synthetic_context');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {createDelegatedRevisionsService}=require('../../src/lib/merchantAttendanceDelegatedRevisions.server.ts');
 const {executeManagementDelegation}=require('../../src/lib/merchantAttendanceManagementDelegation.server.ts');
 const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
 const {executeAttendanceSelf}=require('../../src/lib/merchantAttendanceSelf.server.ts');
 const {executeCorrectionControls}=require('../../src/lib/merchantAttendanceCorrectionControls.server.ts');
 const {executeAttendanceCorrection}=require('../../src/lib/merchantAttendanceCorrection.server.ts');
 const {parseCorrectionProposal}=require('../../src/lib/merchantAttendanceCorrection.ts');
 const {executeCurrentCorrectionDecision}=require('../../src/lib/merchantAttendanceCurrentCorrectionDecision.server.ts');
 const {executeRevisionCycle}=require('../../src/lib/merchantAttendanceRevisionCycle.server.ts');
 const {executeRevisionApprovalReview,executeRevisionDecision}=require('../../src/lib/merchantAttendanceRevisionDecision.server.ts');
 const p=delegatedRevisionsNativeIds,siteId=delegatedRevisionsNativeSite,site=quote(siteId),owner=quote(d.owner),names=d.inventory();
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),oldPeriod=periodContinuationArchiveBytes(await periodArchive());
 const all=outageNativeFingerprintSql(names),prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000}),deadline=Date.now()+120000;
 const originals=`(select jsonb_object_agg(n,rows) from(${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${n} x) rows`).join(' union all ')}) original_rows)`;
 const preserve=names.map(n=>`assert not exists(select previous.value from jsonb_array_elements(current_setting('faolla.rv208_originals')::jsonb->${quote(n)}) previous(value) except select to_jsonb(x) from public.${n} x),'rv208_old_row_changed:${n}';`).join('\n');
 const external=names.map(n=>`assert not exists(select to_jsonb(x) from public.${n} x where coalesce(to_jsonb(x)->>'merchant_id',case when ${quote(n)}='merchants' then to_jsonb(x)->>'id' end,'')<>${site}
 except select previous.value from jsonb_array_elements(current_setting('faolla.rv208_originals')::jsonb->${quote(n)}) previous(value)),'rv208_external_scope_added:${n}';`).join('\n');
 const notifications=names.filter(n=>/notification|reminder/.test(n));assert(notifications.length>0,'revisions208_notification_tables_required');
 const rawNames=names.filter(n=>/merchant_attendance_(?:events|states|location_results|location_clock_notices|rule_bindings)$/.test(n));assert(rawNames.includes('merchant_attendance_events'));
 const raw=outageNativeFingerprintSql(rawNames),notificationHash=outageNativeFingerprintSql(notifications);
 const config=['merchant_attendance_settings','merchant_attendance_config_operations','merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_employment_periods'];
 const reviewTables=names.filter(n=>/merchant_attendance_(?:correction_|revision_|effect_versions|review_responsibility_|reminder_)/.test(n));
 const authorityTables=['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'];
 const groups=[],replayOps=new Set();let steps=0,rpcs=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,pendingStep=null,primaryError=null,profile,version=0,policyRevision=0,
  startEvent,lastEvent,rootRequest,rawBaseline,initialProposal,proposalSerial=1,legacyApproved,legacyRejected,approveGrant,rejectGrant,approvedCommand,approvedReceipt,rejectedCommand,rejectedReceipt,
  pending,lateGrant,pendingGrant,pendingCommand,atomicReceipt,dropReplyOperation=null;
 const next=()=>uid(++serial),stamp6=t=>new Date(t).toISOString().replace('Z','000Z');
 const equal=(actual,expected,label)=>assert.equal(actual===expected,true,label);
 const step=async(label,sql)=>{stage=label;assert(++steps<=140,'rv208_max140_SQLsteps');assert(Date.now()<deadline,'rv208_max120s');const dispatched=connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));pendingStep=dispatched;
  try{return await dispatched;}finally{if(pendingStep===dispatched)pendingStep=null;}};
 const failure=error=>new Error('delegated_revisions_native_stage:'+stage+':steps='+steps+':rpcs='+rpcs+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc),{cause:error});
 const call=async(label,expression,{write=false,replay=false,prepare='',allowed=null}={})=>{
  assert(++rpcs<=90,'rv208_max90_actual_RPCs');const outside=allowed===null?null:outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)));
  const result=JSON.parse(await step(label,`do $rv208_call$ declare before_hash text;outside_hash text;value jsonb;prepared_command jsonb;failure text;state_code text;context_text text;constraint_text text;begin
   before_hash:=${all};${outside?'outside_hash:='+outside+';':''}${prepare}begin set local role service_role;assert current_user='service_role';value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context,constraint_text=constraint_name;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=before_hash,'rv208_read_rejection_replay_wrote';end if;
   ${outside?'assert '+outside+"=outside_hash,'rv208_unrelated_table_changed';":''}${preserve}${external}
   perform set_config('faolla.rv208_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text,'constraint',constraint_text)::text,true);
  end;$rv208_call$;select current_setting('faolla.rv208_result')::jsonb;`));
  //Diagnostics select only error codes/function frames, never a full review,
  //command, artifact, private SQL statement or an assertion's giant actual JSON.
  lastRpc={error:result.error??result.value?.error??null,sqlstate:result.sqlstate,constraint:result.constraint,
   context:result.context?.split('\n').filter(s=>/^(?:PL\/pgSQL|SQL) function /.test(s)).map(s=>s.slice(0,240)).slice(0,8)??[],kind:result.value?.kind??null,protocol:result.value?.protocol??null};
  if(lastRpc.error)rejections++;else if(write&&!replay)writes++;else reads++;return result;
 };
 const service={rpc:async(name,args)=>{
  const c=args.p_command,allowed=name==='faolla_attendance_admin_v1'?config:name==='faolla_attendance_management_delegations_v1'?authorityTables:
   name==='faolla_attendance_delegated_revisions_v1'?[...reviewTables,...authorityTables]:name.startsWith('faolla_attendance_self_')?null:reviewTables;
  const result=await call('actual_'+name+'_'+(c?.action??c?.kind??args.p_query?.mode??args.p_query?.view??'read'),delegatedRevisionsNativeRpcExpression(name,args),
   {write:c!==undefined&&c!==null,replay:c!==undefined&&c!==null&&replayOps.has(c.operationId),allowed});
  if(name==='faolla_attendance_delegated_revisions_v1'&&c?.operationId===dropReplyOperation&&result.error===null){dropReplyOperation=null;throw Error('synthetic208_lost_POST_response');}
  return {data:result.value,error:result.error?{message:result.error}:null};
 }};
 const node=createDelegatedRevisionsService(service,{environment:()=>({FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_ENABLED:'1',FAOLLA_ATTENDANCE_DELEGATED_REVISIONS_SITE_IDS:siteId})}),
  offNode=createDelegatedRevisionsService(service,{environment:()=>({})});
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(lastRpc));assert(!r.value?.error,JSON.stringify(lastRpc));return r.value;};
 const deny=(promise,code)=>assert.rejects(promise,e=>e?.code===code||e?.message===code);
 const group=async(index,run)=>{const beforeRpcs=rpcs,beforeSteps=steps;await run();const spec=delegatedRevisionsNativeGroupBudgets[index],actual={name:spec.name,rpcs:rpcs-beforeRpcs,steps:steps-beforeSteps};
  assert(actual.rpcs<=spec.rpcs&&actual.steps<=spec.steps,'rv208_group_budget:'+JSON.stringify(actual));groups.push(actual);native.pass('208 group'+(index+1)+' '+JSON.stringify(actual));};
 const save=async label=>{assert(/^[a-z0-9_]+$/.test(label));return step('save_'+label,`savepoint ${label};select ${all};`);};
 const restore=async(label,hash)=>equal(await step('restore_'+label,`rollback to savepoint ${label};release savepoint ${label};select ${all};`),hash,'rv208_savepoint_full_facts_not_restored');
 const cq=(grantId,requestId)=>({siteId,grantId,mode:'context',requestId}),rq=(grantId,operationId)=>({siteId,grantId,mode:'recover',operationId});
 const run=(grantId,requestId,command=null,actor=p.delegateAuth)=>node.execute({query:cq(grantId,requestId),command,authUserId:actor,allowWrite:true});
 const recover=(grantId,command,actor=p.delegateAuth)=>offNode.recover({query:rq(grantId,command.operationId),expectedCommand:command,authUserId:actor});
 const foundation=command=>executeManagementDelegation({query:{siteId,mode:'write'},command,authUserId:d.owner,allowGrant:true},service);
 const scopeValue=(includePending=false,patch={})=>({kind:'revision',workerId:p.worker,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,locationIds:[p.location],includePending,...patch});
 const grantCommand=(action,includePending=false,patch={})=>({action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,
  delegatedAction:'revision_'+action,scope:scopeValue(includePending),validFrom:profile.from,validUntil:profile.until,reason:'Synthetic208 explicit one-action revision authority',...patch});
 const grant=async(action,includePending=false)=>{const c=grantCommand(action,includePending),r=await foundation(c);assert.equal(r.receipt.grantId,c.operationId);return c.operationId;};
 const admin=async(kind,values)=>{const r=await executeAttendanceAdmin({siteId,view:'settings',cursor:null,search:'',operationId:null,command:{kind,values,operationId:next(),expectedVersion:version},authUserId:d.owner},service);version=r.version;return r;};
 const cycleQuery=(mode='prepare',requestId=null)=>({siteId,expectedWorkerId:p.worker,baseRequestId:rootRequest,mode,requestId,operationId:null});
 const cycle=(query=cycleQuery(),command=null)=>executeRevisionCycle({query,command,authUserId:p.employeeAuth,moduleEnabled:true},service);
 const submit=async()=>{const prepared=await cycle();assert(prepared.canSubmit,'rv208_real_revision_prepare_must_be_eligible');
  const proposal={...initialProposal,startAt:stamp6(Date.parse(initialProposal.startAt)-60000*(++proposalSerial))};
  const command=delegatedRevisionsNativeSubmit(prepared,next(),proposal),result=await cycle(cycleQuery('detail',command.operationId),command);
  assert.equal(result.item.status,'submitted');assert.equal(result.item.requestId,command.operationId);return{command,result};};
 const ownerReview=requestId=>executeRevisionApprovalReview({query:{siteId,requestId},authUserId:d.owner},service);
 const ownerDecision=(requestId,command=null,allowWrite=true)=>executeRevisionDecision({query:{siteId,requestId,operationId:null},command,authUserId:d.owner,allowWrite},service);
 const raw208=(grantId,requestId,command=null,actor=p.delegateAuth,allow=true)=>delegatedRevisionsNativeRpcExpression('faolla_attendance_delegated_revisions_v1',
  {p_query:cq(grantId,requestId),p_auth_user_id:actor,p_command:command,p_allow_write:allow});
 const status=value=>ok('actual208_delegate_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,
  prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(p.delegate)},'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(p.delegate)}),
   'actor_type','owner','actor_id',${owner},'status',${quote(value)},'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $rv208_begin$ begin assert current_user='postgres';assert not exists(select 1 from public.merchants where id=${site});
   assert to_regprocedure('public.synthetic208_owned_late_revision_fault_v1()') is null;perform set_config('faolla.rv208_originals',${originals}::text,true);end;$rv208_begin$;select 1;`);
  await group(0,async()=>{
   profile=JSON.parse(await step('six_explicit_synthetic_identity_role_rows',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic208 revisions','synthetic208@example.test');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
     (${quote(p.role)},${site},'Synthetic208 explicit revision reviewer',array['enterprise.view','attendance.correction.revision.review']),
     (${quote(p.selfRole)},${site},'Synthetic208 ordinary employee self requests',array['enterprise.view','attendance.self.view','attendance.self.clock','attendance.self.request']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
     ${[['delegate','delegateAuth','role'],['employee','employeeAuth','selfRole'],['other','otherAuth','selfRole']].map(([e,a,r],i)=>`(${quote(p[e])},${site},${quote(p[a])},'synthetic208-${i}@example.test','Synthetic208 member ${i}',${quote(p[r])},'active',clock_timestamp(),1)`).join(',')};
    select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`));
   await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
   for(const locationId of[p.location,p.otherLocation])await admin('location',{id:locationId,name:'Synthetic208 ordinary location',timeZone:'UTC',active:true});
   await admin('worker',{id:p.worker,employeeId:p.employee,workerNo:'SYNTHETIC208',displayName:'Synthetic208 actual member',locationId:p.location,active:true,startsOn:'2000-01-01'});
   const policy=await executeCorrectionControls({query:{siteId,operationId:null,beforeRevision:null},authUserId:d.owner,allowWrite:true,
    command:{action:'set_policy',operationId:next(),expectedRevision:0,expectedSettingsVersion:version,submissionWindowDays:365,reason:'Synthetic208 explicit ordinary correction policy'}},service);policyRevision=policy.revision;
   let state=await executeAttendanceSelf({siteId,authUserId:p.employeeAuth,command:null,operationId:null},service);assert.equal(state.state.status,'off');
   for(const action of['clock_in','clock_out']){state=await executeAttendanceSelf({siteId,authUserId:p.employeeAuth,operationId:null,
    command:{action,operationId:next(),expectedWorkerId:p.worker,locationId:p.location,expectedSequence:state.state.sequence}},service);
    if(action==='clock_in')startEvent=state.receipt;else lastEvent=state.receipt;}
   assert(startEvent.occurredAt<lastEvent.occurredAt,'rv208_actual_clock_pair_must_have_positive_duration');
   const prepared=await executeAttendanceCorrection({query:{siteId,mode:'prepare',expectedWorkerId:p.worker,startEventId:startEvent.id},command:null,authUserId:p.employeeAuth,moduleEnabled:true},service);assert(prepared.canRequest);
   initialProposal=parseCorrectionProposal({startAt:stamp6(Date.parse(startEvent.occurredAt)-60000),endAt:lastEvent.occurredAt,breaks:[]});rootRequest=next();
   const c={action:'submit',operationId:rootRequest,expectedRevision:prepared.revision,expectedPolicyRevision:policyRevision,startEventId:startEvent.id,expectedLastEventId:lastEvent.id,
    proposal:initialProposal,reason:'Synthetic208 actual first correction'};
   await executeAttendanceCorrection({query:{siteId,mode:'detail',expectedWorkerId:p.worker,requestId:rootRequest,operationId:null},command:c,authUserId:p.employeeAuth,moduleEnabled:true},service);
   const query={siteId,requestId:rootRequest,operationId:null},detail=await executeCurrentCorrectionDecision({query,command:null,authUserId:d.owner,allowWrite:true},service);assert(detail.canApprove);
   const first=await executeCurrentCorrectionDecision({query,command:{action:'approve',operationId:next(),requestId:rootRequest,expectedRevision:detail.review.application.item.revision,
    expectedEvidence:detail.evidenceToken,reason:'Synthetic208 real owner initial approval'},authUserId:d.owner,allowWrite:true},service);assert.equal(first.current.revision,1);
   rawBaseline=await step('actual_current_raw_clock_baseline','select '+raw+';');
  });
  await group(1,async()=>{
   for(const action of['approve','reject']){const request=await submit(),review=await ownerReview(request.command.operationId);assert.equal(review.requestState,'submitted');
    const detail=await ownerDecision(request.command.operationId);assert(detail[action==='approve'?'canApprove':'canReject']);
    const command=delegatedRevisionsNativeDecision(detail,action,next()),result=await ownerDecision(command.requestId,command);assert.equal(result.decision.action,action);
    assert.equal(result.effectiveChanged,action==='approve');if(action==='approve')legacyApproved={command,result};else legacyRejected={command,result};}
   await step('legacy_NULL_owner_has_no_delegated_sidecar',`do $rv208_legacy$ begin assert not exists(select 1 from public.merchant_attendance_management_delegation_operations where merchant_id=${site});end;$rv208_legacy$;select 1;`);
  });
  await group(2,async()=>{
   approveGrant=await grant('approve',false);const ar=await submit(),ac=await run(approveGrant,ar.command.operationId);assert(ac.context.canApprove&&!ac.context.canReject);
   approvedCommand=delegatedRevisionsNativeDecision(ac,'approve',next());dropReplyOperation=approvedCommand.operationId;
   await deny(run(approveGrant,approvedCommand.requestId,approvedCommand),'attendance_delegated_revisions_invalid');assert.equal(dropReplyOperation,null);
   approvedReceipt=(await recover(approveGrant,approvedCommand)).receipt;assert.equal(approvedReceipt.action,'revision_approve');assert.equal(approvedReceipt.reference.effectRevision,3);
   const rr=await submit();rejectGrant=await grant('reject',true);const rc=await run(rejectGrant,rr.command.operationId);assert(!rc.context.canApprove&&rc.context.canReject);
   rejectedCommand=delegatedRevisionsNativeDecision(rc,'reject',next());rejectedReceipt=(await run(rejectGrant,rejectedCommand.requestId,rejectedCommand)).receipt;
   assert.equal(rejectedReceipt.action,'revision_reject');assert.equal(rejectedReceipt.reference.effectRevision,null);
  });
  await group(3,async()=>{
   pending=await submit();lateGrant=await grant('approve',false);await deny(run(lateGrant,pending.command.operationId),'attendance_management_delegation_scope_invalid');
   pendingGrant=await grant('approve',true);
   await deny(run(pendingGrant,pending.command.operationId,null,p.otherAuth),'attendance_access_denied');
   const cross={p_query:{...cq(pendingGrant,pending.command.operationId),siteId:d.site},p_auth_user_id:p.delegateAuth,p_command:null,p_allow_write:true};
   assert.equal((await call('actual208_wrong_merchant_grant',delegatedRevisionsNativeRpcExpression('faolla_attendance_delegated_revisions_v1',cross))).error,'attendance_access_denied');
   assert.equal((await call('actual208_wrong_target_request',raw208(pendingGrant,uid(999)))).error,'attendance_management_delegation_scope_invalid');
   const self=grantCommand('approve',true,{delegateEmployeeId:p.employee,delegateAuthUserId:p.employeeAuth});
   assert.equal((await call('actual202_self_approval_grant_refused',delegatedRevisionsNativeRpcExpression('faolla_attendance_management_delegations_v1',
    {p_query:{siteId,mode:'write'},p_auth_user_id:d.owner,p_command:self,p_allow_grant:true}),{write:true,allowed:authorityTables})).error,'attendance_invalid_request');
   const wrongIdentity=grantCommand('approve',true,{scope:scopeValue(true,{employeeAuthUserId:p.otherAuth})});await deny(foundation(wrongIdentity),'attendance_management_delegation_scope_invalid');
   const wrongLocation=grantCommand('approve',true,{scope:scopeValue(true,{locationIds:[p.otherLocation]})});await deny(foundation(wrongLocation),'attendance_management_delegation_scope_invalid');
  });
  await group(4,async()=>{
   const context=await run(pendingGrant,pending.command.operationId);pendingCommand=delegatedRevisionsNativeDecision(context,'approve',next());
   for(const[patch,code]of[[{expectedRevision:pendingCommand.expectedRevision+1},'attendance_version_conflict'],[{expectedEvidence:'0'.repeat(32)},'attendance_correction_evidence_changed'],
    [{expectedBaseOperationId:uid(998)},'attendance_revision_base_changed'],[{action:'reject'},'attendance_access_denied']])
    assert.equal((await call('actual208_old_guard_'+Object.keys(patch)[0],raw208(pendingGrant,pendingCommand.requestId,{...pendingCommand,operationId:next(),...patch}),{write:true,allowed:[...reviewTables,...authorityTables]})).error,code);
   await deny(offNode.execute({query:cq(pendingGrant,pendingCommand.requestId),command:{...pendingCommand,operationId:next()},authUserId:p.delegateAuth,allowWrite:true}),'attendance_delegated_revisions_disabled');
   await deny(node.execute({query:cq(pendingGrant,pendingCommand.requestId),command:{...pendingCommand,operationId:next()},authUserId:p.delegateAuth,allowWrite:false}),'attendance_delegated_revisions_disabled');
   assert.equal((await call('actual208_SQL_write_flagoff_refused',raw208(pendingGrant,pendingCommand.requestId,null,p.delegateAuth,false))).error,'attendance_delegated_revisions_disabled');
   const adopt={...pendingCommand,operationId:legacyApproved.command.operationId};
   assert.equal((await call('actual208_no_adopt_existing_owner_decision',raw208(pendingGrant,pendingCommand.requestId,adopt),{write:true,allowed:[...reviewTables,...authorityTables]})).error,'attendance_operation_conflict');
  });
  await group(5,async()=>{
   const branch=await save('rv208_rights');const receipt=(await run(pendingGrant,pendingCommand.requestId,pendingCommand)).receipt;
   await foundation({action:'revoke',operationId:next(),grantId:pendingGrant,expectedRevision:1,reason:'Synthetic208 actual revoke current management grant'});
   await deny(run(pendingGrant,pendingCommand.requestId),'attendance_access_denied');assert.deepEqual((await recover(pendingGrant,pendingCommand)).receipt,receipt);
   replayOps.add(pendingCommand.operationId);try{assert.deepEqual((await offNode.execute({query:cq(pendingGrant,pendingCommand.requestId),command:pendingCommand,authUserId:p.delegateAuth,allowWrite:false})).receipt,receipt);}finally{replayOps.delete(pendingCommand.operationId);}
   await deny(recover(pendingGrant,pendingCommand,p.otherAuth),'attendance_access_denied');await restore('rv208_rights',branch);
   const epoch=await save('rv208_epoch');await status('disabled');await deny(run(pendingGrant,pendingCommand.requestId),'attendance_access_denied');
   assert.deepEqual((await recover(approveGrant,approvedCommand)).receipt,approvedReceipt);
   await step('actual208_delegate_generation_captured',`do $rv208_epoch$ begin assert exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(p.delegate)} and generation=1 and paused);end;$rv208_epoch$;select 1;`);
   await restore('rv208_epoch',epoch);
  });
  await group(6,async()=>{
   const beforeCatalog=await step('owned_fault_catalog_before','select '+managementAuditNativeCatalogSql(d.owned.oid)+';'),branch=await save('rv208_fault');
   await step('unique208_owned_AFTER23514',delegatedRevisionsNativeFaultSql(pendingCommand.operationId));
   const notificationsBefore=await step('all_notification_tables_before_fault','select '+notificationHash+';');
   await deny(run(pendingGrant,pendingCommand.requestId,pendingCommand),'attendance_delegated_revisions_invalid');
   assert.equal(lastRpc.error,'synthetic208_late_sidecar_failure');assert.equal(lastRpc.sqlstate,'23514');assert.equal(lastRpc.constraint,'synthetic208_owned_late_revision_fault');
   assert.equal((await recover(pendingGrant,pendingCommand)).receipt,null);
   await step('failed208_all_decision_effect_sidecar_and_notifications_absent',`do $rv208_atomic$ begin
    assert not exists(select 1 from public.merchant_attendance_revision_decisions where merchant_id=${site} and operation_id=${quote(pendingCommand.operationId)});
    assert not exists(select 1 from public.merchant_attendance_effect_versions where merchant_id=${site} and operation_id=${quote(pendingCommand.operationId)});
    assert not exists(select 1 from public.merchant_attendance_management_delegation_operations where merchant_id=${site} and operation_id=${quote(pendingCommand.operationId)});
    assert ${notificationHash}=${quote(notificationsBefore)};end;$rv208_atomic$;select 1;`);
   await restore('rv208_fault',branch);
   await step('owned_fault_objects_catalog_exact_restored',`do $rv208_catalog$ begin assert to_regprocedure('public.synthetic208_owned_late_revision_fault_v1()') is null;
    assert ${managementAuditNativeCatalogSql(d.owned.oid)}=${quote(beforeCatalog)};end;$rv208_catalog$;select 1;`);
   atomicReceipt=(await run(pendingGrant,pendingCommand.requestId,pendingCommand)).receipt;assert.equal(atomicReceipt.reference.effectRevision,4);
  });
  await group(7,async()=>{
   await admin('settings',{timeZone:'UTC',enabled:false,webClockEnabled:true,webBreakPaid:false});await deny(run(pendingGrant,pendingCommand.requestId),'attendance_access_denied');
   assert.deepEqual((await recover(approveGrant,approvedCommand)).receipt,approvedReceipt);assert.deepEqual((await recover(pendingGrant,pendingCommand)).receipt,atomicReceipt);
   replayOps.add(rejectedCommand.operationId);try{assert.deepEqual((await offNode.execute({query:cq(rejectGrant,rejectedCommand.requestId),command:rejectedCommand,authUserId:p.delegateAuth,allowWrite:false})).receipt,rejectedReceipt);}finally{replayOps.delete(rejectedCommand.operationId);}
   await step('actual208_three_ledgers_full_actor_proof_appendonly_raw_unchanged',`do $rv208_final$ declare authority public.merchant_attendance_management_delegation_operations%rowtype;denied boolean;begin
    assert (select count(*) from public.merchant_attendance_management_delegation_operations where merchant_id=${site})=3;
    assert (select count(*) from public.merchant_attendance_revision_decisions where merchant_id=${site} and actor_auth_user_id=${quote(p.delegateAuth)})=3;
    assert (select count(*) from public.merchant_attendance_effect_versions where merchant_id=${site} and actor_auth_user_id=${quote(p.delegateAuth)})=2;
    for authority in select * from public.merchant_attendance_management_delegation_operations where merchant_id=${site} loop
     assert authority.actor_auth_user_id=${quote(p.delegateAuth)} and authority.delegate_employee_id=${quote(p.delegate)} and authority.delegate_generation=0;
     perform public.faolla_attendance_delegated_revisions_operation_v1(authority,false);end loop;
    assert not exists(select 1 from public.merchant_attendance_management_delegation_operations where merchant_id=${site} and operation_id in(${quote(legacyApproved.command.operationId)},${quote(legacyRejected.command.operationId)}));
    denied:=false;begin update public.merchant_attendance_revision_decisions set reason=reason where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    denied:=false;begin update public.merchant_attendance_effect_versions set revision=revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    denied:=false;begin update public.merchant_attendance_management_delegation_operations set business_revision=business_revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    assert ${raw}=${quote(rawBaseline)},'rv208_raw_clock_changed';${preserve}${external}end;$rv208_final$;select 1;`);
  });
  assert.equal(groups.length,8);assert(rpcs<=90&&steps<140);await step('rollback','rollback;');
  return {phase:208,groups,steps,rpcs,reads,writes,rejections,seedRows:6,newSite:siteId,connections:1,races:0,actualNodeCoordinator:true,actualCurrentClockRpc:true,
   actualCorrectionSubmitAndInitialOwnerApproval:true,actualContinuousRevisionSubmit:true,actualLegacyNullOwnerApproveReject:true,actual202Grants:true,actual208ApproveReject:true,
   actualActorIdentity:true,actualScopeAndIncludePending:true,actualCasEvidenceAndBase:true,actualGrantRevokeAndEpochPause:true,lostResponseOriginalGet:true,receiptOnlyRecovery:true,
   noLegacyDecisionAdoption:true,late23514AtomicFailure:true,allNotificationTablesProtected:true,rawClockUnchanged:true,rollbackRestored:true,
   realAuth:false,browser:false,kdf:false,production:false,newSealBusinessCases:0,
   missingCoverage:['No new seal business case: real current clock periods cannot legitimately be sealed while a revision is pending. Existing150 actual seal validation and208 exact dependency/guards are reused, not reported as a new208 seal test. No wall-time expiry, real Auth, notification delivery or lock race is claimed.']};
 }catch(error){primaryError=failure(error);throw primaryError;}
 finally{try{await delegatedRevisionsNativeCleanup(connection,pendingStep,[
   ['facts',()=>equal(d.fingerprint(),baseline,'rv208_full_rollback_facts')],
   ['definitions',()=>equal(d.definitions(),definitions,'rv208_full_rollback_function_OID_ACL')],['catalog',()=>equal(d.tableCatalog(),catalog,'rv208_full_rollback_catalog')],
   ['archive155',async()=>assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155)],
   ['archive207',async()=>assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),oldPeriod)],
  ],primaryError);}catch(error){throw failure(error);}}
}
