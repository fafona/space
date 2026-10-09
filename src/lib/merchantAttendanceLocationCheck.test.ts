import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendanceLocationCommand, parseAttendanceLocationQuery, parseAttendanceLocationPolicy, parseAttendanceLocationCheckResult, parseAttendancePosition } from "./merchantAttendanceLocationCheck";
import { executeAttendanceLocationCheck } from "./merchantAttendanceLocationCheck.server";
import type { AttendanceSelfRpc } from "./merchantAttendanceSelf.server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = { siteId: "99990001", expectedWorkerId: id(2), expectedLocationId: id(3) };
const versions = { settingsVersion: 1, workerVersion: 2, locationVersion: 3 };
const position = { latitude: 37.3, longitude: -5.9, accuracyMeters: 10, capturedAt: "2026-09-30T10:00:00.000Z" };
const command = { ...target, ...versions, position };
const policy = { ...versions, siteId: target.siteId, employeeId: id(1), workerId: id(2), locationId: id(3), checkedAt: position.capturedAt,
  maxAgeMs: 60000, diagnosticOnly: true, punchRecorded: false };
const snapshot = { ...policy, fence: { latitude: position.latitude, longitude: position.longitude, radiusMeters: 100, maxAgeMs: 60000 } };
const input = { ...target, authUserId: id(4), command };
const service = (data: unknown = snapshot): AttendanceSelfRpc => ({ rpc: async () => ({ data, error: null }) });

test("location target query is exact and accepts no caller identity, coords or extra parameters", () => {
  const url = `https://local.invalid/?${new URLSearchParams(target)}`;
  assert.deepEqual(parseAttendanceLocationQuery(url), target);
  for (const key of ["employeeId", "authUserId", "workerId", "latitude", "radiusMeters", "maxAgeMs", "siteId"]) assert.throws(() => parseAttendanceLocationQuery(`${url}&${key}=1`));
  for (const key of Object.keys(target)) { const q = new URL(url); q.searchParams.delete(key); assert.throws(() => parseAttendanceLocationQuery(q.href)); }
});
test("location body rejects unknown keys, client verdict, source time, policy and identity", () => {
  assert.deepEqual(parseAttendanceLocationCommand(command), command);
  for (const extra of [{ reason: "inside" }, { authUserId: id(4) }, { maxAgeMs: 999999 }, { fence: snapshot.fence }, { serverNow: position.capturedAt }, { operationId: id(5) }]) assert.throws(() => parseAttendanceLocationCommand({ ...command, ...extra }));
  for (const key of Object.keys(command)) { const changed: Record<string, unknown> = { ...command }; delete changed[key]; assert.throws(() => parseAttendanceLocationCommand(changed)); }
  for (const version of [0, -1, 1.1, "1", Number.MAX_SAFE_INTEGER + 1, null]) for (const key of Object.keys(versions)) assert.throws(() => parseAttendanceLocationCommand({ ...command, [key]: version }));
});
test("strict position permits geographic extremes but rejects malformed/coerced/extra fields", () => {
  for (const latitude of [-90, 0, 90]) for (const longitude of [-180, 0, 180]) assert.equal(parseAttendancePosition({ ...position, latitude, longitude }).latitude, latitude);
  for (const bad of [{ latitude: NaN }, { latitude: 90.00001 }, { longitude: Infinity }, { longitude: -180.01 }, { accuracyMeters: -1 },
    { accuracyMeters: 40_100_001 }, { accuracyMeters: "2" }, { latitude: null }, { altitude: 3 }, { capturedAt: "2026-02-30T00:00:00.000Z" },
    { capturedAt: "2026-09-30T10:00:00+02:00" }]) assert.throws(() => parseAttendancePosition({ ...position, ...bad }));
});
test("responses project no coordinates or authentication identity and never imply punch success", () => {
  assert.deepEqual(parseAttendanceLocationPolicy({ ...snapshot, secret: "private" }, target), policy);
  const result = { ...snapshot, reason: "inside", needsReview: false, distanceMeters: 0 };
  assert.deepEqual(parseAttendanceLocationCheckResult(result, target), { ...policy, reason: "inside", needsReview: false, distanceMeters: 0 });
  for (const bad of [{ siteId: "99990002" }, { workerId: id(99) }, { locationId: id(99) }, { employeeId: "bad" }, { maxAgeMs: 300000 },
    { diagnosticOnly: false }, { punchRecorded: true }, { checkedAt: "today" }]) assert.throws(() => parseAttendanceLocationPolicy({ ...policy, ...bad }, target));
  for (const bad of [{ reason: "passed" }, { needsReview: true }, { distanceMeters: null }, { distanceMeters: -1 }, { distanceMeters: 1.2 },
    { reason: "future", needsReview: true, distanceMeters: 0 }]) assert.throws(() => parseAttendanceLocationCheckResult({ ...result, ...bad }, target));
});
test("adapter only sends verified identity and expected versions to RPC, not device coordinates", async () => {
  let calls = 0;
  const rpc: AttendanceSelfRpc = { rpc: async (name, args) => {
    calls++; assert.equal(name, "faolla_attendance_location_policy_v1");
    assert.deepEqual(args, { p_site_id: target.siteId, p_auth_user_id: id(4), p_expected_worker_id: id(2), p_expected_location_id: id(3), p_expected_versions: versions });
    return { data: snapshot, error: null };
  } };
  const result = await executeAttendanceLocationCheck(input, rpc);
  assert.equal(calls, 1); assert.deepEqual(result, { ...policy, reason: "inside", needsReview: false, distanceMeters: 0 });
  assert.deepEqual(await executeAttendanceLocationCheck({ ...input, command: null }, service()), policy);
});
test("server classifies age and accuracy using database clock and fence, not local device claims", async () => {
  for (const [change, reason] of [[{ accuracyMeters: 150 }, "uncertain"], [{ latitude: 38 }, "outside"],
    [{ capturedAt: "2026-09-30T09:58:59.999Z" }, "stale"], [{ capturedAt: "2026-09-30T10:00:05.001Z" }, "future"],
    [{ capturedAt: "2026-09-30T09:59:00.000Z" }, "inside"], [{ capturedAt: "2026-09-30T10:00:05.000Z" }, "inside"]] as const) {
    const result = await executeAttendanceLocationCheck({ ...input, command: { ...command, position: { ...position, ...change } } }, service());
    assert.equal("reason" in result && result.reason, reason); assert.equal(result.punchRecorded, false);
  }
});
test("bad policy, stale version, invalid fence and raw DB errors fail closed without leak", async () => {
  for (const data of [null, { ...snapshot, employeeId: null }, { ...snapshot, fence: null }, { ...snapshot, fence: { ...snapshot.fence, latitude: 91 } },
    { ...snapshot, fence: { ...snapshot.fence, maxAgeMs: 300000 } }, { ...snapshot, settingsVersion: 4 }])
    await assert.rejects(executeAttendanceLocationCheck(input, service(data)), /attendance_unavailable/);
  await assert.rejects(executeAttendanceLocationCheck(input, null), /attendance_unavailable/);
  for (const [message, expected] of [["attendance_location_policy_changed", "attendance_location_policy_changed"], ["private SQL with location", "attendance_unavailable"]])
    await assert.rejects(executeAttendanceLocationCheck(input, { rpc: async () => ({ data: null, error: { message } }) }), new RegExp(`^MerchantAttendanceError: ${expected}$`));
});
