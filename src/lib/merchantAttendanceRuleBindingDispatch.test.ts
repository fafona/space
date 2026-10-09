import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { attendanceClockRpcName } from "./merchantAttendanceRuleBindingDispatch.server";
import { executeAttendanceSelf, type AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { executeAttendanceLocationClock } from "./merchantAttendanceLocationClock.server";
import { executeOnsiteClock } from "./merchantAttendanceOnsiteQr.server";
import { executePinClock } from "./merchantAttendancePinClock.server";

const siteId = "99990001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const channels = ["self", "location", "pin", "onsite"] as const;
const legacy = ["faolla_attendance_self_v1", "faolla_attendance_location_clock_v2", "faolla_attendance_pin_clock_v1", "faolla_attendance_onsite_clock_v1"];
const bound = ["faolla_attendance_self_bound_v1", "faolla_attendance_location_clock_bound_v1", "faolla_attendance_pin_clock_bound_v1", "faolla_attendance_onsite_clock_bound_v1"];
const envKeys = ["FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED", "FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS", "FAOLLA_ATTENDANCE_PIN_PEPPER"] as const;
function setEnvironment(t: TestContext, enabled: string, sites: string) {
  const prior = envKeys.map(key => process.env[key]);
  t.after(() => envKeys.forEach((key, index) => { if (prior[index] === undefined) delete process.env[key]; else process.env[key] = prior[index]; }));
  process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED = enabled;
  process.env.FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS = sites;
  process.env.FAOLLA_ATTENDANCE_PIN_PEPPER = Buffer.alloc(32, 23).toString("base64url");
}

test("all four channels remain legacy without both explicit server controls", () => {
  for (const enabled of [undefined, "", "0", "true", "1 ", "yes", "1"]) {
    for (const sites of [undefined, "", "*", "99990002", "99990001,*", "99990001,", "99990001,not-a-site", ",99990001", "99990001\n99990002"]) {
      channels.forEach((channel, index) => assert.equal(attendanceClockRpcName(channel, siteId, {
        FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED: enabled, FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS: sites,
      }), legacy[index]));
    }
  }
});

test("valid bounded allowlist opts only exact merchants in and never changes admission permission", () => {
  const env = { FAOLLA_ATTENDANCE_RULE_BINDINGS_ENABLED: "1", FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS: " 99990002, 99990001 " };
  channels.forEach((channel, index) => {
    assert.equal(attendanceClockRpcName(channel, siteId, env), bound[index]);
    for (const other of ["99990003", "999900010", "9999000", " 99990001", "99990001 "]) assert.equal(attendanceClockRpcName(channel, other, env), legacy[index]);
    for (const tooLarge of [Array(101).fill(siteId).join(","), " ".repeat(4097) + siteId])
      assert.equal(attendanceClockRpcName(channel, siteId, { ...env, FAOLLA_ATTENDANCE_RULE_BINDINGS_SITE_IDS: tooLarge }), legacy[index]);
  });
});

for (const enabled of ["0", "1"]) test(`actual server dispatch ${enabled}: original arguments/denials preserved; no fallback RPC`, async t => {
  setEnvironment(t, enabled, siteId);
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: null, error: { message: "attendance_access_denied" } };
  } };
  const self = { siteId, authUserId: id(1), command: null, operationId: id(2) };
  await assert.rejects(executeAttendanceSelf(self, service), /attendance_access_denied/);
  assert.deepEqual(calls.at(-1)?.args, { p_site_id: siteId, p_auth_user_id: id(1), p_command: null, p_operation_id: id(2) });
  await assert.rejects(executeAttendanceLocationClock({ ...self, expectedWorkerId: id(3), moduleEnabled: false }, service), /attendance_access_denied/);
  assert.deepEqual(calls.at(-1)?.args, { p_site_id: siteId, p_auth_user_id: id(1), p_expected_worker_id: id(3),
    p_allow_new_sessions: false, p_require_clock: false, p_command: null, p_operation_id: id(2), p_assertion: null });
  await assert.rejects(executeOnsiteClock({ ...self, token: null, allowNew: false }, service), /attendance_access_denied/);
  assert.deepEqual(calls.at(-1)?.args, { p_site: siteId, p_auth: id(1), p_claims: null, p_command: null, p_operation: id(2), p_allow_new: false });
  const expected = enabled === "1" ? bound : legacy;
  assert.deepEqual(calls.map(call => call.name), [expected[0], expected[1], expected[3]]);

  const pinCalls: { name: string; args: Record<string, unknown> }[] = [];
  await assert.rejects(executePinClock({ siteId, terminalId: id(4), secret: Buffer.alloc(32, 17).toString("base64url"),
    workerNo: "TEST-01", pin: "01738264", command: null, operationId: id(2), allowNew: false }, { rpc: async (name, args) => {
    pinCalls.push({ name, args });
    return { data: name === "faolla_attendance_pin_begin_v1"
      ? { workerId: id(3), employeeId: id(5), revision: 1, salt: "01".repeat(16), verifier: "0".repeat(64) }
      : { error: "attendance_access_denied" }, error: null };
  } }), /attendance_access_denied/);
  assert.deepEqual(pinCalls.map(call => call.name), ["faolla_attendance_pin_begin_v1", expected[2]]);
  assert.equal(pinCalls[0].args.p_allow, true);
  assert.equal(pinCalls[1].args.p_allow_new, false);
  assert.equal(pinCalls[1].args.p_verified, false);
  assert.equal(pinCalls[1].args.p_lease, pinCalls[0].args.p_lease);
  assert.deepEqual(pinCalls[1].args.p_request, { command: null, operationId: id(2) });
  assert.doesNotMatch(JSON.stringify(pinCalls), /01738264|binding|sourceText/);
});

test("successful self receipt stays unchanged; private binding fields cannot reach the browser", async t => {
  setEnvironment(t, "1", siteId);
  const command = { expectedWorkerId: id(3), operationId: id(2), locationId: id(4), action: "clock_in" as const, expectedSequence: 0 };
  const receipt = { id: id(6), siteId, workerId: id(3), operationId: id(2), locationId: id(4), action: "clock_in", sequence: 1,
    occurredAt: "2026-10-04T10:00:00.000Z", timeZone: "UTC", breakPaid: null };
  const result = { workerId: id(3), locationId: id(4), state: { sequence: 1, status: "working", lastEvent: receipt }, receipt, replayed: false };
  assert.deepEqual(await executeAttendanceSelf({ siteId, authUserId: id(1), command, operationId: null }, { rpc: async (name, args) => {
    assert.equal(name, bound[0]); assert.deepEqual(args.p_command, command);
    return { data: { ...result, privateBinding: { sourceText: "private" } }, error: null };
  } }), result);
});

test("missing new migration or corrupt bound result is not retried through the unbound writer", async t => {
  setEnvironment(t, "1", siteId);
  const input = { siteId, authUserId: id(1), command: null, operationId: null };
  for (const response of [{ data: null, error: { message: "function missing; private database details" } }, { data: {}, error: null }]) {
    let calls = 0;
    await assert.rejects(executeAttendanceSelf(input, { rpc: async name => { calls++; assert.equal(name, bound[0]); return response; } }), { message: "attendance_unavailable" });
    assert.equal(calls, 1);
  }
});
