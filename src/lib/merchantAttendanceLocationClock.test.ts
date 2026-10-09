import assert from "node:assert/strict";
import test from "node:test";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";
import { parseAttendanceLocationClockCommand, parseAttendanceLocationClockQuery, parseAttendanceLocationClockResult } from "./merchantAttendanceLocationClock";
import { executeAttendanceLocationClock } from "./merchantAttendanceLocationClock.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", at = "2026-09-30T10:00:00.000Z";
const policy = { settingsVersion: 1, workerVersion: 1, locationVersion: 1, mode: "record_and_review", maxAgeMs: 60000, algorithmVersion: 1 } as const;
const baseCommand = { expectedWorkerId: id(2), operationId: id(5), locationId: id(3), action: "clock_in", expectedSequence: 0,
  settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false, position: { latitude: 37.3, longitude: -5.9, accuracyMeters: 10, capturedAt: at }, positionFailure: null } as const;
const event = { id: id(4), siteId, workerId: id(2), locationId: id(3), operationId: id(5), action: "clock_in", sequence: 1, occurredAt: at, timeZone: "UTC", breakPaid: null };
const prepared = { siteId, employeeId: id(1), workerId: id(2), locationId: id(3), state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false,
  noticeGate: { ready: true, reason: "ready", revision: 1 }, finish: null, receiptGate: null,
  channelEnabled: true, policy, locationResult: null, internalPolicyFingerprint: "a".repeat(32), internalFence: { latitude: 37.3, longitude: -5.9, radiusMeters: 100, maxAgeMs: 60000 } };
const summary = { eventId: event.id, settingsVersion: 1, workerVersion: 1, locationVersion: 1, algorithmVersion: 1,
  reason: "inside", needsReview: false, capturedAt: at, accuracyMeters: 10, distanceMeters: 0 };
const sqlIntent = { operationId: id(5), locationId: id(3), action: "clock_in", expectedSequence: 0, settingsVersion: 1, workerVersion: 1, locationVersion: 1, noticeRevision: 1, safeFinish: false };
const saved = { ...prepared, receipt: event, state: { sequence: 1, status: "working", lastEvent: event }, locationResult: summary,
  receiptGate: { noticeRevision: 1, safeFinish: false, command: sqlIntent } };
