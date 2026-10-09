//189 inert, caller-owned PostgreSQL probes. No environment is created here.
//Two temporary genuine grants, genuine RPC approval, and an explicitly injected
//NEW-table CHECK failure all roll back. This is not a natural production fault.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

export async function verifyMissingDelegationAtomicNative(c){
  const {d,h,native,scope,ownerQuery,delegateQuery,grant,expr,next,actor,employee}=c;
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true);
  assert.equal(typeof d.guard,'string');assert.equal(typeof native.querySteps,'function');
  assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/);
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  for(const value of [h.workerId,h.employeeId,h.employeeAuthUserId,d.location,actor,employee])assert.match(value,/^[0-9a-f-]{36}$/);
  assert.notEqual(actor,h.employeeAuthUserId,'atomic_distinct_delegate_and_applicant_required');
  const baseline=d.fingerprint(),definitions=d.definitions(),catalog=d.tableCatalog();
  //Use a real pending request left by the primary189 employee-submit path,
  //not a copied row, future invalid request, already-terminal item or self-review.
  const request=JSON.parse(d.exec(`select jsonb_build_object('requestId',r.request_id,'locationId',r.location_id,
      'employeeId',r.employee_id,'employeeAuthUserId',r.actor_auth_user_id)
    from public.merchant_attendance_missing_requests r
    join public.merchant_attendance_missing_entries e on e.merchant_id=r.merchant_id and e.request_id=r.request_id and e.revision=1
    where r.merchant_id=${quote(d.site)} and r.worker_id=${quote(h.workerId)} and r.employee_id=${quote(h.employeeId)}
      and r.actor_auth_user_id=${quote(h.employeeAuthUserId)} and r.location_id=${quote(d.location)}
      and r.reason='Synthetic189 employee genuine missing request' and e.action='submit' and e.actor_auth_user_id=r.actor_auth_user_id
      and not exists(select 1 from public.merchant_attendance_missing_entries t where t.merchant_id=r.merchant_id and t.request_id=r.request_id and t.revision=2)
    order by r.submitted_at desc,r.request_id desc limit 1;`));
  assert(request?.requestId,'atomic_real_pending_request_required');
  assert.equal(request.locationId,d.location);assert.equal(request.employeeId,h.employeeId);assert.equal(request.employeeAuthUserId,h.employeeAuthUserId);
  const otherLocation=d.exec(`select id from public.merchant_attendance_locations where merchant_id=${quote(d.site)} and active and id<>${quote(d.location)} order by id limit 1;`);
  assert.match(otherLocation,/^[0-9a-f-]{36}$/,'atomic_existing_other_location_required');assert.notEqual(otherLocation,d.location);
  const inGrant=grant(),outGrant=grant({locationId:otherLocation});
  assert.equal(inGrant.workerId,h.workerId);assert.equal(inGrant.locationId,d.location);
  const inQuery=delegateQuery({mode:'detail',grantId:inGrant.operationId,requestId:request.requestId});
  const outQuery=delegateQuery({mode:'detail',grantId:outGrant.operationId,requestId:request.requestId});
  const outList=delegateQuery({mode:'list',grantId:outGrant.operationId});
  const positiveOp=next(),outsideOp=next(),faultOp=next();
  const command=(grantId,operationId)=>({grantId,expectedGrantRevision:1,decision:{action:'approve',operationId,requestId:request.requestId,
    expectedRevision:1,evidenceToken:'0'.repeat(32),reason:'Synthetic189 atomic authority probe'}});
  //The token comes from the actual matching-scope read inside EACH step, never
  //from a stale browser or a made-up owner. Cross-scope denial cannot be a token
  //mismatch because both grants otherwise authorize the same actor/worker.
  const invoke=(q,operationId)=>`public.faolla_attendance_delegated_missing_v1(${json({...q,mode:'decide'})},${quote(actor)},
    jsonb_set(${json(command(q.grantId,operationId))},'{decision,evidenceToken}',review->'detail'->'evidenceToken'),true)`;
  const missingEntry=op=>`not exists(select 1 from public.merchant_attendance_missing_entries where merchant_id=${quote(d.site)} and operation_id=${quote(op)})`;
  const missingAuthority=op=>`not exists(select 1 from public.merchant_attendance_missing_delegation_decisions where merchant_id=${quote(d.site)} and operation_id=${quote(op)})`;
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const ready=`set local role service_role;review:=${expr(inQuery)};reset role;
    assert review->'detail'->>'requestId'=${quote(request.requestId)},'189_atomic_existing_request';
    assert review->'detail'->'canApprove'='true'::jsonb and review->'detail'->'blocked'='false'::jsonb,'189_atomic_otherwise_approvable';`;
  const stages=[
    'begin;'+prefix+`do $atomic189_owned$ declare n text;t oid;begin
      assert current_user='postgres','189_atomic_owned_postgres';
      foreach n in array array['merchant_attendance_missing_delegations','merchant_attendance_missing_delegation_decisions','merchant_attendance_missing_entries'] loop
        t:=to_regclass('public.'||n);
        assert exists(select 1 from pg_class where oid=t and relnamespace=${d.owned.oid} and relowner::regrole::text='postgres'),'189_atomic_owned_tables';
        assert not exists(select 1 from pg_trigger where tgrelid=t and tgenabled<>'O'),'189_atomic_triggers_on';
        assert not exists(select 1 from pg_constraint where conrelid=t and not convalidated),'189_atomic_existing_constraints_valid';
      end loop;
      assert not exists(select 1 from pg_constraint where conrelid='public.merchant_attendance_missing_delegation_decisions'::regclass and conname='missing_delegation_atomic_probe'),'189_atomic_constraint_absent';
    end;$atomic189_owned$;
    set local role service_role;select ${expr(ownerQuery(),inGrant)};select ${expr(ownerQuery(),outGrant)};reset role;`,
    prefix+`do $atomic189_scope$ declare review jsonb;r jsonb;begin
      ${ready}
      set local role service_role;r:=${expr(outList)};reset role;
      assert not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'requestId'=${quote(request.requestId)}),'189_atomic_scope_list_no_leak';
      begin
        set local role service_role;perform ${expr(outQuery)};reset role;raise exception '189_atomic_expected_scope_read_denial';
      exception when raise_exception then reset role;if sqlerrm<>'attendance_access_denied' then raise;end if;end;
      begin
        set local role service_role;perform ${invoke(outQuery,outsideOp)};reset role;raise exception '189_atomic_expected_scope_approval_denial';
      exception when raise_exception then reset role;if sqlerrm<>'attendance_access_denied' then raise;end if;end;
      assert ${missingEntry(outsideOp)} and ${missingAuthority(outsideOp)},'189_atomic_outside_no_facts';
    end;$atomic189_scope$;`,
    prefix+`do $atomic189_positive$ declare review jsonb;r jsonb;begin
      ${ready}
      begin
        set local role service_role;r:=${invoke(inQuery,positiveOp)};reset role;
        assert r->'receipt'->>'operationId'=${quote(positiveOp)} and r->'receipt'->>'status'='approved','189_atomic_real_positive_rpc';
        assert exists(select 1 from public.merchant_attendance_missing_entries where merchant_id=${quote(d.site)} and operation_id=${quote(positiveOp)} and action='approve' and actor_auth_user_id=${quote(actor)}),'189_atomic_old_terminal_inserted';
        assert exists(select 1 from public.merchant_attendance_missing_delegation_decisions where merchant_id=${quote(d.site)} and operation_id=${quote(positiveOp)} and delegate_auth_user_id=${quote(actor)}),'189_atomic_authority_inserted';
        raise exception using errcode='P1891',message='189_positive_probe_rollback';
      exception when sqlstate 'P1891' then reset role;end;
      assert ${missingEntry(positiveOp)} and ${missingAuthority(positiveOp)},'189_atomic_positive_subtransaction_restored';
    end;$atomic189_positive$;`,
    //A targeted additional CHECK on ONLY the new sidecar. NOT VALID preserves
    //all existing rows/checks but still checks every new INSERT. It is removed
    //by the outer rollback; no trigger, original constraint or function changes.
    prefix+`alter table public.merchant_attendance_missing_delegation_decisions
      add constraint missing_delegation_atomic_probe check(operation_id<>${quote(faultOp)}::uuid) not valid;
    do $atomic189_fault$ declare review jsonb;failed_constraint text;failed_table text;caught boolean:=false;begin
      ${ready}
      begin
        set local role service_role;perform ${invoke(inQuery,faultOp)};reset role;raise exception '189_atomic_expected_check_failure';
      exception when check_violation then
        reset role;get stacked diagnostics failed_constraint=constraint_name,failed_table=table_name;
        assert failed_constraint='missing_delegation_atomic_probe' and failed_table='merchant_attendance_missing_delegation_decisions','189_atomic_exact_sidecar_check';
        caught:=true;
      end;
      assert caught,'189_atomic_fault_reached';
      assert ${missingEntry(faultOp)},'189_atomic_old_entry_rolled_back';
      assert ${missingAuthority(faultOp)},'189_atomic_sidecar_rolled_back';
      assert not exists(select 1 from public.merchant_attendance_missing_entries where merchant_id=${quote(d.site)} and request_id=${quote(request.requestId)} and revision=2),'189_atomic_request_still_pending';
      set local role service_role;review:=${expr(inQuery)};reset role;
      assert review->'detail'->'canApprove'='true'::jsonb,'189_atomic_still_approvable_after_fault';
    end;$atomic189_fault$;`,
    prefix+'set constraints all immediate;rollback;',
  ];
  let phase=0;
  try{await native.querySteps(stages.map((sql,index)=>{phase=index+1;return scope.sql(sql);}));}
  catch(error){throw new Error('missing_delegation_atomic_probes_failed: '+String(error),{cause:error});}
  finally{
    assert.equal(d.fingerprint(),baseline,'189_atomic_all_fact_rows_restored');
    assert.equal(d.definitions(),definitions,'189_atomic_all_definitions_restored');
    assert.equal(d.tableCatalog(),catalog,'189_atomic_catalog_restored');
  }
  assert.equal(phase,5);
  native.pass('real existing other-location scope denial and real approval sidecar CHECK failure roll back old terminal plus authority; all temporary grants/schema probes restored');
  return {groups:2,scopeDenials:2,scopeListChecked:true,realPositiveApprovalRolledBack:true,mandatorySidecarFailure:'injected_check_violation_23514',
    oldEntryAndAuthorityRolledBack:true,allFactsDefinitionsCatalogRestored:true,
    fixture:'Existing genuine employee request; two temporary real grants; injected new-sidecar CHECK only, not a natural production failure. Entire transaction rolled back.'};
}
