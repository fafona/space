import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const source=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const fixture=source('./fixtures/attendance-leave-parent-boundary-browser.tsx');
const harness=source('./attendance-self-browser-harness.mjs');
const runner=source('./merchant-attendance-leave-parent-boundary-browser-check.mjs');

test('parent-boundary repair acceptance mounts the actual two parent panels, not replacement leave clients or child-only launchers',()=>{
  for(const name of ['MerchantAttendanceAdminPanel','MerchantAttendanceSelfPanel']){
    assert(fixture.includes(`../../src/components/enterprise/${name}`));
    assert(fixture.includes(`<${name} `));
  }
  assert(!/new Attendance(?:Self|Admin|Leave).*Client/.test(fixture));
  assert(!/import .*Leave(?:Panel|Launcher|Notifications)/.test(fixture));
  assert(fixture.includes('canClock={false}'));
});

test('repair page transport is same-origin GET-only with explicit owner and employee endpoint lists',()=>{
  assert(fixture.includes('url.origin !== window.location.origin'));
  assert(fixture.includes('!allowed.has(url.pathname)'));
  assert(fixture.includes('(init?.method ?? "GET") !== "GET" || init?.body'));
  assert(fixture.includes('synthetic_leave_parent_boundary_route_required'));
  const endpoints=[...new Set(fixture.match(/\/api\/merchant-enterprise\/attendance\/[a-z-]+/g))].sort();
  assert.deepEqual(endpoints,['admin','leave','leave-notifications','self'].map(key=>`/api/merchant-enterprise/attendance/${key}`));
  assert(!/localStorage|sessionStorage|\.env|window\.open|location\.assign/.test(fixture));
});

test('new diagnostic mode rejects mixed entry flags and preserves prior PIN and other isolated harness entries',()=>{
  assert(harness.includes("const withLeaveParentBoundary=process.argv.includes('--leave-parent-boundary')"));
  assert(harness.includes("!['--leave-parent-boundary','--check-only'].includes(flag)"));
  assert(harness.includes("throw Error('attendance_leave_parent_boundary_conflicting_flags')"));
  const entry=harness.split('\n').find(line=>line.startsWith('const entry = '));
  assert(entry);
  for(const [flag,name] of [
    ['withGroups','groups'],['withCalendar','calendar'],['withLeaveParentBoundary','leave-parent-boundary'],
    ['withLeaveReview','leave-review'],['withLeaveNotifications','leave-notifications'],['withLeave','leave'],
    ['withPinWorkflow','pin-workflow'],['withPinClock','pin-clock'],['withPin','pin'],
    ['withKioskCorrection','kiosk-correction'],['withTerminals','terminals'],
    ['withUnified','unified'],['withMissing','missing'],['withSchedule','schedule'],
    ['withMerchantShell','merchant-shell'],['withDatabaseEntry','database'],
  ])assert(entry.includes(`${flag}?'${name}':`),`missing isolated entry: ${flag}`);
  assert(harness.includes("withLeave||withLeaveReview||withLeaveParentBoundary?'\"1\"':'\"0\"'"));
  assert(harness.includes("withLeaveNotifications||withLeaveParentBoundary?'\"1\"':'\"0\"'"));
});

test('repair runner requires parent reset, late-reply suppression, independent inactive-worker history and non-auth recovery',()=>{
  for(const contract of [
    "owner-parent-403-resets-child",
    "self-parent-403-resets-dirty-child-and-invalidates-late-read",
    "inactive-worker-resets-parent-but-leave-history-reopens",
    "attendanceLeaveParentBoundaryRepair:true",
    "authorizationCleanupPassed:true",
    "lateAuthorizedReplySuppressed:true",
    "nonAuthorizationFailuresPreservedChildren:true",
  ])assert(runner.includes(contract),`missing repair acceptance: ${contract}`);
  assert(runner.includes("item.error==='attendance_access_denied'"));
  assert(runner.includes("item.error==='attendance_disabled'")||runner.includes("disabledRead.error,'attendance_disabled'"));
  assert(runner.includes("unavailableRead.status,503"));
  assert(runner.includes("pausedRead.moduleEnabled,false"));
  assert(runner.includes("waitFor({state:'detached'})"));
  assert(runner.includes("requestAnimationFrame(()=>requestAnimationFrame(resolve))"));
  assert(runner.includes("requests.some(item=>item.method==='POST'),false"));
  assert(!runner.includes('authorizationCleanupPassed:false,noProductionFix:true'));
});
