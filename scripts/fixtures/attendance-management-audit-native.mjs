//202→203 INERT. Eight finite groups, one existing-owned connection, ROLLBACK.
//Nine disclosed synthetic identity/role rows; all config/scope/grants/exports,
//employee suspension generations and same-identity restores use actual RPCs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(203600000+n);
export const managementAuditNativeSite='99990203';
export const managementAuditNativeIds=Object.freeze({role:uid(1),viewRole:uid(2),plainRole:uid(3),delegate:uid(4),delegateAuth:uid(5),
 viewDelegate:uid(6),viewAuth:uid(7),plainDelegate:uid(8),plainAuth:uid(9),employeeA:uid(10),authA:uid(11),employeeB:uid(12),authB:uid(13),
 workerA:uid(14),workerB:uid(15),locationA:uid(16),locationB:uid(17),newOwner:uid(18),scopeA:uid(19),scopeB:uid(20),scopeMixed:uid(21),scopeElsewhere:uid(22)});
export const managementAuditNativePermissions=Object.freeze({full:Object.freeze(['enterprise.view','attendance.records.view','attendance.audit.view','attendance.audit.export']),
 view:Object.freeze(['enterprise.view','attendance.audit.view']),plain:Object.freeze(['enterprise.view','attendance.self.view','attendance.self.clock'])});
