import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { MerchantAttendanceError } from "@/lib/merchantAttendanceTime";
import { MerchantEnterpriseAccessError } from "@/lib/merchantEnterpriseAuth.server";
import { executeLeaveReview } from "@/lib/merchantAttendanceLeaveReview.server";
import { LEAVE_REVIEW_ERRORS, leaveReviewQueryString, type LeaveReviewQuery, type LeaveReviewResult } from "@/lib/merchantAttendanceLeaveReview";
import { handleLeaveReview, leaveReviewDependencies } from "./route-handler";
import { GET, POST } from "./route";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const url = "https://www.faolla.com/api/merchant-enterprise/attendance/leave-review";
const siteId = "99990001", ownerId = id(99), query: LeaveReviewQuery = { siteId, afterAt: null, afterId: null };
const result = (): LeaveReviewResult => ({ protocol: "leave-review-v1", siteId, ownerId, items: [], scanned: 0, nextCursor: null });
const get = (value = query) => new Request(`${url}?${leaveReviewQueryString(value)}`);
function setup(patch: Partial<typeof leaveReviewDependencies> = {}) {
  const calls: Parameters<typeof leaveReviewDependencies.execute>[0][] = [];
  const deps: typeof leaveReviewDependencies = { enabled: () => true, allow: () => true,
    authenticate: async () => ({ user: { id: ownerId } as User, accessToken: "synthetic", authenticationMethods: ["password"] }),
    entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: true } }) as Awaited<ReturnType<typeof leaveReviewDependencies.entitlement>>,
    execute: async input => { calls.push(input); return result(); }, ...patch };
  return { deps, calls };
}

test("review requires both literal server flags; public flag alone cannot enable GET or POST", async t => {
  const names = ["FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED", "FAOLLA_ATTENDANCE_LEAVE_ENABLED", "NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED"] as const;
  const old = names.map(name => process.env[name]);
  t.after(() => { names.forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; }); });
  process.env.NEXT_PUBLIC_FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED = "1";
  let authenticated = 0; const f = setup({ enabled: leaveReviewDependencies.enabled, authenticate: async () => { authenticated++; throw Error("unexpected auth"); } });
  for (const [review, leave] of [[undefined, undefined], ["1", undefined], [undefined, "1"], ["true", "1"], ["1", "true"], ["0", "1"], ["1", "0"]]) {
    if (review === undefined) delete process.env.FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED; else process.env.FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED = review;
    if (leave === undefined) delete process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED; else process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED = leave;
    assert.equal(leaveReviewDependencies.enabled(), false);
    for (const request of [get(), new Request(url, { method: "POST" })]) {
      const response = await handleLeaveReview(request, f.deps); assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { ok: false, error: "attendance_not_available" });
    }
  }
  assert.equal(authenticated, 0);
  process.env.FAOLLA_ATTENDANCE_LEAVE_REVIEW_ENABLED = "1"; process.env.FAOLLA_ATTENDANCE_LEAVE_ENABLED = "1";
  assert.equal(leaveReviewDependencies.enabled(), true);
  assert.equal(typeof GET, "function"); assert.equal(typeof POST, "function");
  const response = await POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "approve" }) }));
  assert.equal(response.status, 405); assert.deepEqual(await response.json(), { ok: false, error: "method_not_allowed" });
});

test("GET-only rejects all mutation methods, malformed or oversized POST bodies before auth or execution", async () => {
  let authenticated = 0;
  const f = setup({ authenticate: async () => { authenticated++; throw Error("must not authenticate mutation"); } });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await handleLeaveReview(new Request(url, { method, body: "x".repeat(140000) }), f.deps);
    assert.equal(response.status, 405); assert.deepEqual(await response.json(), { ok: false, error: "method_not_allowed" });
  }
  assert.equal(authenticated, 0); assert.equal(f.calls.length, 0);
});

test("noncanonical and cross-origin GETs are rejected before authentication", async () => {
  let authenticated = 0;
  const f = setup({ authenticate: async () => { authenticated++; throw Error("must not authenticate foreign GET"); } });
  const alias = new Request(get().url.replace("www.", "merchant."));
  const foreign = get(); foreign.headers.set("origin", "https://evil.invalid");
  const crossSite = get(); crossSite.headers.set("sec-fetch-site", "cross-site");
  for (const request of [alias, foreign, crossSite]) {
    const response = await handleLeaveReview(request, f.deps); assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "forbidden_origin" });
  }
  assert.equal(authenticated, 0); assert.equal(f.calls.length, 0);
  const trusted = setup(), request = get(); request.headers.set("origin", "https://www.faolla.com");
  assert.equal((await handleLeaveReview(request, trusted.deps)).status, 200);
});

test("ordinary password/OAuth sessions pass authenticated owner separately; weak auth cannot discover candidates", async () => {
  for (const methods of [["password"], ["oauth"], [], ["invite"], ["magiclink"], ["password", "recovery"]]) {
    const f = setup({ authenticate: async () => ({ user: { id: ownerId } as User, accessToken: "synthetic", authenticationMethods: methods }) });
    const allowed = methods.length === 1 && ["password", "oauth"].includes(methods[0]);
    assert.equal((await handleLeaveReview(get(), f.deps)).status, allowed ? 200 : 403); assert.equal(f.calls.length, allowed ? 1 : 0);
    if (allowed) assert.deepEqual(f.calls[0], { query, authUserId: ownerId });
  }
  const denied = setup({ execute: async () => { throw new MerchantAttendanceError("attendance_access_denied"); } });
  const response = await handleLeaveReview(get(), denied.deps); assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "attendance_access_denied" });
});

