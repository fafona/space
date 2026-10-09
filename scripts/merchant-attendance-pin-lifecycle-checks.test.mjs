import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {pinLifecyclePlan,pinLifecycleRequestSql} from './merchant-attendance-pin-lifecycle-checks.mjs';
const lease='00000000-0000-4000-8000-000001021901';

test('two independent synthetic member/role cases retain one original operation and a five-attempt budget',()=>{
  const cases=pinLifecyclePlan();assert.deepEqual(cases.map(item=>item.kind),['member','role']);
  for(const key of ['worker','employee','auth','role','terminal','no','startOperation','closeOperation'])assert.equal(new Set(cases.map(item=>item[key])).size,2);
  for(const item of cases){
    assert.equal(item.start.action,'clock_in');assert.equal(item.start.expectedSequence,0);
    assert.equal(item.close.action,'clock_out');assert.equal(item.close.expectedSequence,1);
    assert.equal(item.close.operationId,item.closeOperation);assert.equal(item.close.expectedEmployeeId,item.employee);
  }
  cases[0].close.expectedEmployeeId=cases[1].employee;
  assert.notEqual(pinLifecyclePlan()[0].close.expectedEmployeeId,cases[1].employee,'caller cannot mutate the fixed plan');
});

test('SQL request constructor pins the synthetic tenant and service role, exposes verification as a SQL boundary input only',()=>{
  const item=pinLifecyclePlan()[0],request=pinLifecycleRequestSql(0,lease,item.close);
  assert.match(request.begin,/^set local role service_role;select public\.faolla_attendance_pin_begin_v1\('99990004'/);
  assert.match(request.clock,/^set local role service_role;select public\.faolla_attendance_pin_clock_v1\('99990004'/);
  assert(request.clock.includes(`'${lease}',true,`));assert(request.clock.includes(JSON.stringify({command:item.close,operationId:null})));
  const read=pinLifecycleRequestSql(0,lease,null,item.closeOperation);
  assert(read.clock.includes(JSON.stringify({command:null,operationId:item.closeOperation})));
  assert.doesNotMatch(request.begin+request.clock,/\bbegin;|\bcommit;|\brollback;|update|delete|truncate/);
});

test('constructor rejects cross-person commands, arbitrary operations, malformed leases and extra fields before SQL',()=>{
  const [first,second]=pinLifecyclePlan();
  for(const index of [-1,2,0.5,'0',null])assert.throws(()=>pinLifecycleRequestSql(index,lease),/pin_lifecycle_case/);
  for(const bad of [null,'',lease.toUpperCase().replace('4000','Z000'),"x');select 1;--"])
    assert.throws(()=>pinLifecycleRequestSql(0,bad),/pin_lifecycle_lease/);
  for(const body of [second.close,{...first.close,action:'break_start'},{...first.close,expectedSequence:0},{...first.close,extra:true},
    {...first.close,expectedEmployeeId:second.employee},{...first.close,operationId:second.closeOperation}])
    assert.throws(()=>pinLifecycleRequestSql(0,lease,body),/pin_lifecycle_command/);
  assert.throws(()=>pinLifecycleRequestSql(0,lease,first.close,first.closeOperation),/pin_lifecycle_operation_mode/);
  assert.throws(()=>pinLifecycleRequestSql(0,lease,null,second.closeOperation),/pin_lifecycle_operation/);
});

test('native scenario keeps real lock witness and immutable-fact checks without counter reset, fake clocks or KDF claims',()=>{
  const source=readFileSync(new URL('./merchant-attendance-pin-lifecycle-checks.mjs',import.meta.url),'utf8');
  assert.match(source,/assertLifecycleSandbox\(exec\)/);assert.match(source,/lifecycleRace\(\{connect,query,sql\},holder,pending\.clock\)/);
  assert.match(source,/raced\.witnessed,true/);assert.match(source,/restore_cannot_revive_consumed_lease/);
  assert.match(source,/checkCounters\(item,2\)/);assert.match(source,/checkCounters\(item,5\)/);
  assert.match(source,/old_facts_unchanged/);assert.match(source,/restore_preserves_old_fact_and_receipt/);
  assert.match(source,/pinPasswordVerified:false/);assert.match(source,/attemptCountersReset:false/);
  assert.match(source,/at_time\+interval '720 hours'/);assert.doesNotMatch(source,/interval '30 days'/);
  assert.doesNotMatch(source,/attempts\s*=\s*0|set\s+lease_|set\s+window_at|pg_sleep|setTimeout|deriveAttendancePin|process\.env|spawn\(/);
  assert.doesNotMatch(source,/insert into public\.merchant_attendance_events|insert into public\.merchant_attendance_pin_clock_receipts/i);
});
