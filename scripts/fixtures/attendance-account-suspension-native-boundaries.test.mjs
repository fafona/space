import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {accountSuspensionBoundaryPlan} from './attendance-account-suspension-native-boundaries.mjs';
const source=readFileSync(new URL('./attendance-account-suspension-native-boundaries.mjs',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('bounded plan has a distinct synthetic delegate and exact original target identities',()=>{
  const p=accountSuspensionBoundaryPlan({site:'99990001',owner:id(1),targetWorker:id(2),targetEmployee:id(3),targetAuth:id(4),locationId:id(5),workerLocationId:id(6)});
  assert.notEqual(p.delegateEmployee,p.targetEmployee);assert.notEqual(p.delegateAuth,p.targetAuth);assert.equal(p.application.employeeAuthUserId,p.targetAuth);
  assert.equal(p.missing.locationId,id(5));assert.deepEqual(p.application.kinds,[]);assert.equal(p.application.includePending,false);
  assert.equal(new Set([...p.statusOperations,p.restoreOperation,p.blockedRestoreOperation,p.configOperation,p.application.operationId,p.missing.operationId,p.freshApplication.operationId]).size,10);
  assert.match(p.application.validFrom,/\.\d{6}Z$/);assert(Date.parse(p.application.validUntil)>Date.parse(p.application.validFrom));
});
test('actual public writers only; no synthetic workers or receipts or disabled constraints',()=>{
  for(const name of ['faolla_attendance_missing_delegations_v1','faolla_attendance_application_delegations_v1','faolla_update_merchant_enterprise_employee_v1','faolla_attendance_admin_v1','faolla_attendance_account_suspensions_v1'])assert(source.includes(name));
  assert(!/insert into public\.merchant_attendance_workers/i.test(source));assert(!/insert into public\.merchant_attendance_account_(?:suspensions|restores)/i.test(source));
  assert(!/disable trigger|session_replication_role|statement_timeout|spawn\(/i.test(source));assert.match(source,/set constraints all immediate;set constraints all deferred/);
  assert.match(source,/newGrant|fresh_application_after_restore/);assert.match(source,/attendance_account_suspended/);assert.match(source,/attendance_account_suspension_changed/);
});
test('owned single rollback transaction keeps all fact definition and catalog evidence with real parser',()=>{
  assert.match(source,/assertLifecycleSandbox/);assert.match(source,/steps.map\(step=>scope.sql\(step\)\)/);assert.match(source,/steps.length<=12/);assert.match(source,/rollback;/);
  for(const evidence of ['boundary_all_facts_restored','boundary_definitions','boundary_catalog','boundary_read_or_rejection_wrote','parseAccountSuspensionResult','binding_changed'])assert(source.includes(evidence));
  assert.match(source,/if\(failures.length\)throw new AggregateError/);assert(!source.includes('process.argv'));
});
