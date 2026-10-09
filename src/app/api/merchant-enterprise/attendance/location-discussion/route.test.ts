import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { discussionDependencies, handleAttendanceDiscussion } from "./route-handler";
import type { DiscussionInput } from "@/lib/merchantAttendanceLocationDiscussion.server";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { createDiscussionFixture, discussionSite as siteId, discussionWorker as expectedWorkerId, discussionEvent as eventId, discussionId as id, discussionDetailQuery as detail } from "../../../../../../scripts/fixtures/attendance-location-discussion-model";
import { discussionQueryString } from "@/lib/merchantAttendanceLocationDiscussion";
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/location-discussion";
const body = { siteId, access: "self", expectedWorkerId, eventId, operationId: id(20), expectedRevision: 0, note: "Synthetic explanation" };
const post = (value: unknown = body, target = url, origin = "https://www.faolla.com") => new Request(target, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(value) });
const get = (access: "self" | "owner" = "self") => new Request(`${url}?${discussionQueryString(detail(access))}`);
function setup(patch: Partial<typeof discussionDependencies> = {}) {
  const calls: DiscussionInput[] = [];
  const deps: typeof discussionDependencies = { enabled: () => true, accessEnabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: id(90) } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof discussionDependencies.entitlement>>,
    execute: async input => { calls.push(input); return createDiscussionFixture().detail(input.query.access) as Awaited<ReturnType<typeof discussionDependencies.execute>>; }, ...patch };
  return { deps, calls };
}
test("discussion defaults closed and separately gates self and owner entry", async () => {
  const f = setup({ enabled: () => false, authenticate: async () => { throw Error("unexpected"); } });
  const r = await handleAttendanceDiscussion(post(), f.deps); assert.equal(r.status, 404); assert.equal(r.headers.get("cache-control"), "private, no-store");
  const closed = setup({ accessEnabled: a => a === "owner" }); assert.equal((await handleAttendanceDiscussion(get(), closed.deps)).status, 404); assert.equal((await handleAttendanceDiscussion(get("owner"), closed.deps)).status, 200);
});
test("untrusted origin, noncanonical portal and wrong methods stop before authentication", async () => {
  const f = setup({ authenticate: async () => { throw Error("unexpected"); } });
  assert.equal((await handleAttendanceDiscussion(post(body, url, "https://evil.example"), f.deps)).status, 403);
  assert.equal((await handleAttendanceDiscussion(post(body, url.replace("www.faolla.com", "shop.faolla.com")), f.deps)).status, 403);
  assert.equal((await handleAttendanceDiscussion(new Request(url, { method: "DELETE" }), f.deps)).status, 405);
});
test("self requires password; owner permits normal OAuth but not invite/recovery/magiclink", async () => {
  for (const access of ["self", "owner"] as const) for (const methods of [[], ["password"], ["oauth"], ["invite"], ["password", "recovery"], ["magiclink"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: id(90) } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && (methods[0] === "password" || access === "owner" && methods[0] === "oauth");
    assert.equal((await handleAttendanceDiscussion(get(access), f.deps)).status, allowed ? 200 : 403); assert.equal(f.calls.length, allowed ? 1 : 0);
  }
});
test("query/body injection, other worker selector and oversized/non-JSON writes reject", async () => {
  const f = setup();
  for (const patch of [{ actorAuthUserId: id(99) }, { visible: false }, { latitude: 1 }, { reviewOutcome: "approved" }, { expectedWorkerId: null }]) assert.equal((await handleAttendanceDiscussion(post({ ...body, ...patch }), f.deps)).status, 400);
  assert.equal((await handleAttendanceDiscussion(post(body, `${url}?x=1`), f.deps)).status, 400);
  assert.equal((await handleAttendanceDiscussion(new Request(`${get().url}&eventId=${eventId}`), f.deps)).status, 400);
  assert.equal((await handleAttendanceDiscussion(post({ ...body, note: "x".repeat(5000) }), f.deps)).status, 413);
  assert.equal((await handleAttendanceDiscussion(new Request(url, { method: "POST", headers: { origin: "https://www.faolla.com", "Content-Type": "text/plain" }, body: "x" }), f.deps)).status, 415);
  assert.equal(f.calls.length, 0);
});
test("entitlement remains checked while attendance pause permits existing-case read/write", async () => {
  const f = setup({ entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } }) as Awaited<ReturnType<typeof discussionDependencies.entitlement>> });
  const r = await handleAttendanceDiscussion(post(), f.deps); assert.equal(r.status, 200); assert.equal((await r.json()).moduleEnabled, false); assert.equal(f.calls[0].authUserId, id(90)); assert.equal(f.calls[0].query.mode, "detail");
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } }); assert.equal((await handleAttendanceDiscussion(get(), denied.deps)).status, 403); assert.equal(denied.calls.length, 0);
});
test("rate limiting, worker mismatch and sanitized backend errors preserve correct HTTP statuses", async () => {
  const limited = setup({ allow: () => false }); const r = await handleAttendanceDiscussion(get(), limited.deps); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "60");
  for (const [code, status] of [["attendance_worker_changed", 409], ["attendance_review_not_found", 404], ["attendance_access_denied", 403], ["secret database error", 503]] as const) {
    const f = setup({ execute: async () => { throw new MerchantAttendanceError(code); } }); const result = await handleAttendanceDiscussion(get(), f.deps); assert.equal(result.status, status); assert.doesNotMatch(await result.text(), /secret/);
  }
});
