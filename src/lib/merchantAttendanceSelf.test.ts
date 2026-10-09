import assert from "node:assert/strict";
import test from "node:test";
import { parseAttendanceSelfCommand } from "./merchantAttendanceSelf";
import { createAttendanceSelfLimiter, executeAttendanceSelf, readAttendanceSelfJson } from "./merchantAttendanceSelf.server";
import { DEFAULT_MERCHANT_ENTERPRISE_ROLES, getMissingMerchantEnterprisePermissionDependencies, normalizeMerchantEnterprisePermissions, isMerchantEnterpriseCollaborationPermission } from "./merchantEnterprise";
import type { AttendanceSelfResult } from "./merchantAttendanceSelf";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const body = { siteId: "99990001", expectedWorkerId: id(5), action: "clock_in", operationId: id(1), locationId: id(2), expectedSequence: 0 };
const input = { ...parseAttendanceSelfCommand(body), authUserId: id(3), operationId: null };
const receipt = { id: id(4), workerId: id(5), siteId: body.siteId, operationId: id(1), locationId: id(2), action: "clock_in" as const,
  sequence: 1, occurredAt: "2026-09-29T12:00:00.000Z", timeZone: "UTC", breakPaid: null };
const result: AttendanceSelfResult = { workerId: id(5), locationId: id(2), state: { sequence: 1, status: "working", lastEvent: receipt }, receipt, replayed: false };

test("attendance permissions normalize but grant no existing default role access", () => {
  assert.equal(isMerchantEnterpriseCollaborationPermission("attendance.self.view"), true);
  assert.equal(isMerchantEnterpriseCollaborationPermission("attendance.self.clock"), true);
  assert.deepEqual(normalizeMerchantEnterprisePermissions(["attendance.self.view", "attendance.self.clock"]), ["attendance.self.view", "attendance.self.clock"]);
  for (const role of DEFAULT_MERCHANT_ENTERPRISE_ROLES) assert.equal(role.permissions.some((p) => p.startsWith("attendance.")), false);
  assert.ok(getMissingMerchantEnterprisePermissionDependencies(["attendance.self.clock"]).length);
  assert.deepEqual(getMissingMerchantEnterprisePermissionDependencies(["enterprise.view", "attendance.self.view", "attendance.self.clock"]), []);
});
for (const expectedSequence of [-1, 0.1, "1", null, Number.MAX_SAFE_INTEGER, Infinity, NaN]) {
  test(`reject invalid expected sequence ${String(expectedSequence)}`, () => assert.throws(() => parseAttendanceSelfCommand({ ...body, expectedSequence }), /attendance_invalid_request/));
}
test("operation IDs are mandatory canonical UUIDs and actions explicit", () => {
  for (const value of [{ ...body, action: "toggle" }, { ...body, operationId: "" }, { ...body, locationId: "other" }, [], null]) assert.throws(() => parseAttendanceSelfCommand(value), /attendance_invalid_request/);
});
test("RPC wrapper sends one service transaction and preserves successful receipt", async () => {
  let calls = 0;
  assert.deepEqual(await executeAttendanceSelf(input, { rpc: async (name, args) => {
    calls++; assert.equal(name, "faolla_attendance_self_v1");
    assert.deepEqual(args, { p_site_id: body.siteId, p_auth_user_id: id(3), p_command: input.command, p_operation_id: null });
    return { data: result, error: null };
  } }), result);
  assert.equal(calls, 1);
});
test("RPC wrapper does not invent success when service or receipt is missing", async () => {
  await assert.rejects(executeAttendanceSelf(input, null), /attendance_unavailable/);
  for (const data of [null, {}, { ...result, receipt: null }, { ...result, receipt: { ...receipt, siteId: "99990002" } }, { ...result, receipt: { ...receipt, operationId: id(999) } }]) {
    await assert.rejects(executeAttendanceSelf(input, { rpc: async () => ({ data, error: null }) }), /attendance_unavailable/);
  }
});
test("RPC preserves known conflicts but does not expose database details", async () => {
  await assert.rejects(executeAttendanceSelf(input, { rpc: async () => ({ data: null, error: { message: "attendance_sequence_conflict" } }) }), /attendance_sequence_conflict/);
  await assert.rejects(executeAttendanceSelf(input, { rpc: async () => ({ data: null, error: { message: "internal sql including confidential data" } }) }), { message: "attendance_unavailable" });
});
test("RPC response validator rejects corrupt state, scope or time and strips unknown fields", async () => {
  for (const data of [
    { ...result, state: { ...result.state, sequence: 2 } },
    { ...result, state: { ...result.state, status: "off" } },
    { ...result, receipt: { ...receipt, occurredAt: "not a date" } },
    { ...result, receipt: { ...receipt, workerId: id(999) } },
    { ...result, locationId: undefined },
  ]) await assert.rejects(executeAttendanceSelf(input, { rpc: async () => ({ data, error: null }) }), /attendance_unavailable/);
  const parsed = await executeAttendanceSelf(input, { rpc: async () => ({ data: { ...result, internal: "private", receipt: { ...receipt, email: "private@example.test" } }, error: null }) });
  assert.deepEqual(parsed, result);
});
test("RPC read response cannot return a receipt for another request or tenant", async () => {
  const read = { ...input, command: null, operationId: id(88) };
  await assert.rejects(executeAttendanceSelf(read, { rpc: async () => ({ data: result, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeAttendanceSelf(read, { rpc: async () => ({ data: { ...result, receipt: null, state: { ...result.state, lastEvent: { ...receipt, siteId: "99990002" } } }, error: null }) }), /attendance_unavailable/);
});
test("JSON size enforcement counts actual stream bytes without trusting Content-Length", async () => {
  const request = new Request("https://example.test", { method: "POST", headers: { "content-type": "application/json", "content-length": "1" }, body: JSON.stringify({ data: "中".repeat(2000) }) });
  await assert.rejects(readAttendanceSelfJson(request), /attendance_body_too_large/);
});
test("limiter resets after a minute, does not merge users, and rejects new keys at capacity", () => {
  const allow = createAttendanceSelfLimiter();
  for (let i = 0; i < 60; i++) assert.equal(allow(id(1), 1000), true);
  assert.equal(allow(id(1), 1001), false); assert.equal(allow(id(2), 1001), true);
  assert.equal(allow(id(1), 61000), true);
  const full = createAttendanceSelfLimiter();
  for (let i = 0; i < 10000; i++) assert.equal(full(id(i), 0), true);
  assert.equal(full(id(10001), 0), false); assert.equal(full(id(10001), 60000), true);
});
