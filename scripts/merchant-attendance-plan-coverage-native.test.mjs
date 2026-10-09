// Pure/static only; root separately executes the real SQL acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {checkAttendancePlanCoverageNative,runAttendancePlanCoverageNative,planCoverageNativeLabels,planCoverageDenseEventsSql} from './merchant-attendance-plan-coverage-native.mjs';
import {preparePlanCoverageNativeFixture,planCoverageExpression,planCoverageMigration} from './fixtures/attendance-plan-coverage-native.mjs';
import {lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';
const source=readFileSync(new URL('./merchant-attendance-plan-coverage-native.mjs',import.meta.url),'utf8');
const fixture=readFileSync(new URL('./fixtures/attendance-plan-coverage-native.mjs',import.meta.url),'utf8');
test('inert exports retain one owned namespace and no invocation of old broad checks',()=>{
  for(const fn of [checkAttendancePlanCoverageNative,runAttendancePlanCoverageNative,preparePlanCoverageNativeFixture])assert.equal(typeof fn,'function');
  assert.equal(planCoverageNativeLabels.length,8);assert(Object.isFrozen(planCoverageNativeLabels));
  assert.match(source,/withAttendanceConcurrencySandbox\(native,async scope/);assert.match(source,/if\(process.argv\[1\]/);
  assert.doesNotMatch(source+fixture,/checkAttendanceShiftCheckNative|checkAttendanceSelfSchedule\(|\bspawn\(|session_replication_role|disable trigger/i);
});
test('139 full migration preserves CIC boundaries and exactly one additive valid index',()=>{
  assert.equal(planCoverageMigration,'202610050139_merchant_attendance_plan_coverage.sql');
  for(const marker of ['native.query(scope.sql(readFileSync','addedIndexes.length,1',"addedIndexes[0][1],'attendance_shift_schedule_slot_idx'",'oldDefinitions(),oldDefs',
    'assert.equal(d.fingerprint(),installedFacts)','assert.deepEqual(indexes(),afterIndexes)'])assert(fixture.includes(marker));
  assert.doesNotMatch(fixture,/boundClockMigrationBody.*planCoverageMigration/);
});
test('read expression fixes reader and escapes JSON plus actor',()=>{
  const q={siteId:'99990001',workerId:id(201),slotId:id(701)};
  assert.equal(planCoverageExpression(q,id(99)),`public.faolla_attendance_plan_coverage_v1('${JSON.stringify(q)}'::jsonb,'${id(99)}')`);
  assert.match(planCoverageExpression({...q,extra:"O'Hara"},"x'y"),/O''Hara/);
});
test('actual137 same-slot cycles and private095 approval paths keep synthetic history honest',()=>{
  for(const marker of ['executeAttendanceSelfSchedule({','executeAttendanceSelf({','faolla_attendance_correction_self_v3','faolla_attendance_correction_decide_v1',
    'faolla_attendance_revision_self_v2','faolla_attendance_revision_decide_v2','ONE explicitly synthetic historical plan','NOT proof of past publication',
    'insert into public.merchant_attendance_schedule_publication_evidence select(e).*','SYNTHETIC historical events AND relations, not actual137 clocks',
    'plan_fixture_historical_worker_tail_changed',"'attendance.self.request'=any(role_check.permissions)","detail=coalesce((r->'blockers')::text",'syntheticHistoricalEvents:4','syntheticHistoricalRelations:2'])assert(fixture.includes(marker),marker);
  assert.doesNotMatch(fixture,/update public\.merchant_attendance_(?:events|schedule_slots|shift_schedule_relations)/);
  assert.match(source,/realPastPublication:false/);assert.match(source,/actualSameSlotSessions:true/);
  assert.match(source,/historical.worker.workerId,d.geoWorker/);assert.match(fixture,/readRaw=\(q=query\(slots.future\),actor=owner\)/);
});
test('selected geometry changes only after actual approval while absent rules cannot erase a linked interval',()=>{
  for(const marker of ["historical.selected.coveredUs,'3600000000'","moved.selected.coveredUs,'1800000000'",'d.reviseHistorical(false)',
    'assert.deepEqual(moved.original,historical.original)','missing_rules_must_not_erase_trusted_relation',"legacy.sessions[0].relation.reason,'publication_missing'"])assert(source.includes(marker));
});
test('density reaches aggregate2002 and2003 not just each-child event cap; batches are bounded100',()=>{
  const d={ongoing:{id:id(164777)}};
  const finish=planCoverageDenseEventsSql(d,2002,1901,95),open=planCoverageDenseEventsSql(d,2003,1901,96);
  assert.match(finish,/when n=1995 then 'clock_out'/);assert.match(finish,/generate_series\(1901,1995\)/);
  assert.doesNotMatch(open,/then 'clock_out'/);assert.match(open,/generate_series\(1901,1996\)/);
  assert.throws(()=>planCoverageDenseEventsSql(d,2002,1,101));assert.throws(()=>planCoverageDenseEventsSql(d,2002,1995,2));
  assert.throws(()=>planCoverageDenseEventsSql({ongoing:{id:"x';"}},2002,1,1));
  for(const marker of ['offset+=100','native.querySteps(steps.map(scope.sql))','result.sessions.reduce((n,s)=>n+s.events.length,0),2002',
    'Array.from({length:7},()=>cycle)','cap10.sessions.length,10'])assert(source.includes(marker));
});
test('real clock-out and cancel waiters roll back savepoint writes after exact-PID lock witnesses',()=>{
  for(const marker of ['lifecycleRace({connect:native.connect','savepoint write_probe','rollback to savepoint write_probe',
    'public.faolla_attendance_self_v1','public.faolla_attendance_schedule_v1','race.witnessed,true','race.right.error,null'])assert(source.includes(marker));
  assert.match(source,/actualClockCancellationLockWitnesses:races.length/);
});
test('empty-set auth current identity paused reads strict handler and private ACL are covered',()=>{
  for(const marker of ['[slots.zero,slots.future]',"status='disabled',auth_user_id=null",'inactive.worker.active,false',
    'handlePlanCoverage(request(),dependencies)','executePlanCoverage(input,service)',"allowEmployeeAttendance:false",'handlerSql,before',
    "['anon','authenticated','service_role']",'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER','plan_native_changed_facts',
    'indexUsableWithSeqScanDisabled:true','capacityBenchmark:false'])assert(source.includes(marker));
});
