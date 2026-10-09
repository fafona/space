import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("employee location workspace is lazy, default-off and displaces ordinary self client effects", () => {
  const s = read("src/components/enterprise/MerchantAttendanceSelfPanel.tsx");
  assert.match(s, /NEXT_PUBLIC_FAOLLA_ATTENDANCE_EMPLOYEE_LOCATION_WORKSPACE_ENABLED === "1"/);
  assert.match(s, /lazy\(\(\) => import\("\.\/MerchantAttendanceEmployeeLocationWorkspace"\)\)/);
  assert.match(s, /if \(locationOpen\) return;/); assert.match(s, /\[client, locationOpen, locationWorkspaceEnabled, siteId, employeeId, exceptionOpen, correctionOpen, planExceptionOpen\]/);
  assert.match(s, /if \(planExceptionOpen\) return;/);
  assert.match(s, /client.dispose\(\)/); assert.match(s, /if \(!checkSchedulePending\(\) && !checkLocationPending\(\)\) void client.submit\(action\)/);
  assert.match(s, /disabled=\{scheduleBlocked \|\| waiting \|\| !!state.pending \|\| state.phase === "storage_error"\}/);
});
test("employee workspace mounts one keyed child, has no implicit GPS/POST, and guards exit", () => {
  const s = read("src/components/enterprise/MerchantAttendanceEmployeeLocationWorkspace.tsx"), core = read("src/lib/merchantAttendanceEmployeeLocationWorkspace.ts");
  assert.match(s, /target.step === "clock" \?/); assert.match(s, /StepBoundary key=\{token\}/); assert.match(s, /requiresLeaveWarning/);
  assert.match(s, /access: "self"/); assert.doesNotMatch(s, /navigator.geolocation|method: "POST"|setInterval/);
  assert.doesNotMatch(core, /setItem|removeItem|method: "POST"|setInterval|geolocation/);
});
test("location actions require current notice; explicit safe-finish is not coupled to notice gate", () => {
  const s = read("src/components/enterprise/MerchantAttendanceLocationClockPanel.tsx"), hook = read("src/components/enterprise/useAttendanceLocationWorkspaceActivity.ts");
  assert.match(s, /result.noticeGate.ready && attendanceActionAllowed/);
  assert.match(s, /disabled=\{busy \|\| scheduleBlocked \|\| !canClock \|\| !finishConfirmed \|\| state.phase !== "ready"\}/);
  assert.match(s, /onClick=\{\(\) => \{ if \(scheduleClient.blocksOtherActions\(\)\) return; setFinishConfirmation\(null\); void client.finish\(\); \}\}/);
  assert.match(hook, /phase === "locating" \|\| phase === "submitting"/);
  const schedule = read("src/components/enterprise/MerchantAttendanceLocationScheduleClock.tsx");
  assert.match(s, /const activity = locationScheduleWorkspaceActivity\(state, scheduleState\)/);
  assert.match(s, /useAttendanceLocationWorkspaceActivity\(onWorkspaceActivity, activity.phase, activity.pendingId, activity.receiptId\)/);
  assert.match(schedule, /const busy = \["loading", "locating", "submitting"\].includes\(legacy.phase\) \|\| \["loading", "locating", "submitting"\].includes\(schedule.phase\)/);
  assert.match(schedule, /phase: busy \? "loading" : schedule.phase === "storage_error" \? "loading" : "paused"/);
});
