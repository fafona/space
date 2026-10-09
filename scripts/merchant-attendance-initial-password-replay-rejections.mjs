// Local, rollback-only fault fixtures. Every claim is the installed real RPC;
// no Auth mutation, business response model or persistent repair is used here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertLifecycleSandbox} from './merchant-attendance-lifecycle-native-support.mjs';
import {validateInitialPasswordRpcInput} from './merchant-attendance-initial-password-fixture.mjs';

const claim='faolla_claim_merchant_employee_initial_password_setup_v1';
const setup='public.merchant_employee_initial_password_setups';
const employees='public.merchant_enterprise_employees';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const changedHex=value=>(value[0]==='0'?'1':'0')+value.slice(1);
const marker='faolla.initial_password_replay_rejection';
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);

function checkedInput(invite,input){
  validateInitialPasswordRpcInput(claim,{p_input:input});
  assert(invite&&/^00000000-0000-4000-8000-00000000010[1-3]$/.test(invite.employeeId),'initial_password_replay_employee_required');
  assert(invite.actor?.id===input.auth_user_id&&invite.version===input.invitation_version,'initial_password_replay_identity_required');
  assert(typeof invite.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(invite.token),'initial_password_replay_invitation_required');
  assert(createHash('sha256').update(invite.token,'utf8').digest('hex')===input.token_hash,'initial_password_replay_token_binding_required');
  return input;
}

export function assertInitialPasswordReplayPrestate(facts,invite,input){
  checkedInput(invite,input);
  assert(facts&&Array.isArray(facts.employees)&&Array.isArray(facts.setups)&&Array.isArray(facts.audits),'initial_password_replay_facts_required');
  const matchingEmployees=facts.employees.filter(row=>row.id===invite.employeeId);
  const matchingSetups=facts.setups.filter(row=>row.employee_id===invite.employeeId);
  assert(matchingEmployees.length===1&&matchingSetups.length===1,'initial_password_replay_exact_prestate_required');
  const employee=matchingEmployees[0],receipt=matchingSetups[0];
  assert(employee.merchant_id===input.merchant_id&&employee.auth_user_id===input.auth_user_id&&employee.status==='invited'
    &&employee.accepted_at===null&&employee.invitation_revoked_at===null&&employee.initial_password_policy==='completed'
    &&employee.invitation_version===input.invitation_version&&employee.invitation_token_hash===input.token_hash,
  'initial_password_replay_completed_employee_required');
  assert(receipt.merchant_id===input.merchant_id&&receipt.auth_user_id===input.auth_user_id
    &&receipt.invitation_version===input.invitation_version&&receipt.invitation_token_hash===input.token_hash
    &&receipt.operation_id===input.operation_id&&receipt.password_fingerprint===input.password_fingerprint
    &&receipt.state==='completed'&&typeof receipt.completed_at==='string'&&Number.isFinite(Date.parse(receipt.completed_at))
    &&receipt.claim_expires_at===null,'initial_password_replay_completed_receipt_required');
}

