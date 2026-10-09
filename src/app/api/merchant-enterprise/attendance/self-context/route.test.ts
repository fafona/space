import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { attendanceSelfContextDependencies, handleAttendanceSelfContext } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const id = "00000000-0000-4000-8000-000000000001", base = "https://www.faolla.com/api/merchant-enterprise/attendance/self-context", siteId = "99990001";
const request = (q = `siteId=${siteId}`) => new Request(`${base}?${q}`);
function fixture(patch: Partial<typeof attendanceSelfContextDependencies> = {}) {
  const calls: { siteId: string; authUserId: string }[] = [];
  const deps: typeof attendanceSelfContextDependencies = {
    enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof attendanceSelfContextDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { siteId, employeeId: id, workerId: id, locationId: null }; }, ...patch,
  };
  return { calls, deps };
}
test("self context closes before auth when disabled, noncanonical target, or not GET", async () => {
  let auth = 0; const f = fixture({ enabled: () => false, authenticate: async () => { auth++; throw Error("unreachable"); } });
  assert.equal((await handleAttendanceSelfContext(request(), f.deps)).status, 404); f.deps.enabled = () => true;
  assert.equal((await handleAttendanceSelfContext(new Request(base, { method: "POST" }), f.deps)).status, 405);
  assert.equal((await handleAttendanceSelfContext(new Request(request().url.replace("www.", "merchant.")), f.deps)).status, 403);
  assert.equal(auth, 0);
});
for (const authenticationMethods of [[], ["oauth"], ["recovery"], ["password", "invite"], ["magiclink"]]) test(`self context requires normal password login: ${authenticationMethods}`, async () => {
  const f = fixture({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods }) });
  assert.equal((await handleAttendanceSelfContext(request(), f.deps)).status, 403); assert.equal(f.calls.length, 0);
});
test("paused module may discover own worker with verified auth ID and private headers", async () => {
  const f = fixture(), response = await handleAttendanceSelfContext(request(), f.deps), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.moduleEnabled, false); assert.deepEqual(f.calls, [{ siteId, authUserId: id }]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.match(response.headers.get("Vary")!, /Cookie/);
  for (const key of ["employeeId", "workerId", "authUserId", "isOwner", "permissions", "locationId"]) assert.equal((await handleAttendanceSelfContext(request(`siteId=${siteId}&${key}=${id}`), f.deps)).status, 400);
  assert.equal(f.calls.length, 1);
});
test("each discovery rechecks auth/enterprise; rate and DB denials preserve status without internals", async () => {
  let count = 0; const f = fixture(); const authenticate = f.deps.authenticate;
  f.deps.authenticate = async r => { count++; return authenticate(r); };
  await handleAttendanceSelfContext(request(), f.deps);
  f.deps.execute = async () => { throw new MerchantAttendanceError("attendance_access_denied"); };
  assert.equal((await handleAttendanceSelfContext(request(), f.deps)).status, 403); assert.equal(count, 2);
  for (const [patch, status] of [[{ allow: () => false }, 429], [{ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } }, 403],
    [{ execute: async () => { throw Error("private SQL"); } }, 503]] as const) {
    const response = await handleAttendanceSelfContext(request(), fixture(patch).deps);
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /private SQL/);
    if (status === 429) assert.equal(response.headers.get("Retry-After"), "60");
  }
});