const input = { siteId, expectedWorkerId: id(2), authUserId: id(6), command: baseCommand, operationId: null, moduleEnabled: true };
const query = { siteId, expectedWorkerId: id(2), operationId: null, command: null };
test("location punch accepts only exact intent plus one position or one explicit failure", () => {
  assert.deepEqual(parseAttendanceLocationClockCommand({ siteId, ...baseCommand }), { siteId, command: baseCommand });
  for (const failure of ["denied", "timeout", "unavailable", "unsupported", "not_provided"] as const)
    assert.equal(parseAttendanceLocationClockCommand({ siteId, ...baseCommand, position: null, positionFailure: failure }).command.positionFailure, failure);
  for (const extra of [{ reason: "inside" }, { assertion: {} }, { internalPolicyFingerprint: "a".repeat(32) }, { authUserId: id(6) }, { moduleEnabled: true }, { occurredAt: at }, { latitude: 5 }])
    assert.throws(() => parseAttendanceLocationClockCommand({ siteId, ...baseCommand, ...extra }));
  for (const change of [{ position: null }, { positionFailure: "denied" }, { position: null, positionFailure: "inside" }, { position: { ...baseCommand.position, altitude: 1 } },
    { settingsVersion: 0 }, { workerVersion: "1" }, { locationVersion: Number.MAX_SAFE_INTEGER + 1 }, { expectedSequence: -1 }, { action: "toggle" }])
    assert.throws(() => parseAttendanceLocationClockCommand({ siteId, ...baseCommand, ...change }));
});
test("GET is bound to current expected worker and never accepts coordinates or chosen identities", () => {
  const url = `https://local.invalid/?${new URLSearchParams({ siteId, expectedWorkerId: id(2), operationId: id(5) })}`;
  assert.deepEqual(parseAttendanceLocationClockQuery(url), { siteId, expectedWorkerId: id(2), operationId: id(5) });
  for (const extra of ["&siteId=99990002", "&employeeId=x", "&reason=inside", "&latitude=1", "&allow=true"]) assert.throws(() => parseAttendanceLocationClockQuery(url + extra));
  assert.throws(() => parseAttendanceLocationClockQuery(`https://local.invalid/?siteId=${siteId}`));
});
test("response whitelist binds summary to receipt and does not expose fence/fingerprint or device coordinates", () => {
  const result = parseAttendanceLocationClockResult(saved, input);
  assert.equal(result.locationResult?.eventId, result.receipt?.id);
  assert.doesNotMatch(JSON.stringify(result), /internal|Fingerprint|latitude|longitude|authUserId/);
  for (const change of [{ employeeId: "bad" }, { siteId: "99990002" }, { workerId: id(9) }, { locationResult: null },
    { locationResult: { ...summary, eventId: id(9) } }, { locationResult: { ...summary, needsReview: true } },
    { locationResult: { ...summary, reason: "approved" } }, { channelEnabled: true, policy: null }, { policy: { ...policy, mode: "inside_only" } }])
    assert.throws(() => parseAttendanceLocationClockResult({ ...saved, ...change }, input));
});
test("freshness is checked against receipt time, not response time, including exact threshold edges", () => {
  const cases = [
    ["2026-09-30T09:59:00.000Z", "inside"], ["2026-09-30T09:58:59.999Z", "stale"],
    ["2026-09-30T10:00:05.000Z", "inside"], ["2026-09-30T10:00:05.001Z", "future"],
  ] as const;
  for (const [capturedAt, reason] of cases) {
    const value = { ...saved, locationResult: { ...summary, capturedAt, reason, needsReview: reason !== "inside" } };
    assert.equal(parseAttendanceLocationClockResult(value, input).locationResult?.reason, reason);
    assert.throws(() => parseAttendanceLocationClockResult({ ...value, locationResult: { ...value.locationResult, reason: reason === "inside" ? "stale" : "inside", needsReview: reason === "inside" } }, input));
  }
});
test("missing evidence has no fabricated accuracy/distance/time and always requires review", () => {
  const missing = { ...summary, reason: "denied", capturedAt: null, accuracyMeters: null, distanceMeters: null, needsReview: true };
  assert.equal(parseAttendanceLocationClockResult({ ...saved, locationResult: missing }, input).locationResult?.reason, "denied");
  for (const extra of [{ capturedAt: at }, { distanceMeters: 0 }, { accuracyMeters: 0 }, { needsReview: false }])
    assert.throws(() => parseAttendanceLocationClockResult({ ...saved, locationResult: { ...missing, ...extra } }, input));
});
test("server adapter makes an authenticated read then atomic write, never passes raw GPS to RPC", async () => {
  const calls: Record<string, unknown>[] = [];
  const service: AttendanceSelfRpc = { rpc: async (name, args) => { assert.equal(name, "faolla_attendance_location_clock_v2"); calls.push(args); return { data: calls.length === 1 ? prepared : saved, error: null }; } };
  const result = await executeAttendanceLocationClock(input, service); assert.equal(result.receipt?.id, event.id); assert.equal(calls.length, 2);
  assert.equal(calls[0].p_require_clock, true); assert.equal(calls[0].p_operation_id, baseCommand.operationId); assert.equal(calls[0].p_command, null);
  assert.equal(calls[1].p_allow_new_sessions, true);
  assert.deepEqual(calls[1].p_assertion, { policyFingerprint: prepared.internalPolicyFingerprint, algorithmVersion: 1, reason: "inside", capturedAt: at, accuracyMeters: 10, distanceMeters: 0 });
  assert.doesNotMatch(JSON.stringify(calls), /latitude|longitude|internalFence/);
  assert.equal(Object.keys(calls[1].p_command as object).length, 9);
  // Actual HTTP serializes the already-projected server result; browser parsing
  // must accept that shape too, not only the richer raw SQL fixture.
  assert.deepEqual(parseAttendanceLocationClockResult(JSON.parse(JSON.stringify(result)), input), result);
});
test("adapter leaves age classification to locked write even when device time is old/future", async () => {
  for (const capturedAt of ["2000-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"]) {
    let count = 0;
    const code = capturedAt < at ? "stale" : "future";
    await executeAttendanceLocationClock({ ...input, command: { ...baseCommand, position: { ...baseCommand.position, capturedAt } } }, { rpc: async (_, args) => {
      count++; if (count === 1) return { data: prepared, error: null };
      assert.equal((args.p_assertion as { reason: string }).reason, "inside");
      return { data: { ...saved, locationResult: { ...summary, capturedAt, reason: code, needsReview: true } }, error: null };
    } });
  }
});
test("explicit failed position creates a minimized review assertion, not an empty successful position", async () => {
  let count = 0;
  const result = await executeAttendanceLocationClock({ ...input, command: { ...baseCommand, position: null, positionFailure: "denied" } }, { rpc: async (_, args) => {
    count++; if (count === 1) return { data: prepared, error: null };
    assert.deepEqual(args.p_assertion, { policyFingerprint: prepared.internalPolicyFingerprint, algorithmVersion: 1, reason: "denied", capturedAt: null, accuracyMeters: null, distanceMeters: null });
    return { data: { ...saved, locationResult: { ...summary, reason: "denied", needsReview: true, capturedAt: null, accuracyMeters: null, distanceMeters: null } }, error: null };
  } }); assert.equal(result.locationResult?.needsReview, true);
});
test("receipt recovery is one read, no reclassification/write, even after pause/configuration change", async () => {
  let calls = 0;
  const result = await executeAttendanceLocationClock({ ...input, moduleEnabled: false }, { rpc: async (_, args) => {
    calls++; assert.equal(args.p_require_clock, true); assert.equal(args.p_allow_new_sessions, false);
    return { data: { ...saved, channelEnabled: false, policy: { ...policy, settingsVersion: 9 }, internalFence: null }, error: null };
  } });
  assert.equal(calls, 1); assert.equal(result.replayed, true); assert.deepEqual(result.receipt, event); assert.equal(result.locationResult?.settingsVersion, 1);
  await assert.rejects(executeAttendanceLocationClock({ ...input, command: { ...baseCommand, action: "clock_out" } }, { rpc: async () => ({ data: saved, error: null }) }), /attendance_operation_conflict/);
});
test("server-only READ requires no clock permission and strips all internal configuration", async () => {
  const result = await executeAttendanceLocationClock({ ...input, command: null, operationId: event.operationId }, { rpc: async (_, args) => {
    assert.equal(args.p_require_clock, false); return { data: saved, error: null };
  } }); assert.equal(result.replayed, false); assert.doesNotMatch(JSON.stringify(result), /internal|latitude|longitude/);
});
test("malformed internal snapshot, partial write response and RPC errors cannot look successful", async () => {
  for (const bad of [{ ...prepared, internalPolicyFingerprint: "bad" }, { ...prepared, internalFence: null }, { ...prepared, internalFence: { ...prepared.internalFence, latitude: 100 } }]) {
    let calls = 0; await assert.rejects(executeAttendanceLocationClock(input, { rpc: async () => { calls++; return { data: bad, error: null }; } }), /attendance_unavailable/); assert.equal(calls, 1);
  }
  let calls = 0; await assert.rejects(executeAttendanceLocationClock(input, { rpc: async () => ({ data: ++calls === 1 ? prepared : { ...saved, locationResult: null }, error: null }) }), /attendance_unavailable/);
  for (const [message, code] of [["attendance_location_policy_changed", "attendance_location_policy_changed"], ["secret DB data", "attendance_unavailable"]])
    await assert.rejects(executeAttendanceLocationClock(input, { rpc: async () => ({ data: null, error: { message } }) }), new RegExp(code));
  await assert.rejects(executeAttendanceLocationClock(input, null), /attendance_unavailable/);
  assert.equal(parseAttendanceLocationClockResult(prepared, query).receipt, null);
});
test("internal worker/query mismatch is rejected before any RPC or mutation", async () => {
  let calls = 0;
  const service: AttendanceSelfRpc = { rpc: async () => { calls++; return { data: saved, error: null }; } };
  await assert.rejects(executeAttendanceLocationClock({ ...input, expectedWorkerId: id(99) }, service), /attendance_invalid_request/);
  await assert.rejects(executeAttendanceLocationClock({ ...input, operationId: id(5) }, service), /attendance_invalid_request/);
  assert.equal(calls, 0);
});

