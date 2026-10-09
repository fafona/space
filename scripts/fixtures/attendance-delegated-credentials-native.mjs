//207 INERT, eight finite actual-Node/actual-RPC groups in one ROLLBACK.
//Only7 synthetic identity/role rows are inserted directly. All credentials,
//audits, delegations, proofs, employment and epochs use their real writers.
//Verifier doubles are explicit: ZERO scrypt, Auth login or production writes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
import {periodContinuationSerialization,periodContinuationArchiveBytes} from './attendance-period-continuation-native.mjs';
import {managementAuditNativeCatalogSql} from './attendance-management-audit-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(207600000+n),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
export const delegatedCredentialsNativeSite='99990207';
export const delegatedCredentialsNativeIds=Object.freeze({role:uid(1),plainRole:uid(2),delegate:uid(3),delegateAuth:uid(4),plain:uid(5),plainAuth:uid(6),
 employee:uid(7),employeeAuth:uid(8),other:uid(9),otherAuth:uid(10),worker:uid(11),independentWorker:uid(12),subject:uid(13),
 location:uid(14),otherLocation:uid(15),terminal:uid(16),ownerTerminal:uid(17)});
export const delegatedCredentialsNativeGroupBudgets=Object.freeze([
 ['legacy_NULL_owner_and_real_independent_generation_setup',13,18],['real202_grants_prepare_pair_and_historical_device_issuer',12,15],
 ['two_PIN_issue_same_material_replay_and_different_PIN_conflict',18,19],['three_revokes_and_noop_or_old_fact_adoption_refusals',15,16],
 ['identity_scope_private_core_material_and_default_off',6,7],['actual_delegate_epoch_restore_revoke_and_original_receipts',11,17],
 ['late23514_three_ledgers_atomic_retry',9,15],['paused_settings_flagoff_minimal_receipts_and_appendonly',6,10],
].map(([name,rpcs,steps])=>Object.freeze({name,rpcs,steps})));
const rpcNames={
 faolla_attendance_delegated_terminals_v1:['p_query','p_auth_user_id','p_command','p_allow_write','p_material'],
 faolla_attendance_delegated_pin_v1:['p_query','p_auth_user_id','p_command','p_allow_write','p_material'],
 faolla_attendance_management_delegations_v1:['p_query','p_auth_user_id','p_command','p_allow_grant'],
 faolla_attendance_admin_v1:['p_site_id','p_auth_user_id','p_query','p_command','p_operation_id'],
 faolla_attendance_independent_admin_v1:['p_site','p_auth','p_query','p_command','p_material','p_allow_new'],
};
export function delegatedCredentialsNativeRpcExpression(name,args){
 const fields=rpcNames[name];assert(fields,'credentials207_public_RPC_only');assert.deepEqual(Object.keys(args).sort(),[...fields].sort());
 for(const field of fields)if(field.startsWith('p_allow_'))assert.equal(typeof args[field],'boolean');
 const site=args.p_query?.siteId??args.p_site_id??args.p_site;assert.match(site,/^9999[0-9]{4}$/);
 assert.match(args.p_auth_user_id??args.p_auth,/^[0-9a-f-]{36}$/);
 const value=v=>v===null?'null':typeof v==='boolean'?String(v):typeof v==='string'?quote(v):json(v);
 //Named binding is important: old196 material is BEFORE allow_new, new207
 //material is AFTER allow_write. Never positional-forward the new wire.
 return `public.${name}(${fields.map(field=>field+'=>'+value(args[field])).join(',')})`;
}
export function delegatedCredentialsNativeIndependentChange(action,operationId,state){
 assert(['enable','disable'].includes(action));assert.equal(state?.data?.kind,'receipt');const receipt=state.receipt;assert(receipt);
 assert.equal(receipt.subjectId,delegatedCredentialsNativeIds.subject);assert.equal(receipt.workerId,delegatedCredentialsNativeIds.independentWorker);
 //196 writes return the real receipt CAS, not a detail.subject projection.
 return {action,operationId,subjectId:receipt.subjectId,expectedSubjectRevision:receipt.subjectRevision,expectedGeneration:receipt.generation,
  expectedWorkerVersion:receipt.workerVersion,expectedSettingsVersion:state.settingsVersion,reason:'Synthetic207 real independent lifecycle setup'};
}
export function delegatedCredentialsNativeFaultSql(operationId,site=delegatedCredentialsNativeSite){
 assert.match(operationId,/^[0-9a-f-]{36}$/);assert.equal(site,delegatedCredentialsNativeSite);
 return `create function public.synthetic207_owned_late_credentials_fault_v1() returns trigger language plpgsql set search_path=pg_catalog as $owned207_fault$
 begin if new.merchant_id=${quote(site)} and new.operation_id=${quote(operationId)} then raise exception using errcode='23514',message='synthetic207_late_sidecar_failure',constraint='synthetic207_owned_late_credentials_fault';end if;return new;end;$owned207_fault$;
 create trigger synthetic207_owned_late_credentials_fault after insert on public.merchant_attendance_management_delegation_operations
 for each row execute function public.synthetic207_owned_late_credentials_fault_v1();select 1;`;
}
//Only close the owned session while a timed-out Node request may still be in
//flight. Close rolls back that transaction; do not dispatch competing SQL.
export async function delegatedCredentialsNativeCleanup(connection,pending,protections,primary=null){
 const failures=[],settled=pending?pending.then(()=>null,error=>error):null;
 try{await connection.close();}catch(error){failures.push({label:'close',error});}
 if(settled){const error=await settled;if(error)failures.push({label:'pending',error});}
 for(const [label,check]of protections){try{await check();}catch(error){failures.push({label,error});}}
 if(failures.length){
  const detail=failures.map(({label,error})=>label+':'+String(error?.message??error).slice(0,1000)).join('|');
  if(primary){const note='\ndelegated_credentials_native_cleanup_secondary:'+detail;primary.message+=note;primary.stack=(primary.stack??primary.message)+note;}
  else throw new AggregateError(failures.map(item=>item.error),'delegated_credentials_native_cleanup_failed:'+detail);
 }
}
export async function verifyDelegatedCredentialsNative(ctx){
 const {d,h,native,scope,archive,periodArchive}=ctx??{};assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);assert.equal(scope.schema,d.owned.schema);
 const {createDelegatedCredentialsService}=require('../../src/lib/merchantAttendanceDelegatedCredentials.server.ts');
 const {executeManagementDelegation}=require('../../src/lib/merchantAttendanceManagementDelegation.server.ts');
 const {executeAttendanceAdmin}=require('../../src/lib/merchantAttendanceAdmin.server.ts');
 const {createIndependentAttendanceService}=require('../../src/lib/merchantAttendanceIndependent.server.ts');
 const {independentAttendanceMaterialCommitment}=require('../../src/lib/merchantAttendanceIndependentPinKdf.server.ts');
 const p=delegatedCredentialsNativeIds,siteId=delegatedCredentialsNativeSite,site=quote(siteId),owner=quote(d.owner),names=d.inventory();
 const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),old155=periodContinuationArchiveBytes(await archive()),old207=periodContinuationArchiveBytes(await periodArchive());
 const all=outageNativeFingerprintSql(names),prefix=periodContinuationSerialization+d.guard,connection=native.connect({lifetimeMs:90000});
 const originalRows=`(select jsonb_object_agg(n,rows) from(${names.map(n=>`select ${quote(n)} n,(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${n} x) rows`).join(' union all ')}) original_rows)`;
 const preserve=names.map(n=>`assert not exists(select previous.value from jsonb_array_elements(current_setting('faolla.dc207_originals')::jsonb->${quote(n)}) previous(value) except select to_jsonb(x) from public.${n} x),'dc207_old_row_changed:${n}';`).join('\n');
 const external=names.map(n=>`assert not exists(select to_jsonb(x) from public.${n} x where coalesce(to_jsonb(x)->>'merchant_id',case when ${quote(n)}='merchants' then to_jsonb(x)->>'id' end,'')<>${site}
 except select previous.value from jsonb_array_elements(current_setting('faolla.dc207_originals')::jsonb->${quote(n)}) previous(value)),'dc207_external_scope_added:${n}';`).join('\n');
 const rawNames=names.filter(n=>/merchant_attendance_(?:events|correction_|missing_|leave_|work_arrangement_|period_|schedule_|shift_|plan_|calendar_|outage_)/.test(n));assert(rawNames.length>10);
 const raw=outageNativeFingerprintSql(rawNames),configuration=['merchant_attendance_settings','merchant_attendance_config_operations','merchant_attendance_workers','merchant_attendance_locations','merchant_attendance_employment_periods'];
 const terminals=['merchant_attendance_terminals','merchant_attendance_terminal_audit'];
 const member=['merchant_attendance_pin_credentials','merchant_attendance_pin_audit'];
 const independent=['merchant_attendance_independent_subjects','merchant_attendance_independent_entries','merchant_attendance_independent_credentials','merchant_attendance_independent_leases','merchant_attendance_workers','merchant_attendance_employment_periods'];
 const sidecars=['merchant_attendance_management_delegation_operations','merchant_attendance_delegated_credential_proofs'];
 const replayOps=new Set(),groups=[];let steps=0,rpcs=0,reads=0,writes=0,rejections=0,serial=100,stage='begin',lastRpc=null,profile,rawBaseline,version=0,verifierDoubleCalls=0,pendingStep=null,primaryError=null;
 const next=()=>uid(++serial);
 const step=async(label,sql)=>{stage=label;assert(++steps<=140,'dc207_max140_SQLsteps');const dispatched=connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));pendingStep=dispatched;
  try{return await dispatched;}finally{if(pendingStep===dispatched)pendingStep=null;}};
 const failure=error=>new Error('delegated_credentials_native_stage:'+stage+':steps='+steps+':rpcs='+rpcs+':'+(error?.stack??error)+':'+JSON.stringify(lastRpc),{cause:error});
 const call=async(label,expression,{write=false,replay=false,prepare='',role='service_role',allowed=null}={})=>{
  assert(++rpcs<=90,'dc207_max90_actual_RPCs');const outside=allowed===null?null:outageNativeFingerprintSql(names.filter(n=>!allowed.includes(n)));
  const result=JSON.parse(await step(label,`do $dc207_call$ declare old_hash text;outside_hash text;value jsonb;prepared_command jsonb;failure text;state_code text;context_text text;constraint_text text;begin
   old_hash:=${all};${outside?'outside_hash:='+outside+';':''}${prepare}begin set local role ${role};assert current_user=${quote(role)};value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,state_code=returned_sqlstate,context_text=pg_exception_context,constraint_text=constraint_name;end;reset role;
   if failure is not null or value ? 'error' or ${!write||replay} then assert ${all}=old_hash,'dc207_read_rejection_replay_wrote';end if;
   ${outside?'assert '+outside+"=outside_hash,'dc207_unrelated_table_changed';":''}${preserve}${external}
   perform set_config('faolla.dc207_result',jsonb_build_object('value',value,'error',failure,'sqlstate',state_code,'context',context_text,'constraint',constraint_text)::text,true);
  end;$dc207_call$;select current_setting('faolla.dc207_result')::jsonb;`));
  //Never put input material, verifier/PIN or SQL statements into diagnostics.
  lastRpc={error:result.error??result.value?.error??null,sqlstate:result.sqlstate,constraint:result.constraint,
   context:result.context?.split('\n').filter(s=>/^(?:PL\/pgSQL|SQL) function /.test(s)).map(s=>s.slice(0,240)).slice(0,8)??[],kind:result.value?.kind??null,protocol:result.value?.protocol??null};
  if(lastRpc.error)rejections++;else if(write&&!replay)writes++;else reads++;return result;
 };
 const service={rpc:async(name,args)=>{
  const allowed=name==='faolla_attendance_admin_v1'?configuration:name==='faolla_attendance_independent_admin_v1'?independent:
   name==='faolla_attendance_delegated_terminals_v1'?[...terminals,...sidecars]:name==='faolla_attendance_delegated_pin_v1'?[...member,...independent,...sidecars]:
    ['merchant_attendance_management_delegations','merchant_attendance_management_delegation_revocations','merchant_attendance_management_delegation_operations'];
  const c=args.p_command,result=await call('actual_'+name+'_'+(c?.action??c?.kind??args.p_query.mode??args.p_query.view),delegatedCredentialsNativeRpcExpression(name,args),{write:c!==null,replay:c!==null&&replayOps.has(c.operationId),allowed});
  return {data:result.value,error:result.error?{message:result.error}:null};
 }};
 const environment=()=>({FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_ENABLED:'1',FAOLLA_ATTENDANCE_DELEGATED_TERMINALS_SITE_IDS:siteId,
  FAOLLA_ATTENDANCE_DELEGATED_PIN_ENABLED:'1',FAOLLA_ATTENDANCE_DELEGATED_PIN_SITE_IDS:siteId});
 const dependencies={environment,pepper:()=> 'synthetic207_test_double_key_not_production',memberVerifier:async(pin,salt,binding)=>{verifierDoubleCalls++;return sha('synthetic207_member_verifier_double:'+pin+':'+salt+':'+JSON.stringify(binding));},
  independentMaterial:async(pin,key,binding,operationId)=>{verifierDoubleCalls++;const salt=sha('synthetic207_independent_salt:'+key+':'+JSON.stringify(binding)+':'+operationId).slice(0,32),verifier=sha('synthetic207_independent_verifier_double:'+pin+':'+salt);
   return{salt,verifier,commitment:independentAttendanceMaterialCommitment(binding,operationId,salt,verifier)};}};
 const node=createDelegatedCredentialsService(service,dependencies),offNode=createDelegatedCredentialsService(service,{...dependencies,environment:()=>({})});
 const independentNode=createIndependentAttendanceService(service,{environment:()=>({FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_ENABLED:'1',FAOLLA_ATTENDANCE_INDEPENDENT_WORKERS_SITE_IDS:siteId})});
 const ok=async(label,expression,options)=>{const r=await call(label,expression,options);assert.equal(r.error,null,JSON.stringify(lastRpc));assert(!r.value?.error,JSON.stringify(lastRpc));return r.value;};
 const deny=async(promise,code)=>assert.rejects(promise,e=>e?.code===code||e?.message===code);
 const group=async(index,run)=>{const beforeRpcs=rpcs,beforeSteps=steps;await run();const spec=delegatedCredentialsNativeGroupBudgets[index],actual={name:spec.name,rpcs:rpcs-beforeRpcs,steps:steps-beforeSteps};
  assert(actual.rpcs<=spec.rpcs&&actual.steps<=spec.steps,'dc207_group_budget:'+JSON.stringify(actual));groups.push(actual);native.pass('207 group'+(index+1)+' '+JSON.stringify(actual));};
 const save=async label=>step('save_'+label,`savepoint ${label};select ${all};`),restore=async(label,hash)=>assert.equal(await step('restore_'+label,`rollback to savepoint ${label};release savepoint ${label};select ${all};`),hash,'dc207_savepoint_not_exact');
 const q=grantId=>({siteId,grantId,mode:'context',operationId:null}),rq=(grantId,operationId)=>({siteId,grantId,mode:'recover',operationId});
 const terminal=(grantId,command=null,pairSecret=null,actor=p.delegateAuth,allowWrite=true)=>node.executeTerminal({query:q(grantId),command,pairSecret,authUserId:actor,allowWrite});
 const pin=(grantId,command=null,secret=null,actor=p.delegateAuth,allowWrite=true)=>node.executePin({query:q(grantId),command,pin:secret,authUserId:actor,allowWrite});
 const recoverTerminal=(grantId,command,actor=p.delegateAuth)=>node.recoverTerminal({query:rq(grantId,command.operationId),authUserId:actor,expectedCommand:command});
 const recoverPin=(grantId,command,actor=p.delegateAuth)=>node.recoverPin({query:rq(grantId,command.operationId),authUserId:actor,expectedCommand:command});
 const foundation=(query,command=null)=>executeManagementDelegation({query,command,authUserId:d.owner,allowGrant:true},service);
 const grant=async(action,scopeValue,patch={})=>{const c={action:'grant',operationId:next(),delegateEmployeeId:p.delegate,delegateAuthUserId:p.delegateAuth,delegatedAction:action,scope:scopeValue,
  validFrom:profile.from,validUntil:profile.until,reason:'Synthetic207 explicit scoped credentials authority',...patch};const r=await foundation({siteId,mode:'write'},c);assert.equal(r.receipt.grantId,c.operationId);return c.operationId;};
 const memberScope={kind:'member_pin',workerId:p.worker,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,locationIds:[p.location]};
 const independentScope=generation=>({kind:'independent_pin',workerId:p.independentWorker,subjectId:p.subject,generation,locationIds:[p.location]});
 const terminalScope=create=>({kind:'terminal',terminalId:p.terminal,locationId:p.location,create});
 const legacy=async(kind,values)=>{const c={kind,values,operationId:next(),expectedVersion:version};const r=await executeAttendanceAdmin({siteId,view:'settings',cursor:null,search:'',operationId:null,command:c,authUserId:d.owner},service);version=r.version;return r;};
 const iq={siteId,mode:'detail',subjectId:p.subject};let independentState;
 const ownerIndependent=async command=>{independentState=await independentNode.executeAdmin({query:iq,command,pin:null,authUserId:d.owner,allowNew:true});return independentState;};
 const independentChange=action=>delegatedCredentialsNativeIndependentChange(action,next(),independentState);
 const memberCommand=(action,expectedRevision)=>({kind:'member_pin',action,operationId:next(),workerId:p.worker,employeeId:p.employee,employeeAuthUserId:p.employeeAuth,workerNo:'SYNTHETIC207-MEMBER',expectedRevision,reason:'Synthetic207 delegated member credential'});
 const independentCommand=(action,subjectRevision,generation,workerVersion,credentialRevision)=>({kind:'independent_pin',action,operationId:next(),workerId:p.independentWorker,subjectId:p.subject,
  expectedSubjectRevision:subjectRevision,expectedGeneration:generation,expectedWorkerVersion:workerVersion,expectedSettingsVersion:version,expectedCredentialRevision:credentialRevision,reason:'Synthetic207 delegated independent credential'});
 const raw207=(family,grantId,command,material=null,actor=p.delegateAuth,allow=true)=>delegatedCredentialsNativeRpcExpression('faolla_attendance_delegated_'+family+'_v1',
  {p_query:q(grantId),p_auth_user_id:actor,p_command:command,p_allow_write:allow,p_material:material});
 const pairSecret=Buffer.alloc(32,7).toString('base64url'),deviceSecret=Buffer.alloc(32,8).toString('base64url'),pairHash=sha(pairSecret),deviceHash=sha(deviceSecret);
 let prepareGrant,revokeTerminalGrant,memberIssueGrant,memberRevokeGrant,independentIssueGrant,independentRevokeGrant,prepareCommand,prepareResult,memberIssue,memberResult,independentIssue,independentResult,terminalRevoke,memberRevoke,independentRevoke,atomicCommand,atomicResult,atomicGrant;
 const status=value=>ok('actual207_delegate_'+value,'public.faolla_update_merchant_enterprise_employee_v1(prepared_command)',{write:true,prepare:`prepared_command:=jsonb_build_object('merchant_id',${site},'employee_id',${quote(p.delegate)},
  'expected_version',(select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(p.delegate)}),'actor_type','owner','actor_id',${owner},'status',${quote(value)},'attendance_operation_id',${quote(next())},'attendance_suspension_enabled',true)${value==='disabled'?`||'{"offboarding_mode":"unassign"}'::jsonb`:''};`});
 try{
  await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';do $dc207_begin$ begin assert current_user='postgres';assert not exists(select 1 from public.merchants where id=${site});
   assert to_regprocedure('public.synthetic207_owned_late_credentials_fault_v1()') is null;perform set_config('faolla.dc207_originals',${originalRows}::text,true);end;$dc207_begin$;select 1;`);
  await group(0,async()=>{
   profile=JSON.parse(await step('seven_explicit_synthetic_identity_role_rows',`insert into public.merchants(id,user_id,name,email) values(${site},${owner},'Synthetic207 credentials','synthetic207@example.test');
    insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values
    (${quote(p.role)},${site},'Synthetic207 explicit four credentials capabilities',array['enterprise.view','attendance.terminals.pair','attendance.terminals.revoke','attendance.pin.issue','attendance.pin.revoke']),
    (${quote(p.plainRole)},${site},'Synthetic207 target ordinary clock role',array['enterprise.view','attendance.self.view','attendance.self.clock']);
    insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version) values
    ${[['delegate','delegateAuth','role'],['plain','plainAuth','plainRole'],['employee','employeeAuth','plainRole'],['other','otherAuth','plainRole']].map(([e,a,r],i)=>`(${quote(p[e])},${site},${quote(p[a])},'synthetic207-${i}@example.test','Synthetic207 member ${i}',${quote(p[r])},'active',clock_timestamp(),1)`).join(',')};
    select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));`));
   rawBaseline=await step('raw_clock_source_baseline','select '+raw+';');
   await legacy('settings',{timeZone:'UTC',enabled:true,webClockEnabled:true,webBreakPaid:false});
   for(const locationId of[p.location,p.otherLocation])await legacy('location',{id:locationId,name:'Synthetic207 ordinary location',timeZone:'UTC',active:true});
   await legacy('worker',{id:p.worker,employeeId:p.employee,workerNo:'SYNTHETIC207-MEMBER',displayName:'Synthetic207 member',locationId:p.location,active:true,startsOn:'2000-01-01'});
   const oldTerminal={action:'create',terminalId:p.ownerTerminal,locationId:p.location,label:'Synthetic207 old owner terminal',pairHash:sha('synthetic207_old_owner_pair')};
   const created=await ok('legacy104_NULL_owner_create',`public.faolla_attendance_terminal_admin_v1(${site},${owner},'{"cursor":null,"terminalId":null}'::jsonb,${json(oldTerminal)},true)`,{write:true,allowed:terminals});assert.equal(created.items[0].state,'pending');
   await ok('legacy104_NULL_owner_revoke',`public.faolla_attendance_terminal_admin_v1(${site},${owner},'{"cursor":null,"terminalId":null}'::jsonb,${json({action:'revoke',terminalId:p.ownerTerminal})},false)`,{write:true,allowed:terminals});
   for(const[action,revision]of[['set',0],['revoke',1]])await ok('legacy106_NULL_owner_'+action,`public.faolla_attendance_pin_admin_v1(${site},${owner},'SYNTHETIC207-MEMBER',null,${json({action,operationId:next(),expectedRevision:revision,workerId:p.worker,employeeId:p.employee,
    salt:action==='set'?'1'.repeat(32):null,verifier:action==='set'?'2'.repeat(64):null,commandHash:sha('synthetic207_legacy_'+action)})},true)`,{write:true,allowed:member});
   await ownerIndependent({action:'create',operationId:next(),subjectId:p.subject,workerId:p.independentWorker,expectedSettingsVersion:version,workerNo:'SYNTHETIC207-INDEPENDENT',displayName:'Synthetic207 independent',locationId:p.location,startsOn:'2000-01-01',reason:'Synthetic207 real196 independent create'});
   for(const action of['enable','disable','enable'])await ownerIndependent(independentChange(action));
   await ownerIndependent(null);assert.equal(independentState.data.subject.generation,1);assert.equal(independentState.data.subject.revision,4);assert.equal(independentState.data.credential.revision,0);
  });
  await group(1,async()=>{
   prepareGrant=await grant('terminal_prepare',terminalScope(true));prepareCommand={action:'terminal_prepare',operationId:next(),terminalId:p.terminal,locationId:p.location,label:'Synthetic207 delegated terminal',pairHash,reason:'Synthetic207 actual delegated prepare'};
   prepareResult=await terminal(prepareGrant,prepareCommand,pairSecret);assert.equal(prepareResult.receipt.reference.auditAction,'create');
   const paired=await ok('actual104_pair_after207_prepare',`public.faolla_attendance_terminal_device_v1(${site},${quote(p.terminal)},${quote(pairHash)},${quote(deviceHash)},true)`,{write:true,allowed:terminals});assert.equal(paired.terminal.state,'active');
   revokeTerminalGrant=await grant('terminal_revoke',terminalScope(false));memberIssueGrant=await grant('pin_issue',memberScope);memberRevokeGrant=await grant('pin_revoke',memberScope);
   independentIssueGrant=await grant('pin_issue',independentScope(1));independentRevokeGrant=await grant('pin_revoke',independentScope(1));
   await foundation({siteId,mode:'write'},{action:'revoke',operationId:next(),grantId:prepareGrant,expectedRevision:1,reason:'Synthetic207 revoke management not issued device'});
   const device=await ok('actual104_device_survives_management_grant_revoke',`public.faolla_attendance_terminal_device_v1(${site},${quote(p.terminal)},${quote(deviceHash)},null,false)`);assert.equal(device.terminal.state,'active');
   await step('actual207_prepare_three_real_proofs',`do $dc207_prepare_proof$ declare authority public.merchant_attendance_management_delegation_operations%rowtype;begin
    select * into authority from public.merchant_attendance_management_delegation_operations where merchant_id=${site} and operation_id=${quote(prepareCommand.operationId)};
    assert authority.actor_auth_user_id=${quote(p.delegateAuth)} and authority.business_operation_id=${quote(p.terminal)};
    perform public.faolla_attendance_delegated_credentials_proof_v1(authority,false);assert public.faolla_attendance_delegated_credentials_issuer_v1(${site},${quote(p.terminal)});
   end;$dc207_prepare_proof$;select 1;`);
  });
  await group(2,async()=>{
   memberIssue=memberCommand('pin_issue',2);memberResult=await pin(memberIssueGrant,memberIssue,'12345678');assert.equal(memberResult.receipt.reference.revision,3);
   independentIssue=independentCommand('pin_issue',4,1,4,0);independentResult=await pin(independentIssueGrant,independentIssue,'12345678');assert.equal(independentResult.receipt.reference.credentialRevision,1);
   for(const[g,c,r]of[[memberIssueGrant,memberIssue,memberResult],[independentIssueGrant,independentIssue,independentResult]]){
    replayOps.add(c.operationId);assert.deepEqual((await pin(g,c,'12345678')).receipt,r.receipt);await deny(pin(g,c,'87654321'),'attendance_operation_conflict');replayOps.delete(c.operationId);
   }
  });
  await group(3,async()=>{
   terminalRevoke={action:'terminal_revoke',operationId:next(),terminalId:p.terminal,locationId:p.location,reason:'Synthetic207 real terminal revoke'};
   const tr=await terminal(revokeTerminalGrant,terminalRevoke);assert.equal(tr.receipt.reference.auditAction,'revoke');
   assert.equal((await call('actual104_explicit_revoke_stops_device',`public.faolla_attendance_terminal_device_v1(${site},${quote(p.terminal)},${quote(deviceHash)},null,false)`)).error,'attendance_terminal_denied');
   memberRevoke=memberCommand('pin_revoke',3);const mr=await pin(memberRevokeGrant,memberRevoke);assert.equal(mr.receipt.reference.revision,4);
   independentRevoke=independentCommand('pin_revoke',5,1,5,1);const ir=await pin(independentRevokeGrant,independentRevoke);assert.equal(ir.receipt.reference.generation,2);assert.equal(ir.receipt.reference.credentialRevision,2);
   assert.equal((await call('already_revoked_terminal_is_not_new_sidecar',raw207('terminals',revokeTerminalGrant,{...terminalRevoke,operationId:next()}))).error,'attendance_operation_conflict');
   assert.equal((await call('already_revoked_member_PIN_is_not_new_sidecar',raw207('pin',memberRevokeGrant,memberCommand('pin_revoke',4)))).error,'attendance_pin_changed');
   const consumed=await grant('pin_revoke',independentScope(2));assert.equal((await call('already_revoked_independent_PIN_is_not_new_sidecar',raw207('pin',consumed,independentCommand('pin_revoke',6,2,6,2)))).error,'attendance_independent_unchanged');
   assert.equal((await call('same_original_body_conflict',raw207('terminals',revokeTerminalGrant,{...terminalRevoke,reason:'Synthetic207 changed original reason'},null,p.delegateAuth,false))).error,'attendance_operation_conflict');
  });
  await group(4,async()=>{
   await deny(pin(memberIssueGrant,null,null,p.plainAuth),'attendance_access_denied');
   assert.equal((await node.readPinReceipt({query:{...rq(memberIssueGrant,memberIssue.operationId),siteId:d.site},authUserId:p.delegateAuth})).receipt,null);
   assert.equal((await call('wrong_complete_employee_Auth',raw207('pin',memberRevokeGrant,{...memberCommand('pin_revoke',4),employeeAuthUserId:p.otherAuth}))).error,'attendance_access_denied');
   assert.equal((await call('private_material_for_GET_forbidden',delegatedCredentialsNativeRpcExpression('faolla_attendance_delegated_pin_v1',{p_query:q(memberIssueGrant),p_auth_user_id:p.delegateAuth,p_command:null,p_allow_write:false,p_material:{salt:'1'.repeat(32),verifier:'2'.repeat(64),commitment:'3'.repeat(64)}}))).error,'attendance_invalid_request');
   const core=`public.faolla_attendance_delegated_credentials_member_core_v1(${site},${quote(p.delegateAuth)},'SYNTHETIC207-MEMBER',null,null,false,${quote(memberIssueGrant)})`;
   assert.equal((await call('private207_core_service_cannot_execute',core)).sqlstate,'42501');
   const before=verifierDoubleCalls;await deny(offNode.executePin({query:q(memberIssueGrant),command:memberCommand('pin_issue',4),pin:'12345678',authUserId:p.delegateAuth,allowWrite:true}),'attendance_delegated_pin_disabled');assert.equal(verifierDoubleCalls,before);
  });
  await group(5,async()=>{
   const branch=await save('dc207_epoch');await status('disabled');await deny(pin(memberIssueGrant),'attendance_access_denied');assert.deepEqual((await recoverPin(memberIssueGrant,memberIssue)).receipt,memberResult.receipt);
   await status('active');const query={siteId,mode:'detail',afterId:null,suspensionId:null,operationId:null};
   const suspensionId=await step('actual207_delegate_paused_epoch','select suspension_id from public.merchant_attendance_account_epochs where merchant_id='+site+' and employee_id='+quote(p.delegate)+' and generation=1 and paused;');assert.match(suspensionId,/^[0-9a-f-]{36}$/);query.suspensionId=suspensionId;
   const prepared=await ok('actual164_delegate_restore_prepare',`public.faolla_attendance_account_suspensions_v1(${json(query)},${owner},null,true)`);assert(prepared.detail.canRestore);
   const c={action:'restore',operationId:next(),suspensionId,expectedGeneration:1,workerId:null,expectedWorkerVersion:prepared.detail.workerVersion,
    expectedEmployeeVersion:prepared.detail.employeeVersion,employeeId:p.delegate,employeeAuthUserId:p.delegateAuth,reason:'Synthetic207 real sameidentity explicit restore'};
   await ok('actual164_delegate_restore',`public.faolla_attendance_account_suspensions_v1(${json(query)},${owner},${json(c)},true)`,{write:true});
   await deny(pin(memberIssueGrant),'attendance_access_denied');assert.deepEqual((await recoverPin(memberIssueGrant,memberIssue)).receipt,memberResult.receipt);
   await restore('dc207_epoch',branch);
   await foundation({siteId,mode:'write'},{action:'revoke',operationId:next(),grantId:memberIssueGrant,expectedRevision:1,reason:'Synthetic207 actual currentgrant revoke'});
   await deny(pin(memberIssueGrant),'attendance_access_denied');assert.deepEqual((await recoverPin(memberIssueGrant,memberIssue)).receipt,memberResult.receipt);
  });
  await group(6,async()=>{
   atomicGrant=await grant('pin_issue',memberScope);const current=await pin(atomicGrant);assert.equal(current.context.status.revision,4);atomicCommand=memberCommand('pin_issue',4);
   const beforeCatalog=await step('fault_catalog_before','select '+managementAuditNativeCatalogSql(d.owned.oid)+';'),branch=await save('dc207_fault');
   await step('unique207_owned_AFTER23514_fault',delegatedCredentialsNativeFaultSql(atomicCommand.operationId));await deny(pin(atomicGrant,atomicCommand,'12345678'),'attendance_delegated_pin_invalid');
   assert.equal(lastRpc.error,'synthetic207_late_sidecar_failure');assert.equal(lastRpc.sqlstate,'23514');assert.equal(lastRpc.constraint,'synthetic207_owned_late_credentials_fault');
   assert.equal((await recoverPin(atomicGrant,atomicCommand)).receipt,null);await restore('dc207_fault',branch);
   await step('fault_catalog_exact_restored',`do $dc207_catalog$ begin assert to_regprocedure('public.synthetic207_owned_late_credentials_fault_v1()') is null;
    assert ${managementAuditNativeCatalogSql(d.owned.oid)}=${quote(beforeCatalog)};end;$dc207_catalog$;select 1;`);
   atomicResult=await pin(atomicGrant,atomicCommand,'12345678');assert.equal(atomicResult.receipt.reference.revision,5);
  });
  await group(7,async()=>{
   await legacy('settings',{timeZone:'UTC',enabled:false,webClockEnabled:true,webBreakPaid:false});await deny(pin(atomicGrant),'attendance_access_denied');
   assert.deepEqual((await recoverTerminal(prepareGrant,prepareCommand)).receipt,prepareResult.receipt);assert.deepEqual((await recoverPin(atomicGrant,atomicCommand)).receipt,atomicResult.receipt);
   const before=verifierDoubleCalls;await deny(offNode.executePin({query:q(atomicGrant),command:atomicCommand,pin:'12345678',authUserId:p.delegateAuth,allowWrite:false}),'attendance_delegated_pin_disabled');assert.equal(verifierDoubleCalls,before);
   const old=await offNode.executeTerminal({query:q(revokeTerminalGrant),command:terminalRevoke,pairSecret:null,authUserId:p.delegateAuth,allowWrite:false});assert.equal(old.receipt.reference.auditAction,'revoke');
   await step('three_atomic_ledgers_real_actor_appendonly_no_clock_side_effects',`do $dc207_immutable$ declare authority public.merchant_attendance_management_delegation_operations%rowtype;denied boolean;begin
    assert (select count(*) from public.merchant_attendance_management_delegation_operations where merchant_id=${site})=7;
    assert (select count(*) from public.merchant_attendance_delegated_credential_proofs where merchant_id=${site})=7;
    for authority in select * from public.merchant_attendance_management_delegation_operations where merchant_id=${site} loop
     assert authority.actor_auth_user_id=${quote(p.delegateAuth)} and authority.delegate_employee_id=${quote(p.delegate)} and authority.delegate_generation=0;
     perform public.faolla_attendance_delegated_credentials_proof_v1(authority,false);end loop;
    denied:=false;begin update public.merchant_attendance_delegated_credential_proofs set reference=reference where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    denied:=false;begin update public.merchant_attendance_management_delegation_operations set business_revision=business_revision where merchant_id=${site};exception when others then assert sqlerrm='attendance_events_append_only';denied:=true;end;assert denied;
    assert ${raw}=${quote(rawBaseline)},'dc207_clock_source_side_effect';${preserve}${external}end;$dc207_immutable$;select 1;`);
  });
  assert.equal(groups.length,8);assert(rpcs<=90&&steps<140);await step('rollback','rollback;');
  return {phase:207,groups,steps,rpcs,reads,writes,rejections,seedRows:7,newSite:siteId,actualNodeCoordinator:true,actualOwnerGrants:true,actualLegacyNullCores:true,
   actualSixCredentialActions:true,actualHistoricalDeviceIssuer:true,actualDelegateEpoch:true,actualPrivateMaterialReplay:true,actualThreeLedgerAtomicity:true,
   receiptOnlyRecovery:true,late23514AtomicFailure:true,rollbackRestored:true,noClockSourceSideEffects:true,verifierDoubleCalls,realKdfCalls:0,realAuth:false,browser:false,production:false,
   missingCoverage:['Real scrypt is not run: deterministic verifier doubles explicitly exercise material commitments. Actual Auth/device cookies, browser UI, wall-time expiry and settings-lock races are not claimed.']};
 }catch(error){primaryError=failure(error);throw primaryError;}
 finally{try{await delegatedCredentialsNativeCleanup(connection,pendingStep,[
   ['facts',()=>assert.equal(d.fingerprint(),baseline,'dc207_full_rollback_facts')],
   ['definitions',()=>assert.equal(d.definitions(),definitions)],['catalog',()=>assert.equal(d.tableCatalog(),catalog)],
   ['archive155',async()=>assert.deepEqual(periodContinuationArchiveBytes(await archive()),old155)],
   ['archive207',async()=>assert.deepEqual(periodContinuationArchiveBytes(await periodArchive()),old207)],
  ],primaryError);}catch(error){throw failure(error);}}
}
