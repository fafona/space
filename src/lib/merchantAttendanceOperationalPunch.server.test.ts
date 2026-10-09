// 242 synthetic transport tests: no SQL, real Auth, terminal or device claim.
import test from "node:test";
import assert from "node:assert/strict";
import { executeOperationalPunch, operationalPunchErrorStatus, type OperationalPunchServiceInput } from "./merchantAttendanceOperationalPunch.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { deriveAttendancePin } from "./merchantAttendancePin.server";
import { terminalHash } from "./merchantAttendanceTerminal.server";
import { signOnsiteToken } from "./merchantAttendanceOnsiteQr.server";
import { punchId as id, punchSite as siteId, punchFixture, punchStartFixture } from "./merchantAttendanceOperationalPunchTestFixtures";

const flags = { moduleEnabled: false, allowOperationalStart: false, allowSchedule: false, bindRules: false };
const authUserId = id(3), terminalId = id(9), secret = "A".repeat(43), workerNo = "PIN-01", pin = "01738264";
const read = { siteId, query: { mode: "prepare" as const }, command: null, ...flags };
const finish = { clock: { expectedWorkerId: id(1), operationId: id(20), locationId: id(4), action: "clock_out" as const, expectedSequence: 1 }, choice: { kind: "finish" as const } };
function rpc(run: (name: string, args: Record<string, unknown>) => unknown): AttendanceSelfRpc {
  return { rpc: async (name, args) => ({ data: await run(name, args), error: null }) };
}
const sqlDenied: AttendanceSelfRpc = { rpc: async () => ({ data: null, error: { message: "attendance_operational_punch_changed" } }) };
function rawClock(channel: "location" | "pin" | "onsite") {
  const clock = { workerId: id(1), locationId: id(4), state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false };
  return { result: { protocol: "attendance-operational-punch-v1", channel, siteId, readAt: "2026-10-08T12:00:00.000000Z",
    clock: channel === "onsite" ? { ...clock, employeeId: id(2) } : channel === "pin" ? { ...clock, siteId, terminalId, workerNo, workerName: "Synthetic only", employeeId: id(2), canStart: false, canFinish: false, blockReason: "attendance_not_employed" }
      : { ...clock, siteId, employeeId: id(2), channelEnabled: false, policy: null, locationResult: null, noticeGate: { ready: false, reason: "unpublished", revision: null }, finish: null, receiptGate: null, internalFence: null, internalPolicyFingerprint: null },
    policy: null, session: null, choices: null, association: null, adoption: null, operation: null, replayed: false, canStart: false, canBreak: false, canFinish: false }, source: null };
}

test("242 self adapter dispatches the strict source-verified result using only real supplied Auth", async () => {
  const f = await punchFixture(); let calls = 0;
  const result = await executeOperationalPunch({ ...read, channel: "self", authUserId }, rpc((name, args) => {
    calls++; assert.equal(name, "faolla_attendance_operational_punch_self_v1");
    assert.deepEqual(args, { p_site: siteId, p_auth: authUserId, p_query: read.query, p_command: null, p_allow_new_sessions: false, p_allow_operational_start: false, p_allow_schedule: false, p_bind_rules: false });
    return { result: f.result, source: f.source };
  }));
  assert.equal(calls, 1); assert.deepEqual(result, f.result); assert.equal("source" in result, false);
  await assert.rejects(executeOperationalPunch({ ...read, channel: "self", authUserId }, rpc(() => ({ result: f.result, source: null }))), /attendance_operational_punch_invalid/);
});

