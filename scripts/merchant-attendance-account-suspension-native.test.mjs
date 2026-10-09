// Static acceptance-runner guardrails only; no database or browser starts here.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const driver=read('./merchant-attendance-account-suspension-native.mjs');
const fixture=read('./fixtures/attendance-account-suspension-native.mjs');
const has=(source,values)=>{for(const value of values)assert(source.includes(value),value);};
test('193 entry is inert, delegates to the existing single owned cluster and exact employee chain',()=>{
  has(driver,['runApplicationDelegationNative(args,null,async context=>','prepareAttendanceEmployeeManagement(context.native,context.scope)',
    'verifyAccountSuspensionNative({...context,enterprise},browserCheck)','if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))']);
  assert.doesNotMatch(driver+fixture,/\binitdb\b|\bcreatedb\b|DISABLE\s+(?:TRIGGER|ROW)|session_replication_role|npm run build/i);
  has(fixture,['assert(d.syntheticOnly&&h.syntheticOnly&&context.enterprise.syntheticOnly)',
    'assert.deepEqual(assertLifecycleSandbox(sql=>native.query(scope.sql(sql))),d.owned)']);
});
test('actual SQL results cross the exact protocol and independent JS command fingerprints',()=>{
  has(fixture,['parseAccountSuspensionResult(JSON.parse(exec(',
    'firstReceipt.commandFingerprint,await accountStatusCommandFingerprint',
    'restored.result.receipt.commandFingerprint,await accountSuspensionCommandFingerprint']);
});
test('old no-ID calls, real task handover and failure rollback remain separately asserted',()=>{
  has(fixture,["phase='old-path'", "reject(()=>mutate(noOpOld),'enterprise_version_conflict')",
    'assert.equal(firstResult.affected_task_count,1)',"event_type='employee_offboarded'",
    "for(const key of ['employee_id','actor_type','actor_id','status'])",'assert.equal(d.fingerprint(),rollbackBefore)',
    'finally{exec(`drop trigger ${failureName}',"statusReceipt,null)"]);
});
test('open work, wasActive false and original history are not silently rewritten',()=>{
  has(fixture,["clock('clock_in');clock('break_start')",'assert.equal(protectedFacts(),beforePause)',
    "assert.equal(clock(null).state.status,'break')",'suspension.wasActive,false',
    'restore(inactivePause).result.receipt.workerActive,false','context.approved.receipt']);
  assert.doesNotMatch(fixture,/insert\s+into\s+public\.merchant_attendance_(?:events|account_restores|account_suspensions|account_status_operations)\b/i);
});
test('five witnessed races use real blocking backends and verify terminal outcomes',()=>{
  has(fixture,['lifecycleRace({connect:()=>native.connect()',
    'pinRace.witnessed&&!pinRace.right.error','stopped.witnessed&&stopped.right.error',
    'restoreStop.witnessed&&!restoreStop.right.error','decisionRace.witnessed&&decisionRace.right.error',
    'grantRace.witnessed&&grantRace.right.error',"detail.status,'submitted'",'realConcurrentWaits:5']);
});
test('actual PIN issue, old lease denial and explicit reissue are distinct',()=>{
  has(fixture,['executePinAdmin','faolla_attendance_pin_begin_v1','faolla_attendance_pin_finish_v1',
    'assert.deepEqual(JSON.parse(pinRace.right.output),{verified:false})',
    'assert.equal(invalidPin.enabled,false)','assert.equal(invalidPin.revision,leased.revision+1)',
    'assert.equal((await issuePin()).enabled,true)']);
});
test('browser binds real routes/store/SQL through synthetic auth and restores feature env',()=>{
  has(fixture,['withAttendanceApplicationAuth','createAttendanceEmployeeManagementReadTransport',
    "require('../../src/app/api/merchant-enterprise/employees/route-handler.ts')",
    "require('../../src/app/api/merchant-enterprise/overview/route-handler.ts')",
    'PATCH(authenticated(request))','handleAccountSuspension(authenticated(request)',
    'assert.equal(body.needsBootstrap,false)','assert.equal(reads.errors.length,0',
    'finally{if(saved===undefined)delete process.env[env];else process.env[env]=saved;}']);
});
