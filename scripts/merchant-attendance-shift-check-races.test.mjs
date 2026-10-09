// Pure/static checks only: these do not start PostgreSQL or claim lock proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {checkAttendanceShiftCheckRaces,shiftCheckRaceLabels,shiftCheckRacePlan} from './merchant-attendance-shift-check-races.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const source=readFileSync(new URL('./merchant-attendance-shift-check-races.mjs',import.meta.url),'utf8');
const support=readFileSync(new URL('./merchant-attendance-lifecycle-native-support.mjs',import.meta.url),'utf8');
const connections=readFileSync(new URL('./merchant-attendance-native-connections.mjs',import.meta.url),'utf8');
const owned={schema:`attendance_race_${'a'.repeat(32)}`,oid:1001,tableOid:1002,owner:'postgres',marker:`faolla-synthetic-concurrency:${id(999)}`};
const input={siteId:'99990001',ownerId:id(99),workerId:id(201),startEventId:id(162001)};
const plan=shiftCheckRacePlan(owned,input);

test('new race module is inert with exactly three bounded caller-owned checks',()=>{
  assert.equal(typeof checkAttendanceShiftCheckRaces,'function');assert.equal(shiftCheckRaceLabels.length,3);
  assert(Object.isFrozen(shiftCheckRaceLabels));assert(Object.isFrozen(plan));assert(Object.isFrozen(plan.query));
  assert.doesNotMatch(source,/child_process|process\.env|process\.argv|\bspawn\s*\(|\bfetch\s*\(|withAttendanceConcurrencySandbox|runAttendanceLabelsReuse/);
  assert.match(source,/assert.equal\(scope.schema,d.owned.schema/);assert.match(source,/assert.equal\(scope.sql,d.sql/);
  assert.match(source,/assert.deepEqual\(assertLifecycleSandbox\(d.exec\),d.owned\)/);
});
test('plan refuses unowned namespaces, malformed schema identities and unsafe query literals',()=>{
  for(const patch of [{schema:'public'},{owner:'service_role'},{oid:0},{tableOid:NaN},{marker:"unowned';drop schema public;"}])
    assert.throws(()=>shiftCheckRacePlan({...owned,...patch},input));
  for(const patch of [{siteId:"99990001';"},{workerId:'not-a-uuid'},{ownerId:id(162990)},{startEventId:null}])
    assert.throws(()=>shiftCheckRacePlan(owned,{...input,...patch}));
  for(const value of [owned.schema,String(owned.oid),String(owned.tableOid),owned.marker])assert(plan.guard.includes(value));
  assert.match(plan.guard,/c.oid='public.merchants'::regclass/);assert.match(plan.guard,/n.nspowner::regrole::text='postgres'/);
});
test('holder uses actual138 service-only read with the original immutable anchor',()=>{
  assert.deepEqual(plan.query,{siteId:input.siteId,workerId:input.workerId,startEventId:input.startEventId});
  assert.match(plan.read,/set local role service_role/);assert.match(plan.read,/select public.faolla_attendance_shift_check_v1\(/);
  assert(plan.read.includes(JSON.stringify(plan.query)));assert(plan.read.endsWith(`,'${input.ownerId}');`));
  assert.doesNotMatch(plan.read,/\bupdate\b|\binsert\b|\bdelete\b|\balter\b/i);
  assert.doesNotMatch(source,/faolla_attendance_correction_decide|faolla_attendance_revision_decide|faolla_attendance_self_/);
});
test('settings and worker waiters acquire exact scoped UPDATE locks without fact edits',()=>{
  assert.match(plan.settingsWaiter,/select merchant_id from public.merchant_attendance_settings\s+where merchant_id='99990001' for update/);
  assert.match(plan.workerWaiter,new RegExp(`where merchant_id='99990001' and id='${input.workerId}' for update`));
  for(const sql of [plan.settingsWaiter,plan.workerWaiter]){
    assert(sql.startsWith(plan.guard));assert.doesNotMatch(sql,/\bupdate\s+public\.|\binsert\b|\bdelete\b/i);
  }
});
test('owner transfer is compare-and-set and finally restoration rejects unknown owners',()=>{
  assert(plan.ownerHolder.includes(`where id='${input.siteId}' and user_id='${input.ownerId}'`));
  assert.match(plan.ownerHolder,/get diagnostics changed=row_count/);assert.match(plan.ownerHolder,/assert changed=1/);
  assert.match(plan.restore,/select user_id into current_owner[\s\S]*for update/);
  assert(plan.restore.includes(`current_owner is distinct from '${input.ownerId}'::uuid`));
  assert(plan.restore.includes(`current_owner is distinct from '${plan.replacementOwner}'::uuid`));
  assert(plan.restore.includes(`where id='${input.siteId}' and user_id='${plan.replacementOwner}'`));
  assert.match(source,/finally\{[\s\S]*if\(transferAttempted\)d.exec\(plan.restore\)/);
  assert.match(source,/assert.match\(String\(owner.right.error\),\/ERROR:/);
});
test('three sequential races reuse exact holder PID proof with unchanged connection limits',()=>{
  assert.equal((source.match(/await lifecycleRace\(/g)??[]).length,3);
  assert.doesNotMatch(source,/Promise\.all|setTimeout|statement_timeout|lock_timeout|\.connect\(/);
  assert.match(support,/wait_event_type='Lock' and \$\{pid\}=any\(pg_blocking_pids\(pid\)\)/);
  assert.match(support,/await holder.step\(rollback\?'rollback;':'commit;'\)/);
  assert.match(support,/await Promise.all\(\[holder.close\(\),waiter\?\.close\(\)\]\)/);
  assert.match(connections,/active.size < 4/);assert.match(connections,/25000/);assert.match(connections,/12000/);
});
test('fact and definition fingerprints protect both success and failure cleanup',()=>{
  for(const marker of ['const facts=d.fingerprint(),definitions=d.definitions()',
    "assert.equal(d.fingerprint(),facts,'shift_check_races_changed_facts')",
    "assert.equal(d.definitions(),definitions,'shift_check_races_changed_definitions')",
    'const restored=d.readRaw(plan.query,d.owner)','assert.equal(restored.binding.actorId,d.owner)'])assert(source.includes(marker));
  assert.match(source,/delete copy.asOf;delete copy.binding.readAt/);
  assert.equal((source.match(/assert.deepEqual\(withoutObservation\(JSON.parse\(/g)??[]).length,2);
});
test('reported proof distinguishes lock attempts and synthetic owner transfer from actual approval races',()=>{
  for(const marker of ['exactPidLockWitnesses:3','successfulReads:4','deniedReads:1','actualApprovalRace:false',
    'actualClockRace:false','syntheticOwnerTransfer:true','ownerRestored:true','realAuthentication:false',
    'productionAccess:false','newCluster:false'])assert(source.includes(marker));
  assert.match(source,/not real settings edits, correction/);
});
