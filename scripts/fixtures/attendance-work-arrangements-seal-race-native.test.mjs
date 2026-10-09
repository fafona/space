import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyWorkArrangementSealRaceNative} from './attendance-work-arrangements-seal-race-native.mjs';
const source=readFileSync(new URL('./attendance-work-arrangements-seal-race-native.mjs',import.meta.url),'utf8');
test('seal race is inert and rejects unowned inputs before any runtime calls',async()=>{
  let called=false;await assert.rejects(verifyWorkArrangementSealRaceNative({d:{syntheticOnly:false},native:{query(){called=true;}}}));assert.equal(called,false);
  assert.doesNotMatch(source,/spawn|execFile|pg_ctl|initdb|disable trigger|session_replication_role/i);
  for(const text of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)','h.workerId,d.otherWorker'])assert(source.includes(text),text);
});
test('actual owner seal and authenticated self submit use two original RPCs under real service role and exact PID witness',()=>{
  for(const text of ["head.state,'confirmed'",'head.confirmedVersion,head.currentVersion',"attempt.startAt,h.slot.startAt",'set local role service_role;',
    'faolla_attendance_period_closure_v1','${json(seal)},null,true','faolla_attendance_work_arrangement_v1','h.employeeAuthUserId','await lifecycleRace',
    'race.witnessed,true','attendance_period_sealed','winner.operation.command.action'])assert(source.includes(text),text);
  assert.doesNotMatch(source,/action:\s*['"](?:send|confirm|decide)['"]|faolla_attendance_plan_exception_review_v1/);
});
test('only one exact period entry and mutable head may change; all archives/versions/business facts are protected',()=>{
  for(const text of ['merchant_attendance_period_closures','merchant_attendance_period_entries','r.operation_id=${quote(operationId)}',
    'beforeCounts.submitRequests,0','beforeCounts.submitEntries,0','periodEntries:beforeCounts.periodEntries+1,sealEntries:1',
    'seal_race_changed_unapproved_facts_or_old_archives','d.definitions(),defs','d.tableCatalog(),catalog','seal_result_read_wrote',
    'periodVersionsAdded:0','periodArtifactsAdded:0','workArrangementRequestsAdded:0','reverseRace:false'])assert(source.includes(text),text);
  assert.match(source,/const settled|settled=await period\(q\)/);
});
