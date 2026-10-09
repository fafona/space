import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { attendanceLocationPolicyDependencies, handleAttendanceLocationPolicy } from "./route-handler";
import type { AttendanceLocationPolicyInput } from "@/lib/merchantAttendanceLocationPolicy.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
const id = "00000000-0000-4000-8000-000000000001", siteId = "99990001";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/location-policy";
const body = { siteId, locationId: id, operationId: id, expectedRevision: 0, expectedSettingsVersion: 1, expectedLocationVersion: 1,
  values: { purpose: "Attendance", notice: "Draft", contact: "Owner", alternative: "Manual review", retentionDays: 90, latitude: 0, longitude: 0, radiusMeters: 100 } };
const post = (value: unknown = body, target = url, origin = "https://www.faolla.com") => new Request(target, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(value) });
const get = () => new Request(`${url}?siteId=${siteId}&locationId=${id}`);
function setup(overrides: Partial<typeof attendanceLocationPolicyDependencies> = {}) {
  const calls: AttendanceLocationPolicyInput[] = [];
  const deps: typeof attendanceLocationPolicyDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["oauth"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof attendanceLocationPolicyDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { siteId, locationId: id, draftOnly: true, settingsVersion: 1, location: { name: "Synthetic", active: true, version: 1 }, current: null, previous: null, receipt: null }; }, ...overrides };
  return { deps, calls };
}
test("policy route is default closed before authentication and never cacheable", async () => {
  const { deps } = setup({ enabled: () => false, authenticate: async () => { throw Error("unexpected"); } });
  const r = await handleAttendanceLocationPolicy(post(), deps); assert.equal(r.status, 404); assert.equal(r.headers.get("cache-control"), "private, no-store");
});
test("canonical origin and method rejected before any auth call", async () => {
  const { deps } = setup({ authenticate: async () => { throw Error("unexpected"); } });
  for (const request of [post(body, url, "https://other.example"), new Request(`https://shop.faolla.com/api/merchant-enterprise/attendance/location-policy?siteId=${siteId}&locationId=${id}`)]) assert.equal((await handleAttendanceLocationPolicy(request, deps)).status, 403);
  assert.equal((await handleAttendanceLocationPolicy(new Request(url, { method: "DELETE" }), deps)).status, 405);
});
test("owner password and OAuth allowed, risky or empty sessions denied", async () => {
  for (const methods of [[], ["recovery"], ["password", "invite"], ["magiclink"], ["password"], ["oauth"]]) {
    const { deps, calls } = setup({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    assert.equal((await handleAttendanceLocationPolicy(post(), deps)).status, allowed ? 200 : 403); assert.equal(calls.length, allowed ? 1 : 0);
  }
});
test("client cannot supply identity, switches, GPS or query parameters to a write", async () => {
  const { deps, calls } = setup();
  for (const patch of [{ ownerId: id }, { allowWrite: true }, { enabled: true }, { position: { latitude: 0 } }]) assert.equal((await handleAttendanceLocationPolicy(post({ ...body, ...patch }), deps)).status, 400);
  assert.equal((await handleAttendanceLocationPolicy(post(body, `${url}?siteId=${siteId}`), deps)).status, 400);
  assert.equal((await handleAttendanceLocationPolicy(new Request(`${get().url}&locationId=${id}`), deps)).status, 400); assert.equal(calls.length, 0);
});
test("platform pause passes false to locked RPC so receipt replay remains possible but never supplies client override", async () => {
  const { deps, calls } = setup({ entitlement: async () => ({}) as Awaited<ReturnType<typeof attendanceLocationPolicyDependencies.entitlement>> });
  assert.equal((await handleAttendanceLocationPolicy(post(), deps)).status, 200); assert.equal(calls[0].allowWrite, false); assert.equal(calls[0].authUserId, id);
  assert.equal((await handleAttendanceLocationPolicy(get(), deps)).status, 200);
  deps.execute = async () => { throw new MerchantAttendanceError("attendance_platform_paused"); };
  assert.equal((await handleAttendanceLocationPolicy(post(), deps)).status, 403);
});
test("rate limits, bounded request and opaque internal errors", async () => {
  const { deps, calls } = setup();
  assert.equal((await handleAttendanceLocationPolicy(post({ ...body, padding: "x".repeat(4096) }), deps)).status, 413); assert.equal(calls.length, 0);
  const limited = await handleAttendanceLocationPolicy(get(), { ...deps, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  const failure = await handleAttendanceLocationPolicy(get(), { ...deps, execute: async () => { throw Error("private SQL"); } }); assert.equal(failure.status, 503); assert.equal((await failure.json()).error, "attendance_unavailable");
});
