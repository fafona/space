import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyPlanClearanceBoundariesNative} from './attendance-plan-clearance-boundaries-native.mjs';
const source=readFileSync(new URL('./attendance-plan-clearance-boundaries-native.mjs',import.meta.url),'utf8');
const between=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start);return source.slice(start,end);};

test('inert boundary helper requires caller-owned runtime and never changes historical rules or writer definitions',()=>{
  assert.equal(typeof verifyPlanClearanceBoundariesNative,'function');
  assert.match(source,/assertLifecycleSandbox\(sql=>native\.query\(scope\.sql\(sql\)\)\)/);
  assert.match(source,/assert\.equal\(scope\.schema,d\.owned\.schema\)/);
  assert(!/process\.argv|spawn\(|createRequire|disable trigger|session_replication_role|create or replace|statement_timeout/i.test(source));
  assert(!/update public\.merchant_attendance_(?:events|plan_rule|shift_|correction_|revision_|effect_|plan_exception_)/i.test(source));
  assert.match(source,/source\.approval\?\.source\.fields\.earlyGraceMinutes/);
  assert.match(source,/candidate\.early\.rawDeltaUs,'60000000'/);assert.match(source,/candidate\.early\.excessUs,'0'/);
  assert.match(source,/disabledOrUnconfiguredHistoricalRuleNativeCovered:false/);
});
test('negative writes use exact errors and a normalized whole-ledger hash inside nine-stage rollback',()=>{
  const group=between('const stages=[','const privateSignature=');
  for(const name of ['missing_case','approved_leave','auth_rebind','role_withdrawn','employee_inactive','worker_inactive','module_paused'])assert(group.includes(`closedStage('${name}'`));
  assert.match(source,/set local time zone 'UTC';set local datestyle='ISO, YMD'/);
  assert.match(source,/if sqlerrm<>\$\{quote\(error\)\} then raise;end if/);
  assert.match(source,/assert \$\{hash\}=before_hash/);
  assert.match(group,/assert\.equal\(stages\.length,9\)/);assert.match(group,/assert\.equal\(denials,10\)/);
  assert.match(group,/set constraints all immediate;rollback;/);
  assert.match(group,/finally\{assert\.equal\(all\(\),baseline/);
});
test('missing case uses an actual case-free slot and approved leave comes from two original RPC calls',()=>{
  const absent=between('const missingCase=','const leaveRequest=');
  assert.match(absent,/merchant_attendance_schedule_slots s/);assert.match(absent,/not exists\(select 1 from public\.merchant_attendance_plan_exception_cases/);
  assert.match(absent,/expectedRevision:1/);assert.match(absent,/attendance_plan_exception_review_blocked/);
  const leave=between('const leaveSetup=','const ownerRecovery=');
  assert.equal((leave.match(/public\.faolla_attendance_leave_v1\(/g)||[]).length,2);
  assert.match(leave,/set local role service_role;reply:=public\.faolla_attendance_leave_v1/);
  assert.match(leave,/action:'approve'.*expectedRevision:1/);assert.match(leave,/detail'->>'status'='approved'/);
  assert.match(source,/currentBlocked\('leave_approved','actual_approved_leave'\)/);
});
test('real revision approval holds exactPID lock and stale clearance fails against post-winner full hash',()=>{
  const race=between('const beforeCorrection=','const captureOff=');
  assert.match(source,/public\.faolla_attendance_revision_self_v2/);assert.match(source,/public\.faolla_attendance_revision_decide_v2/);
  assert.match(race,/prepareRevision\(raceRequest,raceApproval,raceProposal\)/);
  assert.match(race,/pending\.blockers\.includes\('pending_correction'\)/);
  assert.match(race,/await lifecycleRace\(\{connect:\(\)=>native\.connect\(\)/);
  assert.match(race,/perform \$\{preparedRace\.sql\};set constraints all immediate/);
  assert.match(race,/attendance_plan_exception_review_source_changed/);
  assert.match(race,/assert\.equal\(normalized\(\),winnerHash,'clearance_waiter_failure_has_no_residue'\)/);
  assert.match(race,/effect\.operationId,raceApproval/);
});
test('no-backfill starts with a real capture-off success then replays all three RPCs without writes',()=>{
  const replay=between('const captureOff=','//Keep the browser');
  assert.match(replay,/submit\(captureOff,\{capture:false\}\)/);
  assert.match(replay,/assert\.equal\(countCapture\(\),'0'\);const beforeReplay=all\(\)/);
  assert.match(replay,/for\(const name of \[review,eventReview,clearance\]\)/);
  assert.match(replay,/allow:false,enabled:false,capture:true/);
  assert.match(replay,/read\(rq\('recover','owner',captureOffOperation\)\)/);
  assert.match(replay,/assert\.equal\(all\(\),beforeReplay,'clearance_capture_off_original_never_backfilled'\)/);
});
test('final browser precondition is restored by a second real revision, protecting every preexisting row',()=>{
  const ending=source.slice(source.indexOf('//Keep the browser'));
  assert.match(ending,/prepareRevision\(resumeRequest,resumeApproval/);assert.match(ending,/ownedCall\(resumed\.sql\)/);
  assert.match(ending,/assert\.equal\(final\.detail\.stale,true\)/);assert.match(ending,/candidate\[key\]\.state,'not_triggered'/);
  assert.match(ending,/effect\.operationId,resumeApproval/);assert.match(ending,/clearance_all_preexisting_rows_unchanged/);
  assert.match(source,/where not\(merchant_id=\$\{quote\(site\)\} and operation_id in/);
  assert.match(source,/merchant_attendance_plan_exception_entries:\[captureOffOperation\]/);
  assert.match(source,/assert\.deepEqual\(privateAcl,\{service:false,anon:false,authenticated:false\}\)/);
});
