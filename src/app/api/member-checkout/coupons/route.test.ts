import assert from "node:assert/strict";
import test from "node:test";
import { handleMemberCheckoutCouponGet, type MemberCheckoutCouponReadDependencies } from "./route-handler";
import { normalizeMerchantCouponRecord } from "@/lib/merchantCoupons";
import { normalizeMerchantMembershipRecord } from "@/lib/merchantMemberships";
import { isMemberCheckoutPilotEnabled } from "@/lib/merchantMemberCheckoutPilot.server";

const at = "2026-11-22T00:00:00Z", accountId = "50010105", userId = "customer-synthetic";
function fixture() {
  const calls: string[] = [];
  const user = { id: userId, email: "private@example.invalid", email_confirmed_at: "2026-01-01T00:00:00Z" };
  const session = { accountId, userId, servicePaused: false, user } as unknown as NonNullable<Awaited<ReturnType<MemberCheckoutCouponReadDependencies["session"]>>>;
  const member = normalizeMerchantMembershipRecord({ id: "member-test", siteId: "10909095", accountId, userId, status: "active", joinedAt: at, updatedAt: at })!;
  const coupon = normalizeMerchantCouponRecord({ id: "coupon-test", code: "TEST", siteId: "10909095", title: "本人会员券", discountType: "points_voucher", discountValue: 100,
    claimEvents: [{ id: "claim-test", at, accountId, userId, email: "private@example.invalid", customerName: "Private", code: "",
      settlementType: "qr", settlementCode: "PRIVATE-CODE", validUntil: null }], createdAt: at, updatedAt: at })!;
  const site = { id: "10909095", status: "online", serviceExpiresAt: "2099-01-01T00:00:00Z",
    permissionConfig: { allowMembershipManagement: true, allowCouponModule: true } } as unknown as NonNullable<Awaited<ReturnType<MemberCheckoutCouponReadDependencies["site"]>>>;
  const deps: MemberCheckoutCouponReadDependencies = {
    enabled: () => true, session: async () => { calls.push("session"); return session; }, site: async () => { calls.push("site"); return site; },
    members: async () => { calls.push("members"); return { siteId: site.id, memberships: [member], updatedAt: at }; },
    coupons: async () => { calls.push("coupons"); return { coupons: [coupon], updatedAt: at }; }, now: () => at,
  };
  const request = (query = "siteId=10909095", headers: HeadersInit = {}) => new Request(`https://synthetic.faolla.invalid/api/member-checkout/coupons?${query}`, { headers });
  return { deps, calls, user, session, member, coupon, site, request };
}

test("pilot is explicitly server configured and malformed lists are never partially enabled", () => {
  for (const value of [undefined, "", "*", "10909095,", "10909095,not-a-site", "109090950"]) {
    assert.equal(isMemberCheckoutPilotEnabled("10909095", { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: value }), false);
  }
  assert.equal(isMemberCheckoutPilotEnabled("10909095", { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: "10909096, 10909095" }), true);
  assert.equal(isMemberCheckoutPilotEnabled("10909097", { MERCHANT_MEMBER_CHECKOUT_PILOT_SITES: "10909095" }), false);
});

test("read-only issued-coupon API returns only this active member's safe inventory", async () => {
  const f = fixture();
  const response = await handleMemberCheckoutCouponGet(f.request(), f.deps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.coupons.length, 1); assert.equal(body.coupons[0].quoteRequired, true);
  assert.equal(body.coupons[0].claimEventId, "claim-test");
  assert.equal(body.total, 1); assert.equal(body.hasMore, false);
  assert.deepEqual(f.calls, ["session", "site", "members", "coupons", "session"]);
  assert.ok(!/PRIVATE|private@example|settlementCode|redeemEvents|claimEvents|accountId|member-test/.test(JSON.stringify(body)));
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("guest, unverified, paused and business-token access is denied before wallet reads", async () => {
  for (const mode of ["guest", "unverified", "paused", "business"] as const) {
    const f = fixture();
    if (mode === "guest") f.deps.session = async () => null;
    if (mode === "unverified") f.user.email_confirmed_at = "";
    if (mode === "paused") f.session.servicePaused = true;
    const response = await handleMemberCheckoutCouponGet(f.request(undefined, mode === "business" ? { "x-merchant-access-token": "synthetic" } : {}), f.deps);
    assert.equal(response.status, mode === "business" ? 403 : 401);
    assert.ok(!f.calls.includes("coupons"));
  }
});

test("request cannot choose another principal/member, repeat a site or request an unbounded page", async () => {
  for (const query of ["siteId=10909095&memberId=other", "siteId=10909095&accountId=50010106", "siteId=10909095&siteId=10909096",
    "siteId=10909095&limit=101", "siteId=10909095&offset=-1", "siteId=10909095&limit=0"]) {
    const f = fixture(), response = await handleMemberCheckoutCouponGet(f.request(query), f.deps);
    assert.equal(response.status, 400); assert.deepEqual(f.calls, []);
  }
});

test("disabled pilot and merchant permission/expiry gates preserve legacy code and fail closed", async () => {
  const off = fixture(); off.deps.enabled = () => false;
  assert.equal((await handleMemberCheckoutCouponGet(off.request(), off.deps)).status, 503); assert.deepEqual(off.calls, []);
  for (const mode of ["missing", "paused", "expired", "noMember", "noCoupon"] as const) {
    const f = fixture();
    if (mode === "missing") f.deps.site = async () => null;
    if (mode === "paused") f.site.status = "maintenance";
    if (mode === "expired") f.site.serviceExpiresAt = "2020-01-01T00:00:00Z";
    if (mode === "noMember") f.site.permissionConfig!.allowMembershipManagement = false;
    if (mode === "noCoupon") f.site.permissionConfig!.allowCouponModule = false;
    assert.equal((await handleMemberCheckoutCouponGet(f.request(), f.deps)).status, 403);
    assert.ok(!f.calls.includes("members"));
  }
});

test("left, another-owner and ambiguous memberships never expose a wallet", async () => {
  for (const mode of ["left", "foreign", "ambiguous"] as const) {
    const f = fixture();
    if (mode === "left") f.member.status = "left";
    if (mode === "foreign") f.member.userId = "other-user";
    if (mode === "ambiguous") f.deps.members = async () => ({ siteId: f.site.id, memberships: [f.member, { ...f.member, id: "another-membership" }], updatedAt: at });
    assert.equal((await handleMemberCheckoutCouponGet(f.request(), f.deps)).status, mode === "ambiguous" ? 409 : 403);
    assert.ok(!f.calls.includes("coupons"));
  }
});

test("account switch or revoked session during loading hides the previous account's data", async () => {
  const f = fixture(); let calls = 0;
  f.deps.session = async () => ++calls === 1 ? f.session : null;
  const response = await handleMemberCheckoutCouponGet(f.request(), f.deps);
  assert.equal(response.status, 401); assert.ok(!JSON.stringify(await response.json()).includes("claim-test"));
});

test("paging stays private and repository errors are sanitized", async () => {
  const f = fixture();
  const result = await handleMemberCheckoutCouponGet(f.request("siteId=10909095&offset=1&limit=10"), f.deps);
  assert.equal(result.status, 200); assert.deepEqual((await result.json()).coupons, []);
  f.deps.coupons = async () => { throw new Error("SELECT private_email WITH connection_secret"); };
  const failed = await handleMemberCheckoutCouponGet(f.request(), f.deps);
  assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { error: "checkout_coupons_unavailable" });
});
