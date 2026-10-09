import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleAttendanceNoticeCoverage, coverageDependencies } from "./route-handler";
import type { CoverageInput } from "@/lib/merchantAttendanceNoticeCoverage.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = `https://www.faolla.com/api/merchant-enterprise/attendance/location-notice-coverage?siteId=99990001&locationId=${id(301)}`;
function setup(patch: Partial<typeof coverageDependencies> = {}) {
  const calls: CoverageInput[] = [];
  const deps: typeof coverageDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic-only", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof coverageDependencies.entitlement>>,
    execute: async input => { calls.push(input); return { siteId: input.query.siteId, location: { id: input.query.locationId, name: "合成地点", active: true, version: 1 },
      settingsVersion: 1, notice: null, noticeCurrent: false, observedAt: "2026-10-03T10:00:00.000000Z", counts: { assigned: 0, eligible: 0, excluded: 0, confirmed: null, pending: null }, items: [], nextCursor: null }; }, ...patch };
  return { deps, calls };
}
test("coverage is default gated and rejects writes and noncanonical hosts before authentication", async () => {
  const fail = setup({ authenticate: async () => { throw Error("unexpected authentication"); } });
  const closed = await handleAttendanceNoticeCoverage(new Request(url), { ...fail.deps, enabled: () => false });
  assert.equal(closed.status, 404); assert.equal(closed.headers.get("cache-control"), "private, no-store");
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) assert.equal((await handleAttendanceNoticeCoverage(new Request(url, { method }), fail.deps)).status, 405);
  assert.equal((await handleAttendanceNoticeCoverage(new Request(url.replace("www.faolla.com", "foreign.test")), fail.deps)).status, 403);
});
test("coverage permits ordinary owner login methods but denies incomplete invitation/recovery identities", async () => {
  for (const methods of [[], ["password"], ["oauth"], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(99) } as User, accessToken: "synthetic-only", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    assert.equal((await handleAttendanceNoticeCoverage(new Request(url), f.deps)).status, allowed ? 200 : 403);
    assert.equal(f.calls.length, allowed ? 1 : 0);
  }
});
test("paused attendance remains a private readonly owner query, never passes a caller-supplied actor", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof coverageDependencies.entitlement>> });
  const response = await handleAttendanceNoticeCoverage(new Request(url), f.deps), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.moduleEnabled, false); assert.equal(f.calls[0].authUserId, id(99));
  assert.match(response.headers.get("vary")!, /Cookie, Authorization, x-merchant-access-token/);
  for (const suffix of ["&access=owner", "&authUserId=" + id(1), "&limit=500", "&siteId=99990001", "&cursorWorkerId=" + id(201)])
    assert.equal((await handleAttendanceNoticeCoverage(new Request(url + suffix), f.deps)).status, 400);
  assert.equal(f.calls.length, 1);
});
test("coverage preserves ownership, scope and version refusals, rate limits and sanitized backend errors", async () => {
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  assert.equal((await handleAttendanceNoticeCoverage(new Request(url), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
  const limited = setup({ allow: () => false }); const limit = await handleAttendanceNoticeCoverage(new Request(url), limited.deps);
  assert.equal(limit.status, 429); assert.equal(limit.headers.get("retry-after"), "60"); assert.equal(limited.calls.length, 0);
  for (const [code, status] of [["attendance_access_denied", 403], ["attendance_location_denied", 403], ["attendance_version_conflict", 409], ["attendance_settings_required", 409], ["private SQL", 503]] as const) {
    const f = setup({ execute: async () => { throw new MerchantAttendanceError(code); } }), response = await handleAttendanceNoticeCoverage(new Request(url), f.deps);
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /private SQL/);
  }
});