test("safe finish is strictly locationless and cannot create a new shift or break", () => {
  const safe = { siteId, ...baseCommand, action: "clock_out", safeFinish: true, noticeRevision: null, position: null, positionFailure: "not_provided" };
  assert.equal(parseAttendanceLocationClockCommand(safe).command.safeFinish, true);
  for (const extra of [{ action: "clock_in" }, { action: "break_start" }, { noticeRevision: 1 }, { position: baseCommand.position, positionFailure: null }, { positionFailure: "denied" }, { safeFinish: "true" }])
    assert.throws(() => parseAttendanceLocationClockCommand({ ...safe, ...extra }));
  for (const noticeRevision of [null, 0, -1, 1.5, "1", 9007199254740991]) assert.throws(() => parseAttendanceLocationClockCommand({ siteId, ...baseCommand, noticeRevision }));
  assert.equal(parseAttendanceLocationClockCommand({ siteId, ...baseCommand, noticeRevision: 9007199254740990 }).command.noticeRevision, 9007199254740990);
});

test("receipt notice binding is not inferred from current notice and all original intent fields must match", () => {
  const withdrawn = { ...saved, channelEnabled: false, noticeGate: { ready: false, reason: "withdrawn", revision: 2 } };
  assert.equal(parseAttendanceLocationClockResult(withdrawn, input).receiptGate?.noticeRevision, 1);
  for (const extra of [{ receiptGate: null }, { noticeGate: { ...prepared.noticeGate, ready: false } },
    { receiptGate: { ...saved.receiptGate, command: { ...sqlIntent, expectedSequence: 9 } } },
    { receiptGate: { ...saved.receiptGate, noticeRevision: 2 } },
    { receiptGate: { ...saved.receiptGate, command: { ...sqlIntent, settingsVersion: 9 } } },
    { finish: { locationId: id(99), settingsVersion: 1, workerVersion: 1, locationVersion: 1 } }]) assert.throws(() => parseAttendanceLocationClockResult({ ...saved, ...extra }, input));
  // Read-only legacy receipts remain readable, never presented as notice-bound writes.
  assert.equal(parseAttendanceLocationClockResult({ ...saved, receiptGate: null }, { ...query, operationId: event.operationId }).receiptGate, null);
});

