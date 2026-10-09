import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./attendance-missing-delegation-atomic-native.mjs',import.meta.url),'utf8');
test('189 atomic helper is inert, owned-only and does not start or reconfigure an environment',async()=>{
  const fixtureModule=await import('./attendance-missing-delegation-atomic-native.mjs');
  assert.equal(typeof fixtureModule.verifyMissingDelegationAtomicNative,'function');
  for(const part of ['assertLifecycleSandbox','d.owned','d.guard',"current_user='postgres'",'relowner::regrole::text=\'postgres\'','relnamespace=${d.owned.oid}'])assert(source.includes(part));
  assert.doesNotMatch(source,/\b(?:initdb|createdb|dropdb|pg_dump|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|listen|spawn|pg_ctl)\b|process\.env/);
});
test('real outside-location denial is not a nonexistent, self-review, terminal or wrong-token false proof',()=>{
  for(const part of ["r.reason='Synthetic189 employee genuine missing request'",'e.action=\'submit\'','t.revision=2','assert.notEqual(actor,h.employeeAuthUserId',
    "id<>${quote(d.location)}",'grant({locationId:otherLocation})',"'189_atomic_otherwise_approvable'",'jsonb_set(',"review->'detail'->'evidenceToken'",
    "sqlerrm<>'attendance_access_denied'","'189_atomic_scope_list_no_leak'","'189_atomic_real_positive_rpc'","errcode='P1891'"])assert(source.includes(part),part);
  assert.match(source,/missingEntry\(outsideOp\).*missingAuthority\(outsideOp\)/);
});
test('actual new RPC hits an explicit new-sidecar CHECK and checks exact constraint/table diagnostics',()=>{
  assert.match(source,/alter table public\.merchant_attendance_missing_delegation_decisions\s+add constraint missing_delegation_atomic_probe check\(operation_id<>/);
  assert.match(source,/not valid;/);assert.match(source,/exception when check_violation/);
  assert.match(source,/get stacked diagnostics failed_constraint=constraint_name,failed_table=table_name/);
  assert.match(source,/failed_constraint='missing_delegation_atomic_probe' and failed_table='merchant_attendance_missing_delegation_decisions'/);
  for(const part of ['perform ${invoke(inQuery,faultOp)}',"'189_atomic_old_entry_rolled_back'","'189_atomic_sidecar_rolled_back'","'189_atomic_request_still_pending'","'189_atomic_still_approvable_after_fault'"])assert(source.includes(part));
  assert.doesNotMatch(source,/disable trigger|session_replication_role|create or replace function|drop constraint|update public\.|delete from public\.|insert into public\./i);
});
test('five bounded steps preserve all original checks and roll back facts, definitions and catalog',()=>{
  assert.match(source,/tgenabled<>'O'/);assert.match(source,/not convalidated/);
  assert.match(source,/set constraints all immediate;rollback;/);assert.match(source,/native\.querySteps/);
  for(const part of ['assert.equal(phase,5)','assert.equal(d.fingerprint(),baseline','assert.equal(d.definitions(),definitions','assert.equal(d.tableCatalog(),catalog'])assert(source.includes(part));
  assert.doesNotMatch(source,/statement_timeout|lock_timeout|setTimeout|sleep\(|new Pool|native\.connect\(/);
  assert.match(source,/not a natural production failure/);
});
