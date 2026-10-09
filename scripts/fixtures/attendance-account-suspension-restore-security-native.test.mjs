import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {accountSuspensionRestoreSecurityPlan} from './attendance-account-suspension-restore-security-native.mjs';
const source=readFileSync(new URL('./attendance-account-suspension-restore-security-native.mjs',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('plan keeps exact employee/worker identities and six distinct qualification cases',()=>{
  const p=accountSuspensionRestoreSecurityPlan({site:'99990001',otherSite:'99990002',owner:id(1),employeeId:id(2),employeeAuthUserId:id(3),workerId:id(4),nonOwner:id(3)});
  assert.equal(p.employeeAuthUserId,p.nonOwner);assert.notEqual(p.site,p.otherSite);
  assert.equal(new Set([p.stopOperation,p.activeOperation,p.restoreOperation,p.replacementAuth]).size,4);
  assert.deepEqual(p.variants.map(([name])=>name),['auth_replaced','worker_binding_removed','role_clock_revoked','settings_disabled','location_disabled','employment_ended']);
  assert.throws(()=>accountSuspensionRestoreSecurityPlan({...p,otherSite:p.site}));
});
test('fixture is inert and ownership checked, with a single bounded rollback transaction',()=>{
  for(const needle of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(scope.schema,owned.schema)',"const prepare=`begin;",'steps.length<=10','scope.sql(','set constraints all immediate;rollback;','finally','AggregateError'])assert(source.includes(needle),needle);
  assert.doesNotMatch(source,/process\.argv|spawn\(|startNative|initdb|CREATE DATABASE|statement_timeout|session_replication_role|disable trigger/i);
});
test('genuine status writers and parsed actual source create the template, never copied success rows',()=>{
  for(const needle of ['faolla_update_merchant_enterprise_employee_v1','faolla_attendance_account_suspensions_v1',"'mode','detail'",'restore_security_real_restore_eligible','parseAccountSuspensionResult','parseAccountSuspensionCommand'])assert(source.includes(needle),needle);
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_account|update public\.merchant_attendance_events|insert into public\.merchant_attendance_events|insert into public\.merchant_enterprise_employees/i);
  assert(source.includes('oldTailIdentityDamageSimulated:false'));
});
test('savepoints mutate only allowed current synthetic facts and compare zero-write rejection fingerprints',()=>{
  for(const needle of ['savepoint ${label}','rollback to ${label};release ${label}','restore_security_actual_blocker_',
    "sqlerrm<>'attendance_account_suspension_changed'",'restore_security_no_restore_receipt','restore_security_zero_writes_',
    'restore_security_access_zero_writes_',"'restore_security_all_facts'","'restore_security_definitions'","'restore_security_catalog'"])assert(source.includes(needle),needle);
  assert(source.includes("dc:=jsonb_set(${command},'{expectedEmployeeVersion}',r->'detail'->'employeeVersion')"));
  assert(source.includes("r->'detail'->'workerVersion'<>'null'::jsonb"));
});
test('cross-merchant and non-owner probes use real authorization and do not impersonate saved owners',()=>{
  assert(source.includes("denied('non_owner',q,quote(p.nonOwner))"));assert(source.includes("denied('other_merchant'"));
  assert(source.includes("sqlerrm<>'attendance_access_denied'"));assert(source.includes("m.id<>${quote(d.site)}"));
  assert(source.includes("realEmployeeStatusWrites:2,realRestoreWrites:0"));assert(source.includes('qualificationRejections:6,accessRejections:2'));
});
