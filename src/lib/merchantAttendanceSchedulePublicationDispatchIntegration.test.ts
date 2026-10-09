// Pure service-boundary integration with a stub RPC, not SQL/Auth acceptance.
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { executeAttendanceSchedule } from "./merchantAttendanceSchedule.server";
import { parseScheduleResult, type ScheduleCommand, type ScheduleQuery, type ScheduleResult } from "./merchantAttendanceSchedule";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q: ScheduleQuery = { siteId: "99990001", access: "owner", workerId: id(201), fromDate: "2026-10-01", throughDate: "2026-10-31", operationId: null };
const publish: ScheduleCommand = { operationId: id(401), expectedRevision: 0, expectedSettingsVersion: 1, reason: "Synthetic original publication",
  action: "publish", locationId: id(301), timeZone: "UTC", slots: [["2026-10-10T08:00:00.000Z", "2026-10-10T16:00:00.000Z"]] };
const cancel: ScheduleCommand = { operationId: id(402), expectedRevision: 1, expectedSettingsVersion: 1, reason: "Synthetic cancellation", action: "cancel", slotId: id(501) };
const original = "faolla_attendance_schedule_v1", evidenced = "faolla_attendance_schedule_evidenced_v1";
const keys = ["FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_ENABLED", "FAOLLA_ATTENDANCE_SCHEDULE_PUBLICATION_EVIDENCE_SITE_IDS"] as const;
function environment(t: TestContext, enabled: string | undefined, sites: string | undefined = q.siteId) {
  const prior = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; }));
  [enabled, sites].forEach((value, i) => { if (value === undefined) delete process.env[keys[i]]; else process.env[keys[i]] = value; });
}
const input = (command: ScheduleCommand | null, allowWrite = true, query = q) => ({ query, command, authUserId: id(99), allowWrite });
function result(command: ScheduleCommand | null = null, query = q): ScheduleResult {
  return { siteId: query.siteId, access: query.access, fromDate: query.fromDate, throughDate: query.throughDate,
    revision: command ? command.expectedRevision + 1 : 0, settingsVersion: 1, timeZone: "UTC",
    worker: query.workerId ? { id: query.workerId, name: "Synthetic worker", active: true,
      location: { id: id(301), name: "Synthetic location", active: true, timeZone: "UTC" } } : null,
    entries: [], rangeLimited: false, receipt: command ? { operationId: command.operationId, revision: command.expectedRevision + 1, command } : null, moduleEnabled: true };
}

