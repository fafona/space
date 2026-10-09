import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { noticeDependencies, handleAttendanceNotice } from "./route-handler";
import type { NoticeInput } from "@/lib/merchantAttendanceLocationNotice.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { createNoticeFixture, noticeQuery, noticeId as id } from "../../../../../../scripts/fixtures/attendance-location-notice-model";
import { noticeQueryString } from "@/lib/merchantAttendanceLocationNotice";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/location-notice", q = noticeQuery();
const body = { siteId: q.siteId, access: q.access, locationId: q.locationId, expectedWorkerId: null, action: "publish", operationId: id(20), expectedRevision: 0, draftRevision: 1, expectedSettingsVersion: 1, expectedLocationVersion: 1, reason: "Public reason" };
const post = (value: unknown = body, target = url, origin = "https://www.faolla.com") => new Request(target, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(value) });
const get = (access: "owner" | "self" = "owner") => new Request(`${url}?${noticeQueryString(noticeQuery(access))}`);
function setup(patch: Partial<typeof noticeDependencies> = {}) {
  const calls: NoticeInput[] = [];
  const deps: typeof noticeDependencies = { enabled: () => true, accessEnabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(90) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof noticeDependencies.entitlement>>,
    execute: async input => { calls.push(input); return createNoticeFixture().snapshot(input.query.access); }, ...patch };
  return { deps, calls };
}
test("notice defaults closed, remains uncached and independently gates owner/self entry", async () => {
  const f = setup({ enabled: () => false, authenticate: async () => { throw Error("unexpected"); } }); const r = await handleAttendanceNotice(post(), f.deps); assert.equal(r.status, 404); assert.equal(r.headers.get("cache-control"), "private, no-store");
  const g = setup({ accessEnabled: a => a === "owner" }); assert.equal((await handleAttendanceNotice(get("self"), g.deps)).status, 404); assert.equal((await handleAttendanceNotice(get(), g.deps)).status, 200);
});
test("notice origin and HTTP method guards precede auth", async () => {
  const f = setup({ authenticate: async () => { throw Error("unexpected"); } });
  assert.equal((await handleAttendanceNotice(post(body, url, "https://foreign.example"), f.deps)).status, 403);
  assert.equal((await handleAttendanceNotice(new Request(get().url.replace("www.faolla.com", "shop.faolla.com")), f.deps)).status, 403);
  assert.equal((await handleAttendanceNotice(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
});
test("self needs password, owner supports normal OAuth, recovery/invite/empty identities cannot proceed", async () => {
  for (const a of ["owner", "self"] as const) for (const methods of [[], ["password"], ["oauth"], ["magiclink"], ["password", "recovery"], ["invite"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(90) } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && (methods[0] === "password" || a === "owner" && methods[0] === "oauth");
    assert.equal((await handleAttendanceNotice(get(a), f.deps)).status, allowed ? 200 : 403); assert.equal(f.calls.length, allowed ? 1 : 0);
  }
});
test("cannot forge activation, actor, notice values, mixed query or oversized write", async () => {
  const f = setup();
  for (const patch of [{ enabled: true }, { actorAuthUserId: id(99) }, { values: {} }, { consent: true }, { latitude: 0 }]) assert.equal((await handleAttendanceNotice(post({ ...body, ...patch }), f.deps)).status, 400);
  assert.equal((await handleAttendanceNotice(post(body, `${url}?siteId=${q.siteId}`), f.deps)).status, 400);
  assert.equal((await handleAttendanceNotice(new Request(`${get().url}&access=self`), f.deps)).status, 400);
  assert.equal((await handleAttendanceNotice(post({ ...body, reason: "x".repeat(5000) }), f.deps)).status, 413); assert.equal(f.calls.length, 0);
});
test("paused publication reaches atomic policy guard while withdrawal and receipt reads remain possible", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof noticeDependencies.entitlement>> });
  const r = await handleAttendanceNotice(post(), f.deps); assert.equal(r.status, 200); assert.equal(f.calls[0].allowPublish, false); assert.equal(f.calls[0].authUserId, id(90));
  await handleAttendanceNotice(post({ ...body, action: "withdraw", expectedRevision: 1, draftRevision: null }), f.deps); assert.equal(f.calls[1].allowPublish, false);
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } }); assert.equal((await handleAttendanceNotice(get(), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
});
test("rate limits, stale notice, already acknowledged and backend failures have sanitized status", async () => {
  const limited = setup({ allow: () => false }); const r = await handleAttendanceNotice(get(), limited.deps); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60");
  for (const [code, status] of [["attendance_notice_unavailable", 409], ["attendance_notice_already_acknowledged", 409], ["attendance_version_conflict", 409], ["attendance_access_denied", 403], ["secret SQL error", 503]] as const) {
    const f = setup({ execute: async () => { throw new MerchantAttendanceError(code); } }); const result = await handleAttendanceNotice(get(), f.deps); assert.equal(result.status, status); assert.doesNotMatch(await result.text(), /secret SQL/);
  }
});
