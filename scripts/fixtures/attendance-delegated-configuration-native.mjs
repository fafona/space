//205 INERT: eight finite production-Node/actual-RPC groups, one ROLLBACK.
//Only7 explicitly synthetic identity rows. Business config, employment, grants,
//suspension epochs and restores are produced by their actual public RPCs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {managementAuditNativeCatalogSql} from './attendance-management-audit-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(205600000+n);
export const delegatedConfigurationNativeSite='99990205';
export const delegatedConfigurationNativeIds=Object.freeze({role:uid(1),plainRole:uid(2),delegate:uid(3),delegateAuth:uid(4),plainDelegate:uid(5),plainAuth:uid(6),
 employeeA:uid(7),authA:uid(8),employeeB:uid(9),authB:uid(10),workerA:uid(11),workerNew:uid(12),locationA:uid(13),locationB:uid(14),locationNew:uid(15),terminal:uid(16)});
export const delegatedConfigurationNativeGroupBudgets=Object.freeze([
 ['legacy_NULL_owner_four_writes_and_bounded_views',9,13],['actual202_two_scoped_create_grants_and_default_off',7,9],
 ['production_Node_four_delegated_writes_and_original_receipts',15,17],['three_identities_locations_other_action_and_private_core_denials',14,16],
 ['global_CAS_one_use_create_same_number_and_old_owner_collision',8,10],['actual_revoke_future_validity_and_original_actor_recovery',8,10],
 ['actual_delegate_target_epochs_disable_restore_do_not_revive_grants',15,22],['late23514_atomic_retry_appendonly_settings_off_original_recovery',12,20],
].map(([name,rpcs,steps])=>Object.freeze({name,rpcs,steps})));
export function delegatedConfigurationNativeRpcExpression(name,args){
 assert(['faolla_attendance_delegated_config_v1','faolla_attendance_management_delegations_v1','faolla_attendance_admin_v1'].includes(name));
 if(name==='faolla_attendance_admin_v1'){
  assert.deepEqual(Object.keys(args).sort(),['p_site_id','p_auth_user_id','p_query','p_command','p_operation_id'].sort());assert.match(args.p_site_id,/^9999[0-9]{4}$/);assert.match(args.p_auth_user_id,/^[a-f0-9-]{36}$/);
  return `public.${name}(${quote(args.p_site_id)},${quote(args.p_auth_user_id)},${json(args.p_query)},${json(args.p_command)},${args.p_operation_id===null?'null':quote(args.p_operation_id)})`;
 }
 const flag=name==='faolla_attendance_management_delegations_v1'?'p_allow_grant':'p_allow_write';
 assert.deepEqual(Object.keys(args).sort(),['p_query','p_auth_user_id','p_command',flag].sort());assert.equal(typeof args[flag],'boolean');
 assert.match(args.p_query.siteId,/^9999[0-9]{4}$/);assert.match(args.p_auth_user_id,/^[a-f0-9-]{36}$/);
 return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args[flag]})`;
}
export function delegatedConfigurationNativeFaultSql(operationId,site=delegatedConfigurationNativeSite){
 assert.match(operationId,/^[a-f0-9-]{36}$/);assert.equal(site,delegatedConfigurationNativeSite);
 return `create function public.synthetic205_owned_late_config_fault_v1() returns trigger language plpgsql set search_path=pg_catalog as $owned205_fault$
 begin if new.merchant_id=${quote(site)} and new.operation_id=${quote(operationId)} then raise exception using errcode='23514',message='synthetic205_late_sidecar_failure',constraint='synthetic205_owned_late_config_fault';end if;return new;end;$owned205_fault$;
 create trigger synthetic205_owned_late_config_fault after insert on public.merchant_attendance_management_delegation_operations
 for each row execute function public.synthetic205_owned_late_config_fault_v1();select 1;`;
}
export async function verifyDelegatedConfigurationNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {executeManagementDelegation}=require('../../src/lib/merchantAttendanceManagementDelegation.server.ts');
 const {createDelegatedConfigurationService}=require('../../src/lib/merchantAttendanceDelegatedConfiguration.server.ts');
 const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
 const {delegatedConfigurationCommandFingerprint}=require('../../src/lib/merchantAttendanceDelegatedConfiguration.ts');
 const p=delegatedConfigurationNativeIds,siteId=delegatedConfigurationNativeSite,site=quote(siteId),owner=quote(d.owner),names=d.inventory();
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const all=outageNativeFingerprintSql(names),prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 const originalRows=`(select jsonb_object_agg(n,rows) from(${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${n} x) rows`).join(' union all ')}) original_rows)`;
 const preserve=names.map(n=>`assert not exists(select previous.value from jsonb_array_elements(current_setting('faolla.dc205_originals')::jsonb->${quote(n)}) previous(value) except select to_jsonb(x) from public.${n} x),'dc205_old_row_changed:${n}';`).join('\n');
 const external=names.map(n=>`assert not exists(select to_jsonb(x) from public.${n} x where coalesce(to_jsonb(x)->>'merchant_id',case when ${quote(n)}='merchants' then to_jsonb(x)->>'id' end,'')<>${site}
 except select previous.value from jsonb_array_elements(current_setting('faolla.dc205_originals')::jsonb->${quote(n)}) previous(value)),'dc205_external_scope_added:${n}';`).join('\n');
 const rawNames=names.filter(n=>/merchant_attendance_(?:events|correction_|missing_|leave_|work_arrangement_|period_|schedule_|shift_|plan_|calendar_|outage_)/.test(n));assert(rawNames.length>10);
 const raw=outageNativeFingerprintSql(rawNames),business=['merchant_attendance_settings','merchant_attendance_config_operations','merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_employment_periods'];
 let rawBaseline,steps=0,rpcs=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,rolledBack=false,profile;
 const groups=[],next=()=>uid(++serial);
 const step=async(label,sql)=>{stage=label;assert(++steps<=140,'dc205_max140_SQLsteps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const call=async(label,expression,{write=false,replay=false,prepare='',role='service_role',allowed=null}={})=>{
  assert(++rpcs<=90,'dc205_max90_RPCs');const outside=allowed===null?null:outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)));
  const r=JSON.parse(await step(label,`do $dc205_call$ declare old_hash text;outside_hash text;value jsonb;prepared_command jsonb;failure text;state_code text;context_text text;constraint_text text;begin
   old_hash:=${all};${outside?'outside_hash:='+outside+';':''}${prepare}begin set local role ${role};assert current_user=${quote(role)};value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context,constraint_text=constraint_name;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=old_hash,'dc205_read_rejection_replay_wrote';end if;
   ${outside?'assert '+outside+"=outside_hash,'dc205_unrelated_table_changed';":''}${preserve}${external}
   perform set_config('faolla.dc205_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text,'constraint',constraint_text)::text,true);
  end;$dc205_call$;select current_setting('faolla.dc205_result')::jsonb;`));
  lastRpc={error:r.error??r.value?.error??null,sqlstate:r.sqlstate,constraint:r.constraint,context:r.context?.slice(0,6000)??null,kind:r.value?.kind??null,protocol:r.value?.protocol??null};
  if(lastRpc.error)rejections++;else if(write&&!replay)writes++;else reads++;return r;
 };
 const service={rpc:async(name,args)=>{
  const allowed=name==='faolla_attendance_admin_v1'?business:name==='faolla_attendance_delegated_config_v1'?[...business,'merchant_attendance_management_delegation_operations']:
   ['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'];
  const r=await call('actual_'+name+'_'+(args.p_command?.kind??args.p_command?.action??args.p_query.mode??args.p_query.view),delegatedConfigurationNativeRpcExpression(name,args),{write:args.p_command!==null,allowed});
  return{data:r.value,error:r.error?{message:r.error}:null};
 }};
 const node=createDelegatedConfigurationService(service,{enabled:s=>s===siteId}),offNode=createDelegatedConfigurationService(service,{enabled:()=>false});
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(lastRpc));assert(!r.value?.error,JSON.stringify(lastRpc));return r.value;};
 const deny=async(promise,code)=>assert.rejects(promise,e=>e?.code===code||e?.message===code);
 const group=async(index,run)=>{const beforeRpcs=rpcs,beforeSteps=steps;await run();const spec=delegatedConfigurationNativeGroupBudgets[index],actual={name:spec.name,rpcs:rpcs-beforeRpcs,steps:steps-beforeSteps};
  assert(actual.rpcs<=spec.rpcs&&actual.steps<=spec.steps,'dc205_group_budget:'+JSON.stringify(actual));groups.push(actual);native.pass('205 group'+(index+1)+' '+JSON.stringify(actual));};
 const save=async label=>{assert(/^[a-z0-9_]+$/.test(label));return step('save_'+label,`savepoint ${label};select ${all};`);};
 const restore=async(label,hash)=>assert.equal(await step('restore_'+label,`rollback to savepoint ${label};release savepoint ${label};select ${all};`),hash,'dc205_savepoint_not_exact');
 const q=grantId=>({siteId,grantId,mode:'context',operationId:null}),rq=(grantId,operationId)=>({siteId,grantId,mode:'recover',operationId});
 const execute=(grantId,command=null,actor=p.delegateAuth,allowWrite=true)=>node.execute({query:q(grantId),command,authUserId:actor,allowWrite});
 const recover=(grantId,command,actor=p.delegateAuth)=>node.recover({query:rq(grantId,command.operationId),expectedCommand:command,authUserId:actor});
 const fq={siteId,mode:'write'},fd=grantId=>({siteId,mode:'detail',grantId});
 const foundation=(query,command=null,actor=d.owner,allowGrant=true)=>executeManagementDelegation({query,command,authUserId:actor,allowGrant},service);
 const workerScope=(workerId=p.workerA,employeeId=p.employeeA,authUserId=p.authA,create=false)=>({kind:'worker',create,workerId,employeeId,employeeAuthUserId:authUserId,locationIds:[p.locationA]});
 const locationScope=(locationId,create=false)=>({kind:'location',locationId,create});
 const grant=async(action,scopeValue,patch={})=>{const command={action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,delegatedAction:action,scope:scopeValue,
  validFrom:profile.from,validUntil:profile.until,reason:'Synthetic205 explicit scoped configuration authority',...patch};const result=await foundation(fq,command);assert.equal(result.receipt.grantId,command.operationId);return command.operationId;};
 const location=(locationId,name='Synthetic205 location')=>({id:locationId,name,timeZone:'UTC',active:true});
 const worker=(workerId,employeeId,locationId,displayName='Synthetic205 worker')=>({id:workerId,employeeId,workerNo:'SYNTHETIC205-'+(workerId===p.workerA?'A':'NEW'),displayName,locationId,active:true,startsOn:'2000-01-01'});
 const command=(kind,values,expectedVersion)=>({kind,values,operationId:next(),expectedVersion});
 let version=0,ownerCollision,createLocationGrant,createWorkerGrant,workerAGrant,otherGrant,locationUpdateGrant,workerUpdateGrant,locationContext,createdLocation,updatedLocation,createdWorker,updatedWorker;
 const legacy=async(c=null,view='settings',actor=d.owner)=>{const result=await executeAttendanceAdmin({siteId,view,cursor:null,search:'',operationId:null,command:c,authUserId:actor},service);version=result.version;return result;};
 const status=(employeeId,value)=>ok('actual_employee_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(employeeId)},
  'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(employeeId)}),'actor_type','owner','actor_id',${owner},'status',${quote(value)},'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $dc205_begin$ begin assert current_user='postgres';assert not exists(select 1 from public.merchants where id=${site});
   assert to_regprocedure('public.synthetic205_owned_late_config_fault_v1()') is null;perform set_config('faolla.dc205_originals',${originalRows}::text,true);end;$dc205_begin$;select 1;`);
  await group(0,async()=>{
   profile=JSON.parse(await step('seven_explicit_synthetic_identity_role_rows',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic205 configuration','synthetic205@example.test');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
    (${quote(p.role)},${site},'Synthetic205 explicit configuration',array['enterprise.view','attendance.workers.manage','attendance.locations.manage','attendance.terminals.pair']),
    (${quote(p.plainRole)},${site},'Synthetic205 no configuration authority',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
    ${[['delegate','delegateAuth','role'],['plainDelegate','plainAuth','plainRole'],['employeeA','authA','plainRole'],['employeeB','authB','plainRole']].map(([e,a,r],i)=>`(${quote(p[e])},${site},${quote(p[a])},'synthetic205-${i}@example.test','Synthetic205 member ${i}',${quote(p[r])},'active',clock_timestamp(),1)`).join(',')};
    select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'futureUntil',to_char((clock_timestamp()+interval '2 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`));
   rawBaseline=await step('raw_source_baseline','select '+raw+';');
   await legacy(command('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false},version));
   for(const locationId of[p.locationA,p.locationB])await legacy(command('location',location(locationId),version));
   await legacy(command('worker',worker(p.workerA,p.employeeA,p.locationA),version));
   ownerCollision=command('location',location(p.locationA,'Synthetic205 owner renamed'),version);await legacy(ownerCollision);
   await legacy(command('worker',worker(p.workerA,p.employeeA,p.locationA,'Synthetic205 owner worker update'),version));
   assert.equal((await legacy()).view,'settings');assert.equal((await legacy(null,'workers')).items.length,1);assert.equal((await legacy(null,'locations')).items.length,2);
  });
  await group(1,async()=>{
   createLocationGrant=await grant('location_save',locationScope(p.locationNew,true));createWorkerGrant=await grant('worker_save',workerScope(p.workerNew,p.employeeB,p.authB,true));workerAGrant=await grant('worker_save',workerScope());
   otherGrant=await grant('terminal_prepare',{kind:'terminal',terminalId:p.terminal,locationId:p.locationA,create:true});
   locationContext=await execute(createLocationGrant);assert.equal(locationContext.context.targetVersion,null);assert.deepEqual(locationContext.context.locations,[]);
   const target=await execute(createWorkerGrant);assert.equal(target.context.worker,null);assert.equal(target.context.employee.id,p.employeeB);assert.deepEqual(target.context.locations.map(x=>x.id),[p.locationA]);
   await deny(offNode.execute({query:q(createLocationGrant),command:command('location',location(p.locationNew),version),authUserId:p.delegateAuth,allowWrite:true}),'attendance_delegated_configuration_disabled');
  });
  await group(2,async()=>{
   const c=command('location',location(p.locationNew),locationContext.context.settingsVersion);createdLocation={command:c,result:await execute(createLocationGrant,c)};assert.equal(createdLocation.result.receipt.actorId,p.delegateAuth);
   locationUpdateGrant=await grant('location_save',locationScope(p.locationNew));const lc=await execute(locationUpdateGrant),l=command('location',location(p.locationNew,'Synthetic205 delegated location update'),lc.context.settingsVersion);
   updatedLocation={command:l,result:await execute(locationUpdateGrant,l)};assert.equal(lc.context.targetVersion,1);
   const wc=await execute(createWorkerGrant),w=command('worker',worker(p.workerNew,p.employeeB,p.locationA),wc.context.settingsVersion);createdWorker={command:w,result:await execute(createWorkerGrant,w)};
   workerUpdateGrant=await grant('worker_save',workerScope(p.workerNew,p.employeeB,p.authB));const uc=await execute(workerUpdateGrant),u=command('worker',worker(p.workerNew,p.employeeB,p.locationA,'Synthetic205 delegated worker update'),uc.context.settingsVersion);
   updatedWorker={command:u,result:await execute(workerUpdateGrant,u)};version=updatedWorker.result.receipt.revision;assert.equal(uc.context.targetVersion,1);
   assert.deepEqual((await recover(createWorkerGrant,w)).receipt,createdWorker.result.receipt);assert.deepEqual((await recover(locationUpdateGrant,l)).receipt,updatedLocation.result.receipt);
   assert.equal(updatedWorker.result.receipt.commandFingerprint,await delegatedConfigurationCommandFingerprint(q(workerUpdateGrant),p.delegateAuth,u));
   await step('actual_same_actor_old_configop_and_authority_proofs',`do $dc205_proof$ declare authority public.merchant_attendance_management_delegation_operations%rowtype;begin
    assert (select count(*) from public.merchant_attendance_management_delegation_operations where merchant_id=${site})=4;
    for authority in select * from public.merchant_attendance_management_delegation_operations where merchant_id=${site} loop
     assert authority.actor_auth_user_id=${quote(p.delegateAuth)} and authority.delegate_employee_id=${quote(p.delegate)} and authority.delegate_generation=0;
     assert exists(select 1 from public.merchant_attendance_config_operations actual where actual.merchant_id=${site} and actual.operation_id=authority.operation_id and actual.actor_auth_user_id=authority.actor_auth_user_id and actual.version=authority.business_revision);
     perform public.faolla_attendance_delegated_config_operation_v1(authority,false);end loop;
    assert (select count(*) from public.merchant_attendance_employment_periods where merchant_id=${site} and worker_id=${quote(p.workerNew)} and starts_on=date '2000-01-01' and ends_on is null)=1;
   end;$dc205_proof$;select 1;`);
  });
  await group(3,async()=>{
   const fresh=()=>command('worker',worker(p.workerA,p.employeeA,p.locationA),version);
   await deny(execute(workerAGrant,fresh(),p.plainAuth),'attendance_access_denied');
   await deny(execute(workerAGrant,{...fresh(),values:worker(p.workerA,p.employeeB,p.locationA)}),'attendance_access_denied');
   await deny(execute(workerAGrant,{...fresh(),values:worker(p.workerA,p.employeeA,p.locationB)}),'attendance_access_denied');
   await deny(execute(workerAGrant,{...fresh(),values:worker(p.workerNew,p.employeeA,p.locationA)}),'attendance_access_denied');
   await deny(grant('worker_save',{...workerScope(),employeeAuthUserId:p.authB}),'attendance_management_delegation_scope_invalid');
   await deny(execute(otherGrant),'attendance_access_denied');
   await deny(node.execute({query:{...q(workerAGrant),siteId:d.site},command:null,authUserId:p.delegateAuth,allowWrite:false}),'attendance_access_denied');
   const core=`public.faolla_attendance_admin_core_v2(${site},${quote(p.delegateAuth)},'{"view":"workers","cursor":null,"search":""}'::jsonb,null,null,null)`;
   for(const role of['service_role','anon'])assert.equal((await call('private205_core_'+role,core,{role})).sqlstate,'42501');
  });
  await group(4,async()=>{
   assert.deepEqual((await execute(createLocationGrant,createdLocation.command,p.delegateAuth,false)).receipt,createdLocation.result.receipt);
   await deny(execute(createLocationGrant),'attendance_access_denied');
   await deny(execute(createLocationGrant,command('location',location(p.locationNew),version)),'attendance_access_denied');
   await deny(execute(workerUpdateGrant,{...updatedWorker.command,operationId:next()}),'attendance_version_conflict');
   const conflicting={...updatedLocation.command,values:location(p.locationNew,'Synthetic205 conflicting original')};
   assert.equal((await call('exact205_same_operation_different_body',delegatedConfigurationNativeRpcExpression('faolla_attendance_delegated_config_v1',{p_query:q(locationUpdateGrant),p_auth_user_id:p.delegateAuth,p_command:conflicting,p_allow_write:false}))).error,'attendance_operation_conflict');
   assert.equal((await call('old_owner_operation_is_never_retro_authorized',delegatedConfigurationNativeRpcExpression('faolla_attendance_delegated_config_v1',{p_query:q(workerAGrant),p_auth_user_id:p.delegateAuth,p_command:{...command('worker',worker(p.workerA,p.employeeA,p.locationA),version),operationId:ownerCollision.operationId},p_allow_write:true}))).error,'attendance_operation_conflict');
  });
  await group(5,async()=>{
   await foundation(fq,{action:'revoke',operationId:next(),grantId:locationUpdateGrant,expectedRevision:1,reason:'Synthetic205 actual revoke'});
   await deny(execute(locationUpdateGrant,command('location',location(p.locationNew),version)),'attendance_access_denied');
   assert.deepEqual((await recover(locationUpdateGrant,updatedLocation.command)).receipt,updatedLocation.result.receipt);
   const future=await grant('worker_save',workerScope(),{validFrom:profile.until,validUntil:profile.futureUntil});await deny(execute(future),'attendance_access_denied');
   const unknown=await node.readReceipt({query:rq(workerUpdateGrant,updatedWorker.command.operationId),authUserId:p.plainAuth});assert.equal(unknown.receipt,null);
  });
  await group(6,async()=>{
   const branch=await save('dc205_epochs');await status(p.delegate,'disabled');await status(p.employeeB,'disabled');
   const epochs=JSON.parse(await step('actual205_two_paused_generations',`select jsonb_agg(jsonb_build_object('employeeId',employee_id,'generation',generation,'paused',paused,'suspensionId',suspension_id) order by employee_id) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id in(${quote(p.delegate)},${quote(p.employeeB)});`));
   assert.equal(epochs.length,2);assert(epochs.every(e=>e.generation===1&&e.paused&&e.suspensionId));
   await deny(execute(workerUpdateGrant,{...updatedWorker.command,operationId:next()}),'attendance_access_denied');assert.deepEqual((await recover(workerUpdateGrant,updatedWorker.command)).receipt,updatedWorker.result.receipt);
   await status(p.delegate,'active');await status(p.employeeB,'active');
   for(const [employeeId,authUserId,workerId]of[[p.delegate,p.delegateAuth,null],[p.employeeB,p.authB,p.workerNew]]){
    const epoch=epochs.find(e=>e.employeeId===employeeId),query={siteId,mode:'detail',afterId:null,suspensionId:epoch.suspensionId,operationId:null};
    const prepared=await ok('actual164_restore_prepare',`public.faolla_attendance_account_suspensions_v1(${json(query)},${owner},null,true)`);assert(prepared.detail.canRestore);
    const c={action:'restore',operationId:next(),suspensionId:epoch.suspensionId,expectedGeneration:1,workerId,expectedWorkerVersion:prepared.detail.workerVersion,
     expectedEmployeeVersion:prepared.detail.employeeVersion,employeeId,employeeAuthUserId:authUserId,reason:'Synthetic205 explicit same identity restore'};
    await ok('actual164_restore',`public.faolla_attendance_account_suspensions_v1(${json(query)},${owner},${json(c)},true)`,{write:true});
   }
   await deny(execute(workerUpdateGrant,{...updatedWorker.command,operationId:next()}),'attendance_access_denied');assert.deepEqual((await recover(workerUpdateGrant,updatedWorker.command)).receipt,updatedWorker.result.receipt);
   const current=await foundation(fd(workerUpdateGrant));assert.equal(current.item.authorityCurrent,false);assert.equal(current.item.delegate.generation,0);assert.equal(current.item.targetGeneration,0);
   await step('restored_epoch_proof',`do $dc205_epochs$ begin assert (select count(*) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id in(${quote(p.delegate)},${quote(p.employeeB)}) and generation=1 and not paused)=2;end;$dc205_epochs$;select 1;`);
   await restore('dc205_epochs',branch);
  });
  await group(7,async()=>{
   const freshGrant=await grant('location_save',locationScope(p.locationNew)),current=await execute(freshGrant),c=command('location',location(p.locationNew,'Synthetic205 atomic retry'),current.context.settingsVersion);
   const beforeCatalog=await step('fault_catalog_before','select '+managementAuditNativeCatalogSql(d.owned.oid)+';'),branch=await save('dc205_fault');
   await step('unique_owned_AFTER23514_fault',delegatedConfigurationNativeFaultSql(c.operationId));await deny(execute(freshGrant,c),'attendance_unavailable');
   assert.equal(lastRpc.error,'synthetic205_late_sidecar_failure');assert.equal(lastRpc.sqlstate,'23514');assert.equal(lastRpc.constraint,'synthetic205_owned_late_config_fault');
   assert.equal((await recover(freshGrant,c)).receipt,null);await restore('dc205_fault',branch);
   await step('fault_catalog_and_objects_exact_restored',`do $dc205_catalog$ begin assert to_regprocedure('public.synthetic205_owned_late_config_fault_v1()') is null;
    assert ${managementAuditNativeCatalogSql(d.owned.oid)}=${quote(beforeCatalog)};end;$dc205_catalog$;select 1;`);
   const retried=await execute(freshGrant,c);version=retried.receipt.revision;assert.equal(version,c.expectedVersion+1);
   await legacy(command('settings',{timeZone:'UTC',enabled:false,webClockEnabled:true,webBreakPaid:false},version));await deny(execute(freshGrant),'attendance_access_denied');
   assert.deepEqual((await recover(freshGrant,c)).receipt,retried.receipt);
   await step('appendonly_and_full_original_no_clock_side_effects',`do $dc205_immutable$ declare denied boolean:=false;begin
    begin update public.merchant_attendance_config_operations set after_value=after_value where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    denied:=false;begin update public.merchant_attendance_management_delegation_operations set business_revision=business_revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    assert ${raw}=${quote(rawBaseline)},'dc205_clock_or_source_side_effect';${preserve}${external}end;$dc205_immutable$;select 1;`);
  });
  assert.equal(groups.length,8);assert(rpcs<=90&&steps<140);await step('rollback','rollback;');rolledBack=true;
  return{phase:205,groups,steps,rpcs,reads,writes,rejections,seedRows:7,newSite:siteId,actualNodeCoordinator:true,actualOwnerGrants:true,actualOwnerFourWrites:true,actualDelegatedFourWrites:true,
   actualActorConfigAndSidecar:true,actualDualGenerations:true,receiptOnlyRecovery:true,late23514AtomicFailure:true,rollbackRestored:true,noClockSourceSideEffects:true,realAuth:false,browser:false,production:false,
   missingCoverage:['Actual Auth/browser UI, settings-lock race, expiry by passage of wall time and additional executor families are not claimed by this bounded rollback-only fixture']};
 }catch(error){throw new Error('delegated_configuration_native_stage:'+stage+':steps='+steps+':rpcs='+rpcs+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc));}
 finally{try{if(!rolledBack)await connection.step(scope.sql('rollback;'));}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline,'dc205_full_rollback_facts');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
}
