import assert from "node:assert/strict";
import test from "node:test";
import { AttendanceEmployeeLocationWorkspace } from "./merchantAttendanceEmployeeLocationWorkspace";
import { AttendanceLocationClockClient } from "./merchantAttendanceLocationClockClient";
import { AttendanceNoticeClient } from "./merchantAttendanceLocationNoticeClient";
import { createEmployeeLocationFixture, siteId, employeeId, workerId, locationId } from "../../scripts/fixtures/attendance-employee-location-workspace-model";
function fixture() {
  const f = createEmployeeLocationFixture(), memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  const workspace = new AttendanceEmployeeLocationWorkspace({ siteId, employeeId, apiFetch: f.apiFetch, storage: () => storage });
  const clock = () => new AttendanceLocationClockClient({ siteId, employeeId, workerId, canClock: true, apiFetch: f.apiFetch, environment: f.environment, storage: () => storage });
  const notice = () => new AttendanceNoticeClient({ query: { siteId, access: "self", expectedWorkerId: workerId, locationId, operationId: null }, actorId: employeeId, apiFetch: f.apiFetch, storage: () => storage });
  const report = () => workspace.report(workspace.getSnapshot().token, { busy: false, pendingId: null, receiptId: null });
  return { ...f, workspace, clock, notice, report, memory };
}
test("real clients share notice→acknowledge→guarded-clock state, without implicit collection or punches", async () => {
  const f = fixture(); await f.workspace.initialize(); let clock = f.clock(); await clock.initialize();
  assert.equal(clock.getSnapshot().result?.noticeGate.reason, "unpublished"); await clock.submit("clock_in");
  assert.equal(f.metrics().deviceCalls, 0); assert.equal(f.metrics().posts, 0);
  await f.publish(); await clock.initialize(); assert.equal(clock.getSnapshot().result?.noticeGate.reason, "acknowledgement_required");
  await clock.submit("clock_in"); assert.equal(f.metrics().deviceCalls, 0); assert.equal(f.metrics().posts, 0);
  clock.pause(); f.report(); await f.workspace.navigate("notice"); const notice = f.notice(); await notice.initialize();
  assert.equal(f.metrics().posts, 0); await notice.submit("acknowledge"); assert.equal(notice.getSnapshot().phase, "ready");
  assert.equal(f.metrics().deviceCalls, 0); assert.equal(f.metrics().posts, 1); notice.pause(); f.report(); await f.workspace.navigate("clock");
  clock = f.clock(); await clock.initialize(); assert.equal(clock.getSnapshot().result?.noticeGate.ready, true);
  assert.equal(f.metrics().deviceCalls, 0); await clock.submit("clock_in"); assert.equal(clock.getSnapshot().result?.state.status, "working");
  assert.equal(f.metrics().deviceCalls, 1); assert.equal(f.metrics().punches, 1); assert.equal(f.memory.size, 0); clock.pause();
});
test("lost acknowledgement routes to original notice and resolves by GET, not duplicate acknowledgement", async () => {
  const f = fixture(); await f.publish(); const notice = f.notice(); await notice.initialize(); f.mode("lost"); await notice.submit("acknowledge");
  assert.ok(notice.getSnapshot().pending); assert.equal(f.metrics().posts, 1); notice.pause(); f.mode("normal");
  await f.workspace.initialize(); assert.equal(f.workspace.getSnapshot().target?.step, "notice");
  const recovered = f.notice(); await recovered.initialize(); assert.equal(recovered.getSnapshot().pending, null);
  assert.equal(f.metrics().posts, 1); assert.equal(f.metrics().deviceCalls, 0); assert.equal(f.memory.size, 0); recovered.pause();
});
test("lost punch restores original intent by read; paused channel then allows explicit locationless finish", async () => {
  const f = fixture(); await f.publish(); const notice = f.notice(); await notice.initialize(); await notice.submit("acknowledge"); notice.pause();
  let clock = f.clock(); await clock.initialize(); f.mode("lost"); await clock.submit("clock_in"); assert.ok(clock.getSnapshot().pending); clock.pause();
  const writes = f.metrics().posts, samples = f.metrics().deviceCalls; f.mode("normal"); f.enabled(false);
  await f.workspace.initialize(); assert.equal(f.workspace.getSnapshot().target?.step, "clock"); clock = f.clock(); await clock.initialize();
  assert.equal(clock.getSnapshot().pending, null); assert.ok(clock.getSnapshot().result?.finish); assert.equal(f.metrics().posts, writes);
  await clock.submit("break_start"); assert.equal(f.metrics().posts, writes); assert.equal(f.metrics().deviceCalls, samples);
  await clock.initialize();
  await clock.finish(); assert.equal(clock.getSnapshot().result?.state.status, "off"); assert.equal(clock.getSnapshot().confirmed?.receiptGate?.safeFinish, true);
  assert.equal(f.metrics().deviceCalls, samples); assert.equal(f.metrics().punches, 2); assert.equal(f.memory.size, 0); clock.pause();
});
test("device failure has no automatic fallback; explicit fallback keeps needs-review semantics", async () => {
  const f = fixture(); await f.publish(); const notice = f.notice(); await notice.initialize(); await notice.submit("acknowledge"); notice.pause();
  const clock = f.clock(); await clock.initialize(); f.mode("device_denied"); await clock.submit("clock_in");
  assert.equal(f.metrics().punches, 0); assert.equal(f.metrics().deviceCalls, 1); assert.equal(f.memory.size, 0);
  await clock.initialize(); await clock.submit("clock_in", "denied"); assert.equal(f.metrics().deviceCalls, 1); assert.equal(f.metrics().punches, 1);
  assert.equal(clock.getSnapshot().confirmed?.locationResult?.reason, "denied"); assert.equal(clock.getSnapshot().confirmed?.locationResult?.needsReview, true); clock.pause();
});
