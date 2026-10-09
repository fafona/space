import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { handleCorrectionReview, correctionReviewDependencies } from "./route-handler";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { correctionReviewDetail, reviewQuery } from "../../../../../../scripts/fixtures/attendance-correction-review-model";
import { correctionReviewQueryString } from "@/lib/merchantAttendanceCorrectionReview";
import { correctionId as id } from "../../../../../../scripts/fixtures/attendance-correction-model";
const base = "https://www.faolla.com/api/merchant-enterprise/attendance/correction-reviews";
const get = () => new Request(`${base}?${correctionReviewQueryString(reviewQuery)}`);
function setup(extra: Partial<typeof correctionReviewDependencies> = {}) {
  const calls: Parameters<typeof correctionReviewDependencies.execute>[0][] = [];
  const deps: typeof correctionReviewDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof correctionReviewDependencies.entitlement>>,
    execute: async input => { calls.push(input); return correctionReviewDetail(); }, ...extra };
  return { deps, calls };
}
test("owner review rejects disabled flag, wrong methods and noncanonical hosts before auth", async () => {
  let authenticated = false; const { deps } = setup({ enabled: () => false, authenticate: async () => { authenticated = true; throw Error("unreachable"); } });
  assert.equal((await handleCorrectionReview(get(), deps)).status, 404); deps.enabled = () => true;
  for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await handleCorrectionReview(new Request(base, { method }), deps)).status, 405);
  assert.equal((await handleCorrectionReview(new Request(get().url.replace("www.faolla.com", "merchant.faolla.com")), deps)).status, 403);
  assert.equal(authenticated, false);
});
test("normal owner password/OAuth allowed; recovery/invitation/magiclink cannot review employee applications", async () => {
  for (const methods of [[], ["recovery"], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const { deps, calls } = setup({ authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleCorrectionReview(get(), deps)).status, 403); assert.equal(calls.length, 0);
  }
  for (const methods of [["password"], ["oauth"]]) {
    const { deps } = setup({ authenticate: async () => ({ user: { id: id(1) } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    assert.equal((await handleCorrectionReview(get(), deps)).status, 200);
  }
});
test("historical read uses authenticated identity, rechecks entitlement and disables HTTP caching", async () => {
  const { deps, calls } = setup(); const response = await handleCorrectionReview(get(), deps);
  assert.equal(response.status, 200); assert.deepEqual(calls, [{ query: reviewQuery, authUserId: id(1) }]);
  const body = await response.json(); assert.equal(body.moduleEnabled, false); assert.equal(body.approvalAvailable, false);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("vary")!, /Cookie.*Authorization/);
  deps.entitlement = async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); };
  assert.equal((await handleCorrectionReview(get(), deps)).status, 403); assert.equal(calls.length, 1);
});
test("query cannot smuggle actor, approval, duplicate tenant, or self scope to owner RPC", async () => {
  const { deps, calls } = setup();
  for (const suffix of [`&authUserId=${id(9)}`, "&approve=true", "&siteId=99990002", `&employeeId=${id(9)}`, "&scope=self"])
    assert.equal((await handleCorrectionReview(new Request(get().url + suffix), deps)).status, 400);
  assert.equal(calls.length, 0);
});
test("owner SQL denial, missing request, absent settings, rate limit and unexpected failure stay distinct/private", async () => {
  for (const [override, status, error] of [[{ allow: () => false }, 429, "attendance_rate_limited"],
    [{ execute: async () => { throw new MerchantAttendanceError("attendance_access_denied"); } }, 403, "attendance_access_denied"],
    [{ execute: async () => { throw new MerchantAttendanceError("attendance_correction_not_found"); } }, 404, "attendance_correction_not_found"],
    [{ execute: async () => { throw new MerchantAttendanceError("attendance_settings_required"); } }, 409, "attendance_settings_required"],
    [{ execute: async () => { throw Error("private employee SQL"); } }, 503, "attendance_unavailable"]] as const) {
    const { deps } = setup(override), response = await handleCorrectionReview(get(), deps);
    assert.equal(response.status, status); assert.equal((await response.json()).error, error);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "60");
  }
});
