import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { attendanceLocationCheckDependencies, handleAttendanceLocationCheck } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const id = "00000000-0000-4000-8000-000000000001";
const base = "https://www.faolla.com/api/merchant-enterprise/attendance/location-check";
const target = { siteId: "99990001", expectedWorkerId: id, expectedLocationId: id };
const command = { ...target, settingsVersion: 1, workerVersion: 1, locationVersion: 1, position: { latitude: 1, longitude: 2, accuracyMeters: 3, capturedAt: "2026-09-30T10:00:00.000Z" } };
const get = () => new Request(`${base}?${new URLSearchParams(target)}`);
const post = (body: unknown = command) => new Request(base, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.faolla.com" }, body: JSON.stringify(body) });
function setup(extra: Partial<typeof attendanceLocationCheckDependencies> = {}) {
  const calls: Parameters<typeof attendanceLocationCheckDependencies.execute>[0][] = [];
  const deps: typeof attendanceLocationCheckDependencies = {
    enabled: () => true, allow: () => true, authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof attendanceLocationCheckDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { ...command, siteId: target.siteId, employeeId: id, workerId: id, locationId: id,
      checkedAt: command.position.capturedAt, maxAgeMs: 60000, diagnosticOnly: true, punchRecorded: false }; }, ...extra,
  }; return { deps, calls };
}
test("location check is explicitly gated and rejects noncanonical origin/method before auth", async () => {
  let auth = 0;
  const { deps } = setup({ enabled: () => false, authenticate: async () => { auth++; throw Error("not reached"); } });
  assert.equal((await handleAttendanceLocationCheck(get(), deps)).status, 404); deps.enabled = () => true;
  for (const req of [new Request(base, { method: "DELETE" }), new Request(get().url.replace("www.", "merchant.")),
    new Request(base, { method: "POST", headers: { Origin: "https://foreign.invalid" } })]) {
    assert.equal((await handleAttendanceLocationCheck(req, deps)).status, req.method === "DELETE" ? 405 : 403);
  }
  assert.equal(auth, 0);
});
for (const authenticationMethods of [[], ["oauth"], ["magiclink"], ["password", "invite"], ["recovery"]]) test(`location requires ordinary password session: ${authenticationMethods}`, async () => {
  const { deps, calls } = setup({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods }) });
  for (const req of [get(), post()]) assert.equal((await handleAttendanceLocationCheck(req, deps)).status, 403);
  assert.equal(calls.length, 0);
});
test("GET and POST each revalidate server identity, entitlement and policy with no-store headers", async () => {
  const { deps, calls } = setup(); let auth = 0, entitlement = 0;
  const authenticate = deps.authenticate, access = deps.entitlement;
  deps.authenticate = async req => { auth++; return authenticate(req); }; deps.entitlement = async site => { entitlement++; return access(site); };
  for (const req of [get(), post()]) {
    const response = await handleAttendanceLocationCheck(req, deps); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary")!, /Authorization/);
    assert.equal((await response.json()).punchRecorded, false);
  }
  assert.deepEqual(calls, [{ ...target, authUserId: id, command: null }, { ...target, authUserId: id, command }]);
  assert.equal(auth, 2); assert.equal(entitlement, 2);
  deps.execute = async () => { throw new MerchantAttendanceError("attendance_access_denied"); };
  assert.equal((await handleAttendanceLocationCheck(post(), deps)).status, 403);
});
test("paused platform denies both stages; no allowance borrowed from end-of-shift punches", async () => {
  const { deps, calls } = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof attendanceLocationCheckDependencies.entitlement>> });
  for (const req of [get(), post()]) assert.equal((await handleAttendanceLocationCheck(req, deps)).status, 403); assert.equal(calls.length, 0);
});
test("position never belongs in GET/query string and strict bounded JSON rejects supplied permissions", async () => {
  const { deps, calls } = setup();
  for (const request of [new Request(`${get().url}&latitude=1`), new Request(`${get().url}&siteId=99990002`), post({ ...command, isOwner: true }), post({ ...command, reason: "inside" }),
    new Request(`${base}?latitude=1`, post()), new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com", "Content-Type": "application/json" }, body: "{" })])
    assert.equal((await handleAttendanceLocationCheck(request, deps)).status, 400);
  assert.equal((await handleAttendanceLocationCheck(post({ extra: "x".repeat(5000) }), deps)).status, 413);
  assert.equal((await handleAttendanceLocationCheck(new Request(base, { method: "POST", headers: { Origin: "https://www.faolla.com", "Content-Type": "text/plain" }, body: "{}" }), deps)).status, 415);
  assert.equal(calls.length, 0);
});
test("known refusals, limiter and unknown errors are bounded and never leak coordinates/SQL", async () => {
  for (const [override, status] of [[{ allow: () => false }, 429],
    [{ execute: async () => { throw new MerchantAttendanceError("attendance_location_policy_changed"); } }, 409],
    [{ execute: async () => { throw new MerchantAttendanceError("attendance_location_check_disabled"); } }, 403],
    [{ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } }, 403],
    [{ execute: async () => { throw Error("private SQL latitude=1 longitude=2"); } }, 503]] as const) {
    const { deps } = setup(override); const response = await handleAttendanceLocationCheck(post(), deps); assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private SQL|latitude|longitude/); if (status === 429) assert.equal(response.headers.get("retry-after"), "60");
  }
});
