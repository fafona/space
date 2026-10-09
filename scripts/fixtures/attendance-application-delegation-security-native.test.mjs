import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyApplicationDelegationSecurityNative} from './attendance-application-delegation-security-native.mjs';
const code=readFileSync(new URL('./attendance-application-delegation-security-native.mjs',import.meta.url),'utf8');
const has=(...parts)=>{for(const part of parts)assert(code.includes(part),part);};
const order=(...parts)=>{let at=-1;for(const part of parts){const next=code.indexOf(part,at+1);assert(next>at,part);at=next;}};
test('191 helper import is inert and unowned context rejects before submit or SQL',async()=>{
  assert.equal(typeof verifyApplicationDelegationSecurityNative,'function');
  let writes=0;
  await assert.rejects(()=>verifyApplicationDelegationSecurityNative({d:{syntheticOnly:false},submit:()=>{writes++;}}));
  assert.equal(writes,0);
  has('assertLifecycleSandbox(sql=>native.query(scope.sql(sql)))','assert.equal(scope.schema,d.owned.schema)','assert.match(scope.schema,/^attendance_race_[a-f0-9]{32}$/)');
  assert.doesNotMatch(code,/child_process|spawn\(|execFile|CREATE DATABASE|initdb|pg_ctl|DATABASE_URL|SUPABASE_|process\.env|setTimeout|statement_timeout|lock_timeout|\.connect\(/i);
});
test('only genuine old submissions and explicit real owner grants establish fixture facts',()=>{
  assert.equal((code.match(/await submit\(/g)||[]).length,4);
  has("const pending=await submit('leave')","const remote=await submit('work_arrangement','remote')",
    "const hiddenTrip=await submit('work_arrangement','trip'","const hiddenLeave=await submit('leave'",
    'raw(ownerQuery(),ownGrant)','raw(ownerQuery(),remoteGrant)','raw(ownerQuery(),expired);raw(ownerQuery(),future)',
    'genuineSubmitFixtures:4,genuineGrantFixtures:4');
  assert.doesNotMatch(code,/insert into public\./i);
});
test('explicit elapsed and future grants are queried rather than immutable timestamps edited',()=>{
  has('validFrom:stamp(now-7200000),validUntil:stamp(now-3600000)','validFrom:stamp(now+3600000),validUntil:stamp(now+7200000)',
    '!allGrants.some(g=>g.grantId===expired.operationId||g.grantId===future.operationId)',
    "for(const g of [expired,future])reject('attendance_access_denied'");
  assert.doesNotMatch(code,/update public\.merchant_attendance_application_delegations/i);
});
test('permission, inactive and both identity rebinding probes use legal current rows and outer rollback',()=>{
  has("permissions=array_remove(permissions,'attendance.leave.review')","set status='disabled'",
    'savepoint delegate_rebinding','savepoint applicant_rebinding',"recover('permission_revoked')","recover('inactive')",
    "'old_delegate_auth'","'new_delegate_auth'","'applicant_auth'",'rollback to delegate_rebinding','rollback to applicant_rebinding');
  assert.doesNotMatch(code,/disable trigger|session_replication_role|drop constraint|alter function|create or replace function/i);
});
test('scoped privacy combines actual overlapping category and kind facts and rejects hidden approval',()=>{
  has('startAt:remote.startAt,endAt:remote.endAt',"includePending:true,kinds:['remote']","includePending:true,kinds:['trip']",
    '191_hidden_category_kind_block','191_hidden_application_summaries_absent','191_hidden_application_ids_absent','191_hidden_application_reason_absent',
    "if sqlerrm<>'attendance_access_denied' then raise",'191_privacy_reads_and_denial_zero_writes',
    '191_explicit_kind_grant_minimal_summary','191_category_not_granted_by_kind','191_conflict_exact5',
    '191_explicit_category_and_kind_no_hidden_conflict','191_only_two_authorized_application_summaries');
  order('savepoint privacy_scope','191_hidden_category_kind_block','191_explicit_kind_grant_minimal_summary','191_explicit_category_and_kind_no_hidden_conflict','rollback to privacy_scope');
});
test('exact minimum historical receipt survives feature off, revocation and permission changes without body or GET writes',()=>{
  has('read(approved.recovery,false).receipt,approved.receipt','approved.receipt.commandFingerprint,fingerprint(approved.query,approved.command)',
    "r->'receipt'=","r->'detail'='null'::jsonb","r->'grants'='[]'::jsonb","r->'items'='[]'::jsonb",
    "r->'nextId'='null'::jsonb","r->'nextCursor'='null'::jsonb",'191_minimal_receipt_exact9',
    "array['command','reason','workerName','startAt','endAt']",'191_recovery_zero_writes_');
});
test('positive real delegate approval proves optional notification semantics then rolls back each successful subtransaction',()=>{
  has('positiveProbe(positive,true)+positiveProbe(withoutNotification,false)','191_real_receipt_exact_hash','191_real_delegate_actor',
    '191_real_old_exact_terminal','191_real_authority_capture_choice','191_notification_flag_respected',
    "errcode='P1911'","exception when sqlstate 'P1911'",'191_positive_all_three_rows_rolled_back','191_positive_all_facts_restored');
});
test('both injected NOT VALID CHECKs enforce fresh writes and diagnose exact table/constraint SQLSTATE23514',()=>{
  has('not valid;','exception when check_violation','get stacked diagnostics failed_constraint=constraint_name,failed_table=table_name',
    '191_exact_injected_check_23514','191_fault_reached','191_terminal_notification_authority_atomic_rollback','191_fault_request_still_pending',
    "injected('merchant_attendance_application_delegation_decisions','application_delegation_sidecar_probe',sidecarFault)",
    "injected('merchant_attendance_leave_notifications','application_delegation_notification_probe',notificationFault)",
    '191_existing_triggers_enabled','191_existing_constraints_valid','191_fault_constraints_initially_absent');
  assert.doesNotMatch(code,/check\s*\(false\)|catch\s*\([^)]*\)\s*\{\s*\}/i);
});
test('every rejection/read uses same-role same-timezone all-table fingerprints; finally restores facts definitions and catalog',()=>{
  has("set local time zone 'UTC';set local datestyle='ISO, YMD';",'before_hash:=','reset role;','191_denial_zero_writes_',
    "prefix+'set constraints all immediate;rollback;'","assert(stages.length===10)",
    'native.querySteps(stages.map','d.fingerprint(),baseline','d.definitions(),definitions','d.tableCatalog(),catalog',
    '191_fault_constraints_removed_by_rollback','lifecycleRace:false,productionAccess:false');
  assert.doesNotMatch(code,/import .*lifecycleRace/);
});
