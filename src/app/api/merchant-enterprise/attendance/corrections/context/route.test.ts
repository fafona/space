import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleCorrectionContext, correctionContextEnabled } from "./route-handler";
import { attendanceSelfContextDependencies } from "../../self-context/route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
const id = "00000000-0000-4000-8000-000000000001", siteId = "99990001", base = "https://www.faolla.com/api/merchant-enterprise/attendance/corrections/context";
const request = (query = `siteId=${siteId}`) => new Request(`${base}?${query}`);
function fixture(overrides: Partial<typeof attendanceSelfContextDependencies> = {}) {
  const calls: unknown[] = [];
  const deps: typeof attendanceSelfContextDependencies = {
    enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof attendanceSelfContextDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { siteId, employeeId: id, workerId: id, locationId: null }; }, ...overrides,
  };
  return { calls, deps };
}
test("correction context is default off and independent of GPS flags", () => {
  const keys = ["FAOLLA_ATTENDANCE_SELF_ENABLED", "FAOLLA_ATTENDANCE_CORRECTIONS_ENABLED", "FAOLLA_ATTENDANCE_LOCATION_CLOCK_ENABLED"];
  const original = keys.map(k => process.env[k]);
  try {
    keys.forEach(k => { delete process.env[k]; }); assert.equal(correctionContextEnabled(), false);
    process.env[keys[0]] = "1"; assert.equal(correctionContextEnabled(), false);
    process.env[keys[1]] = "1"; assert.equal(correctionContextEnabled(), true);
    process.env[keys[2]] = "0"; assert.equal(correctionContextEnabled(), true);
    process.env[keys[0]] = "0"; assert.equal(correctionContextEnabled(), false);
  } finally { keys.forEach((key, i) => { if (original[i] === undefined) delete process.env[key]; else process.env[key] = original[i]; }); }
});
test("disabled, off-origin and non-GET correction discovery stop before auth", async () => {
  let auth = 0; const f = fixture({ enabled: () => false, authenticate: async () => { auth++; throw Error("unreachable"); } });
  assert.equal((await handleCorrectionContext(request(), f.deps)).status, 404); f.deps.enabled = () => true;
  assert.equal((await handleCorrectionContext(new Request(base, { method: "POST" }), f.deps)).status, 405);
  assert.equal((await handleCorrectionContext(new Request(request().url.replace("www.", "other.")), f.deps)).status, 403); assert.equal(auth, 0);
});
test("correction discovery remains read-only and no-store while module is paused", async () => {
  const f = fixture(), response = await handleCorrectionContext(request(), f.deps), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.moduleEnabled, false); assert.equal(body.locationId, null);
  assert.deepEqual(f.calls, [{ siteId, authUserId: id }]); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Vary")!, /Cookie/);
});
test("correction context rejects injected identity and rechecks password/role/limits", async () => {
  const f = fixture();
  for (const key of ["employeeId", "workerId", "authUserId", "permissions", "isOwner"]) assert.equal((await handleCorrectionContext(request(`siteId=${siteId}&${key}=${id}`), f.deps)).status, 400);
  assert.equal(f.calls.length, 0);
  for (const methods of [[], ["oauth"], ["password", "invite"]]) {
    const f = fixture({ authenticate: async () => ({ user: { id } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleCorrectionContext(request(), f.deps)).status, 403); assert.equal(f.calls.length, 0);
  }
  assert.equal((await handleCorrectionContext(request(), fixture({ execute: async () => { throw new MerchantAttendanceError("attendance_access_denied"); } }).deps)).status, 403);
  const limited = await handleCorrectionContext(request(), fixture({ allow: () => false }).deps); assert.equal(limited.status, 429); assert.equal(limited.headers.get("Retry-After"), "60");
});