export const managementAuditNativeGroups=Object.freeze([
 {name:'real064_066_sources_and_explicit_synthetic_identity',rpcs:12,steps:16},
 {name:'real202_grants_reads_exact_receipt_owner_and_flag_gates',rpcs:14,steps:16},
 {name:'actual203_company_worker_list_detail_Node_projection',rpcs:12,steps:14},
 {name:'actual_export_SHA_CSV_and_receipt_only_original_recovery',rpcs:10,steps:12},
 {name:'revoke_off_capability_and_canonical_owner_handover',rpcs:12,steps:18},
 {name:'actual_delegate_target_generations_restore_no_grant_revival',rpcs:12,steps:18},
 {name:'whole_resource_worker_location_mixed_cross_scope_refusals',rpcs:10,steps:14},
 {name:'late_atomic_sidecar_fault_rollback_not_yet_valid_and_append_only',rpcs:8,steps:14},
].map(Object.freeze));
export function managementAuditNativeRpcExpression(name,args){
 const flag=name==='faolla_attendance_management_delegations_v1'?'p_allow_grant':'p_allow_access';
 assert(['faolla_attendance_management_delegations_v1','faolla_attendance_delegated_audit_v1'].includes(name),'management_audit_RPC_allowlist');
 assert.deepEqual(Object.keys(args).sort(),['p_query','p_auth_user_id','p_command',flag].sort());
 assert.equal(typeof args[flag],'boolean');assert.match(args.p_query.siteId,/^9999[0-9]{4}$/);
 assert.match(args.p_auth_user_id,/^[a-f0-9-]{36}$/);
 return `public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args[flag]})`;
}
export function managementAuditNativeFaultSql(operationId,site=managementAuditNativeSite){
 assert.match(operationId,/^[a-f0-9-]{36}$/);assert.equal(site,managementAuditNativeSite);
 //New, uniquely named test objects only, inside a savepoint. Real BEFORE guards
 //stay enabled/unmodified; failing AFTER sidecar insert rolls back the RPC.
 return `create function public.synthetic203_owned_late_export_fault_v1() returns trigger language plpgsql set search_path=pg_catalog as $owned203_fault$
 begin if new.merchant_id=${quote(site)} and new.operation_id=${quote(operationId)} then raise exception 'synthetic203_late_sidecar_failure';end if;return new;end;$owned203_fault$;
 create trigger synthetic203_owned_late_export_fault after insert on public.merchant_attendance_management_delegation_operations
 for each row execute function public.synthetic203_owned_late_export_fault_v1();select 1;`;
}
export function managementAuditNativeCatalogSql(schemaOid){
 assert(Number.isSafeInteger(schemaOid)&&schemaOid>0);
 return `(select md5(jsonb_build_object('functions',(select coalesce(jsonb_agg(jsonb_build_array(to_jsonb(proc),pg_get_functiondef(proc.oid)) order by proc.oid),'[]') from pg_proc proc where proc.pronamespace=${schemaOid} and proc.prokind='f'),
 'relations',(select coalesce(jsonb_agg(jsonb_build_array(catalog_table.oid,catalog_table.relname,catalog_table.relkind,catalog_table.relowner,catalog_table.relacl,catalog_table.relrowsecurity,catalog_table.relforcerowsecurity,
  (select jsonb_agg(to_jsonb(attribute) order by attribute.attnum) from pg_attribute attribute where attribute.attrelid=catalog_table.oid and attribute.attnum>0),
  (select jsonb_agg(to_jsonb(constraint_row) order by constraint_row.oid) from pg_constraint constraint_row where constraint_row.conrelid=catalog_table.oid),
  (select jsonb_agg(to_jsonb(trigger_row) order by trigger_row.oid) from pg_trigger trigger_row where trigger_row.tgrelid=catalog_table.oid),
  (select jsonb_agg(to_jsonb(index_row) order by index_row.indexrelid) from pg_index index_row where index_row.indrelid=catalog_table.oid)) order by catalog_table.oid),'[]')
  from pg_class catalog_table where catalog_table.relnamespace=${schemaOid}))::text))`;
}
export async function verifyManagementAuditNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'management_audit_synthetic_context');
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(d.owned.schema,scope.schema);
 const {executeManagementDelegation}=require('../../src/lib/merchantAttendanceManagementDelegation.server.ts');
 const {executeDelegatedAudit}=require('../../src/lib/merchantAttendanceDelegatedAudit.server.ts');
 const {buildDelegatedAuditCsv,delegatedAuditCommandFingerprint}=require('../../src/lib/merchantAttendanceDelegatedAudit.ts');
 const p=managementAuditNativeIds,siteId=managementAuditNativeSite,site=quote(siteId),owner=quote(d.owner),names=d.inventory();
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const all=outageNativeFingerprintSql(names),prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 const originals=`(select jsonb_object_agg(n,rows) from (${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${n} x) rows`).join(' union all ')}) original_rows)`;
 const preserve=names.map(n=>`assert not exists(select prior.value from jsonb_array_elements(current_setting('faolla.ma203_originals')::jsonb->${quote(n)}) prior(value) except select to_jsonb(x) from public.${n} x),'ma203_old_row_changed:${n}';`).join('\n');
 //Any new row in any table must belong to the one newly owned synthetic site.
 const external=names.map(n=>`assert not exists(select to_jsonb(x) from public.${n} x where coalesce(to_jsonb(x)->>'merchant_id',case when ${quote(n)}='merchants' then to_jsonb(x)->>'id' end,'')<>${site}
 except select prior.value from jsonb_array_elements(current_setting('faolla.ma203_originals')::jsonb->${quote(n)}) prior(value)),'ma203_other_scope_added:${n}';`).join('\n');
 let steps=0,rpcs=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,rolledBack=false,replayOnly=false,profile;
 const groups=[],next=()=>uid(++serial);
 const step=async(label,sql)=>{stage=label;assert(++steps<=140,'management_audit140_SQLsteps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const call=async(label,expression,{write=false,replay=false,prepare=''}={})=>{
  assert(++rpcs<=90,'management_audit90_actualRPCs');
  const result=JSON.parse(await step(label,`do $ma203_call$ declare before_hash text;value jsonb;prepared_command jsonb;failure text;state_code text;context_text text;begin
   before_hash:=${all};${prepare}begin set local role service_role;assert current_user='service_role';value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=before_hash,'ma203_read_reject_replay_changed_facts';end if;
   ${preserve}${external}perform set_config('faolla.ma203_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text)::text,true);
  end;$ma203_call$;select current_setting('faolla.ma203_result')::jsonb;`));
  lastRpc={error:result.error,sqlstate:result.sqlstate,context:result.context,kind:result.value?.kind,protocol:result.value?.protocol};
  if(result.error||result.value?.error)rejections++;else if(write&&!replay)writes++;else reads++;return result;
 };
 const service={rpc:async(name,args)=>{const result=await call('actual_'+name+'_'+(args.p_command?.action??args.p_query.mode),managementAuditNativeRpcExpression(name,args),{write:!!args.p_command,replay:replayOnly});
  return {data:result.value,error:result.error?{message:result.error}:null};}};
 const ok=async(label,expression,options)=>{const result=await call(label,expression,options);assert.equal(result.error,null,JSON.stringify(lastRpc));assert(!result.value?.error,JSON.stringify(lastRpc));return result.value;};
 const rejected=async(action,code)=>{const before=rpcs;await assert.rejects(action,error=>error?.code===code||error?.message===code);assert.equal(rpcs,before+1,'ma203_rejection_must_reach_actual_RPC');};
 const save=async label=>{assert(/^[a-z0-9_]+$/.test(label));return step('save_'+label,`savepoint ${label};select ${all};`);};
 const restore=async(label,hash)=>assert.equal(await step('restore_'+label,`rollback to savepoint ${label};release savepoint ${label};select ${all};`),hash);
 const group=async(index,run)=>{const startRpc=rpcs,startSteps=steps;await run();const spec=managementAuditNativeGroups[index];
  assert(rpcs-startRpc<=spec.rpcs,'ma203_group_RPC_budget:'+spec.name);assert(steps-startSteps<=spec.steps,'ma203_group_SQL_budget:'+spec.name);
  groups.push({name:spec.name,rpcs:rpcs-startRpc,steps:steps-startSteps});};
 const foundation=(query,command=null,allowGrant=true,authUserId=d.owner)=>executeManagementDelegation({query,command,allowGrant,authUserId},service);
 const audit=(query,command=null,allowAccess=true,authUserId=p.delegateAuth)=>executeDelegatedAudit({query,command,allowAccess,authUserId},service);
 const fq={siteId,mode:'write'},fl={siteId,mode:'list',afterId:null,state:'all',delegatedAction:null},fd=grantId=>({siteId,mode:'detail',grantId});
 const company={kind:'audit_company',sources:['config','management']},worker={kind:'audit_worker',workerId:p.workerA,employeeId:p.employeeA,employeeAuthUserId:p.authA,locationIds:[p.locationA],sources:['config','management','scope']};
 const grant=(delegatedAction,scopeValue,patch={})=>({action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,delegatedAction,
  scope:scopeValue,validFrom:profile.from,validUntil:profile.until,reason:'Synthetic203 explicit owner resource grant',...patch});
 const list=(grantId,source='config',patch={})=>({siteId,grantId,mode:'list',source,fromAt:profile.from,toAt:profile.until,asOf:null,cursorAt:null,cursorId:null,...patch});
 const detail=(grantId,source,sourceOperationId)=>({siteId,grantId,mode:'detail',source,sourceOperationId});
 const exportQ=(grantId,source='config')=>({siteId,grantId,mode:'export',source,fromAt:profile.from,toAt:profile.until});
 const recover=operationId=>({siteId,mode:'recover',operationId});
 const admin=async(kind,values)=>{const operationId=next();await ok('actual064_'+kind,`public.faolla_attendance_admin_v1(${site},${owner},'{"view":"workers","cursor":null,"search":""}'::jsonb,prepared_command,null)`,{write:true,
  prepare:`prepared_command:=jsonb_build_object('kind',${quote(kind)},'operationId',${quote(operationId)},'expectedVersion',coalesce((select version from public.merchant_attendance_settings where merchant_id=${site}),0),'values',${json(values)});`});return operationId;};
 const workerValues=(which,locationId=which==='A'?p.locationA:p.locationB)=>({id:p['worker'+which],employeeId:p['employee'+which],workerNo:'SYNTHETIC203-'+which,
  displayName:'Synthetic203 actual worker '+which,locationId,active:true,startsOn:'2000-01-01'});
 const scopes=async(grantId,workerIds,locationIds)=>{const operationId=next();await ok('actual066_scope_put',`public.faolla_attendance_scopes_v1(${site},${owner},${quote(p.delegate)},prepared_command,null)`,{write:true,
  prepare:`prepared_command:=jsonb_build_object('action','put','grantId',${quote(grantId)},'grant',${json({workerIds:workerIds.slice().sort(),locationIds:locationIds.slice().sort(),validFrom:profile.from3,validUntil:profile.until3})},
   'operationId',${quote(operationId)},'expectedRevision',coalesce((select revision from public.merchant_attendance_scopes where merchant_id=${site} and employee_id=${quote(p.delegate)}),0));`});return operationId;};
 const status=(employeeId,value)=>ok('actual_employee_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(employeeId)},
  'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(employeeId)}),'actor_type','owner','actor_id',${owner},'status',${quote(value)},
  'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 let sources,grants,exports;
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $ma203_begin$ begin assert current_user='postgres';
   assert not exists(select 1 from public.merchants where id=${site}),'ma203_unused_new_site';
   assert to_regprocedure('public.synthetic203_owned_late_export_fault_v1()') is null;
   assert exists(select 1 from public.faolla_schema_migrations where version=202610080203 and name='merchant_attendance_delegated_audit');
   perform set_config('faolla.ma203_originals',${originals}::text,true);end;$ma203_begin$;select 1;`);
  await group(0,async()=>{
   profile=JSON.parse(await step('nine_explicit_synthetic_identity_rows',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic203 management audit','synthetic203@example.test');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
     (${quote(p.role)},${site},'Synthetic203 explicit audit and records',array[${managementAuditNativePermissions.full.map(quote).join(',')}]),
     (${quote(p.viewRole)},${site},'Synthetic203 view only',array[${managementAuditNativePermissions.view.map(quote).join(',')}]),
     (${quote(p.plainRole)},${site},'Synthetic203 no audit capability',array[${managementAuditNativePermissions.plain.map(quote).join(',')}]);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
     ${[['delegate','delegateAuth','role'],['viewDelegate','viewAuth','viewRole'],['plainDelegate','plainAuth','plainRole'],['employeeA','authA','plainRole'],['employeeB','authB','plainRole']].map(([e,a,r],i)=>`(${quote(p[e])},${site},${quote(p[a])},'synthetic203-${i}@example.test','Synthetic203 member ${i}',${quote(p[r])},'active',clock_timestamp(),1)`).join(',')};
    do $ma203_roles$ begin assert (select user_id from public.merchants where id=${site})=${owner};
     assert not exists(select 1 from public.merchant_enterprise_roles where merchant_id=${site} and public.faolla_valid_merchant_enterprise_permissions_v1(permissions) is distinct from true);
     assert (select permissions from public.merchant_enterprise_roles where id=${quote(p.viewRole)})=array[${managementAuditNativePermissions.view.map(quote).join(',')}];
    end;$ma203_roles$;select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'futureUntil',to_char((clock_timestamp()+interval '2 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'from3',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
     'until3',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));`));
   const settings=await admin('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
   await admin('location',{id:p.locationA,name:'Synthetic203 location A',timeZone:'UTC',active:true});
   await admin('location',{id:p.locationB,name:'Synthetic203 location B',timeZone:'UTC',active:true});
   const workerA=await admin('worker',workerValues('A')),workerB=await admin('worker',workerValues('B'));
   const scopeA=await scopes(p.scopeA,[p.workerA],[p.locationA]),scopeB=await scopes(p.scopeB,[p.workerB],[p.locationB]),scopeMixed=await scopes(p.scopeMixed,[p.workerA,p.workerB],[p.locationA,p.locationB]);
   sources={settings,workerA,workerB,scopeA,scopeB,scopeMixed};
  });
  await group(1,async()=>{
   grants={};for(const [key,action,s] of [['companyView','audit_view',company],['companyExport','audit_export',company],['workerView','audit_view',worker],['workerExport','audit_export',worker]]){
    const command=grant(action,s),saved=await foundation(fq,command);assert.equal(saved.kind,'receipt');assert.equal(saved.receipt.grantId,command.operationId);grants[key]={command,receipt:saved.receipt};}
   const found=await foundation(fd(grants.workerView.command.operationId));assert(found.item.authorityCurrent);assert.equal(found.item.delegate.generation,0);assert.equal(found.item.targetGeneration,0);
   assert.equal((await foundation(fl)).items.length,4);
   replayOnly=true;try{assert.deepEqual((await foundation(fq,grants.workerView.command,false)).receipt,grants.workerView.receipt);}finally{replayOnly=false;}
   assert.deepEqual((await foundation(recover(grants.workerView.command.operationId),null,false)).receipt,grants.workerView.receipt);
   await rejected(()=>foundation(fq,grant('audit_view',company),true,p.delegateAuth),'attendance_access_denied');
   await rejected(()=>foundation(fq,grant('audit_view',company),false),'attendance_management_delegation_disabled');
   await rejected(()=>foundation(fq,grant('audit_view',company,{delegateEmployeeId:p.plainDelegate,delegateAuthUserId:p.plainAuth})),'attendance_management_delegation_scope_invalid');
   await rejected(()=>foundation(fq,{...grants.workerView.command,reason:'Different same operation body'}),'attendance_operation_conflict');
  });
  await group(2,async()=>{
   const cv=grants.companyView.command.operationId,wv=grants.workerView.command.operationId;
   const companyList=await audit(list(cv));assert.equal(companyList.items.length,5);assert(companyList.items.every(i=>i.byCurrentOwner));assert.equal(companyList.target,null);
   const workerList=await audit(list(wv));assert.deepEqual(workerList.items.map(i=>i.operationId),[sources.workerA]);assert.equal(workerList.target.employeeAuthUserId,p.authA);
   const scopeList=await audit(list(wv,'scope'));assert.deepEqual(scopeList.items.map(i=>i.operationId),[sources.scopeA]);
   const configDetail=await audit(detail(wv,'config',sources.workerA));assert.equal(configDetail.row.after.employeeId,p.employeeA);assert.equal(configDetail.row.before,null);
   const scopeDetail=await audit(detail(wv,'scope',sources.scopeA));assert.deepEqual(scopeDetail.row.after.workerIds,[p.workerA]);assert(scopeDetail.row.item.holderRef);assert(!JSON.stringify(scopeDetail).includes(p.delegate));
   assert.equal((await audit(detail(cv,'config',sources.settings))).row.item.kind,'settings');
   const management=await audit(list(wv,'management'));assert.equal(management.items.length,2);assert.equal((await audit(detail(wv,'management',wv))).row.item.kind,'management_grant');
  });
  await group(3,async()=>{
   exports={};for(const [key,grantKey,source] of [['company','companyExport','config'],['worker','workerExport','scope'],['management','workerExport','management']]){
    const query=exportQ(grants[grantKey].command.operationId,source),command={action:'export',operationId:next()},result=await audit(query,command);assert.equal(result.kind,'export');
    assert(result.payload.count>0);assert.equal(result.receipt.commandFingerprint,await delegatedAuditCommandFingerprint(query,p.delegateAuth,command));
    assert(!Object.hasOwn(result,'snapshotText'));const csv=await buildDelegatedAuditCsv(result,query,p.delegateAuth,command);assert(Buffer.byteLength(csv.csv,'utf8')<=2097152);assert(csv.csv.startsWith('\ufeff"schema"'));exports[key]={query,command,result};}
   const saved=exports.worker;replayOnly=true;try{const result=await audit(saved.query,saved.command,false);assert.equal(result.kind,'receipt');assert.deepEqual(result.receipt,saved.result.receipt);assert(!Object.hasOwn(result,'payload'));}finally{replayOnly=false;}
   assert.deepEqual((await audit(recover(saved.command.operationId),null,false)).receipt,saved.result.receipt);
   assert.equal((await audit(recover(saved.command.operationId),null,false,p.authA)).receipt,null);
   assert.equal((await audit({...recover(saved.command.operationId),siteId:d.site},null,false)).receipt,null);
   await rejected(()=>audit({...saved.query,source:'config'},saved.command,false),'attendance_operation_conflict');
  });
  await group(4,async()=>{
   const saved=exports.worker,branch=await save('ma203_revoked');
   await foundation(fq,{action:'revoke',operationId:next(),grantId:grants.workerExport.command.operationId,expectedRevision:1,reason:'Synthetic203 explicit revocation'},false);
   await rejected(()=>audit(saved.query,{action:'export',operationId:next()}),'attendance_access_denied');
   assert.deepEqual((await audit(recover(saved.command.operationId),null,false)).receipt,saved.result.receipt);
   replayOnly=true;try{assert.equal((await audit(saved.query,saved.command,false)).kind,'receipt');}finally{replayOnly=false;}
   await restore('ma203_revoked',branch);
   await rejected(()=>audit(exportQ(grants.companyExport.command.operationId),{action:'export',operationId:next()},false),'attendance_delegated_audit_disabled');
   const viewGrant=grant('audit_view',company,{delegateEmployeeId:p.viewDelegate,delegateAuthUserId:p.viewAuth});await foundation(fq,viewGrant);
   assert.equal((await audit(list(viewGrant.operationId),null,true,p.viewAuth)).kind,'list');
   await rejected(()=>foundation(fq,grant('audit_export',company,{delegateEmployeeId:p.viewDelegate,delegateAuthUserId:p.viewAuth})),'attendance_management_delegation_scope_invalid');
   await rejected(()=>audit(exportQ(viewGrant.operationId),{action:'export',operationId:next()},true,p.viewAuth),'attendance_access_denied');
   const handover=await save('ma203_handover');await step('synthetic_new_site_owner_handover',`update public.merchants set user_id=${quote(p.newOwner)} where id=${site};select 1;`);
   assert.deepEqual((await foundation(recover(grants.workerView.command.operationId),null,false)).receipt,grants.workerView.receipt);
   await rejected(()=>audit(list(grants.companyView.command.operationId)),'attendance_access_denied');
   replayOnly=true;try{assert.equal((await foundation(fq,grants.workerView.command,false)).kind,'receipt');}finally{replayOnly=false;}
   await restore('ma203_handover',handover);
  });
  await group(5,async()=>{
   const branch=await save('ma203_generation');await status(p.delegate,'disabled');await status(p.employeeA,'disabled');
   const epochs=JSON.parse(await step('actual_two_epoch_generations',`select jsonb_agg(jsonb_build_object('employee',employee_id,'generation',generation,'paused',paused,'suspensionId',suspension_id) order by employee_id)
    from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id in(${quote(p.delegate)},${quote(p.employeeA)});`));
   assert.equal(epochs.length,2);assert(epochs.every(e=>e.generation===1&&e.paused&&e.suspensionId));
   await rejected(()=>audit(list(grants.workerView.command.operationId)),'attendance_access_denied');
   assert.deepEqual((await audit(recover(exports.worker.command.operationId),null,false)).receipt,exports.worker.result.receipt);
   await status(p.delegate,'active');await status(p.employeeA,'active');
   for(const [employeeId,authUserId,workerId] of [[p.delegate,p.delegateAuth,null],[p.employeeA,p.authA,p.workerA]]){
    const epoch=epochs.find(e=>e.employee===employeeId),query={siteId,mode:'detail',afterId:null,suspensionId:epoch.suspensionId,operationId:null};
    const prepared=await ok('actual164_restore_prepare',`public.faolla_attendance_account_suspensions_v1(${json(query)},${owner},null,true)`);assert(prepared.detail.canRestore);
    const command={action:'restore',operationId:next(),suspensionId:epoch.suspensionId,expectedGeneration:1,workerId,expectedWorkerVersion:prepared.detail.workerVersion,
     expectedEmployeeVersion:prepared.detail.employeeVersion,employeeId,employeeAuthUserId:authUserId,reason:'Synthetic203 explicit same identity restore'};
    await ok('actual164_restore',`public.faolla_attendance_account_suspensions_v1(${json(query)},${owner},${json(command)},true)`,{write:true});}
   const current=await foundation(fd(grants.workerView.command.operationId));assert.equal(current.item.authorityCurrent,false);assert.equal(current.item.delegate.generation,0);assert.equal(current.item.targetGeneration,0);
   await rejected(()=>audit(list(grants.workerView.command.operationId)),'attendance_access_denied');
   await step('old_grant_does_not_rewrite_generations',`do $ma203_epochs$ begin assert (select count(*) from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id in(${quote(p.delegate)},${quote(p.employeeA)}) and generation=1 and not paused)=2;end;$ma203_epochs$;select 1;`);
   await restore('ma203_generation',branch);
  });
  await group(6,async()=>{
   const wv=grants.workerView.command.operationId;await rejected(()=>audit(detail(wv,'config',sources.workerB)),'attendance_audit_not_found');
   await rejected(()=>audit(detail(wv,'scope',sources.scopeMixed)),'attendance_audit_not_found');
   const elsewhere=await scopes(p.scopeElsewhere,[p.workerA],[p.locationB]);await rejected(()=>audit(detail(wv,'scope',elsewhere)),'attendance_audit_not_found');
   await rejected(()=>audit({...list(wv),siteId:d.site}),'attendance_access_denied');
   await rejected(()=>audit(list(wv),null,true,p.authA),'attendance_access_denied');
   const move=await save('ma203_move'),toB=await admin('worker',workerValues('A',p.locationB)),toA=await admin('worker',workerValues('A',p.locationA));
   await rejected(()=>audit(detail(wv,'config',toB)),'attendance_audit_not_found');await rejected(()=>audit(detail(wv,'config',toA)),'attendance_audit_not_found');
   await restore('ma203_move',move);
  });
  await group(7,async()=>{
   const query=exportQ(grants.workerExport.command.operationId,'scope'),command={action:'export',operationId:next()};
   const faultCatalog=await step('owned_fault_catalog_before','select '+managementAuditNativeCatalogSql(d.owned.oid)+';'),fault=await save('ma203_late_fault');
   await step('new_owned_only_AFTER_sidecar_fault',managementAuditNativeFaultSql(command.operationId));
   await rejected(()=>audit(query,command),'attendance_unavailable');assert.equal(lastRpc.error,'synthetic203_late_sidecar_failure');
   assert.equal(await step('late_failure_zero_export_and_authority',`select (select count(*) from public.merchant_attendance_management_audit_exports where merchant_id=${site} and operation_id=${quote(command.operationId)})+
    (select count(*) from public.merchant_attendance_management_delegation_operations where merchant_id=${site} and operation_id=${quote(command.operationId)});`),'0');
   assert.equal((await audit(recover(command.operationId),null,false)).receipt,null);
   await restore('ma203_late_fault',fault);
   await step('fault_catalog_exactly_restored',`do $ma203_fault_gone$ begin assert to_regprocedure('public.synthetic203_owned_late_export_fault_v1()') is null;
    assert not exists(select 1 from pg_trigger where tgrelid='public.merchant_attendance_management_delegation_operations'::regclass and tgname='synthetic203_owned_late_export_fault');
    assert ${managementAuditNativeCatalogSql(d.owned.oid)}=${quote(faultCatalog)},'ma203_fault_catalog_not_exact';end;$ma203_fault_gone$;select 1;`);
   assert.equal((await audit(query,command)).kind,'export');
   const future=grant('audit_view',company,{validFrom:profile.until,validUntil:profile.futureUntil});await foundation(fq,future);
   await rejected(()=>audit(list(future.operationId)),'attendance_access_denied');
   await step('actual_append_only_ACL_and_old_facts',`do $ma203_security$ declare denied boolean;begin
    denied:=false;begin set local role service_role;update public.merchant_attendance_management_audit_exports set result_count=result_count where merchant_id=${site};exception when insufficient_privilege then denied:=true;end;reset role;assert denied;
    denied:=false;begin update public.merchant_attendance_management_audit_exports set result_count=result_count where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    ${preserve}${external}end;$ma203_security$;select 1;`);
  });
  assert.equal(groups.length,8);assert(rpcs<=90&&steps<=139);await step('rollback','rollback;');rolledBack=true;
  return {phases:[202,203],groups,rpcs,steps,reads,writes,rejections,seedRows:9,newSite:siteId,actualNodeCoordinators:true,actualOwnerGrants:true,
   actualDualGenerations:true,receiptOnlyRecover:true,lateAtomicFailure:true,rollbackRestored:true,oldFactsUnchanged:true,oldArchivesUnchanged:true,
   newDatabase:false,newCluster:false,realAuth:false,browser:false,production:false,capacitySentinels:'SOURCE/pure-only; no bulk native matrix'};
 }catch(error){throw new Error('management_audit_native_stage:'+stage+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc).slice(0,12000));}
 finally{try{if(!rolledBack)await connection.step('rollback;');}catch(error){if(!String(error).includes('attendance_concurrency_closed'))throw error;}finally{await connection.close();}
  assert.equal(d.fingerprint(),baseline,'management_audit_fixture_final_facts');assert.equal(d.definitions(),definitions);assert.equal(d.tableCatalog(),catalog);
  assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155);assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207);}
}
