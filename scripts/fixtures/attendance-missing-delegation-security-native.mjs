//189 Real SQL probes under caller-owned synthetic schema. Roll back temporary
//identity/role changes; never relax constraints, triggers, ACL or database clock.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
export async function verifyMissingDelegationSecurityNative(c){
  const {d,h,native,scope,raw,read,grant,ownerQuery,delegateQuery,submit,decide,expr,next,employee,approved}=c;
  assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned);
  const baselineBeforeSetup=d.fingerprint();
  const command=grant(),grantId=command.operationId;raw(ownerQuery(),command);
  const request=await submit(),q=delegateQuery({mode:'detail',grantId,requestId:request.operationId}),detail=read(q).detail;
  assert(detail.canApprove);assert.notEqual(d.fingerprint(),baselineBeforeSetup);
  const decision=decide(request,detail,'approve',grantId),post={...q,mode:'decide'},recovery=approved.recovery;
  const baseline=d.fingerprint(),defs=d.definitions(),catalog=d.tableCatalog();
  let rejected=0,minimumRecoveries=0;
  const deny=(expression,pattern='^attendance_access_denied$')=>{
    rejected++;
    return `do $deny189$ begin begin set local role service_role;perform ${expression};reset role;
      raise exception '189_expected_rejection_missing';exception when others then reset role;if sqlerrm !~ ${quote(pattern)} then raise;end if;end;end;$deny189$;`;
  };
  const recover=()=>{minimumRecoveries++;return `do $recover189$ declare r jsonb;begin set local role service_role;r:=${expr(recovery,null,false)};reset role;
    assert r->'receipt'=${json(approved.receipt)},'189_original_minimal_receipt';
    assert r->'detail'='null'::jsonb and r->'grants'='[]'::jsonb and r->'items'='[]'::jsonb,'189_recovery_no_body';end;$recover189$;`;};
  const actorEmployee=`merchant_id=${quote(d.site)} and id=${quote(employee)}`;
  const targetEmployee=`merchant_id=${quote(d.site)} and id=${quote(h.employeeId)}`;
  const roleWhere=`merchant_id=${quote(d.site)} and id=(select role_id from public.merchant_enterprise_employees where ${actorEmployee})`;
  const state=(name,mutate,probe)=>`savepoint ${name};${mutate}${probe}rollback to ${name};release ${name};`;
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const stages=[
    'begin;'+prefix+`do $acl189$ declare n text;o oid;begin
      foreach n in array array['merchant_attendance_missing_delegations','merchant_attendance_missing_delegation_revocations','merchant_attendance_missing_delegation_decisions'] loop
        o:=to_regclass('public.'||n);assert o is not null,'189_missing_table';
        assert (select relrowsecurity from pg_class where oid=o),'189_private_table_rls';
        assert not has_table_privilege('anon',o,'select') and not has_table_privilege('authenticated',o,'select') and not has_table_privilege('service_role',o,'select'),'189_no_direct_table_read';
        assert not has_table_privilege('service_role',o,'insert,update,delete'),'189_no_direct_table_write';
      end loop;
      foreach n in array array['faolla_attendance_missing_delegations_v1','faolla_attendance_delegated_missing_v1'] loop
        o:=to_regprocedure('public.'||n||'(jsonb,uuid,jsonb,boolean)');assert o is not null,'189_missing_rpc';
        assert has_function_privilege('service_role',o,'execute') and not has_function_privilege('anon',o,'execute') and not has_function_privilege('authenticated',o,'execute'),'189_rpc_acl';
      end loop;
      assert public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','attendance.self.view','attendance.missing.review']),'189_permission_catalog';
      assert not public.faolla_valid_merchant_enterprise_permissions_v1(array['enterprise.view','attendance.missing.review']),'189_self_entry_dependency';
    end;$acl189$;`,
    prefix+state('role_removed',`update public.merchant_enterprise_roles set permissions=array['enterprise.view'] where ${roleWhere};`,deny(expr(q))+deny(expr(post,decision))+recover()),
    prefix+state('employee_disabled',`update public.merchant_enterprise_employees set status='disabled' where ${actorEmployee};`,deny(expr(q))+deny(expr(post,decision))+recover()),
    prefix+state('delegate_rebound',`update public.merchant_enterprise_employees set auth_user_id=${quote(next())} where ${actorEmployee};`,deny(expr(q))+deny(expr(post,decision))+deny(expr(recovery,null,false))),
    prefix+state('target_rebound',`update public.merchant_enterprise_employees set auth_user_id=${quote(next())} where ${targetEmployee};`,deny(expr(q),'^attendance_(access_denied|missing_delegation_[a-z_]+|missing_not_found)$')+deny(expr(post,decision),'^attendance_(access_denied|missing_delegation_[a-z_]+|missing_not_found)$')+recover()),
    prefix+state('owner_changed',`update public.merchants set user_id=${quote(next())} where id=${quote(d.site)};`,deny(expr(ownerQuery({mode:'recover',operationId:grantId}),null,false))),
    prefix+deny(expr({...q,grantId:next()}),'^attendance_(access_denied|missing_delegation_[a-z_]+|missing_not_found)$')
      +deny(expr({...q,requestId:next()}),'^attendance_(access_denied|missing_delegation_[a-z_]+|missing_not_found)$')
      +deny(expr(post,{...decision,expectedGrantRevision:2}),'^attendance_(invalid_request|version_conflict)$')
      +deny(expr(ownerQuery(),grant({delegateEmployeeId:h.employeeId,delegateAuthUserId:h.employeeAuthUserId})),'^attendance_(access_denied|invalid_request|missing_delegation_[a-z_]+)$'),
    prefix+'set constraints all immediate;rollback;',
  ];
  try{await native.querySteps(stages.map(s=>scope.sql(s)));}
  finally{assert.equal(d.fingerprint(),baseline,'189_security_rollback_facts');assert.equal(d.definitions(),defs);assert.equal(d.tableCatalog(),catalog);}
  native.pass('real SQL permission/inactive/rebinding/owner-change/scope denial and minimal recovery; temporary identity probes rollback');
  return {rejected,minimumRecoveries,rollbackRestored:true,aclChecked:true,requestId:request.operationId,grantId};
}