test("paused entitlement is fresh and leaves only read authority; responses and errors remain private no-store", async () => {
  const sites: string[] = [], f = setup({ entitlement: async site => { sites.push(site);
    return { permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: false } } as Awaited<ReturnType<typeof leaveReviewDependencies.entitlement>>;
  } });
  const response = await handleLeaveReview(get(), f.deps); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ...result(), moduleEnabled: false }); assert.deepEqual(sites, [siteId]);
  assert.deepEqual(f.calls, [{ query, authUserId: ownerId }]); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("vary")!, /Authorization/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const denied = setup({ entitlement: async () => { throw new MerchantEnterpriseAccessError("enterprise_management_disabled", 403); } });
  const error = await handleLeaveReview(get(), denied.deps); assert.equal(error.status, 403); assert.equal(denied.calls.length, 0);
  assert.equal(error.headers.get("cache-control"), "private, no-store");
});

test("query exactness, duplicated keys and invalid paired dates fail before RPC and cannot inject authority or write commands", async () => {
  const f = setup();
  for (const suffix of [`&siteId=${siteId}`, `&ownerId=${ownerId}`, `&authUserId=${ownerId}`, "&allowWrite=true", "&status=submitted",
    "&limit=1000", `&requestId=${id(501)}`, "&command=approve", "&afterAt=2026-10-04T09%3A00%3A00.123456Z", `&afterId=${id(501)}`])
    assert.equal((await handleLeaveReview(new Request(get().url + suffix), f.deps)).status, 400, suffix);
  for (const instant of ["2026-02-30T09:00:00.123456Z", "2026-10-04T09:00:00.123Z", "not-a-time"]) {
    const request = new URL(get().url); request.searchParams.set("afterAt", instant); request.searchParams.set("afterId", id(501));
    const response = await handleLeaveReview(new Request(request), f.deps); assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_invalid_request" });
  }
  assert.equal(f.calls.length, 0);
});

test("rate limiting binds Auth actor and every allowed source or protocol error preserves status without private leaks", async () => {
  const actors: string[] = [], f = setup({ allow: actor => { actors.push(actor); return false; } });
  const limited = await handleLeaveReview(get(), f.deps); assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
  assert.deepEqual(actors, [ownerId]); assert.equal(f.calls.length, 0);
  for (const [code, status] of Object.entries(LEAVE_REVIEW_ERRORS)) {
    const rejected = setup({ execute: async () => { throw new MerchantAttendanceError(code); } });
    const response = await handleLeaveReview(get(), rejected.deps); assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, error: code });
  }
  for (const failure of [Error("private SQL detail"), new MerchantAttendanceError("attendance_leave_overlap")]) {
    const broken = setup({ execute: async () => { throw failure; } });
    const response = await handleLeaveReview(get(), broken.deps); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "attendance_unavailable" });
  }
});

test("service executes only the new read RPC with exactly query/Auth arguments and rejects foreign or malformed results", async () => {
  const input = { query, authUserId: ownerId };
  assert.deepEqual(await executeLeaveReview(input, { rpc: async (name, args) => {
    assert.equal(name, "faolla_attendance_leave_review_v1"); assert.deepEqual(args, { p_query: query, p_auth_user_id: ownerId });
    return { data: result(), error: null };
  } }), result());
  for (const patch of [{ ownerId: id(98) }, { siteId: "99990002" }, { privateReason: "x" }, { scanned: 51 },
    { nextCursor: { at: "2026-10-04T09:00:00.123456Z", id: id(501) } }])
    await assert.rejects(executeLeaveReview(input, { rpc: async () => ({ data: { ...result(), ...patch }, error: null }) }), /attendance_unavailable/);
  await assert.rejects(executeLeaveReview(input, null), /attendance_unavailable/);
  for (const code of [...Object.keys(LEAVE_REVIEW_ERRORS), "attendance_leave_overlap", "private SQL detail"])
    await assert.rejects(executeLeaveReview(input, { rpc: async () => ({ data: null, error: { message: code } }) }),
      new RegExp(Object.hasOwn(LEAVE_REVIEW_ERRORS, code) ? code : "attendance_unavailable"));
  await assert.rejects(executeLeaveReview(input, { rpc: async () => { throw Error("private connection detail"); } }), /attendance_unavailable/);
});

test("executor validates input before RPC and empty50 page passes without fetching more candidates", async () => {
  const calls: string[] = [], service = { rpc: async (name: string) => { calls.push(name); return { data: result(), error: null }; } };
  for (const input of [{ query: { ...query, siteId: "all" }, authUserId: ownerId }, { query, authUserId: "bad" },
    { query: { ...query, afterAt: "2026-10-04T09:00:00.123456Z" }, authUserId: ownerId }])
    await assert.rejects(executeLeaveReview(input, service));
  assert.equal(calls.length, 0);
  const empty = { ...result(), scanned: 50, nextCursor: { at: "2026-10-04T09:00:00.123456Z", id: id(550) } };
  assert.deepEqual(await executeLeaveReview({ query, authUserId: ownerId }, { rpc: async name => { calls.push(name); return { data: empty, error: null }; } }), empty);
  assert.deepEqual(calls, ["faolla_attendance_leave_review_v1"]);
});
