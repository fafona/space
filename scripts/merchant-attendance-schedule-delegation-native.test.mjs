// Inert construction/guardrail checks; no DB or browser starts here.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {scheduleDelegationNativePlan,scheduleDelegationExpression} from './fixtures/attendance-schedule-delegation-native.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const driver=read('./merchant-attendance-schedule-delegation-native.mjs'),fixture=read('./fixtures/attendance-schedule-delegation-native.mjs');
test('198 synthetic scopes deterministic bounded and separate from196',()=>{
  const plans=Array.from({length:20},(_,n)=>scheduleDelegationNativePlan(n,id(1)));
  assert.equal(new Set(plans.map(p=>p.site)).size,20);
  assert.equal(new Set(plans.flatMap(p=>[p.employee,p.auth,p.worker,p.role,p.location,p.delegateEmployee,p.delegateAuth,p.delegateRole,p.otherLocation])).size,180);
  for(const x of [-1,20,0.5,NaN])assert.throws(()=>scheduleDelegationNativePlan(x,id(1)));
  assert.throws(()=>scheduleDelegationNativePlan(0,'no'));
  assert.match(scheduleDelegationExpression({siteId:'99990200'},id(1),null,false),/faolla_attendance_schedule_delegation_v1\(.+,null,false\)$/);
});
test('inert explicit driver preserves193 then196 before167 with inherited ownership cleanup',()=>{
  assert(driver.indexOf('await verifyAccountSuspensionNative(prepared)')<driver.indexOf('await verifyEmploymentLifecycleNative(prepared)'));
  assert(driver.indexOf('await verifyEmploymentLifecycleNative(prepared)')<driver.indexOf('await verifyScheduleDelegationNative(prepared,browserCheck)'));
  for(const value of ['runApplicationDelegationNative(args,null,async context=>','node --import tsx','--directory <existing-stopped-directory>'])assert(driver.includes(value));
  assert.doesNotMatch(driver+fixture,/\binitdb\b|\bcreatedb\b|DISABLE\s+(?:TRIGGER|ROW)|session_replication_role|npm run build/i);
});
test('198 no current-grant fallback or fake owner actor in delegated native scenarios',()=>{
  for(const value of ['assert.equal(published.receipt.actorId,p.delegateAuth)','assert.equal(d.fingerprint(tables),before)',
    'assert.equal(definitions(),oldDefinitions)','assert.equal(d.tableCatalog(),finalCatalog)',
    "assert.deepEqual(acl,{service:true,anon:false,authenticated:false,private:false})","status(c,'disabled');status(c,'active');",
    "assert.equal(read(c,q(c,'delegate')).grants.length,0)","status(c,'disabled',c.employee,true);oldCancel(c,cs.slotId)"])assert(fixture.includes(value),value);
});
test('198 final authority CHECK rollback and actual concurrency witnesses cannot become timing assumptions',()=>{
  for(const value of ["constraint='attendance_schedule_fixture_fail_198'","fault_state='23514' and fault_constraint=${quote(constraint)}",
    'assert.equal(all(),baseline)','drop constraint ${constraint};set constraints all immediate',
    'assert(repeat.witnessed&&!repeat.right.error)','assert(revocation.witnessed&&revocation.right.error)',
    'assert(competing.witnessed&&competing.right.error)','realConcurrentWaits:3'])assert(fixture.includes(value),value);
});

test('198 additional boundary and race callbacks stay inside caller-owned synthetic lifecycle',()=>{
  const boundaries=read('./fixtures/attendance-schedule-delegation-boundaries-native.mjs');
  const races=read('./fixtures/attendance-schedule-delegation-races-native.mjs');
  for(const source of [boundaries,races]){
    assert(source.includes('assertLifecycleSandbox'));
    assert.doesNotMatch(source,/\binitdb\b|\bcreatedb\b|DISABLE\s+(?:TRIGGER|ROW)|session_replication_role|npm run build/i);
  }
  for(const value of ["phase='identity-and-permission-boundaries'",'await verifyScheduleDelegationBoundaries(ports)',
    "phase='additional-lifecycle-races'",'await verifyScheduleDelegationAdditionalRaces(ports)'])assert(fixture.includes(value),value);
  for(const value of ['seed(6)','seed(7)','seed(8)','assert.equal(denialChecks,9)',
    "prefix+'set constraints all immediate;rollback;'",'assert.equal(all(),baseline',
    '198_saved137_128_120_history_unchanged','198_no136_evidence_backfill',
    "normalizedBaseline=d.exec(prefix+'select '+hash+';')",'${hash}=${quote(normalizedBaseline)}'])assert(boundaries.includes(value),value);
  assert.equal((boundaries.match(/\$\{hash\}=\$\{quote\(normalizedBaseline\)\}/g)??[]).length,2);
  for(const value of ['seed(18)','seed(19)','attendance_suspension_enabled:false',
    "expectWaiter(stopRace,'attendance_access_denied')","expectWaiter(revokeRace,'attendance_access_denied')",
    "expectWaiter(ownerRace,'attendance_version_conflict')",'exactPidRaces:3',
    "fault_state='23514' and fault_constraint=${quote(constraint)}",'assert.equal(d.exec(protection),beforeProtected',
    'assert.equal(d.tableCatalog(),catalog)','assert.equal(d.definitions(),defs)'])assert(races.includes(value),value);
});
