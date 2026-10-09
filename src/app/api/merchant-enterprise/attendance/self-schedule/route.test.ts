import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceSelfSchedule, attendanceSelfScheduleDependencies } from "./route-handler";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import type { AttendanceSelfScheduleInput } from "@/lib/merchantAttendanceSelfSchedule.server";
import type { SelfScheduleResult } from "@/lib/merchantAttendanceSelfSchedule";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const siteId = "99990001", url = "https://launch.faolla.com/api/merchant-enterprise/attendance/self-schedule";
const command = { expectedWorkerId: id(2), operationId: id(3), locationId: id(4), action: "clock_in", expectedSequence: 0 };
const body = { siteId, command, selection: null };
const empty: SelfScheduleResult = { protocol: "self-schedule-v1", clock: { workerId: id(2), locationId: id(4),
  state: { sequence: 0, status: "off", lastEvent: null }, receipt: null, replayed: false },
  choices: { timeZone: null, fromDate: null, throughDate: null, revision: 0, limited: false, entries: [] }, association: null };
function post(value: unknown = body, origin = "https://launch.faolla.com") {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(value) });
}
function setup(overrides: Partial<typeof attendanceSelfScheduleDependencies> = {}) {
  const calls: AttendanceSelfScheduleInput[] = []; let authCalls = 0, entitlementCalls = 0;
  const deps: typeof attendanceSelfScheduleDependencies = { baseEnabled: () => true, featureEnabled: () => true, bindRules: () => false,
    authenticate: async () => { authCalls++; return { user: { id: id(1) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }; },
    entitlement: async () => { entitlementCalls++; return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } } as Awaited<ReturnType<typeof attendanceSelfScheduleDependencies.entitlement>>; },
    allow: () => true, execute: async input => { calls.push(input); return structuredClone(empty); }, ...overrides };
  return { deps, calls, counts: () => ({ authCalls, entitlementCalls }) };
}
test("total existing SELF gate remains authoritative even for recovery", async () => {
  const s = setup({ baseEnabled: () => false });
  for (const request of [post(), new Request(`${url}?siteId=${siteId}&operationId=${id(3)}`)])
    assert.equal((await handleAttendanceSelfSchedule(request, s.deps)).status, 404);
  assert.deepEqual(s.counts(), { authCalls: 0, entitlementCalls: 0 }); assert.equal(s.calls.length, 0);
});
test("feature disabled or merchant not opted in rejects writes but retains current-authorized GET", async () => {
  const s = setup({ featureEnabled: () => false });
  const denied = await handleAttendanceSelfSchedule(post(), s.deps);
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error, "attendance_self_schedule_disabled"); assert.equal(s.calls.length, 0);
  const response = await handleAttendanceSelfSchedule(new Request(`${url}?siteId=${siteId}&operationId=${id(3)}`), s.deps);
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.selectionEnabled, false);
  assert.deepEqual(s.calls, [{ siteId, operationId: id(3), command: null, selection: null, authUserId: id(1), allowWrite: false, bindRules: false }]);
});
test("validated identity and independent rule-binding choice reach only the dedicated transaction", async () => {
  const s = setup({ bindRules: () => true }); const response = await handleAttendanceSelfSchedule(post(), s.deps);
  assert.equal(response.status, 200); assert.deepEqual(s.calls, [{ ...body, operationId: null, authUserId: id(1), allowWrite: true, bindRules: true }]);
  assert.deepEqual(s.counts(), { authCalls: 1, entitlementCalls: 1 });
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary")!, /Authorization/);
});
test("pause admits reading and rejects new association without relaxing the old clock authorization", async () => {
  const s = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof attendanceSelfScheduleDependencies.entitlement>> });
  assert.equal((await handleAttendanceSelfSchedule(post(), s.deps)).status, 403); assert.equal(s.calls.length, 0);
  const response = await handleAttendanceSelfSchedule(new Request(`${url}?siteId=${siteId}`), s.deps);
  const result = await response.json(); assert.equal(result.moduleEnabled, false); assert.equal(result.selectionEnabled, false); assert.equal(s.calls.length, 1);
  s.deps.execute = async () => { throw new MerchantAttendanceError("attendance_access_denied"); };
  assert.equal((await handleAttendanceSelfSchedule(new Request(`${url}?siteId=${siteId}`), s.deps)).status, 403);
});
test("old actions and client-provided authority never reach the new writer", async () => {
  const s = setup();
  for (const value of [{ ...body, authUserId: id(99) }, { ...body, allowWrite: true }, { ...body, bindRules: true },
    { ...body, command: { ...command, action: "clock_out" } }, { ...body, command: { ...command, action: "break_start" } },
    { ...body, selection: { slotId: id(5), revision: 1, employeeId: id(2) } }, { ...body, selection: undefined }])
    assert.equal((await handleAttendanceSelfSchedule(post(value), s.deps)).status, 400);
  assert.equal(s.calls.length, 0);
});
test("GET cannot select another worker or duplicate site or operation", async () => {
  const s = setup();
  for (const q of [`siteId=${siteId}&workerId=${id(2)}`, `siteId=${siteId}&siteId=${siteId}`, `siteId=${siteId}&operationId=${id(3)}&operationId=${id(3)}`])
    assert.equal((await handleAttendanceSelfSchedule(new Request(`${url}?${q}`), s.deps)).status, 400);
  assert.equal(s.calls.length, 0);
});
test("cross-origin, unsupported method and rate limits stop before SQL", async () => {
  const s = setup(); assert.equal((await handleAttendanceSelfSchedule(post(body, "https://evil.invalid"), s.deps)).status, 403);
  assert.equal((await handleAttendanceSelfSchedule(new Request(url, { method: "DELETE" }), s.deps)).status, 405);
  assert.equal(s.counts().authCalls, 0);
  s.deps.allow = () => false; const response = await handleAttendanceSelfSchedule(post(), s.deps);
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.equal(s.calls.length, 0);
});
test("recovery never bypasses password-session or enterprise entitlement", async () => {
  const s = setup({ featureEnabled: () => false, authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "synthetic", authenticationMethods: ["recovery"] }) });
  assert.equal((await handleAttendanceSelfSchedule(new Request(`${url}?siteId=${siteId}&operationId=${id(3)}`), s.deps)).status, 403);
  s.deps.authenticate = async () => ({ user: { id: id(1) } as User, accessToken: "synthetic", authenticationMethods: ["password"] });
  s.deps.entitlement = async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); };
  assert.equal((await handleAttendanceSelfSchedule(new Request(`${url}?siteId=${siteId}`), s.deps)).status, 403); assert.equal(s.calls.length, 0);
});
test("internal SQL and transport failures are sanitized with no fallback", async () => {
  const s = setup({ execute: async () => { throw Error("private connection details"); } });
  const response = await handleAttendanceSelfSchedule(post(), s.deps);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
});
test("request body size and media type retain bounded existing reader", async () => {
  const s = setup();
  for (const [payload, type, status] of [["x".repeat(4097), "application/json", 413], ["{}", "text/plain", 415], ["{", "application/json", 400]] as const) {
    const request = new Request(url, { method: "POST", headers: { origin: "https://launch.faolla.com", "content-type": type }, body: payload });
    assert.equal((await handleAttendanceSelfSchedule(request, s.deps)).status, status);
  }
  assert.equal(s.calls.length, 0);
});
