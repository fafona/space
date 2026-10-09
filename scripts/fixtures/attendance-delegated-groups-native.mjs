//204 INERT: eight finite actual RPC/production Node groups in one ROLLBACK.
//Only nine explicitly synthetic merchant/role/identity rows are seeded. All
//settings, workers, groups, grants, suspension generations and restores use RPCs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {managementAuditNativeCatalogSql} from './attendance-management-audit-native.mjs';
import {delegatedGroupsTables} from '../merchant-attendance-delegated-groups-source.mjs';
const require=createRequire(import.meta.url),uid=n=>id(204600000+n);
export const delegatedGroupsNativeSite='99990204';
export const delegatedGroupsNativeIds=Object.freeze({role:uid(1),plainRole:uid(2),otherRole:uid(3),delegate:uid(4),delegateAuth:uid(5),plainDelegate:uid(6),plainAuth:uid(7),
 employeeA:uid(8),authA:uid(9),employeeB:uid(10),authB:uid(11),unusedEmployee:uid(12),unusedAuth:uid(13),workerA:uid(14),workerB:uid(15),locationA:uid(16),locationB:uid(17),
 groupA:uid(21),groupB:uid(22),ownerAssignment:uid(23),createdGroup:uid(24)});
export const delegatedGroupsNativeGroupBudgets=Object.freeze([
 ['real064_setup_and_legacy124_owner_four_writes',14,18],['actual202_scoped_grants_and_default_off',8,10],
 ['delegated_one_use_create_update_and_minimal_receipt',10,12],['delegated_assign_end_cancel_actual_actor_and_SHA',17,20],
 ['cross_group_worker_assignment_location_and_private_core_denials',12,16],['old_CAS_overlap_future_revoke_and_original_receipt',10,16],
 ['actual_delegate_target_generations_same_identity_restore',12,18],['late_atomic_sidecar_failure_same_number_retry_and_immutable',7,14],
].map(([name,rpcs,steps])=>Object.freeze({name,rpcs,steps})));
export function delegatedGroupsNativeRpcExpression(name,args){
 assert(['faolla_attendance_delegated_groups_v1','faolla_attendance_management_delegations_v1','faolla_attendance_groups_v1'].includes(name));
 const flag=name==='faolla_attendance_management_delegations_v1'?'p_allow_grant':'p_allow_write';
 assert.deepEqual(Object.keys(args).sort(),['p_query','p_auth_user_id','p_command',flag].sort());assert.equal(typeof args[flag],'boolean');
 assert.match(args.p_query.siteId,/^9999[0-9]{4}$/);assert.match(args.p_auth_user_id,/^[a-f0-9-]{36}$/);
 return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args[flag]})`;
}
export function delegatedGroupsNativeFaultSql(operationId,site=delegatedGroupsNativeSite){
 assert.match(operationId,/^[a-f0-9-]{36}$/);assert.equal(site,delegatedGroupsNativeSite);
 return `create function public.synthetic204_owned_late_group_fault_v1() returns trigger language plpgsql set search_path=pg_catalog as $owned204_fault$
 begin if new.merchant_id=${quote(site)} and new.operation_id=${quote(operationId)} then raise exception 'synthetic204_late_sidecar_failure';end if;return new;end;$owned204_fault$;
 create trigger synthetic204_owned_late_group_fault after insert on public.merchant_attendance_management_delegation_operations
 for each row execute function public.synthetic204_owned_late_group_fault_v1();select 1;`;
}
export async function verifyDelegatedGroupsNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {executeManagementDelegation}=require('../../src/lib/merchantAttendanceManagementDelegation.server.ts');
 const {createDelegatedGroupsService}=require('../../src/lib/merchantAttendanceDelegatedGroups.server.ts');
 const {executeGroups}=require('../../src/lib/merchantAttendanceGroups.server.ts');
 const {delegatedGroupsCommandFingerprint}=require('../../src/lib/merchantAttendanceDelegatedGroups.ts');
 const p=delegatedGroupsNativeIds,siteId=delegatedGroupsNativeSite,site=quote(siteId),owner=quote(d.owner),names=d.inventory();
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const all=outageNativeFingerprintSql(names),prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 const originalRows=`(select jsonb_object_agg(n,rows) from(${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${n} x) rows`).join(' union all ')}) original_rows)`;
 const preserve=names.map(n=>`assert not exists(select previous.value from jsonb_array_elements(current_setting('faolla.dg204_originals')::jsonb->${quote(n)}) previous(value) except select to_jsonb(x) from public.${n} x),'dg204_old_row_changed:${n}';`).join('\n');
 const external=names.map(n=>`assert not exists(select to_jsonb(x) from public.${n} x where coalesce(to_jsonb(x)->>'merchant_id',case when ${quote(n)}='merchants' then to_jsonb(x)->>'id' end,'')<>${site}
 except select previous.value from jsonb_array_elements(current_setting('faolla.dg204_originals')::jsonb->${quote(n)}) previous(value)),'dg204_external_scope_added:${n}';`).join('\n');
 const rawNames=names.filter(n=>/merchant_attendance_(?:events|correction_|missing_|leave_|work_arrangement_|period_|schedule_|shift_|plan_|calendar_|outage_)/.test(n));assert(rawNames.length>10);
 const raw=outageNativeFingerprintSql(rawNames);let rawBaseline;
 let steps=0,rpcs=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,rolledBack=false,profile;
 const groups=[],next=()=>uid(++serial);
 const step=async(label,sql)=>{stage=label;assert(++steps<=140,'dg204_max140_SQLsteps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const call=async(label,expression,{write=false,replay=false,prepare='',role='service_role',allowed=null}={})=>{
  assert(++rpcs<=90,'dg204_max90_RPCs');const outside=allowed===null?null:outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)));
  const r=JSON.parse(await step(label,`do $dg204_call$ declare old_hash text;outside_hash text;value jsonb;prepared_command jsonb;failure text;state_code text;context_text text;begin
   old_hash:=${all};${outside?'outside_hash:='+outside+';':''}${prepare}begin set local role ${role};assert current_user=${quote(role)};value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=old_hash,'dg204_read_rejection_replay_wrote';end if;
   ${outside?'assert '+outside+"=outside_hash,'dg204_unrelated_table_changed';":''}${preserve}${external}
   perform set_config('faolla.dg204_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text)::text,true);
  end;$dg204_call$;select current_setting('faolla.dg204_result')::jsonb;`));
  lastRpc={error:r.error??r.value?.error??null,sqlstate:r.sqlstate,context:r.context?.slice(0,6000)??null,kind:r.value?.kind??null,protocol:r.value?.protocol??null};
  if(lastRpc.error)rejections++;else if(write&&!replay)writes++;else reads++;return r;
 };
 const service={rpc:async(name,args)=>{const allowed=name==='faolla_attendance_groups_v1'?delegatedGroupsTables:name==='faolla_attendance_delegated_groups_v1'?[...delegatedGroupsTables,'merchant_attendance_management_delegation_operations']:
  ['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'];
  const r=await call('actual_'+name+'_'+(args.p_command?.action??args.p_query.mode??args.p_query.view),delegatedGroupsNativeRpcExpression(name,args),{write:args.p_command!==null,allowed});
  return{data:r.value,error:r.error?{message:r.error}:null};}};
 const node=createDelegatedGroupsService(service,{enabled:id=>id===siteId});
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(lastRpc));assert(!r.value?.error,JSON.stringify(lastRpc));return r.value;};
 const deny=async(promise,code)=>assert.rejects(promise,e=>e?.code===code||e?.message===code);
 const group=async(index,run)=>{const beforeRpcs=rpcs,beforeSteps=steps;await run();const spec=delegatedGroupsNativeGroupBudgets[index],actual={name:spec.name,rpcs:rpcs-beforeRpcs,steps:steps-beforeSteps};
  assert(actual.rpcs<=spec.rpcs&&actual.steps<=spec.steps,'dg204_group_budget:'+JSON.stringify(actual));groups.push(actual);native.pass('204 group'+(index+1)+' '+JSON.stringify(actual));};
 const save=async label=>{assert(/^[a-z0-9_]+$/.test(label));return step('save_'+label,`savepoint ${label};select ${all};`);};
 const restore=async(label,hash)=>assert.equal(await step('restore_'+label,`rollback to savepoint ${label};release savepoint ${label};select ${all};`),hash,'dg204_savepoint_not_exact');
 const q=grantId=>({siteId,grantId,mode:'context',operationId:null}),rq=(grantId,operationId)=>({siteId,grantId,mode:'recover',operationId});
 const execute=(grantId,command=null,actor=p.delegateAuth,allowWrite=true)=>node.execute({query:q(grantId),command,authUserId:actor,allowWrite});
 const recover=(grantId,command,actor=p.delegateAuth)=>node.recover({query:rq(grantId,command.operationId),expectedCommand:command,authUserId:actor});
 const fq={siteId,mode:'write'},fd=grantId=>({siteId,mode:'detail',grantId});
 const foundation=(query,command=null,actor=d.owner,allowGrant=true)=>executeManagementDelegation({query,command,authUserId:actor,allowGrant},service);
 const groupScope=(groupId,create=false)=>({kind:'group',groupId,create}),workerScope=(groupId=p.groupA,assignmentId=null)=>({kind:'group_worker',groupId,assignmentId,workerId:p.workerA,employeeId:p.employeeA,employeeAuthUserId:p.authA,locationIds:[p.locationA]});
 const grant=async(action,scopeValue,patch={})=>{const command={action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,delegatedAction:action,
  scope:scopeValue,validFrom:profile.from,validUntil:profile.until,reason:'Synthetic204 explicit owner group authority',...patch};const result=await foundation(fq,command);assert.equal(result.receipt.grantId,command.operationId);return command.operationId;};
 const lq=(groupId=null,workerId=null,assignmentId=null,view='context')=>({siteId,view,groupId,workerId,onDate:null,assignmentId,operationId:null,cursorId:null});
 const legacy=(query,command=null,actor=d.owner)=>executeGroups({query,command,authUserId:actor,allowWrite:true},service);
 const groupCommand=(groupId,revision=0,name='Synthetic204 group')=>({action:'save_group',operationId:revision===0?groupId:next(),reason:'Synthetic204 actual group write',groupId,expectedRevision:revision,name,description:'Explicit synthetic acceptance',active:true});
 const assignmentCommand=(context,groupId=p.groupA,workerId=p.workerA)=>({action:'assign',operationId:next(),reason:'Synthetic204 actual assignment',groupId,workerId,expectedGroupRevision:context.group.revision,
  expectedWorkerVersion:context.worker.version,expectedSettingsVersion:context.settingsVersion,timeZone:context.timeZone,startsOn:profile.today,endsOn:null});
 const admin=async(kind,values)=>ok('actual064_'+kind,`public.faolla_attendance_admin_v1(${site},${owner},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,{write:true,
  prepare:`prepared_command:=jsonb_build_object('kind',${quote(kind)},'operationId',${quote(next())},'expectedVersion',coalesce((select version from public.merchant_attendance_settings where merchant_id=${site}),0),'values',${json(values)});`});
 const status=(employeeId,value)=>ok('actual_employee_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(employeeId)},
  'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(employeeId)}),'actor_type','owner','actor_id',${owner},'status',${quote(value)},'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 let createGrant,assignGrant,updateGrant,assignContext,created,updated,assigned,ended,cancelled;
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $dg204_begin$ begin assert current_user='postgres';assert not exists(select 1 from public.merchants where id=${site});
   assert to_regprocedure('public.synthetic204_owned_late_group_fault_v1()') is null;perform set_config('faolla.dg204_originals',${originalRows}::text,true);end;$dg204_begin$;select 1;`);
  await group(0,async()=>{
   profile=JSON.parse(await step('nine_explicit_synthetic_identity_role_rows',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic204 groups','synthetic204@example.test');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
    (${quote(p.role)},${site},'Synthetic204 explicit groups',array['enterprise.view','attendance.groups.manage']),
    (${quote(p.plainRole)},${site},'Synthetic204 no group authority',array['enterprise.view','attendance.self.view','attendance.self.clock']),
    (${quote(p.otherRole)},${site},'Synthetic204 empty capability',array['enterprise.view']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
    ${[['delegate','delegateAuth','role'],['plainDelegate','plainAuth','otherRole'],['employeeA','authA','plainRole'],['employeeB','authB','plainRole'],['unusedEmployee','unusedAuth','otherRole']].map(([e,a,r],i)=>`(${quote(p[e])},${site},${quote(p[a])},'synthetic204-${i}@example.test','Synthetic204 member ${i}',${quote(p[r])},'active',clock_timestamp(),1)`).join(',')};
    select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'futureUntil',to_char((clock_timestamp()+interval '2 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'today',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD'));`));
   rawBaseline=await step('raw_source_baseline','select '+raw+';');
   await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
   for(const which of['A','B'])await admin('location',{id:p['location'+which],name:'Synthetic204 location '+which,timeZone:'UTC',active:true});
   for(const which of['A','B'])await admin('worker',{id:p['worker'+which],employeeId:p['employee'+which],workerNo:'SYNTHETIC204-'+which,displayName:'Synthetic204 worker '+which,locationId:p['location'+which],active:true,startsOn:'2000-01-01'});
   for(const groupId of[p.groupA,p.groupB])await legacy(lq(),groupCommand(groupId));
   const context=await legacy(lq(p.groupB,p.workerB)),command=assignmentCommand(context,p.groupB,p.workerB);command.operationId=p.ownerAssignment;
   await legacy(lq(p.groupB,p.workerB),command);await legacy(lq(p.groupB,p.workerB,p.ownerAssignment),{action:'end',operationId:next(),reason:'Synthetic204 owner end',assignmentId:p.ownerAssignment,expectedRevision:1,endsOn:profile.today});
   await legacy(lq(p.groupB,p.workerB,p.ownerAssignment),{action:'cancel',operationId:next(),reason:'Synthetic204 owner cancel',assignmentId:p.ownerAssignment,expectedRevision:2});
   assert.equal((await legacy(lq(null,null,null,'groups'))).items.length,2);assert.equal((await legacy(lq(p.groupB,p.workerB,null,'members'))).items[0].status,'cancelled');
   await deny(legacy(lq(null,null,null,'groups'),null,p.delegateAuth),'attendance_access_denied');
  });
  await group(1,async()=>{
   createGrant=await grant('group_save',groupScope(p.createdGroup,true));assignGrant=await grant('group_assign',workerScope());await grant('group_save',groupScope(p.groupA));
   const createContext=await execute(createGrant);assert.equal(createContext.context.group,null);assert.deepEqual(createContext.context.items,[]);
   assignContext=await execute(assignGrant);assert.equal(assignContext.context.worker.employeeId,p.employeeA);assert.deepEqual(assignContext.context.items,[]);
   const bad={action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,delegatedAction:'group_save',scope:groupScope(p.groupA),validFrom:profile.from,validUntil:profile.until,reason:'Synthetic204 refused grant'};
   await deny(foundation(fq,bad,p.delegateAuth),'attendance_access_denied');await deny(foundation(fq,{...bad,operationId:next()},d.owner,false),'attendance_management_delegation_disabled');
   await deny(foundation(fq,{...bad,operationId:next(),delegateEmployeeId:p.plainDelegate,delegateAuthUserId:p.plainAuth}),'attendance_management_delegation_scope_invalid');
  });
  await group(2,async()=>{
   const command=groupCommand(p.createdGroup);created={command,result:await execute(createGrant,command)};assert.equal(created.result.receipt.actorId,p.delegateAuth);
   assert.deepEqual((await execute(createGrant,command,p.delegateAuth,false)).receipt,created.result.receipt);assert.deepEqual((await recover(createGrant,command)).receipt,created.result.receipt);
   await deny(execute(createGrant),'attendance_access_denied');updateGrant=await grant('group_save',groupScope(p.createdGroup));assert.equal((await execute(updateGrant)).context.group.revision,1);
   const update=groupCommand(p.createdGroup,1,'Synthetic204 delegate updated');updated={command:update,result:await execute(updateGrant,update)};assert.equal(updated.result.receipt.revision,2);
   const conflict=await call('actual204_same_number_different_body',delegatedGroupsNativeRpcExpression('faolla_attendance_delegated_groups_v1',{p_query:q(updateGrant),p_auth_user_id:p.delegateAuth,p_command:{...update,name:'Conflicting body'},p_allow_write:false}));assert.equal(conflict.error,'attendance_operation_conflict');
  });
  await group(3,async()=>{
   const command=assignmentCommand(assignContext.context);assigned={command,result:await execute(assignGrant,command)};
   const endGrant=await grant('group_end',workerScope(p.groupA,command.operationId)),cancelGrant=await grant('group_cancel',workerScope(p.groupA,command.operationId));
   assert.equal((await execute(endGrant)).context.detail.revision,1);assert.equal((await execute(cancelGrant)).context.detail.revision,1);
   const end={action:'end',operationId:next(),reason:'Synthetic204 delegated end',assignmentId:command.operationId,expectedRevision:1,endsOn:profile.today};ended={grantId:endGrant,command:end,result:await execute(endGrant,end)};
   const cancel={action:'cancel',operationId:next(),reason:'Synthetic204 delegated cancel',assignmentId:command.operationId,expectedRevision:2};cancelled={grantId:cancelGrant,command:cancel,result:await execute(cancelGrant,cancel)};
   assert.deepEqual((await recover(endGrant,end)).receipt,ended.result.receipt);const detail=await legacy(lq(p.groupA,p.workerA,command.operationId));assert.equal(detail.detail.status,'cancelled');assert.deepEqual(detail.detail.history.map(x=>x.command.action),['assign','end','cancel']);
   const expected=await delegatedGroupsCommandFingerprint(q(assignGrant),p.delegateAuth,command);assert.equal(assigned.result.receipt.commandFingerprint,expected);
   await step('actual_actor_business_and_authority_proofs',`do $dg204_proof$ declare authority public.merchant_attendance_management_delegation_operations%rowtype;begin
    for authority in select * from public.merchant_attendance_management_delegation_operations where merchant_id=${site} loop
     assert authority.actor_auth_user_id=${quote(p.delegateAuth)} and authority.delegate_employee_id=${quote(p.delegate)} and authority.delegate_generation=0;
     perform public.faolla_attendance_delegated_groups_operation_v1(authority,false);end loop;
    assert (select count(*) from public.merchant_attendance_group_assignment_operations where merchant_id=${site} and assignment_id=${quote(command.operationId)} and actor_auth_user_id=${quote(p.delegateAuth)})=3;
   end;$dg204_proof$;select 1;`);
   assigned.endGrant=endGrant;assigned.cancelGrant=cancelGrant;
  });
  await group(4,async()=>{
   const fresh=()=>({...assigned.command,operationId:next()});await deny(execute(assignGrant,{...fresh(),groupId:p.groupB}),'attendance_invalid_request');
   await deny(execute(assignGrant,{...fresh(),workerId:p.workerB}),'attendance_invalid_request');
   await deny(execute(assigned.cancelGrant,{...cancelled.command,operationId:next(),assignmentId:p.ownerAssignment}),'attendance_invalid_request');
   await deny(execute(assignGrant,fresh(),p.plainAuth),'attendance_access_denied');
   await deny(node.execute({query:{...q(assignGrant),siteId:d.site},command:fresh(),authUserId:p.delegateAuth,allowWrite:true}),'attendance_delegated_groups_disabled');
   const rawCross=await call('actual204_cross_merchant',delegatedGroupsNativeRpcExpression('faolla_attendance_delegated_groups_v1',{p_query:{...q(assignGrant),siteId:d.site},p_auth_user_id:p.delegateAuth,p_command:null,p_allow_write:false}));assert.equal(rawCross.error,'attendance_access_denied');
   await deny(grant('group_assign',{...workerScope(),locationIds:[p.locationB]}),'attendance_management_delegation_scope_invalid');
   const privateDenied=await call('private204_core_service_denied',`public.faolla_attendance_groups_core_v2(${json(lq())},${quote(p.delegateAuth)},null,false,null)`);assert.equal(privateDenied.sqlstate,'42501');
  });
  await group(5,async()=>{
   await deny(execute(updateGrant,{...updated.command,operationId:next()}),'attendance_version_conflict');
   const context=assignContext.context,blocking=assignmentCommand(context,p.groupA,p.workerA);await legacy(lq(p.groupA,p.workerA),blocking);
   await deny(execute(assignGrant,{...assigned.command,operationId:next()}),'attendance_group_overlap');
   const future=await grant('group_save',groupScope(p.groupA),{validFrom:profile.until,validUntil:profile.futureUntil});await deny(execute(future),'attendance_access_denied');
   await foundation(fq,{action:'revoke',operationId:next(),grantId:updateGrant,expectedRevision:1,reason:'Synthetic204 actual revoke'});
   assert.deepEqual((await recover(updateGrant,updated.command)).receipt,updated.result.receipt);await deny(execute(updateGrant),'attendance_access_denied');
  });
  await group(6,async()=>{
   const branch=await save('dg204_epochs');await status(p.delegate,'disabled');await status(p.employeeA,'disabled');
   const epochs=JSON.parse(await step('actual204_two_paused_generations',`select jsonb_agg(jsonb_build_object('employeeId',employee_id,'generation',generation,'paused',paused,'suspensionId',suspension_id) order by employee_id) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id in(${quote(p.delegate)},${quote(p.employeeA)});`));
   assert.equal(epochs.length,2);assert(epochs.every(e=>e.generation===1&&e.paused&&e.suspensionId));await status(p.delegate,'active');await status(p.employeeA,'active');
   for(const [employeeId,authUserId,workerId]of[[p.delegate,p.delegateAuth,null],[p.employeeA,p.authA,p.workerA]]){
    const epoch=epochs.find(e=>e.employeeId===employeeId),query={siteId,mode:'detail',afterId:null,suspensionId:epoch.suspensionId,operationId:null};
    const prepared=await ok('actual164_restore_prepare',`public.faolla_attendance_account_suspensions_v1(${json(query)},${owner},null,true)`);assert(prepared.detail.canRestore);
    const command={action:'restore',operationId:next(),suspensionId:epoch.suspensionId,expectedGeneration:1,workerId,expectedWorkerVersion:prepared.detail.workerVersion,
     expectedEmployeeVersion:prepared.detail.employeeVersion,employeeId,employeeAuthUserId:authUserId,reason:'Synthetic204 explicit same identity restore'};
    await ok('actual164_restore',`public.faolla_attendance_account_suspensions_v1(${json(query)},${owner},${json(command)},true)`,{write:true});
   }
   const current=await foundation(fd(assignGrant));assert.equal(current.item.authorityCurrent,false);assert.equal(current.item.delegate.generation,0);assert.equal(current.item.targetGeneration,0);
   await deny(execute(assignGrant,{...assigned.command,operationId:next()}),'attendance_access_denied');assert.deepEqual((await recover(assignGrant,assigned.command)).receipt,assigned.result.receipt);
   await step('restored_generations_do_not_rewrite_old_grants',`do $dg204_epochs$ begin assert (select count(*) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id in(${quote(p.delegate)},${quote(p.employeeA)}) and generation=1 and not paused)=2;end;$dg204_epochs$;select 1;`);
   await restore('dg204_epochs',branch);
  });
  await group(7,async()=>{
   const freshGrant=await grant('group_save',groupScope(p.createdGroup)),command=groupCommand(p.createdGroup,2,'Synthetic204 atomic retry');
   const beforeCatalog=await step('fault_catalog_before','select '+managementAuditNativeCatalogSql(d.owned.oid)+';'),branch=await save('dg204_fault');
   await step('new_owned_only_AFTER_fault',delegatedGroupsNativeFaultSql(command.operationId));await deny(execute(freshGrant,command),'attendance_unavailable');assert.equal(lastRpc.error,'synthetic204_late_sidecar_failure');
   assert.equal((await recover(freshGrant,command)).receipt,null);await restore('dg204_fault',branch);
   await step('fault_objects_exactly_rolled_back',`do $dg204_catalog$ begin assert to_regprocedure('public.synthetic204_owned_late_group_fault_v1()') is null;
    assert ${managementAuditNativeCatalogSql(d.owned.oid)}=${quote(beforeCatalog)};end;$dg204_catalog$;select 1;`);
   assert.equal((await execute(freshGrant,command)).receipt.revision,3);
   const privateDenied=await call('private204_core_anon_denied',`public.faolla_attendance_groups_core_v2(${json(lq())},${quote(p.delegateAuth)},null,false,null)`,{role:'anon'});assert.equal(privateDenied.sqlstate,'42501');
   await step('append_only_and_no_clock_source_side_effects',`do $dg204_immutable$ declare denied boolean:=false;begin
    begin update public.merchant_attendance_group_operations set snapshot=snapshot where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    denied:=false;begin update public.merchant_attendance_management_delegation_operations set business_revision=business_revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    assert ${raw}=${quote(rawBaseline)},'dg204_clock_or_source_side_effect';${preserve}${external}end;$dg204_immutable$;select 1;`);
  });
  assert.equal(groups.length,8);assert(rpcs<=90&&steps<140);await step('rollback','rollback;');rolledBack=true;
  return{phase:204,groups,steps,rpcs,reads,writes,rejections,seedRows:9,newSite:siteId,actualNodeCoordinator:true,actualOwnerGrants:true,
   actualOwnerFourWrites:true,actualDelegatedFourWrites:true,actualActorBusinessAndSidecar:true,actualDualGenerations:true,receiptOnlyRecovery:true,
   lateAtomicFailure:true,rollbackRestored:true,noClockSourceSideEffects:true,realAuth:false,browser:false,production:false,
   missingCoverage:['Actual Auth/browser UI and settings-lock race are not claimed by this rollback-only fixture']};
 }catch(error){throw new Error('delegated_groups_native_stage:'+stage+':steps='+steps+':rpcs='+rpcs+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc));}
 finally{try{if(!rolledBack)await connection.step(scope.sql('rollback;'));}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline,'dg204_full_rollback_facts');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
}
