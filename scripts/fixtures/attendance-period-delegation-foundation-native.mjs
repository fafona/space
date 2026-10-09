// One explicit transaction, one reused synthetic namespace, no credentials or
// connection on import. Foundation only; private source is NOT a public writer.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(232900000+n);
export async function verifyPeriodDelegationFoundation(ctx){
 const {d,h,native,scope,periodId,pq}=ctx;assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const {executePeriodDelegation}=require('../../src/lib/merchantAttendancePeriodDelegation.server.ts');
 const {parsePeriodDelegationQuery}=require('../../src/lib/merchantAttendancePeriodDelegation.ts');
 const before=d.fingerprint(),names=d.inventory(),allHash=outageNativeFingerprintSql(names),connection=native.connect();
 const allowed=['merchant_attendance_period_delegations','merchant_attendance_period_delegation_revocations','merchant_attendance_account_epochs'];
 const protectedHash=outageNativeFingerprintSql(names.filter(name=>!allowed.includes(name)));
 const oldAllowedRows=`jsonb_build_object(${allowed.map(name=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(original_row)),'[]'::jsonb) from public.${name} original_row)`).join(',')})`;
 const preserveOld=allowed.map(name=>`assert not exists(select old_row.value from jsonb_array_elements(prior_rows->${quote(name)}) old_row(value) except select to_jsonb(current_row) from public.${name} current_row),'period_delegation_old_row_changed:${name}';`).join('\n');
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO,YMD';set local extra_float_digits=3;"+d.guard;
 const site=quote(d.site),delegate=uid(1),auth=uid(2),role=uid(3),grantId=uid(4),revokeId=uid(5),secondId=uid(6);
 let stage='begin',steps=0,reads=0,writes=0,rejections=0,helpers=0,rolledBack=false,lastRpc=null;
 const step=async(label,sql)=>{stage=label;assert(++steps<=65,'period_delegation_max65_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const q=(access='owner',mode='list',patch={})=>parsePeriodDelegationQuery({siteId:d.site,access,mode,catalog:null,grantId:null,afterId:null,operationId:null,...patch});
 const sourceQuery=pq('detail','owner',periodId);const from=sourceQuery.fromDate,through=sourceQuery.throughDate;
 const rpc=async(name,args)=>{
  assert.equal(name,'faolla_attendance_period_delegation_v1');assert.equal(args.p_query.siteId,d.site);assert([d.owner,auth].includes(args.p_auth_user_id));
  assert.deepEqual(Object.keys(args).sort(),['p_query','p_auth_user_id','p_command','p_allow_write'].sort());
  const expression=`public.${name}(${json(args.p_query)},${quote(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write})`;
  const result=JSON.parse(await step('rpc_'+(args.p_command?.action??args.p_query.mode),`do $pd_test_rpc$ declare before_hash text;protected_before text;prior_rows jsonb;rpc_value jsonb;failure text;state_code text;failure_context text;begin
   before_hash:=${allHash};protected_before:=${protectedHash};prior_rows:=${oldAllowedRows};assert octet_length(prior_rows::text)<=1048576;
   begin set local role service_role;assert current_user='service_role';rpc_value:=${expression};set constraints all immediate;set constraints all deferred;
   exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,failure_context=pg_exception_context;end;reset role;
   if failure is not null or ${args.p_command===null?'true':'false'} then assert ${allHash}=before_hash,'period_delegation_read_or_rejection_wrote';end if;
   assert ${protectedHash}=protected_before,'period_delegation_changed_unrelated_facts';${preserveOld}
   assert not exists(select 1 from public.merchant_attendance_account_epochs current_row where to_jsonb(current_row) not in(select value from jsonb_array_elements(prior_rows->'merchant_attendance_account_epochs'))
    and (current_row.merchant_id<>${site} or current_row.employee_id not in(${quote(delegate)},(select employee_id from public.merchant_attendance_workers where merchant_id=${site} and id=${quote(h.workerId)})))),'period_delegation_unexpected_epoch';
   assert not exists(select 1 from public.merchant_attendance_period_delegations current_row where to_jsonb(current_row) not in(select value from jsonb_array_elements(prior_rows->'merchant_attendance_period_delegations'))
    and (current_row.merchant_id<>${site} or current_row.grant_id<>${quote(args.p_command?.operationId??null)})),'period_delegation_unexpected_grant';
   assert not exists(select 1 from public.merchant_attendance_period_delegation_revocations current_row where to_jsonb(current_row) not in(select value from jsonb_array_elements(prior_rows->'merchant_attendance_period_delegation_revocations'))
    and (current_row.merchant_id<>${site} or current_row.operation_id<>${quote(args.p_command?.operationId??null)})),'period_delegation_unexpected_revoke';
   perform set_config('faolla.pd232_result',jsonb_build_object('value',rpc_value,'error',failure,'sqlstate',state_code,'context',failure_context)::text,true);
  end;$pd_test_rpc$;select current_setting('faolla.pd232_result')::jsonb;`));
  lastRpc=result;
  if(result.error){rejections++;return {data:null,error:{message:result.error},diagnostic:result};}
  if(args.p_command)writes++;else reads++;return {data:result.value,error:null};
 };
 const run=(query,command=null,allowWrite=true)=>executePeriodDelegation({query,command,authUserId:query.access==='owner'?d.owner:auth,allowWrite},{rpc});
 const guard=(action='view',grant=grantId,patch={})=>`public.faolla_attendance_period_delegation_guard_v1(${site},${quote(grant)},${quote(auth)},${quote(action)},${quote(patch.worker??h.workerId)},${quote(patch.from??from)}::date,${quote(patch.through??through)}::date,${quote(periodId)},${patch.allow??true})`;
 const helper=async(label,expression,expectedError=null)=>{helpers++;const value=JSON.parse(await step(label,`do $pd_test_helper$ declare before_hash text;rpc_value jsonb;failure text;state_code text;failure_context text;begin
   before_hash:=${allHash};begin rpc_value:=${expression};exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,failure_context=pg_exception_context;end;
   assert ${allHash}=before_hash,'period_delegation_private_read_wrote';perform set_config('faolla.pd232_result',jsonb_build_object('value',rpc_value,'error',failure,'sqlstate',state_code,'context',failure_context)::text,true);
  end;$pd_test_helper$;select current_setting('faolla.pd232_result')::jsonb;`));
  assert.equal(value.error,expectedError,JSON.stringify({label,...value}));return value.value;};
 try{
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $pd_test_seed$ begin
    assert not exists(select 1 from public.merchant_enterprise_employees where id=${quote(delegate)} or auth_user_id=${quote(auth)});
    assert not exists(select 1 from public.merchant_enterprise_roles where id=${quote(role)});
    assert not exists(select 1 from public.merchant_attendance_period_delegations where merchant_id=${site});
   end;$pd_test_seed$;
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(role)},${site},'Synthetic232 supervisor',array['enterprise.view','attendance.period.view','attendance.period.send','attendance.period.respond','attendance.period.seal','attendance.period.reopen']);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
    values(${quote(delegate)},${site},${quote(auth)},'synthetic232-supervisor@example.test','Synthetic232 supervisor',${quote(role)},'active',clock_timestamp(),1);
   select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'employeeId',(select employee_id from public.merchant_attendance_workers where merchant_id=${site} and id=${quote(h.workerId)}));`));
  const command={action:'grant',operationId:grantId,delegateEmployeeId:delegate,delegateAuthUserId:auth,workerId:h.workerId,employeeId:profile.employeeId,employeeAuthUserId:h.employeeAuthUserId,
   fromDate:from,throughDate:through,actions:['view','send','respond','seal','reopen'],includeExisting:true,validFrom:profile.from,validUntil:profile.until,reason:'Synthetic232 explicit delegated period scope'};
  const created=await run(q(),command);assert.equal(created.receipt?.grantId,grantId);assert.equal(created.receipt?.actorId,d.owner);
  const replay=await run(q(),command);assert.deepEqual(replay.receipt,created.receipt);
  assert.deepEqual((await run(q('owner','recover',{operationId:grantId}),null,false)).receipt,created.receipt);
  const meta=await run(q('delegate','detail',{grantId}));assert.equal(meta.detail.delegate.authUserId,auth);assert.deepEqual(meta.detail.usableActions,command.actions);
  const authority=await helper('exact_scope_authority',guard());assert.equal(authority.actorAuthUserId,auth);assert.equal(authority.employeeAuthUserId,h.employeeAuthUserId);
  await helper('outside_worker',guard('view',grantId,{worker:uid(98)}),'attendance_access_denied');
  await helper('flag_off',guard('view',grantId,{allow:false}),'attendance_access_denied');
  const source=`public.faolla_attendance_period_delegated_source_v1(${site},${quote(h.workerId)},${quote(profile.employeeId)},${quote(h.employeeAuthUserId)},${quote(auth)},${quote(from)}::date,${quote(through)}::date,${quote(periodId)})`;
  const delegated=await helper('real_private_fixed_source',source);const original=await helper('original_owner_source',`public.faolla_attendance_period_closure_source_v1(${json({siteId:d.site,access:'owner',workerId:h.workerId,fromDate:from,throughDate:through,periodId})},${quote(d.owner)})`);
  assert.equal(delegated.validation,'delegate_checked');assert.equal(delegated.report.access,'delegate');assert.equal(delegated.sourceFingerprint,original.sourceFingerprint);assert.deepEqual(delegated.sourceCanonical,original.sourceCanonical);
  await step('forbidden_direct_service_helper',`do $pd_test_acl$ declare rejected boolean:=false;begin
   begin set local role service_role;perform ${source};exception when insufficient_privilege then rejected:=true;end;reset role;assert rejected,'period_source_exposed_to_service_role';end;$pd_test_acl$;select 1;`);
  const narrow={...command,operationId:secondId,actions:['view'],includeExisting:false};await run(q(),narrow);
  await helper('historical_period_not_implicitly_included',guard('view',secondId),'attendance_access_denied');
  await helper('action_not_granted',guard('seal',secondId),'attendance_access_denied');
  const revoked=await run(q('owner','detail',{grantId}),{action:'revoke',operationId:revokeId,grantId,expectedRevision:1,reason:'Synthetic232 explicit revoke'},false);
  assert.equal(revoked.receipt.action,'revoke');assert.equal((await run(q('owner','detail',{grantId}),null,false)).detail.status,'revoked');
  await helper('revoked_scope',guard(),'attendance_access_denied');
  assert.deepEqual((await run(q('owner','recover',{operationId:grantId}),null,false)).receipt,created.receipt);
  await assert.rejects(run(q('delegate','recover',{operationId:grantId}),null,false),error=>error.code==='attendance_access_denied');
  const footprint=JSON.parse(await step('no_raw_or_archive_writes',`select jsonb_build_object('periodOperations',(select count(*) from public.merchant_attendance_period_delegation_operations where merchant_id=${site}),
   'delegateWorkers',(select count(*) from public.merchant_attendance_workers where merchant_id=${site} and employee_id=${quote(delegate)}));`));
  assert.equal(footprint.periodOperations,0);assert.equal(footprint.delegateWorkers,0);
  await step('rollback','rollback;');rolledBack=true;
  return {steps,reads,writes,rejections,helpers,sourceCanonicalMatchesOwner:true,serviceCannotCallPrivateSource:true,realAuth:false,
   noPeriodWriter:true,noBrowser:true,rollbackRestored:true};
 }catch(error){throw new Error(`period_delegation_foundation:${stage}:${error?.stack??String(error)}:${JSON.stringify(lastRpc?.error?lastRpc:null)}`);}
 finally{if(!rolledBack)await connection.step('rollback;').catch(()=>{});await connection.close();assert.equal(d.fingerprint(),before,'period_delegation_full_transaction_not_restored');}
}
