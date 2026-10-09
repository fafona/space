import assert from "node:assert/strict";
import test from "node:test";
import { attendanceLocationPolicyNotice, parseAttendanceLocationPolicyCommand, parseAttendanceLocationPolicyQuery, parseAttendanceLocationPolicyResult } from "./merchantAttendanceLocationPolicy";
import { executeAttendanceLocationPolicy } from "./merchantAttendanceLocationPolicy.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", locationId = id(1), at = "2026-09-30T12:00:00.000Z";
const values = { purpose: "考勤核查", notice: "请先阅读说明", contact: "负责人员工服务", alternative: "联系负责人进行替代登记", retentionDays: 90, latitude: 37.3, longitude: -5.9, radiusMeters: 100 };
const body = { siteId, locationId, operationId: id(2), expectedRevision: 0, expectedSettingsVersion: 1, expectedLocationVersion: 1, values };
const snapshot = { revision: 1, recordedAt: at, settingsVersion: 1, locationVersion: 1, values };
const base = { siteId, locationId, draftOnly: true, settingsVersion: 1, location: { name: "合成地点", active: true, version: 1 }, current: snapshot, previous: null, receipt: { operationId: id(2), revision: 1, recordedAt: at } };
const expected = { siteId, locationId, operationId: id(2) };
test("policy command has bounded owner draft fields and never an activation switch", () => {
  assert.deepEqual(parseAttendanceLocationPolicyCommand(body).command.values, values);
  for (const key of ["enabled", "authUserId", "published", "employeeConsent", "allowWrite"]) assert.throws(() => parseAttendanceLocationPolicyCommand({ ...body, [key]: true }));
  for (const key of ["locationClockEnabled", "continuousTracking", "employeeLatitude"]) assert.throws(() => parseAttendanceLocationPolicyCommand({ ...body, values: { ...values, [key]: true } }));
});
test("policy numeric and text limits reject coercion, infinities, malformed versions and control characters", () => {
  for (const patch of [{ latitude: 91 }, { longitude: -181 }, { radiusMeters: 0 }, { radiusMeters: 1.5 }, { latitude: NaN }, { longitude: Infinity }, { retentionDays: 3651 }, { retentionDays: "90" }, { purpose: " " }, { notice: "x\ntext" }, { contact: "x".repeat(121) }, { alternative: null }])
    assert.throws(() => parseAttendanceLocationPolicyCommand({ ...body, values: { ...values, ...patch } }));
  for (const key of ["expectedRevision", "expectedSettingsVersion", "expectedLocationVersion"]) for (const value of [-1, "1", 1.2, Number.MAX_SAFE_INTEGER]) assert.throws(() => parseAttendanceLocationPolicyCommand({ ...body, [key]: value }));
  assert.throws(() => parseAttendanceLocationPolicyCommand({ ...body, expectedSettingsVersion: 0 }));
  assert.equal(parseAttendanceLocationPolicyCommand({ ...body, values: { ...values, purpose: "  purpose  " } }).command.values.purpose, "purpose");
});
test("query permits only site, own location and optional recovery ID, with no duplicates", () => {
  assert.deepEqual(parseAttendanceLocationPolicyQuery(`https://www.faolla.com/?siteId=${siteId}&locationId=${locationId}`), { siteId, locationId, operationId: null });
  for (const extra of ["&latitude=1", "&ownerId=1", `&locationId=${locationId}`, "&cursor=1", "&operationId=bad"]) assert.throws(() => parseAttendanceLocationPolicyQuery(`https://www.faolla.com/?siteId=${siteId}&locationId=${locationId}${extra}`));
});
test("projection drops identity and metadata, binds location/receipt and adjacent revision snapshots", () => {
  const result = parseAttendanceLocationPolicyResult({ ...base, actor_auth_user_id: id(9), command: body, current: { ...snapshot, actor: id(9) } }, expected);
  assert.deepEqual(result, base);
  for (const patch of [{ siteId: "99990002" }, { locationId: id(9) }, { draftOnly: false }, { receipt: { ...base.receipt, operationId: id(8) } }, { previous: snapshot }, { current: { ...snapshot, revision: 3 } }, { receipt: { ...base.receipt, revision: 2 } }]) assert.throws(() => parseAttendanceLocationPolicyResult({ ...base, ...patch }, expected));
  const newer = { ...base, current: { ...snapshot, revision: 2 }, previous: snapshot };
  assert.equal(parseAttendanceLocationPolicyResult(newer, expected).receipt?.revision, 1);
  assert.throws(() => parseAttendanceLocationPolicyResult({ ...newer, previous: { ...snapshot, recordedAt: "2026-10-01T12:00:00.000Z" } }, expected));
});
test("draft preview does not present saving as employee consent, retention enforcement or activation", () => {
  const notice = attendanceLocationPolicyNotice(values).join("\n");
  for (const text of ["尚未向员工发布", "不进行持续追踪", "未启用自动清理", "替代登记", "不等于同意放弃权利"]) assert.ok(notice.includes(text));
});
test("adapter uses authenticated owner and only its service-only draft RPC", async () => {
  const parsed = parseAttendanceLocationPolicyCommand(body), calls: unknown[] = [];
  const input = { ...parsed, authUserId: id(3), operationId: null, allowWrite: false };
  const result = await executeAttendanceLocationPolicy(input, { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ...base, internal: true }, error: null }; } });
  assert.deepEqual(result, base);
  assert.deepEqual(calls, [{ name: "faolla_attendance_location_policy_draft_v1", args: { p_site_id: siteId, p_auth_user_id: id(3), p_location_id: locationId, p_command: parsed.command, p_operation_id: null, p_allow_write: false } }]);
  await assert.rejects(executeAttendanceLocationPolicy({ ...input, operationId: id(2) }, { rpc: async () => { throw Error("must not run"); } }), /attendance_invalid_request/);
});
test("adapter sanitizes unknown SQL errors and rejects malformed or mismatched receipts", async () => {
  const input = { ...parseAttendanceLocationPolicyCommand(body), authUserId: id(3), operationId: null, allowWrite: true };
  for (const data of [{ ...base, receipt: null }, { ...base, current: null }, { ...base, locationId: id(8) }]) await assert.rejects(executeAttendanceLocationPolicy(input, { rpc: async () => ({ data, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeAttendanceLocationPolicy(input, { rpc: async () => ({ data: null, error: { message: "private SQL" } }) }), /attendance_unavailable/);
  await assert.rejects(executeAttendanceLocationPolicy(input, { rpc: async () => ({ data: null, error: { message: "attendance_access_denied" } }) }), /attendance_access_denied/);
});
