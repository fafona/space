//238 INERT: one caller-owned connection, bounded transaction, real RPCs and
//strict Node parsers. Only supervisor role/member are synthetic prerequisite rows.
//No raw punch/source, historical decision or archive is fabricated or rewritten.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationArchiveBytes,periodContinuationSerialization} from './attendance-period-continuation-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(238400000+n),t=n=>'merchant_attendance_'+n;
export function correctionDelegationNativePlan(){return {delegate:uid(1),auth:uid(2),role:uid(3),grant:uid(4),later:uid(5),included:uid(6),
 request:uid(10),approve:uid(11),reject:uid(12),oldApprove:uid(13),failed:uid(14),revoke:uid(15),rebound:uid(16),disable:uid(17),activate:uid(18),restore:uid(19),selfGrant:uid(20),outsideGrant:uid(21)};}
export function correctionDelegationNativeQuery(siteId,access='owner',mode=access==='owner'?'list':'grants',patch={}){
 return access==='owner'?{siteId,access,mode,catalog:null,afterId:null,grantId:null,operationId:null,...patch}:
 {siteId,access,mode,grantId:null,requestId:null,operationId:null,beforeAt:null,beforeId:null,afterId:null,...patch};
}
function slotPredicates(site,p){
 assert(/^[0-9]{8}$/.test(site));const literal=quote(site),inIds=(col,ids)=>col+' in('+ids.map(quote).join(',')+')';
 const where={
  merchant_enterprise_roles:'x.id='+quote(p.role),merchant_enterprise_employees:'x.id='+quote(p.delegate),
  merchant_enterprise_audit_events:'x.entity_id='+quote(p.delegate),
  [t('correction_delegations')]:inIds('x.grant_id',[p.grant,p.later,p.included,p.outsideGrant]),
  [t('correction_delegation_revocations')]:'x.operation_id='+quote(p.revoke),
  [t('correction_delegation_decisions')]:inIds('x.operation_id',[p.approve,p.reject]),
  [t('correction_entries')]:'x.operation_id='+quote(p.request),
  [t('correction_rule_bindings')]:'x.request_id='+quote(p.request),
  [t('correction_decisions')]:inIds('x.operation_id',[p.approve,p.reject,p.oldApprove]),
  [t('correction_effects')]:inIds('x.operation_id',[p.approve,p.oldApprove]),
  ...Object.fromEntries(['account_epochs','account_suspensions','account_status_operations','account_restores'].map(n=>[t(n),'x.employee_id='+quote(p.delegate)])),
 };
 return Object.fromEntries(Object.entries(where).map(([name,predicate])=>[name,'x.merchant_id='+literal+' and ('+predicate+')']));
}
export function correctionDelegationNativeEmptySlotsSql(site,p){
 return Object.entries(slotPredicates(site,p)).map(([name,predicate])=>'assert not exists(select 1 from public.'+name+' x where '+predicate+'),'+quote('correction_delegation_slot_not_empty:'+name)+';').join('\n');
}
export function correctionDelegationNativeProtectedHash(names,site,p){
 const where=slotPredicates(site,p);
 return '(select md5(jsonb_object_agg(n,rows order by n)::text) from ('+names.map(name=>{
  assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name)&&name.length<=63);
  return 'select '+quote(name)+' n,(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),\'[]\'::jsonb) from public.'+name+' x'+
   (where[name]?' where ('+where[name]+') is not true':'')+') rows';
 }).join(' union all ')+') facts)';
}
export async function verifyCorrectionDelegationNative(ctx){
 const {d,h,native,scope,archive,oldArchive,periodArchive}=ctx;
 assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {executeCorrectionDelegation}=require('../../src/lib/merchantAttendanceCorrectionDelegation.server.ts');
 const {parseCorrectionResult}=require('../../src/lib/merchantAttendanceCorrection.ts');
 const {parseCurrentCorrectionDecision}=require('../../src/lib/merchantAttendanceCurrentCorrectionDecision.ts');
 const p=correctionDelegationNativePlan(),site=quote(d.site),owner=quote(d.owner),auth=quote(h.employeeAuthUserId),start=id(204710),end=id(204711);
 const names=d.inventory(),baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
 const old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());assert.deepEqual(old155,periodContinuationArchiveBytes(oldArchive));
 const all=outageNativeFingerprintSql(names),outside=correctionDelegationNativeProtectedHash(names,d.site,p);
 const prefix=periodContinuationSerialization+d.guard,connection=native.connect();
 let steps=0,reads=0,writes=0,rejections=0,stage='begin',rolledBack=false,lastResult=null;
 const step=async(label,sql)=>{stage=label;assert(++steps<=75,'correction_delegation_max75_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const protectedGuard=`assert ${outside}=current_setting('faolla.cd238_baseline'),'correction_delegation_unrelated_or_old_row_changed';`;
 const call=async(label,expression,write=false)=>{
  const r=JSON.parse(await step(label,`do $cd238_call$ declare previous text;value jsonb;failure text;state_code text;context_text text;begin
   previous:=${all};
   begin set local role service_role;assert current_user='service_role';value:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context;end;reset role;
   if failure is not null or ${!write} then assert ${all}=previous,'correction_delegation_read_or_rejected_write_changed_facts';end if;
   ${protectedGuard}perform set_config('faolla.cd238_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text)::text,true);
  end;$cd238_call$;select current_setting('faolla.cd238_result')::jsonb;`));
  lastResult=r;if(r.error)rejections++;else if(write)writes++;else reads++;return r;
 };
 const rpc=async(name,args)=>{
  assert(['faolla_attendance_correction_delegations_v1','faolla_attendance_delegated_corrections_v1'].includes(name));
  assert.equal(args.p_query.siteId,d.site);assert([d.owner,p.auth,p.rebound].includes(args.p_auth_user_id));
  const r=await call('rpc_'+args.p_query.access+'_'+(args.p_command?.action??args.p_command?.decision?.action??args.p_query.mode),
   `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write})`,args.p_command!==null);
  return {data:r.value,error:r.error?{message:r.error}:null};
 };
 const q=(access='owner',mode=access==='owner'?'list':'grants',patch={})=>correctionDelegationNativeQuery(d.site,access,mode,patch);
 const run=(query,command=null,allowWrite=true,who=query.access==='owner'?d.owner:p.auth)=>executeCorrectionDelegation({query,command,authUserId:who,allowWrite},{rpc});
 const detail=(grant=p.grant)=>q('delegate','detail',{grantId:grant,requestId:p.request});
 const deciding=q('delegate','decide',{grantId:p.grant,requestId:p.request});
 const decision=(action,operationId,read)=>({grantId:p.grant,expectedGrantRevision:1,decision:{action,operationId,requestId:p.request,expectedRevision:read.detail.revision,expectedEvidence:read.detail.evidenceToken,reason:'Synthetic238 explicit '+action}});
 const denied=async(label,query,command=null,allowWrite=true,who=p.auth,code='attendance_access_denied')=>{
  stage=label;const beforeSteps=steps;let caught=null;
  try{await run(query,command,allowWrite,who);}catch(error){caught=error;}
  assert(caught,label+':expected_rejection');assert.equal(caught.code,code,label+':'+JSON.stringify(lastResult));
  assert.equal(steps,beforeSteps+1,label+':must_reach_exactly_one_real_RPC');assert(lastResult.error,label+':SQL_rejection_required');
 };
 const save=async(name)=>{assert(/^[a-z0-9_]+$/.test(name));return step('save_'+name,`savepoint ${name};select ${all};`);};
 const restore=async(name,before)=>{assert(/^[a-z0-9_]+$/.test(name));assert.equal(await step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};select ${all};`),before);};
 try{
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $cd238_seed$ begin
    assert not exists(select 1 from public.merchant_enterprise_employees where id=${quote(p.delegate)} or auth_user_id in(${quote(p.auth)},${quote(p.rebound)}));
    assert not exists(select 1 from public.merchant_enterprise_roles where id=${quote(p.role)});
    assert not exists(select 1 from public.merchant_attendance_correction_delegations where merchant_id=${site});
    assert not exists(select 1 from public.merchant_attendance_correction_entries where merchant_id=${site} and operation_id=${quote(p.request)});
    assert not exists(select 1 from public.merchant_attendance_correction_decisions where merchant_id=${site} and operation_id in(${[p.approve,p.reject,p.oldApprove,p.failed].map(quote).join(',')}));
    assert not exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(p.delegate)});
    ${correctionDelegationNativeEmptySlotsSql(d.site,p)}
    perform set_config('faolla.cd238_baseline',${outside},true);
   end;$cd238_seed$;
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(p.role)},${site},'Synthetic238 correction supervisor',array['enterprise.view','attendance.correction.review']);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
    values(${quote(p.delegate)},${site},${quote(p.auth)},'synthetic238@example.test','Synthetic238 supervisor',${quote(p.role)},'active',clock_timestamp(),1);
   select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'outsideLocation',(select l.id from public.merchant_attendance_locations l where l.merchant_id=${site} and l.active
      and l.id<>(select e.location_id from public.merchant_attendance_events e where e.merchant_id=${site} and e.id=${quote(start)}) order by l.id limit 1),
    'basis',public.faolla_attendance_correction_owner_basis_v1(${site},${quote(h.workerId)},${quote(h.employeeId)},${quote(start)},clock_timestamp()));`));
  const events=profile.basis.currentBasis.events;assert.deepEqual(events.map(e=>[e.id,e.action]),[[start,'clock_in'],[end,'clock_out']]);
  assert.equal(events[0].locationId,events[1].locationId);assert.equal(events[0].source,'web');
  assert.equal(typeof profile.outsideLocation,'string','correction_delegation_existing_other_active_location_required');assert.notEqual(profile.outsideLocation,events[0].locationId);
  const grant={action:'grant',operationId:p.grant,delegateEmployeeId:p.delegate,delegateAuthUserId:p.auth,workerId:h.workerId,
   employeeId:h.employeeId,employeeAuthUserId:h.employeeAuthUserId,locationId:events[0].locationId,includePending:false,
   validFrom:profile.from,validUntil:profile.until,reason:'Synthetic238 one historical location'};
  const created=await run(q(),grant);assert.equal(created.receipt.grantId,p.grant);
  assert.deepEqual((await run(q(),grant)).receipt,created.receipt);
  assert.deepEqual((await run(q('owner','recover',{operationId:p.grant}),null,false)).receipt,created.receipt);
  const grants=await run(q('delegate'));assert(grants.grants.some(g=>g.grantId===p.grant&&g.usable));assert.equal(grants.employeeId,p.delegate);
  const selfGrant={...grant,operationId:p.selfGrant,delegateEmployeeId:h.employeeId,delegateAuthUserId:h.employeeAuthUserId};
  const beforeSelfSteps=steps,beforeSelfResult=lastResult;
  await assert.rejects(run(q(),selfGrant,true,d.owner),error=>error.code==='attendance_invalid_request');
  assert.equal(steps,beforeSelfSteps,'self_grant_Node_rejection_must_be_zero_RPC');assert.equal(lastResult,beforeSelfResult);
  const selfSql=await call('self_grant_real_SQL',`public.faolla_attendance_correction_delegations_v1(${json(q())},${owner},${json(selfGrant)},true)`,true);
  assert.equal(selfSql.error,'attendance_access_denied',JSON.stringify(selfSql));assert.equal(selfSql.sqlstate,'P0001');
  const prepareQ={siteId:d.site,expectedWorkerId:h.workerId,mode:'prepare',startEventId:start};
  const wire=q=>Object.fromEntries(Object.entries(q).filter(([key])=>key!=='siteId'));
  const rawPrepare=await call('real_employee_prepare',`public.faolla_attendance_correction_self_v3(${site},${auth},${json(wire(prepareQ))},null,true)`);
  assert.equal(rawPrepare.error,null,JSON.stringify(rawPrepare));const prepared=parseCorrectionResult(rawPrepare.value,prepareQ,true,true);assert(prepared.canRequest&&prepared.rules.policy);assert.equal(prepared.pendingRequestId,null);
  const cq={siteId:d.site,expectedWorkerId:h.workerId,mode:'detail',requestId:p.request,operationId:null};
  const command={action:'submit',operationId:p.request,expectedRevision:prepared.revision,expectedPolicyRevision:prepared.rules.policy.revision,startEventId:start,expectedLastEventId:end,
   proposal:{startAt:events[0].occurredAt,endAt:new Date(Date.parse(events[1].occurredAt)+60000).toISOString().replace('Z','000Z'),breaks:[]},reason:'Synthetic238 real employee request'};
  const submitted=await call('real_employee_submit',`public.faolla_attendance_correction_self_v3(${site},${auth},${json(wire(cq))},${json(command)},true)`,true);
  assert.equal(submitted.error,null,JSON.stringify(submitted));parseCorrectionResult(submitted.value,{...cq,operationId:p.request},true,true);
  const list=await run(q('delegate','list',{grantId:p.grant}));assert.deepEqual(list.items.map(x=>x.requestId),[p.request]);
  const current=await run(detail());assert.equal(current.detail.canApprove,true,JSON.stringify(current.detail.blockers));assert.equal(current.detail.canReject,true);
  assert.deepEqual(current.detail.original,{startAt:events[0].occurredAt,endAt:events[1].occurredAt,breaks:[]});assert.deepEqual(current.detail.proposal,command.proposal);
  await run(q(),{...grant,operationId:p.later,includePending:false});
  assert.equal((await run(q('delegate','list',{grantId:p.later}))).items.length,0);await denied('historical_pending_not_included',detail(p.later));
  await run(q(),{...grant,operationId:p.included,includePending:true});assert.equal((await run(detail(p.included))).detail.requestId,p.request);
  // The request is explicitly included by time, leaving LOCATION as the only
  // denied dimension. Reuse another existing active location; never seed one.
  await run(q(),{...grant,operationId:p.outsideGrant,locationId:profile.outsideLocation,includePending:true});
  assert.deepEqual((await run(q('delegate','list',{grantId:p.outsideGrant}))).items,[]);
  await denied('saved_basis_outside_grant_location',detail(p.outsideGrant));
  await denied('disabled_fresh_read',detail(),null,false,p.auth,'attendance_correction_delegation_disabled');
  const oldBranch=await save('cd238_old');
  const oq={siteId:d.site,requestId:p.request,operationId:null};
  const oldRead=await call('old_owner_review',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(p.request)},null,null,true)`);assert.equal(oldRead.error,null,JSON.stringify(oldRead));
  const oldDetail=parseCurrentCorrectionDecision(oldRead.value,oq);assert(oldDetail.canApprove);
  const oldCommand={action:'approve',operationId:p.oldApprove,requestId:p.request,expectedRevision:oldDetail.review.application.item.revision,expectedEvidence:oldDetail.evidenceToken,reason:'Synthetic238 legacy owner unchanged'};
  const oldWrite=await call('old_owner_approve',`public.faolla_attendance_correction_decide_v2(${site},${owner},${quote(p.request)},${json(oldCommand)},null,true)`,true);
  assert.equal(oldWrite.error,null,JSON.stringify(oldWrite));parseCurrentCorrectionDecision(oldWrite.value,{...oq,operationId:p.oldApprove});await restore('cd238_old',oldBranch);
  const rejectBranch=await save('cd238_reject');const rejected=await run(deciding,decision('reject',p.reject,current));assert.equal(rejected.receipt.status,'rejected');
  assert.deepEqual((await run(q('delegate','recover',{operationId:p.reject}),null,false)).receipt,rejected.receipt);await restore('cd238_reject',rejectBranch);
  await step('inject_new_sidecar_failure',`alter table public.merchant_attendance_correction_delegation_decisions add constraint synthetic238_fault check(operation_id<>${quote(p.failed)}) not valid;select 1;`);
  await denied('atomic_sidecar_failure',deciding,decision('approve',p.failed,current),true,p.auth,'attendance_unavailable');assert.equal(lastResult.sqlstate,'23514');
  await step('remove_new_sidecar_failure','alter table public.merchant_attendance_correction_delegation_decisions drop constraint synthetic238_fault;select 1;');
  assert.equal((await run(q('delegate','recover',{operationId:p.failed}),null,false)).receipt,null);
  const approve=decision('approve',p.approve,current),approved=await run(deciding,approve);assert.equal(approved.receipt.actorId,p.auth);assert.equal(approved.receipt.status,'approved');
  assert.deepEqual((await run(deciding,approve)).receipt,approved.receipt);
  await denied('same_operation_changed_body',deciding,{...approve,decision:{...approve.decision,reason:'Different body'}},true,p.auth,'attendance_operation_conflict');
  const captured=JSON.parse(await step('real_business_and_authority',`select jsonb_build_object('decisionActor',(select actor_auth_user_id from public.merchant_attendance_correction_decisions where merchant_id=${site} and operation_id=${quote(p.approve)}),
   'authority',(select command from public.merchant_attendance_correction_delegation_decisions where merchant_id=${site} and operation_id=${quote(p.approve)}),
   'effect',(select proposal from public.merchant_attendance_correction_effects where merchant_id=${site} and operation_id=${quote(p.approve)}),
   'delegateWorkers',(select count(*) from public.merchant_attendance_workers where merchant_id=${site} and employee_id=${quote(p.delegate)}));`));
  assert.equal(captured.decisionActor,p.auth);assert.deepEqual(captured.authority,approve);assert.deepEqual(captured.effect,command.proposal);assert.equal(captured.delegateWorkers,0);
  const authBranch=await save('cd238_rebind');await step('synthetic_auth_rebind',`update public.merchant_enterprise_employees set auth_user_id=${quote(p.rebound)} where merchant_id=${site} and id=${quote(p.delegate)};select 1;`);
  await denied('old_auth_recovery',q('delegate','recover',{operationId:p.approve}),null,false);
  await denied('new_auth_cannot_adopt',q('delegate','recover',{operationId:p.approve}),null,false,p.rebound);await restore('cd238_rebind',authBranch);
  const pauseBranch=await save('cd238_pause');
  const status=(value,op)=>`input_value:=${json({merchant_id:d.site,employee_id:p.delegate,actor_type:'owner',actor_id:d.owner,status:value,...(value==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:op,attendance_suspension_enabled:false})}||jsonb_build_object('expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(p.delegate)}));
   set local role service_role;assert current_user='service_role';answer:=public.faolla_update_merchant_enterprise_employee_v1(input_value);reset role;`;
  await step('real_no_worker_pause_even_enabled_false',`do $cd238_pause$ declare input_value jsonb;answer jsonb;begin ${status('disabled',p.disable)}
   assert exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(p.delegate)} and paused and generation=1);
   ${protectedGuard}end;$cd238_pause$;select 1;`);writes++;
  await denied('paused_grant',detail());assert.deepEqual((await run(q('delegate','recover',{operationId:p.approve}),null,false)).receipt,approved.receipt);
  await step('real_no_worker_restore',`do $cd238_restore$ declare input_value jsonb;answer jsonb;query_value jsonb;detail_value jsonb;begin ${status('active',p.activate)}
   query_value:=jsonb_build_object('siteId',${site},'mode','detail','afterId',null,'operationId',null,'suspensionId',(select suspension_id from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(p.delegate)}));
   set local role service_role;assert current_user='service_role';answer:=public.faolla_attendance_account_suspensions_v1(query_value,${owner},null,true);detail_value:=answer->'detail';
   assert (detail_value->>'canRestore')::boolean and detail_value->'suspension'->'workerId'='null'::jsonb;
   answer:=public.faolla_attendance_account_suspensions_v1(query_value,${owner},jsonb_build_object('action','restore','operationId',${quote(p.restore)},'suspensionId',query_value->'suspensionId',
    'expectedGeneration',detail_value->'suspension'->'generation','workerId',null,'expectedWorkerVersion',null,'expectedEmployeeVersion',detail_value->'employeeVersion','employeeId',${quote(p.delegate)},'employeeAuthUserId',${quote(p.auth)},'reason','Synthetic238 restore supervisor'),true);reset role;
   assert exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(p.delegate)} and not paused and generation=1);
   ${protectedGuard}end;$cd238_restore$;select 1;`);writes+=2;reads++;
  await denied('restored_old_epoch_denied',detail());assert.deepEqual((await run(q('delegate','recover',{operationId:p.approve}),null,false)).receipt,approved.receipt);await restore('cd238_pause',pauseBranch);
  await run(q('owner','detail',{grantId:p.grant}),{action:'revoke',operationId:p.revoke,grantId:p.grant,expectedRevision:1,reason:'Synthetic238 emergency revoke'},false);
  await denied('revoked_grant',detail());assert.deepEqual((await run(q('delegate','recover',{operationId:p.approve}),null,false)).receipt,approved.receipt);
  assert.equal((await run(q('owner','detail',{grantId:p.grant}),null,false)).detail.status,'revoked');
  await step('private_helper_acl',`do $cd238_acl$ declare denied boolean:=false;previous text;begin previous:=${all};
   begin set local role service_role;perform public.faolla_attendance_correction_delegation_review_v1(${site},${quote(p.auth)},${quote(p.request)});exception when insufficient_privilege then denied:=true;end;reset role;
   assert denied;assert ${all}=previous;${protectedGuard}end;$cd238_acl$;select 1;`);
  await step('rollback','rollback;');rolledBack=true;
  return {steps,reads,writes,rejections,realAuth:false,browser:false,syntheticPrerequisiteRows:2,noRawSourceWrites:true,
   actualEmployeeSubmit:true,actualApproveAndReject:true,actualLegacyOwnerApproveSavepoint:true,authorityAtomicRollback:true,includePendingBoundary:true,savedLocationBoundary:true,
   noOwnWorkerRequired:true,selfGrantNodeRejectionZeroRpc:true,selfGrantSqlRejected:true,pauseWithEnabledFalseCaptured:true,restoredOldEpochRejected:true,minimalRecoveryAfterPauseAndRevoke:true,
   exactOldRowsAndArchivesPreserved:true,rollbackRestored:true};
 }catch(error){throw new Error(`correction_delegation_native:${stage}:${error?.stack??String(error)}:${JSON.stringify(lastResult?.error?lastResult:null)}`);}
 finally{if(!rolledBack)await connection.step('rollback;').catch(()=>{});await connection.close();
  assert.equal(d.fingerprint(),baseline,'correction_delegation_full_rollback_failed');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
}