test("withdrawn preparation produces no location assertion and still reaches authoritative transactional denial", async () => {
  let calls = 0;
  await assert.rejects(executeAttendanceLocationClock(input, { rpc: async (_, args) => {
    if (++calls === 1) return { data: { ...prepared, channelEnabled: false, noticeGate: { ready: false, reason: "withdrawn", revision: 2 }, internalFence: null }, error: null };
    assert.equal(args.p_assertion, null); assert.equal((args.p_command as Record<string, unknown>).noticeRevision, 1);
    return { data: null, error: { message: "attendance_notice_required" } };
  } }), /attendance_notice_required/);
  assert.equal(calls, 2);
});

test("withdrawal between ready preparation and final write is surfaced, never accepted by pre-read alone", async () => {
  let calls = 0;
  await assert.rejects(executeAttendanceLocationClock(input, { rpc: async () => ++calls === 1 ? { data: prepared, error: null } : { data: null, error: { message: "attendance_notice_required" } } }), /attendance_notice_required/);
  assert.equal(calls, 2);
});

test("safe finish bypasses GPS classification, not atomic auth or exact receipt binding", async () => {
  const command = { ...baseCommand, operationId: id(8), action: "clock_out" as const, expectedSequence: 1, safeFinish: true, noticeRevision: null, position: null, positionFailure: "not_provided" as const };
  const sqlCommand = Object.fromEntries(Object.entries(command).filter(([key]) => !["expectedWorkerId", "position", "positionFailure"].includes(key)));
  const endEvent = { ...event, id: id(9), operationId: id(8), action: "clock_out", sequence: 2 };
  const endSummary = { ...summary, eventId: id(9), reason: "not_provided", needsReview: true, capturedAt: null, accuracyMeters: null, distanceMeters: null };
  const before = { ...saved, receipt: null, locationResult: null, receiptGate: null, channelEnabled: false,
    noticeGate: { ready: false, reason: "withdrawn", revision: 2 }, internalFence: null, finish: { locationId: id(3), settingsVersion: 1, workerVersion: 1, locationVersion: 1 } };
  let calls = 0;
  const result = await executeAttendanceLocationClock({ ...input, command, moduleEnabled: false }, { rpc: async (_, args) => {
    assert.equal(args.p_require_clock, true);
    if (++calls === 1) return { data: before, error: null };
    assert.equal(args.p_assertion, null);
    return { data: { ...before, receipt: endEvent, state: { sequence: 2, status: "off", lastEvent: endEvent }, finish: null,
      locationResult: endSummary, receiptGate: { noticeRevision: null, safeFinish: true, command: sqlCommand } }, error: null };
  } });
  assert.equal(result.receiptGate?.safeFinish, true); assert.equal(result.locationResult?.needsReview, true); assert.equal(calls, 2);
});