test("242 actual command and all four server gates reach the same new self RPC, including paused replay", async () => {
  const f = await punchStartFixture(); let calls = 0;
  const input: OperationalPunchServiceInput = { ...read, channel: "self", authUserId, command: f.command, query: f.input.query };
  assert.deepEqual(await executeOperationalPunch(input, rpc((name, args) => {
    calls++; assert.equal(name, "faolla_attendance_operational_punch_self_v1"); assert.deepEqual(args.p_command, f.command);
    assert.equal(args.p_allow_new_sessions, false); assert.equal(args.p_allow_operational_start, false); return { result: f.result, source: f.source };
  })), f.result); assert.equal(calls, 1);
  await assert.rejects(executeOperationalPunch({ ...input, query: { mode: "prepare" } }, rpc(() => { assert.fail("invalid query must not dispatch"); })), /attendance_invalid_request/);
});

test("242 known channel errors remain exact; unknown SQL/transport bodies are not no-write evidence", async () => {
  const input: OperationalPunchServiceInput = { ...read, channel: "self", authUserId };
  await assert.rejects(executeOperationalPunch(input, sqlDenied), /attendance_operational_punch_changed/);
  await assert.rejects(executeOperationalPunch(input, { rpc: async () => ({ data: null, error: { message: "private relation and secret" } }) }), /^MerchantAttendanceError: attendance_operational_punch_invalid$/);
  await assert.rejects(executeOperationalPunch(input, { rpc: async () => { throw Error("private network"); } }), /attendance_unavailable/);
  await assert.rejects(executeOperationalPunch(input, null), /attendance_unavailable/);
  for (const channel of ["self", "location", "pin", "onsite"] as const) assert.equal(operationalPunchErrorStatus(channel).attendance_operational_punch_changed, 409);
});

test("242 location read strips its private fence and never calls the old endpoint", async () => {
  const raw = rawClock("location"), calls: string[] = [];
  const result = await executeOperationalPunch({ ...read, channel: "location", authUserId, expectedWorkerId: id(1), position: null, positionFailure: null }, rpc(name => { calls.push(name); return raw; }));
  assert.deepEqual(calls, ["faolla_attendance_operational_punch_location_v1"]); assert.equal("internalFence" in result.clock, false);
});

test("242 location write derives spatial assertion from the exact private fence, without durable GPS", async () => {
  const raw = rawClock("location"); Object.assign(raw.result.clock, { channelEnabled: true,
    policy: { settingsVersion: 1, workerVersion: 1, locationVersion: 1, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 },
    noticeGate: { ready: true, reason: "ready", revision: 1 }, internalFence: { latitude: 0, longitude: 0, radiusMeters: 100, maxAgeMs: 60000 }, internalPolicyFingerprint: "1".repeat(32) });
  const command = { ...finish, clock: { ...finish.clock, settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false } };
  let calls = 0;
  await assert.rejects(executeOperationalPunch({ ...read, channel: "location", authUserId, expectedWorkerId: id(1), command,
    query: { mode: "recover", operationId: id(20) }, position: { latitude: 0, longitude: 0, accuracyMeters: 5, capturedAt: "2026-10-08T12:00:00.000Z" }, positionFailure: null }, {
    rpc: async (name, args) => { calls++; assert.equal(name, "faolla_attendance_operational_punch_location_v1"); assert.equal(args.p_require_clock, true);
      if (calls === 1) { assert.equal(args.p_command, null); assert.equal(args.p_assertion, null); return { data: raw, error: null }; }
      assert.deepEqual(args.p_command, command); assert.deepEqual(args.p_assertion, { policyFingerprint: "1".repeat(32), algorithmVersion: 1, reason: "inside", capturedAt: "2026-10-08T12:00:00.000Z", accuracyMeters: 5, distanceMeters: 0 });
      assert.equal(JSON.stringify(args.p_command).includes("latitude"), false); return { data: null, error: { message: "attendance_operational_punch_changed" } }; }
  }), /attendance_operational_punch_changed/); assert.equal(calls, 2);
});