test("the actual service defaults to099 and keeps all four original arguments", async t => {
  environment(t, undefined); let calls = 0;
  const args = input(publish, false), before = structuredClone(args);
  const response = await executeAttendanceSchedule(args, { rpc: async (name, actual) => {
    calls++; assert.equal(name, original); assert.deepEqual(actual, { p_query: q, p_auth_user_id: id(99), p_command: publish, p_allow_write: false });
    return { data: result(publish), error: null };
  } });
  assert.equal(calls, 1); assert.deepEqual(args, before); assert.deepEqual(response, { ...result(publish), moduleEnabled: false });
});
test("enabled listed publish selects exactly one wrapper call, retains old parsing and strips private snapshot data", async t => {
  environment(t, "1"); let calls = 0; const raw = { ...result(publish), employeeAuthUserId: null, privatePublicationEvidence: { secret: "not a browser field" } };
  const response = await executeAttendanceSchedule(input(publish), { rpc: async (name, args) => {
    calls++; assert.equal(name, evidenced); assert.deepEqual(args, { p_query: q, p_auth_user_id: id(99), p_command: publish, p_allow_write: true });
    return { data: raw, error: null };
  } });
  assert.equal(calls, 1); assert.deepEqual(response, parseScheduleResult(raw, { ...q, operationId: publish.operationId }, false));
  assert.equal(Object.hasOwn(response, "privatePublicationEvidence"), false); assert.equal(Object.hasOwn(response, "employeeAuthUserId"), false);
});
test("GET including original-number recovery and cancel stay099 even for an enabled listed merchant", async t => {
  environment(t, "1"); const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: { message: "attendance_access_denied" } }; } };
  for (const request of [input(null, false), input(null, false, { ...q, operationId: publish.operationId }), input(cancel, true),
    input(null, false, { ...q, access: "self", workerId: null })]) {
    await assert.rejects(executeAttendanceSchedule(request, service), { message: "attendance_access_denied" });
    assert.deepEqual(calls.at(-1), { name: original, args: { p_query: request.query, p_auth_user_id: id(99), p_command: request.command, p_allow_write: request.allowWrite } });
  }
  assert.equal(calls.length, 4);
});
test("off flag or an unlisted merchant keeps publication on099 without changing the result", async t => {
  environment(t, "1", "99990002"); let calls = 0;
  const service: AttendanceSelfRpc = { rpc: async name => { calls++; assert.equal(name, original); return { data: result(publish), error: null }; } };
  assert.deepEqual(await executeAttendanceSchedule(input(publish), service), { ...result(publish), moduleEnabled: false });
  process.env[keys[0]] = "0"; process.env[keys[1]] = q.siteId;
  assert.deepEqual(await executeAttendanceSchedule(input(publish), service), { ...result(publish), moduleEnabled: false }); assert.equal(calls, 2);
});
test("explicit original publish replay still routes through wrapper, preserves command and paused allowWrite, and returns the same old receipt", async t => {
  environment(t, "1"); const calls: Record<string, unknown>[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { assert.equal(name, evidenced); calls.push(args); return { data: result(publish), error: null }; } };
  const first = await executeAttendanceSchedule(input(publish, false), service), replay = await executeAttendanceSchedule(input(publish, false), service);
  assert.deepEqual(first, replay); assert.deepEqual(first.receipt, result(publish).receipt); assert.equal(calls.length, 2);
  for (const args of calls) { assert.equal(args.p_allow_write, false); assert.deepEqual(args.p_command, publish); }
});
test("range-limited old response and32-slot original command remain valid without deriving evidence from empty entries", async t => {
  environment(t, "1"); const slots: [string, string][] = Array.from({ length: 32 }, (_, index) => {
    const start = Date.parse("2026-10-10T00:00:00.000Z") + index * 3600000; return [new Date(start).toISOString(), new Date(start + 1800000).toISOString()];
  });
  const command: ScheduleCommand = { ...publish, slots }, raw = { ...result(command), rangeLimited: true };
  const response = await executeAttendanceSchedule(input(command), { rpc: async (name, args) => {
    assert.equal(name, evidenced); assert.deepEqual(args.p_command, command); return { data: raw, error: null };
  } });
  assert.equal(response.rangeLimited, true); assert.deepEqual(response.entries, []); assert.deepEqual(response.receipt?.command, command);
});
test("new snapshot failure or missing wrapper maps through the unchanged generic503 path without fallback or retry", async t => {
  environment(t, "1");
  for (const message of ["attendance_schedule_publication_evidence_invalid", "function public.faolla_attendance_schedule_evidenced_v1 does not exist", "private SQL diagnostic"]) {
    let calls = 0;
    await assert.rejects(executeAttendanceSchedule(input(publish), { rpc: async name => {
      calls++; assert.equal(name, evidenced); return { data: null, error: { message } };
    } }), { message: "attendance_unavailable" }); assert.equal(calls, 1);
  }
  let calls = 0; await assert.rejects(executeAttendanceSchedule(input(publish), { rpc: async name => {
    calls++; assert.equal(name, evidenced); throw Error("lost response");
  } }), { message: "lost response" }); assert.equal(calls, 1);
});
test("known099 denials and receipt/command mismatches keep old validation with no fallback", async t => {
  environment(t, "1");
  for (const response of [{ data: null, error: { message: "attendance_version_conflict" } }, { data: {}, error: null },
    { data: result(), error: null }, { data: result({ ...publish, reason: "other exact command" }), error: null }]) {
    let calls = 0; await assert.rejects(executeAttendanceSchedule(input(publish), { rpc: async name => { calls++; assert.equal(name, evidenced); return response; } }),
      { message: response.error ? "attendance_version_conflict" : "attendance_unavailable" }); assert.equal(calls, 1);
  }
});
test("invalid commands are rejected before either RPC regardless of the new feature gate", async t => {
  environment(t, "1"); let calls = 0;
  const malformed = { ...publish, reason: "" };
  await assert.rejects(executeAttendanceSchedule(input(malformed), { rpc: async () => { calls++; return { data: null, error: null }; } }), /attendance_invalid_request/);
  assert.equal(calls, 0);
});
