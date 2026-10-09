import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { attendanceLocationReviewDependencies, handleAttendanceLocationReview } from "./route-handler";
import type { AttendanceLocationReviewInput } from "@/lib/merchantAttendanceLocationReview.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { createAttendanceReviewFixture, reviewFixtureSite as siteId, reviewFixtureOwner as ownerId, reviewFixtureEvent as eventId, reviewFixtureId as id } from "../../../../../../scripts/fixtures/attendance-location-review-model";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/location-reviews";
const body = { siteId, eventId, operationId: id(20), expectedRevision: 0, outcome: "noted", note: "Synthetic reason" };
const post = (value: unknown = body, target = url, origin = "https://www.faolla.com") => new Request(target, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(value) });
const get = () => new Request(`${url}?siteId=${siteId}&mode=detail&eventId=${eventId}`);
function setup(overrides: Partial<typeof attendanceLocationReviewDependencies> = {}) {
  const calls: AttendanceLocationReviewInput[] = [];
  const deps: typeof attendanceLocationReviewDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: ownerId } as User, accessToken: "synthetic", authenticationMethods: ["oauth"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof attendanceLocationReviewDependencies.entitlement>>,
    execute: async input => { calls.push(input); return createAttendanceReviewFixture().detail(); }, ...overrides };
  return { deps, calls };
}
test("review endpoint defaults closed before auth and forbids caching", async () => {
  const { deps } = setup({ enabled: () => false, authenticate: async () => { throw Error("unexpected"); } }); const r = await handleAttendanceLocationReview(post(), deps);
  assert.equal(r.status, 404); assert.equal(r.headers.get("cache-control"), "private, no-store");
});
test("canonical origin and accepted methods enforced before authentication", async () => {
  const { deps } = setup({ authenticate: async () => { throw Error("unexpected"); } });
  assert.equal((await handleAttendanceLocationReview(post(body, url, "https://foreign.example"), deps)).status, 403);
  assert.equal((await handleAttendanceLocationReview(new Request(get().url.replace("www.faolla.com", "shop.faolla.com")), deps)).status, 403);
  assert.equal((await handleAttendanceLocationReview(new Request(url, { method: "DELETE" }), deps)).status, 405);
});
test("owner password/OAuth accepted, dangerous and empty sessions rejected", async () => {
  for (const methods of [[], ["recovery"], ["magiclink"], ["password", "invite"], ["password"], ["oauth"]]) {
    const { deps, calls } = setup({ authenticate: async () => ({ user: { id: ownerId } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && ["password", "oauth"].includes(methods[0]); assert.equal((await handleAttendanceLocationReview(get(), deps)).status, allowed ? 200 : 403); assert.equal(calls.length, allowed ? 1 : 0);
  }
});
test("actor, target permissions, payroll fields and mixed POST query cannot be supplied", async () => {
  const { deps, calls } = setup();
  for (const patch of [{ authUserId: ownerId }, { approveWages: true }, { occurredAt: "2026-09-30" }, { access: "manager" }, { allowed: true }]) assert.equal((await handleAttendanceLocationReview(post({ ...body, ...patch }), deps)).status, 400);
  assert.equal((await handleAttendanceLocationReview(post(body, `${url}?siteId=${siteId}`), deps)).status, 400);
  assert.equal((await handleAttendanceLocationReview(new Request(`${get().url}&eventId=${eventId}`), deps)).status, 400); assert.equal(calls.length, 0);
});
test("paused attendance still permits owner review of existing facts but does not skip enterprise access", async () => {
  const { deps, calls } = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof attendanceLocationReviewDependencies.entitlement>> });
  const response = await handleAttendanceLocationReview(post(), deps); assert.equal(response.status, 200); assert.equal((await response.json()).moduleEnabled, false);
  assert.equal(calls[0].authUserId, ownerId); assert.equal(calls[0].query.mode, "detail");
  deps.entitlement = async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); };
  assert.equal((await handleAttendanceLocationReview(post(), deps)).status, 403); assert.equal(calls.length, 1);
});
test("bounded payload, rate limit, missing case and private SQL failure never masquerade as success", async () => {
  const { deps, calls } = setup(); assert.equal((await handleAttendanceLocationReview(post({ ...body, padding: "x".repeat(4096) }), deps)).status, 413); assert.equal(calls.length, 0);
  const limited = await handleAttendanceLocationReview(get(), { ...deps, allow: () => false }); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  for (const [error, status, code] of [[new MerchantAttendanceError("attendance_review_not_found"), 404, "attendance_review_not_found"], [Error("private SQL"), 503, "attendance_unavailable"]] as const) {
    const response = await handleAttendanceLocationReview(get(), { ...deps, execute: async () => { throw error; } }); assert.equal(response.status, status); assert.equal((await response.json()).error, code);
  }
});