/** Closed case construction: callers cannot provide an SQL fragment or error. */
export function initialPasswordReplayRejectionPlan(invite,input){
  checkedInput(invite,input);
  const target=`employee_id=${quote(invite.employeeId)}`;
  const employeeTarget=`id=${quote(invite.employeeId)} and merchant_id=${quote(input.merchant_id)} and auth_user_id=${quote(input.auth_user_id)}`;
  const otherActor=input.auth_user_id.endsWith('001')?'00000000-0000-4000-8000-000000000002':'00000000-0000-4000-8000-000000000001';
  const otherOperation=input.operation_id==='00000000-0000-4000-8000-000000117001'?'00000000-0000-4000-8000-000000117002':'00000000-0000-4000-8000-000000117001';
  const denied='employee_initial_password_not_required';
  const cases=[
    ['receipt_missing',`delete from ${setup} where ${target}`,denied],
    ['receipt_claimed',`update ${setup} set state='claimed',completed_at=null,claim_expires_at=clock_timestamp()+interval '10 minutes' where ${target}`,denied],
    ['receipt_merchant',`update ${setup} set merchant_id='99990002' where ${target}`,denied],
    ['receipt_auth',`update ${setup} set auth_user_id=${quote(otherActor)} where ${target}`,denied],
    ['receipt_version',`update ${setup} set invitation_version=8 where ${target}`,denied],
    ['receipt_hash',`update ${setup} set invitation_token_hash=${quote(changedHex(input.token_hash))} where ${target}`,denied],
    ['receipt_operation',`update ${setup} set operation_id=${quote(otherOperation)} where ${target}`,denied],
    ['receipt_fingerprint',`update ${setup} set password_fingerprint=${quote(changedHex(input.password_fingerprint))} where ${target}`,denied],
    ['role_inactive',`update public.merchant_enterprise_roles set status='archived' where merchant_id=${quote(input.merchant_id)} and id=(select role_id from ${employees} where ${employeeTarget})`,'merchant_access_denied'],
    ['employee_expired',`update ${employees} set invitation_expires_at=clock_timestamp()-interval '1 second' where ${employeeTarget}`,'employee_invitation_expired'],
    ['employee_revoked',`update ${employees} set invitation_revoked_at=clock_timestamp(),invitation_token_hash=null,invitation_delivery_status='revoked' where ${employeeTarget}`,'employee_invitation_revoked'],
    ['employee_disabled',`update ${employees} set status='disabled' where ${employeeTarget}`,'employee_invitation_not_pending'],
    ['employee_generation',`update ${employees} set invitation_version=8 where ${employeeTarget}`,'employee_invitation_superseded'],
  ];
  return cases.map(([name,mutation,error])=>({name,error,sql:`begin;reset role;
    do $prestate$ declare changed integer;begin
      if not exists(select 1 from ${employees} e join ${setup} s on s.employee_id=e.id
        join public.merchant_enterprise_roles r on r.id=e.role_id and r.merchant_id=e.merchant_id and r.status='active'
        where e.id=${quote(invite.employeeId)} and e.merchant_id=${quote(input.merchant_id)} and e.auth_user_id=${quote(input.auth_user_id)}
          and e.status='invited' and e.accepted_at is null and e.invitation_revoked_at is null
          and e.invitation_expires_at>clock_timestamp() and e.initial_password_policy='completed'
          and e.invitation_version=${input.invitation_version} and e.invitation_token_hash=${quote(input.token_hash)}
          and s.merchant_id=e.merchant_id and s.auth_user_id=e.auth_user_id and s.invitation_version=e.invitation_version
          and s.invitation_token_hash=e.invitation_token_hash and s.operation_id=${quote(input.operation_id)}
          and s.password_fingerprint=${quote(input.password_fingerprint)} and s.state='completed'
          and s.completed_at is not null and s.claim_expires_at is null)
        then raise exception 'initial_password_replay_original_completed_required';end if;
      ${mutation};get diagnostics changed=row_count;
      if changed<>1 then raise exception 'initial_password_replay_one_fixture_row_required';end if;
    end;$prestate$;
    set local role service_role;
    do $rejection$ declare actual_error text;begin
      if current_user<>'service_role' then raise exception 'initial_password_replay_service_role_required';end if;
      begin perform public.${claim}(${quote(JSON.stringify(input))}::jsonb);
      exception when others then actual_error:=SQLERRM;end;
      if actual_error is distinct from ${quote(error)} then raise exception 'initial_password_replay_unexpected_result';end if;
      perform set_config('${marker}',actual_error,true);
    end;$rejection$;
    select jsonb_build_object('case',${quote(name)},'error',current_setting('${marker}'),'role',current_user);
    rollback;` }));
}

export function assertInitialPasswordReplayRejectionProof(result,expected){
  assert(result&&typeof result==='object'&&!Array.isArray(result)
    &&Object.keys(result).sort().join(',')==='case,error,role'
    &&result.case===expected.name&&result.error===expected.error&&result.role==='service_role',
  'initial_password_replay_exact_error_required');
}

export async function checkInitialPasswordReplayRejections(native,scope,prepared,invite,input){
  assert(typeof native?.pass==='function'&&typeof scope?.sql==='function','initial_password_replay_native_required');
  assert(typeof prepared?.exec==='function'&&typeof prepared.facts==='function'&&typeof prepared.protectedFingerprint==='function','initial_password_replay_prepared_required');
  assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'initial_password_replay_owned_namespace_required');
  assert(scope.schema===prepared.owned.schema,'initial_password_replay_scope_required');
  const baseline=prepared.facts(),fingerprint=prepared.protectedFingerprint();
  assertInitialPasswordReplayPrestate(baseline,invite,input);
  const cases=initialPasswordReplayRejectionPlan(invite,input);
  const restored=()=>{
    assert(same(prepared.facts(),baseline),'initial_password_replay_facts_not_restored');
    assert(prepared.protectedFingerprint()===fingerprint,'initial_password_replay_protected_facts_not_restored');
  };
  for(const item of cases){
    restored();
    try{
      // prepared.exec is the existing owned/OID/marker-guarded single psql
      // invocation. ON_ERROR_STOP connection exit also rolls back on failure.
      const result=JSON.parse(prepared.exec(item.sql));
      assertInitialPasswordReplayRejectionProof(result,item);
    }catch{
      // Never forward raw SQL, operation ids, invitation hashes or fingerprints.
      throw Error('initial_password_replay_rejection_failed:'+item.name);
    }finally{restored();}
  }
  native.pass('13 real service-role completed-setup replay rejections preserve all original facts after isolated per-case rollback');
  return {cases:cases.length,rolledBack:true};
}
