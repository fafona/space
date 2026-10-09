import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url),uid=n=>id(233900000+n);
export async function verifyPeriodDelegatedClosureNative(ctx){
 const {d,h,native,scope}=ctx;assert.equal(d.syntheticOnly,true);assert.equal(h.syntheticOnly,true);
 assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
 const {executePeriodDelegation}=require('../../src/lib/merchantAttendancePeriodDelegation.server.ts');
 const {executePeriodDelegatedClosures}=require('../../src/lib/merchantAttendancePeriodDelegatedClosure.server.ts');
 const {executePeriodClosuresV2}=require('../../src/lib/merchantAttendancePeriodClosureV2.server.ts');
 const date=new Date(Date.parse(h.slot.startAt.slice(0,10)+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const site=quote(d.site),delegate=uid(1),auth=uid(2),role=uid(3),grantId=uid(4),pid=uid(5);
 const before=d.fingerprint(),names=d.inventory(),connection=native.connect(),allHash=outageNativeFingerprintSql(names);
 const mutable=['merchant_attendance_period_closures','merchant_attendance_period_storage'];
 const append=['merchant_attendance_period_artifacts','merchant_attendance_period_versions','merchant_attendance_period_entries',
  'merchant_attendance_period_artifact_metadata','merchant_attendance_period_delegations','merchant_attendance_period_delegation_revocations',
  'merchant_attendance_period_delegation_operations','merchant_attendance_account_epochs'];
 const protectedHash=outageNativeFingerprintSql(names.filter(n=>!mutable.includes(n)&&!append.includes(n)));
 const oldRows=`jsonb_build_object(${append.map(n=>`${quote(n)},(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.${n} x)`).join(',')})`;
 const preserve=append.map(n=>`assert not exists(select x.value from jsonb_array_elements(prior_rows->${quote(n)}) x(value) except select to_jsonb(x) from public.${n} x),'delegated_old_row_changed:${n}';`).join('\n');
 const oldClosures=`(select md5(coalesce(jsonb_agg(to_jsonb(x) order by merchant_id,period_id)::text,'[]')) from public.merchant_attendance_period_closures x where merchant_id<>${site} or period_id<>${quote(pid)})`;
 const otherStorage=`(select md5(coalesce(jsonb_agg(to_jsonb(x) order by merchant_id)::text,'[]')) from public.merchant_attendance_period_storage x where merchant_id<>${site})`;
 const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO,YMD';set local extra_float_digits=3;"+d.guard;
 let steps=0,reads=0,writes=0,rejections=0,stage='begin',rolledBack=false,lastRpc=null,serial=100;
 const step=async(label,sql)=>{stage=label;assert(++steps<=85,'delegated_closure_max85_steps');return connection.step(scope.sql((label==='begin'?'begin;':'')+prefix+sql));};
 const rpc=async(name,args)=>{
  assert(['faolla_attendance_period_delegation_v1','faolla_attendance_period_delegated_closure_v1','faolla_attendance_period_closure_v2','faolla_attendance_period_closure_source_v1'].includes(name));
  assert.equal(args.p_query.siteId,d.site);assert([d.owner,auth,h.employeeAuthUserId].includes(args.p_auth_user_id));
  const params=[json(args.p_query),quote(args.p_auth_user_id)];
  if(name!=='faolla_attendance_period_closure_source_v1'){params.push(json(args.p_command));if(name!=='faolla_attendance_period_delegation_v1')params.push(json(args.p_artifact));params.push(String(args.p_allow_write));}
  const expression=`public.${name}(${params.join(',')})`;
  const r=JSON.parse(await step('rpc_'+name+'_'+(args.p_command?.action??args.p_query.mode??'source'),`do $dc_rpc$ declare old_hash text;protected_before text;closures_before text;storage_before text;prior_rows jsonb;value jsonb;failure text;sql_state text;failure_context text;begin
   old_hash:=${allHash};protected_before:=${protectedHash};closures_before:=${oldClosures};storage_before:=${otherStorage};prior_rows:=${oldRows};assert octet_length(prior_rows::text)<=2097152;
   begin set local role service_role;assert current_user='service_role';value:=${expression};set constraints all immediate;set constraints all deferred;
    exception when others then get stacked diagnostics failure=message_text,sql_state=returned_sqlstate,failure_context=pg_exception_context;end;reset role;
   if failure is not null or ${args.p_command==null?'true':'false'} then assert ${allHash}=old_hash,'delegated_read_or_rejection_wrote';end if;
   assert ${protectedHash}=protected_before,'delegated_changed_unrelated_facts';assert ${oldClosures}=closures_before,'delegated_changed_old_period';
   assert ${otherStorage}=storage_before,'delegated_changed_other_budget';${preserve}
   assert (select used_bytes from public.merchant_attendance_period_storage where merchant_id=${site})=(select coalesce(sum(artifact_bytes),0) from public.merchant_attendance_period_artifacts where merchant_id=${site}),'delegated_budget_not_exact';
   perform set_config('faolla.dc233_result',jsonb_build_object('value',value,'error',failure,'sqlstate',sql_state,'context',failure_context)::text,true);
  end;$dc_rpc$;select current_setting('faolla.dc233_result')::jsonb;`));lastRpc=r;
  if(r.error){rejections++;return {data:null,error:{message:r.error}};}
  if(args.p_command)writes++;else reads++;return {data:r.value,error:null};
 };
 const q=(mode='detail',patch={})=>({siteId:d.site,access:'delegate',grantId,workerId:h.workerId,fromDate:date,throughDate:date,
  mode,periodId:['list','preview'].includes(mode)?null:pid,operationId:null,version:null,cursor:null,...patch});
 const mg=(mode='list',patch={})=>({siteId:d.site,access:'owner',mode,catalog:null,grantId:null,afterId:null,operationId:null,...patch});
 const management=(query,command=null,allowWrite=true)=>executePeriodDelegation({query,command,authUserId:d.owner,allowWrite},{rpc});
 const run=(query,command=null,moduleEnabled=true)=>executePeriodDelegatedClosures({query,command,authUserId:auth,moduleEnabled},{rpc});
 const oldq=(access='self')=>({siteId:d.site,access,workerId:h.workerId,fromDate:date,throughDate:date,mode:'detail',periodId:pid,operationId:null,version:null,cursor:null});
 const original=(access='self',command=null)=>executePeriodClosuresV2({query:oldq(access),command,authUserId:access==='self'?h.employeeAuthUserId:d.owner,moduleEnabled:true},{rpc});
 const cmd=(action,head,fingerprint=null)=>({action,operationId:uid(++serial),periodId:pid,expectedRevision:head?.revision??0,expectedVersion:head?.currentVersion??0,expectedFingerprint:fingerprint,reason:'Synthetic233 explicit '+action});
 try{
  const profile=JSON.parse(await step('begin',`set local lock_timeout='3s';set local statement_timeout='10s';
   do $dc_seed$ begin assert not exists(select 1 from public.merchant_enterprise_employees where id=${quote(delegate)} or auth_user_id=${quote(auth)});
    assert not exists(select 1 from public.merchant_enterprise_roles where id=${quote(role)});assert not exists(select 1 from public.merchant_attendance_period_closures where period_id=${quote(pid)});
   end;$dc_seed$;
   insert into public.merchant_enterprise_roles(id,merchant_id,name,permissions) values(${quote(role)},${site},'Synthetic233 supervisor',array['enterprise.view','attendance.period.view','attendance.period.send','attendance.period.respond','attendance.period.seal','attendance.period.reopen']);
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
    values(${quote(delegate)},${site},${quote(auth)},'synthetic233-supervisor@example.test','Synthetic233 supervisor',${quote(role)},'active',clock_timestamp(),1);
   select jsonb_build_object('from',to_char((clock_timestamp()-interval '1 minute') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'until',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'employeeId',(select employee_id from public.merchant_attendance_workers where merchant_id=${site} and id=${quote(h.workerId)}));`));
  await management(mg(),{action:'grant',operationId:grantId,delegateEmployeeId:delegate,delegateAuthUserId:auth,workerId:h.workerId,
   employeeId:profile.employeeId,employeeAuthUserId:h.employeeAuthUserId,fromDate:date,throughDate:date,actions:['view','send','respond','seal','reopen'],includeExisting:false,
   validFrom:profile.from,validUntil:profile.until,reason:'Synthetic233 one exact employee period'});
  const preview=await run(q('preview'));assert.equal(preview.kind,'preview');assert.deepEqual(preview.preview.blockers,[]);
  const first=cmd('send',null,preview.preview.artifact.sourceFingerprint),firstReceipt=await run(q(),first);
  assert.equal(firstReceipt.kind,'receipt');assert.equal(firstReceipt.receipt.actorId,auth);assert.equal(firstReceipt.receipt.periodRevision,1);
  assert.deepEqual((await run(q(),first)).receipt,firstReceipt.receipt);
  let head=await run(q());assert.equal(head.artifact.protocol,'attendance-period-artifact-v2');assert.equal(head.artifact.report.access,'delegate');
  assert.equal(head.artifact.authority.actorAuthUserId,auth);assert.equal(head.artifact.authority.actorEmployeeId,delegate);assert.equal(head.artifact.authority.action,'send');
  const initialArtifact=JSON.stringify(head.artifact),fp=head.artifact.sourceFingerprint;
  assert.equal(JSON.stringify((await original('owner')).artifact),initialArtifact);assert.equal(JSON.stringify((await original()).artifact),initialArtifact);
  await assert.rejects(run(q(),cmd('seal',head.period,fp)),e=>e.code==='attendance_period_not_confirmed');
  await assert.rejects(run(q(),cmd('confirm',head.period,fp)),e=>e.code==='attendance_invalid_request');
  await original('self',cmd('dispute',head.period));head=await run(q());assert.equal(head.period.unresolvedDispute,true);
  await run(q(),cmd('respond',head.period));head=await run(q());assert.equal(head.period.unresolvedDispute,true);
  await assert.rejects(run(q(),cmd('seal',head.period,fp)),e=>e.code==='attendance_period_not_confirmed');
  await original('self',cmd('confirm',head.period,fp));head=await run(q());assert.equal(head.period.confirmedVersion,1);
  await run(q(),cmd('seal',head.period,fp));head=await run(q());assert.equal(head.period.sealed,true);
  await run(q(),cmd('reopen',head.period));head=await run(q());assert.equal(head.period.confirmedVersion,null);assert.equal(head.period.state,'open');
  await run(q(),cmd('send',head.period,fp));head=await run(q());assert.equal(head.period.currentVersion,2);assert.equal(JSON.stringify(head.artifact),initialArtifact);
  const history=await run(q('history')),versions=await run(q('versions'));assert.equal(history.items.length,head.period.revision);assert.equal(versions.items.length,2);
  assert.equal((await run(q('list'))).items.length,1);
  const fault=cmd('respond',head.period);
  await step('inject_owned_sidecar_failure',`alter table public.merchant_attendance_period_delegation_operations add constraint synthetic233_fault check(operation_id<>${quote(fault.operationId)}) not valid;select 1;`);
  await assert.rejects(run(q(),fault),e=>e.code==='attendance_unavailable');assert.equal(lastRpc.sqlstate,'23514');
  await step('remove_owned_sidecar_failure',`alter table public.merchant_attendance_period_delegation_operations drop constraint synthetic233_fault;select 1;`);
  const absent=await run(q('recover',{operationId:fault.operationId}));assert.equal(absent.receipt,null);
  await original('self',cmd('confirm',head.period,fp));head=await run(q());await run(q(),cmd('seal',head.period,fp));
  await management(mg('detail',{grantId}),{action:'revoke',operationId:uid(++serial),grantId,expectedRevision:1,reason:'Synthetic233 explicit revoke'},false);
  await assert.rejects(run(q()),e=>e.code==='attendance_access_denied');
  assert.deepEqual((await run(q('recover',{operationId:first.operationId}),null,false)).receipt,firstReceipt.receipt);
  const finalOwner=await original('owner');assert.equal(JSON.stringify(finalOwner.artifact),initialArtifact);
  const proof=JSON.parse(await step('exact_ledger_footprint',`select jsonb_build_object('artifacts',(select count(*) from public.merchant_attendance_period_artifacts where merchant_id=${site} and period_id=${quote(pid)}),
    'proofsValid',not exists(select 1 from public.merchant_attendance_period_delegation_operations x where x.merchant_id=${site} and not public.faolla_attendance_period_delegation_proof_v1(x)),
    'delegateWorkers',(select count(*) from public.merchant_attendance_workers where merchant_id=${site} and employee_id=${quote(delegate)}));`));
  assert.equal(proof.artifacts,1);assert.equal(proof.proofsValid,true);assert.equal(proof.delegateWorkers,0);
  // Authorization-only probes run after the successful lifecycle, never in
  // place of it. Every rejected real187 call retains rpc's complete fact hash.
  // Exact temporary identity/role seeds are not real Auth acceptance. Their
  // out-of-scope rows are protected immediately, and each savepoint restores
  // ALL facts (including audit rows). No grant timestamps/epochs are forged.
  const matrixCases=[],actions=['view','send','respond','seal','reopen'];
  const matrixGrant=uid(++serial),viewGrant=uid(++serial),foreign=uid(++serial),foreignAuth=uid(++serial);
  const grantCommand=(operationId,patch={})=>({action:'grant',operationId,delegateEmployeeId:delegate,delegateAuthUserId:auth,
   workerId:h.workerId,employeeId:profile.employeeId,employeeAuthUserId:h.employeeAuthUserId,fromDate:date,throughDate:date,
   actions,includeExisting:true,validFrom:profile.from,validUntil:profile.until,reason:'Synthetic233 isolated authorization matrix',...patch});
  const matrixQuery=(patch={})=>q('detail',{grantId:matrixGrant,...patch});
  const deny=async(label,query=matrixQuery(),action=null)=>{
   const command=action?cmd(action,finalOwner.period,['send','seal'].includes(action)?fp:null):null;
   const result=await rpc('faolla_attendance_period_delegated_closure_v1',{p_query:query,p_auth_user_id:auth,p_command:command,p_artifact:null,p_allow_write:true});
   assert.equal(result.error?.message,'attendance_access_denied',label);assert.equal(lastRpc.sqlstate,'P0001',label);matrixCases.push(label);
  };
  const save=async name=>JSON.parse(await step(name,`savepoint ${name};select jsonb_build_object('hash',${allHash});`)).hash;
  const restore=async(name,hash)=>step('restore_'+name,`rollback to savepoint ${name};release savepoint ${name};
   do $dc_matrix_restore$ begin assert ${allHash}=${quote(hash)},'delegated_matrix_savepoint_not_exact';end;$dc_matrix_restore$;select 1;`);
  // Setup exceptions are exact rows, not whole tables. Existing rows in an
  // append scope are compared in full; only new rows within that scope may appear.
  const setup=async(label,sql,mutableRows={},appendRows={},savepoint=true)=>{
   const allowed={...mutableRows,...appendRows};for(const name of Object.keys(allowed))assert(names.includes(name));
   const outside=`(select md5(jsonb_object_agg(matrix_table,matrix_rows order by matrix_table)::text) from (${names.map(name=>
    `select ${quote(name)} matrix_table,(select coalesce(jsonb_agg(to_jsonb(matrix_row) order by to_jsonb(matrix_row)::text),'[]') from public.${name} matrix_row${allowed[name]?` where (${allowed[name]}) is not true`:''}) matrix_rows`).join(' union all ')}) matrix_facts)`;
   const prior=Object.keys(appendRows).length?`jsonb_build_object(${Object.entries(appendRows).map(([name,where])=>`${quote(name)},(select coalesce(jsonb_agg(to_jsonb(matrix_row)),'[]') from public.${name} matrix_row where ${where})`).join(',')})`:`'{}'::jsonb`;
   const oldGuard=Object.keys(appendRows).map(name=>`assert not exists(select matrix_old.value from jsonb_array_elements(matrix_prior->${quote(name)}) matrix_old(value) except select to_jsonb(matrix_row) from public.${name} matrix_row),'delegated_matrix_old_row:${name}';`).join('\n');
   return JSON.parse(await step(label,`${savepoint?'savepoint dc_matrix_case;':''}do $dc_matrix_setup$ declare matrix_hash text;matrix_all text;matrix_prior jsonb;
    matrix_result jsonb;matrix_detail jsonb;matrix_until timestamptz;matrix_query jsonb;matrix_status jsonb;begin
    matrix_all:=${allHash};matrix_hash:=${outside};matrix_prior:=${prior};assert octet_length(matrix_prior::text)<=2097152;
    ${sql}
    reset role;set constraints all immediate;set constraints all deferred;
    assert ${outside}=matrix_hash,'delegated_matrix_setup_outside_scope';${oldGuard}
    perform set_config('faolla.dc233_matrix',jsonb_build_object('hash',matrix_all)::text,true);
   end;$dc_matrix_setup$;select current_setting('faolla.dc233_matrix')::jsonb;`)).hash;
  };
  const memberScope=employee=>`matrix_row.merchant_id=${site} and matrix_row.id=${quote(employee)}`;
  const auditScope=entity=>`matrix_row.merchant_id=${site} and matrix_row.entity_id=${quote(entity)}`;
  const matrixBefore=await save('dc_matrix_all');
  await management(mg(),grantCommand(matrixGrant));
  await management(mg(),grantCommand(viewGrant,{actions:['view']}));
  assert.deepEqual((await run(matrixQuery({grantId:viewGrant}))).usableActions,['view']);
  for(const action of actions.slice(1))await deny('grant_view_only_'+action,matrixQuery({grantId:viewGrant}),action);
  const roleBefore=await setup('matrix_role_view_only',`update public.merchant_enterprise_roles set permissions=array['enterprise.view','attendance.period.view'] where merchant_id=${site} and id=${quote(role)};assert found;`,
   {merchant_enterprise_roles:memberScope(role)},{merchant_enterprise_audit_events:auditScope(role)});
  assert.deepEqual((await run(matrixQuery())).usableActions,['view']);
  for(const action of actions.slice(1))await deny('role_missing_'+action,matrixQuery(),action);
  await restore('dc_matrix_case',roleBefore);
  await deny('wrong_target_worker',matrixQuery({workerId:uid(++serial)}));
  const wrongDate=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  await deny('outside_granted_dates',matrixQuery({fromDate:wrongDate,throughDate:wrongDate}));
  const foreignBefore=await setup('matrix_foreign_delegate',`assert not exists(select 1 from public.merchant_enterprise_employees where id=${quote(foreign)} or auth_user_id=${quote(foreignAuth)});
   insert into public.merchant_enterprise_employees(id,merchant_id,auth_user_id,email,display_name,role_id,status,accepted_at,version)
    values(${quote(foreign)},${site},${quote(foreignAuth)},'synthetic233-foreign@example.test','Synthetic233 different delegate',${quote(role)},'active',clock_timestamp(),1);`,
   {},{merchant_enterprise_employees:memberScope(foreign),merchant_enterprise_audit_events:auditScope(foreign)});
  const foreignGrant=uid(++serial);await management(mg(),grantCommand(foreignGrant,{delegateEmployeeId:foreign,delegateAuthUserId:foreignAuth}));
  await deny('another_delegates_real_grant',matrixQuery({grantId:foreignGrant}));await restore('dc_matrix_case',foreignBefore);
  const historicalGrant=uid(++serial);await management(mg(),grantCommand(historicalGrant,{includeExisting:false}));
  await deny('existing_period_not_explicitly_included',matrixQuery({grantId:historicalGrant}));
  const futureGrant=uid(++serial),futureUntil=new Date(Date.parse(profile.until)+86400000).toISOString().replace('Z','000Z');
  await management(mg(),grantCommand(futureGrant,{validFrom:profile.until,validUntil:futureUntil}));
  await deny('grant_not_yet_effective',matrixQuery({grantId:futureGrant}));
  const expiredGrant=uid(++serial);
  await setup('matrix_real_expiration',`matrix_until:=clock_timestamp()+interval '1 second';set local role service_role;
   matrix_result:=public.faolla_attendance_period_delegation_v1(${json(mg())},${quote(d.owner)},
    ${json(grantCommand(expiredGrant))}||jsonb_build_object('validUntil',to_char(matrix_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),true);
   assert matrix_result->'receipt'->>'operationId'=${quote(expiredGrant)};reset role;
   perform pg_sleep(least(1.01,greatest(0,extract(epoch from matrix_until-clock_timestamp()))::double precision+0.01));
   assert clock_timestamp()>=matrix_until;`,{},
   {merchant_attendance_period_delegations:`matrix_row.merchant_id=${site} and matrix_row.grant_id=${quote(expiredGrant)}`},false);writes++;
  await deny('grant_expired',matrixQuery({grantId:expiredGrant}));
  for(const [label,employee,assignment] of [
   ['target_identity_rebound',profile.employeeId,`auth_user_id=${quote(uid(++serial))}`],
   ['delegate_identity_rebound',delegate,`auth_user_id=${quote(uid(++serial))}`],
   ['target_membership_disabled',profile.employeeId,"status='disabled'"]]){
   const caseBefore=await setup('matrix_'+label,`update public.merchant_enterprise_employees set ${assignment} where merchant_id=${site} and id=${quote(employee)};assert found;`,
    {merchant_enterprise_employees:memberScope(employee)},{merchant_enterprise_audit_events:auditScope(employee)});
   await deny(label);await restore('dc_matrix_case',caseBefore);
  }
  const accountScope=`matrix_row.merchant_id=${site} and matrix_row.employee_id=${quote(delegate)}`;
  const statusCall=status=>`matrix_status:=${json({merchant_id:d.site,employee_id:delegate,actor_type:'owner',actor_id:d.owner,status,
   ...(status==='disabled'?{offboarding_mode:'unassign'}:{}),attendance_operation_id:uid(++serial),attendance_suspension_enabled:true})}||jsonb_build_object('expected_version',
    (select version from public.merchant_enterprise_employees where merchant_id=${site} and id=${quote(delegate)}));
   set local role service_role;matrix_status:=public.faolla_update_merchant_enterprise_employee_v1(matrix_status);reset role;`;
  const pauseBefore=await setup('matrix_real_delegate_pause',`assert not exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(delegate)});
   ${statusCall('disabled')}
   assert matrix_status->'employee'->>'status'='disabled';assert exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(delegate)} and generation=1 and paused);`,
   {merchant_enterprise_employees:memberScope(delegate)},
   {merchant_enterprise_audit_events:auditScope(delegate),merchant_attendance_account_epochs:accountScope,merchant_attendance_account_suspensions:accountScope,merchant_attendance_account_status_operations:accountScope});
  writes++;
  await deny('delegate_disabled_and_paused');
  await setup('matrix_real_delegate_restore',`${statusCall('active')}
   assert matrix_status->'employee'->>'status'='active';
   matrix_query:=jsonb_build_object('siteId',${site},'mode','detail','afterId',null,'operationId',null,'suspensionId',
    (select suspension_id from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(delegate)}));
   set local role service_role;matrix_result:=public.faolla_attendance_account_suspensions_v1(matrix_query,${quote(d.owner)},null,true);matrix_detail:=matrix_result->'detail';
   assert (matrix_detail->>'canRestore')::boolean and matrix_detail->'blockers'='[]'::jsonb;
   assert matrix_detail->'suspension'->'workerId'='null'::jsonb and matrix_detail->'workerVersion'='null'::jsonb;
   matrix_result:=public.faolla_attendance_account_suspensions_v1(matrix_query,${quote(d.owner)},jsonb_build_object('action','restore','operationId',${quote(uid(++serial))},
    'suspensionId',matrix_query->'suspensionId','expectedGeneration',matrix_detail->'suspension'->'generation','workerId',null,'expectedWorkerVersion',null,
    'expectedEmployeeVersion',matrix_detail->'employeeVersion','employeeId',${quote(delegate)},'employeeAuthUserId',${quote(auth)},'reason','Synthetic233 restore original delegate'),true);reset role;
   assert matrix_result->'receipt'->'workerId'='null'::jsonb;
   assert exists(select 1 from public.merchant_attendance_account_epochs where merchant_id=${site} and employee_id=${quote(delegate)} and generation=1 and not paused);
   assert not exists(select 1 from public.merchant_attendance_workers where merchant_id=${site} and employee_id=${quote(delegate)});`,
   {merchant_enterprise_employees:memberScope(delegate),merchant_attendance_account_epochs:accountScope},
   {merchant_enterprise_audit_events:auditScope(delegate),merchant_attendance_account_status_operations:accountScope,merchant_attendance_account_restores:accountScope},false);
  writes+=2;reads++;
  await deny('restored_identity_old_epoch_still_rejected');await restore('dc_matrix_case',pauseBefore);
  await restore('dc_matrix_all',matrixBefore);assert.equal(matrixCases.length,19);
  await step('rollback','rollback;');rolledBack=true;
  return {steps,reads,writes,rejections,actualDelegatedFourWrites:true,selfConfirmationOnly:true,unchangedReusedArtifact:true,sidecarFailureRollback:true,
    originalActorReceiptAfterRevocation:true,oldOwnerSelfCompatible:true,authorizationMatrix:{cases:matrixCases,allRejectionsZeroWrites:true,savepointsFullyRestored:true,
     realStatusWrites:2,realAccountRestoreWrites:1,realAccountDetailReads:1,realExpiration:true,syntheticIdentitySeeds:true,targetOffboardingRpcCovered:false},rollbackRestored:true,browser:false,realAuth:false};
 }catch(error){throw new Error(`period_delegated_closure:${stage}:${error?.stack??String(error)}:${JSON.stringify(lastRpc?.error?lastRpc:null)}`);}
 finally{if(!rolledBack)await connection.step('rollback;').catch(()=>{});await connection.close();assert.equal(d.fingerprint(),before,'delegated_closure_transaction_not_restored');}
}
