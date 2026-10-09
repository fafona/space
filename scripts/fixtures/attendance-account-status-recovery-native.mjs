//194 inert SQL boundary probes. A genuine browser-created status operation is
//required; no receipt or business success is synthesized here. Only the current
//manager membership is temporarily perturbed, in ONE owned rollback transaction.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertLifecycleSandbox,lifecycleId as id,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
const require=createRequire(import.meta.url);
const replacementAuth=id(194910001);
const parseLines=output=>output.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));

function allFacts(names){
  assert(Array.isArray(names)&&names.length&&new Set(names).size===names.length);
  return '(select md5(jsonb_object_agg(asr_name,asr_rows order by asr_name)::text) from ('+names.map(name=>{
    assert(/^(?:merchants|faolla_schema_migrations|merchant_[a-z0-9_]+)$/.test(name));
    return `select ${quote(name)} asr_name,(select coalesce(jsonb_agg(to_jsonb(asr_row) order by to_jsonb(asr_row)::text),'[]') from public.${name} asr_row) asr_rows`;
  }).join(' union all ')+') asr_tables)';
}

export async function verifyAccountStatusRecoveryBoundaries(ctx,pending){
  const {d,h,native,scope,site,owner}=ctx??{};
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'status_recovery_synthetic_context_required');
  assert.equal(typeof native?.querySteps,'function');assert.equal(typeof scope?.sql,'function');assert.equal(typeof d.guard,'string');
  assert.equal(site,d.site);assert.equal(owner,d.owner);assert.match(site,/^\d{8}$/);
  for(const value of [owner,d.auth,d.employee,replacementAuth])assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(d.auth,owner);assert.notEqual(replacementAuth,d.auth);assert.notEqual(replacementAuth,owner);
  assert.deepEqual(Object.keys(pending??{}).sort(),['key','operationId','raw']);
  const {parseKnownAccountStatusRecovery}=require('../../src/lib/merchantAttendanceAccountStatusRecovery.ts');
  const {parseAccountSuspensionJson,parseAccountStatusCommand,parseAccountSuspensionResult,accountStatusReceiptMatches}=require('../../src/lib/merchantAttendanceAccountSuspension.ts');
  const entry=await parseKnownAccountStatusRecovery(pending.key,pending.raw,d.auth);
  assert(entry,'status_recovery_real_actor_pending_required');assert.equal(entry.siteId,site);assert.equal(entry.operationId,pending.operationId);
  const command=parseAccountStatusCommand(parseAccountSuspensionJson(pending.raw,'request').command);
  const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));
  assert.deepEqual(owned,d.owned);assert.equal(scope.schema,owned.schema);
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog(),facts=allFacts(d.inventory());
  const query={siteId:site,mode:'recover-status',afterId:null,suspensionId:null,operationId:pending.operationId};
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const merchant=quote(site),employee=quote(d.employee),auth=quote(d.auth),replacement=quote(replacementAuth);
  const rpc=actor=>`public.faolla_attendance_account_suspensions_v1(${json(query)},${quote(actor)},null,false)`;
  const read=label=>`${prefix}do $asr_read$ declare before_hash text;r jsonb;begin
    before_hash:=${facts};set local role service_role;r:=${rpc(d.auth)};reset role;
    assert ${facts}=before_hash,${quote('status_recovery_read_zero_writes_'+label)};
    perform set_config('qa_status_recovery.result',r::text,true);
    end;$asr_read$;
    select jsonb_build_object('kind','read','label',${quote(label)},'value',current_setting('qa_status_recovery.result')::jsonb);`;
  const deny=(label,actor)=>`${prefix}do $asr_deny$ declare before_hash text;begin
    before_hash:=${facts};
    begin set local role service_role;perform ${rpc(actor)};reset role;raise exception 'status_recovery_expected_denial_missing';
    exception when raise_exception then reset role;if sqlerrm<>'attendance_access_denied' then raise;end if;end;
    assert ${facts}=before_hash,${quote('status_recovery_rejection_zero_writes_'+label)};
    end;$asr_deny$;select jsonb_build_object('kind','denied','label',${quote(label)},'code','attendance_access_denied');`;
  const prepare=`begin;${prefix}do $asr_prepare$ begin
    assert exists(select 1 from public.faolla_schema_migrations where version=202610060164),'status_recovery164_required';
    assert exists(select 1 from public.merchant_enterprise_employees where merchant_id=${merchant} and id=${employee} and auth_user_id=${auth} and status='active'),'status_recovery_current_active_manager';
    assert exists(select 1 from public.merchant_attendance_account_status_operations where merchant_id=${merchant} and operation_id=${quote(pending.operationId)}
      and actor_auth_user_id=${auth} and actor_employee_id=${employee} and employee_id=${quote(command.employeeId)}
      and expected_version=${command.version} and version=${command.version+1} and status=${quote(command.status)}
      and command_fingerprint=${quote(entry.commandFingerprint)}),'status_recovery_original_manager_receipt';
    assert not exists(select 1 from public.merchant_enterprise_employees where auth_user_id=${replacement}),'status_recovery_unused_auth';
    assert not exists(select 1 from public.merchants m where ${replacement}::uuid=any(array[m.user_id,m.auth_user_id,m.owner_user_id,m.owner_id,m.auth_id,m.created_by,m.created_by_user_id])),'status_recovery_unused_owner_auth';
    end;$asr_prepare$;`+read('original');
  const disable=`${prefix}do $asr_disable$ declare n integer;begin
    update public.merchant_enterprise_employees set status='disabled' where merchant_id=${merchant} and id=${employee} and auth_user_id=${auth} and status='active';
    get diagnostics n=row_count;assert n=1,'status_recovery_one_disabled_manager';
    end;$asr_disable$;set constraints all immediate;`+read('membership_disabled');
  const rebind=`${prefix}do $asr_rebind$ declare n integer;begin
    --Return to active before testing Auth alone, so inactivity is not the cause
    --of either rejection. This is a reversible synthetic perturbation, not the
    --product's account activation/rebinding workflow.
    update public.merchant_enterprise_employees set status='active',auth_user_id=${replacement}
      where merchant_id=${merchant} and id=${employee} and auth_user_id=${auth} and status='disabled';
    get diagnostics n=row_count;assert n=1,'status_recovery_one_rebound_manager';
    end;$asr_rebind$;set constraints all immediate;`+deny('old_auth_after_rebind',d.auth)+deny('new_auth_cannot_inherit',replacementAuth);
  const steps=[prepare,disable,rebind,`${prefix}set constraints all immediate;rollback;`];
  assert.equal(steps.length,4);let rows;const failures=[];
  try{rows=parseLines(await native.querySteps(steps.map((step,index)=>scope.sql(`--status_recovery_stage_${index+1}\n`+step))));}
  catch(error){failures.push(error);}
  finally{for(const [label,run,expected] of [['status_recovery_all_facts_restored',()=>d.fingerprint(),baseline],
    ['status_recovery_definitions_unchanged',()=>d.definitions(),definitions],['status_recovery_catalog_unchanged',()=>d.tableCatalog(),catalog]]){
    try{assert.equal(run(),expected,label);}catch(error){failures.push(error);}}}
  if(failures.length)throw new AggregateError(failures,'account_status_recovery_boundaries_failed: '+failures.map(error=>error.message).join(' | '));
  assert.deepEqual(rows.map(row=>[row.kind,row.label]),[['read','original'],['read','membership_disabled'],['denied','old_auth_after_rebind'],['denied','new_auth_cannot_inherit']]);
  const results=rows.filter(row=>row.kind==='read').map(row=>parseAccountSuspensionResult(row.value,query,d.auth));
  for(const result of results){assert.deepEqual(result.items,[]);assert.equal(result.detail,null);assert.equal(result.receipt,null);assert.equal(result.nextAfterId,null);
    assert(result.statusReceipt);assert(accountStatusReceiptMatches(result.statusReceipt,command,entry.commandFingerprint));}
  assert.deepEqual(results[1],results[0],'status_recovery_disabled_exact_original_receipt');
  for(const row of rows.filter(value=>value.kind==='denied'))assert.equal(row.code,'attendance_access_denied');
  native.pass('status recovery: disabled same-Auth manager keeps exact minimal receipt; Auth rebinding denies old and replacement actors; all SQL probes roll back');
  return {sqlReads:2,sqlRejections:2,outerRollbackTransactions:1,businessRpcWrites:0,syntheticMembershipPerturbations:2,
    disabledSameAuthExactReceipt:true,oldAuthAfterRebindRejected:true,newAuthCannotInheritReceipt:true,
    allReadsAndRejectionsZeroWrites:true,allFactsDefinitionsCatalogRestored:true,
    fixture:'Actual service-role SQL reads of a genuine browser-created operation, with two synthetic current-membership perturbations in one rollback transaction. This is not HTTP/browser authentication or a real account-rebinding workflow.'};
}