test("242 onsite verifies the original HMAC before SQL; recover needs neither token nor QR key", async () => {
  const old = process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
  try {
    delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET;
    await executeOperationalPunch({ ...read, query: { mode: "recover", operationId: id(20) }, channel: "onsite", authUserId, token: null }, rpc((name, args) => { assert.equal(name, "faolla_attendance_operational_punch_onsite_v1"); assert.equal(args.p_claims, null); return rawClock("onsite"); }));
    process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = "a".repeat(64);
    const at = 1791451200000, claims = { v: 1 as const, purpose: "faolla.attendance.onsite" as const, siteId, terminalId, locationId: id(4), pairedAtMs: at - 1, issuedAtMs: at, expiresAtMs: at + 45000, nonce: id(11) }, token = signOnsiteToken(claims);
    const input: OperationalPunchServiceInput = { ...read, channel: "onsite", authUserId, token, query: { mode: "recover", operationId: id(20) }, command: { ...finish, clock: { ...finish.clock, expectedEmployeeId: id(2) } } };
    let calls = 0; await assert.rejects(executeOperationalPunch(input, { rpc: async (name, args) => { calls++; assert.equal(name, "faolla_attendance_operational_punch_onsite_v1"); assert.deepEqual(args.p_claims, claims); assert.equal("token" in args, false); return { data: null, error: { message: "attendance_qr_expired" } }; } }), /attendance_qr_expired/);
    await assert.rejects(executeOperationalPunch({ ...input, token: token.slice(0, -1) + (token.endsWith("A") ? "B" : "A") }, rpc(() => { assert.fail("bad MAC must not dispatch"); })), /attendance_qr_invalid/); assert.equal(calls, 1);
  } finally { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET; else process.env.FAOLLA_ATTENDANCE_ONSITE_QR_SECRET = old; }
});

test("242 PIN uses real shared KDF and the same lease for new finish; credentials never become intent", async () => {
  const old = process.env.FAOLLA_ATTENDANCE_PIN_PEPPER;
  try {
    process.env.FAOLLA_ATTENDANCE_PIN_PEPPER = "A".repeat(43);
    const salt = "1".repeat(32), verifier = await deriveAttendancePin(pin, salt, { siteId, workerId: id(1), employeeId: id(2) });
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const input: OperationalPunchServiceInput = { ...read, channel: "pin", terminalId, secret, workerNo, pin };
    const service = rpc((name, args) => { calls.push({ name, args }); return calls.length % 2 === 1 ? { workerId: id(1), employeeId: id(2), revision: 1, salt, verifier } : rawClock("pin"); });
    const result = await executeOperationalPunch(input, service); assert.equal(result.channel, "pin"); assert.equal(calls.length, 2);
    assert.equal(calls[0].name, "faolla_attendance_pin_begin_v1"); assert.equal(calls[1].name, "faolla_attendance_operational_punch_pin_v1"); assert.equal(calls[1].args.p_verified, true);
    assert.equal(calls[0].args.p_lease, calls[1].args.p_lease); assert.equal(calls[0].args.p_secret_hash, terminalHash(secret));
    assert.equal(JSON.stringify(calls).includes(pin), false); assert.equal(JSON.stringify(calls).includes(secret), false);
    await assert.rejects(executeOperationalPunch({ ...input, pin: "11738264" }, rpc((name, args) => {
      if (name.endsWith("begin_v1")) return { workerId: id(1), employeeId: id(2), revision: 1, salt, verifier };
      assert.equal(args.p_verified, false); return { error: "attendance_pin_denied" };
    })), /attendance_pin_denied/);
    await assert.rejects(executeOperationalPunch(input, rpc(() => ({ limited: true }))), /attendance_pin_busy/);
    await assert.rejects(executeOperationalPunch(input, rpc(name => name.endsWith("begin_v1") ? { workerId: id(1), employeeId: id(2), revision: 1, salt, verifier } : { error: "private unknown" })), /attendance_operational_punch_invalid/);
  } finally { if (old === undefined) delete process.env.FAOLLA_ATTENDANCE_PIN_PEPPER; else process.env.FAOLLA_ATTENDANCE_PIN_PEPPER = old; }
});
