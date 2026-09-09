import assert from "node:assert/strict";
import test from "node:test";
import {
  claimMerchantCoupon,
  createMerchantCoupon,
  redeemMerchantCoupon,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import {
  prepareMerchantCouponRedemptions,
  redeemMerchantCouponRecords,
  type MerchantCouponRedeemRequest,
} from "@/lib/merchantCoupons.server";
import { buildMutationOperationMarker } from "@/lib/mutationOperationId";
import type { StoredMerchantCoupons } from "@/lib/merchantCouponsStore";

const SITE = "10000000";
const NOW = "2026-09-08T10:00:00.000Z";
const VERSION = "2026-09-08T09:00:00.000Z";
const CODE = "settlement-one";
const OPERATION = "checkout-one";
const SCOPE = "member-redemption-checkout";

function couponFixture(): MerchantCouponRecord {
  return claimMerchantCoupon(createMerchantCoupon({
    id: "coupon-one", siteId: SITE, title: "Points voucher", discountType: "points_voucher", discountValue: 10,
    status: "active", totalQuantity: 100, createdAt: VERSION, updatedAt: VERSION,
  }), VERSION, { id: "claim-one", settlementCode: CODE, accountId: "account-a", userId: "user-a", email: "member-a@example.com" });
}

function snapshot(coupon = couponFixture()): StoredMerchantCoupons {
  return { siteId: SITE, coupons: [coupon], updatedAt: VERSION, existingRowId: "row-one" };
}

function request(patch: Partial<MerchantCouponRedeemRequest> = {}): MerchantCouponRedeemRequest {
  return {
    settlementCode: CODE, expectedCouponId: "coupon-one", expectedClaimEventId: "claim-one",
    expectedAccountId: "account-a", operationId: OPERATION, operationScope: SCOPE,
    allowedDiscountTypes: ["points_voucher"], ...patch,
  };
}

function prepare(coupon: MerchantCouponRecord, redemptions = [request()], now = NOW) {
  return prepareMerchantCouponRedemptions({ siteId: SITE, operatorId: "operator-one", redemptions }, {
    loadCoupons: async () => snapshot(coupon), now: () => now,
  });
}

test("coupon preparation reads exactly once, does not write or mutate the loaded snapshot, and retains original CAS", async () => {
  const original = snapshot();
  const before = structuredClone(original);
  let reads = 0;
  const prepared = await prepareMerchantCouponRedemptions({ siteId: SITE, redemptions: [request()] }, {
    loadCoupons: async (siteId) => { assert.equal(siteId, SITE); reads += 1; return original; }, now: () => NOW,
  });
  assert.equal(reads, 1);
  assert.deepEqual(original, before);
  assert.equal(prepared.mutation.expectedUpdatedAt, VERSION);
  assert.equal(prepared.mutation.next[0].usedCount, 1);
  assert.equal(prepared.mutation.next[0].redeemEvents[0].at, NOW);
  assert.equal(prepared.redeemedCoupons[0], prepared.mutation.next[0]);
  assert.equal(prepared.shadowChanges.length, 1);
  assert.equal(prepared.shadowChanges[0].previous?.usedCount, 0);
});

test("same-operation replay checks member identity before accepting the existing redemption", async () => {
  const coupon = redeemMerchantCoupon(couponFixture(), {
    settlementCode: CODE, now: NOW, note: buildMutationOperationMarker(SCOPE, OPERATION),
  });
  await assert.rejects(() => prepare(coupon, [request({
    expectedAccountId: "account-b", expectedUserId: "user-b", expectedEmail: "member-b@example.com",
  })]), /coupon_claim_member_mismatch/);
  const replayed = await prepare(coupon);
  assert.equal(replayed.mutation.expectedUpdatedAt, VERSION);
  assert.deepEqual(replayed.mutation.next, [coupon]);
  assert.deepEqual(replayed.shadowChanges, []);
  assert.equal(replayed.redeemedCoupons[0].usedCount, 1);
  await assert.rejects(() => prepare(coupon, [request({ operationId: "other-checkout" })]), /coupon_already_redeemed/);
});

test("cart opt-in rejects a legacy same-operation coupon commit without its atomic receipt", async () => {
  const coupon = redeemMerchantCoupon(couponFixture(), {
    settlementCode: CODE, now: NOW, note: buildMutationOperationMarker(SCOPE, OPERATION),
  });
  const deps = { loadCoupons: async () => snapshot(coupon), now: () => NOW };
  await assert.rejects(() => prepareMerchantCouponRedemptions({
    siteId: SITE, redemptions: [request()], rejectExistingOperation: true,
  }, deps), /redemption_legacy_operation_requires_review/);
  await assert.rejects(() => prepareMerchantCouponRedemptions({
    siteId: SITE, redemptions: [request({ expectedAccountId: "account-b" })], rejectExistingOperation: true,
  }, deps), /coupon_claim_member_mismatch/);
  const standalone = await prepareMerchantCouponRedemptions({ siteId: SITE, redemptions: [request()] }, deps);
  assert.equal(standalone.redeemedCoupons[0].usedCount, 1);
  assert.deepEqual(standalone.shadowChanges, []);
});

test("claim identity retains account, user or case-insensitive email compatibility", async () => {
  for (const identity of [
    { expectedAccountId: "account-a" },
    { expectedAccountId: "", expectedUserId: "user-a" },
    { expectedAccountId: "", expectedEmail: " MEMBER-A@EXAMPLE.COM " },
  ]) {
    const prepared = await prepare(couponFixture(), [request(identity)]);
    assert.equal(prepared.redeemedCoupons[0].usedCount, 1);
  }
});

test("duplicate trimmed settlement codes are rejected before reading", async () => {
  let reads = 0;
  await assert.rejects(() => prepareMerchantCouponRedemptions({
    siteId: SITE, redemptions: [request(), request({ settlementCode: ` ${CODE} ` })],
  }, { loadCoupons: async () => { reads += 1; return snapshot(); } }), /coupon_duplicate_settlement_code/);
  assert.equal(reads, 0);
});

test("different settlement aliases cannot redeem one claim twice", async () => {
  const coupon = couponFixture();
  coupon.claimEvents.push({ ...coupon.claimEvents[0], settlementCode: "alias-code" });
  await assert.rejects(() => prepare(coupon, [request(), request({ settlementCode: "alias-code" })]), /coupon_duplicate_settlement_code/);
});

test("two distinct claims on one coupon remain redeemable in one prepared snapshot", async () => {
  const coupon = claimMerchantCoupon(couponFixture(), VERSION, {
    id: "claim-two", settlementCode: "settlement-two", accountId: "account-a",
  });
  const prepared = await prepare(coupon, [request(), request({ settlementCode: "settlement-two", expectedClaimEventId: "claim-two" })]);
  assert.equal(prepared.mutation.next.length, 1);
  assert.equal(prepared.mutation.next[0].usedCount, 2);
  assert.equal(prepared.mutation.next[0].redeemEvents.length, 2);
  assert.equal(prepared.shadowChanges.length, 2);
});

test("preparation preserves coupon/claim binding, direct-type and tenant boundaries", async () => {
  await assert.rejects(() => prepare(couponFixture(), [request({ expectedCouponId: "other-coupon" })]), /coupon_claim_not_found/);
  await assert.rejects(() => prepare(couponFixture(), [request({ expectedClaimEventId: "other-claim" })]), /coupon_claim_not_found/);
  await assert.rejects(() => prepare(couponFixture(), [request({ allowedDiscountTypes: ["product_voucher"] })]), /coupon_not_direct_redeemable/);
  await assert.rejects(() => prepare({ ...couponFixture(), siteId: "20000000" }), /coupon_claim_not_found/);
});

test("first redemption still rejects inactive, future, expired and claim-expired coupons", async () => {
  const coupon = couponFixture();
  await assert.rejects(() => prepare({ ...coupon, status: "archived" }), /coupon_not_active/);
  await assert.rejects(() => prepare({ ...coupon, startsAt: "2026-10-01T00:00:00.000Z" }), /coupon_not_started/);
  await assert.rejects(() => prepare({ ...coupon, expiresAt: VERSION }), /coupon_expired/);
  await assert.rejects(() => prepare({ ...coupon, claimEvents: [{ ...coupon.claimEvents[0], validUntil: VERSION }] }), /coupon_claim_expired/);
});

test("same-member replay after coupon expiry is a no-op with the snapshot still guarded", async () => {
  const coupon = redeemMerchantCoupon(couponFixture(), { settlementCode: CODE, now: NOW, note: buildMutationOperationMarker(SCOPE, OPERATION) });
  coupon.expiresAt = "2026-09-08T11:00:00.000Z";
  const prepared = await prepare(coupon, [request()], "2026-09-09T00:00:00.000Z");
  assert.deepEqual(prepared.shadowChanges, []);
  assert.equal(prepared.mutation.expectedUpdatedAt, VERSION);
  assert.equal(prepared.redeemedCoupons[0].usedCount, 1);
});

test("read failures and missing claims do not produce a prepared mutation", async () => {
  await assert.rejects(() => prepareMerchantCouponRedemptions({ siteId: SITE, redemptions: [request()] }, {
    loadCoupons: async () => { throw new Error("read failed"); },
  }), /read failed/);
  await assert.rejects(() => prepareMerchantCouponRedemptions({ siteId: SITE, redemptions: [request()] }, {
    loadCoupons: async () => null,
  }), /coupon_claim_not_found/);
});

function standaloneDependencies(saveError: string | null = null) {
  const events: string[] = [];
  const client = {
    from: () => { throw new Error("direct query forbidden"); },
    rpc: async () => { throw new Error("unexpected RPC"); },
  };
  const dependencies: NonNullable<Parameters<typeof redeemMerchantCouponRecords>[1]> = {
    createClient: () => client,
    loadCoupons: async () => { events.push("read"); return snapshot(); },
    prepare: (input, deps) => prepareMerchantCouponRedemptions(input, { ...deps, now: () => NOW }),
    saveCoupons: async (_client, input) => {
      events.push("commit");
      assert.equal(input.expectedUpdatedAt, VERSION);
      assert.equal(input.coupons[0].usedCount, 1);
      return { error: saveError };
    },
    mirrorCoupons: async (_client, changes) => { events.push("shadow"); assert.equal(changes.length, 1); },
  };
  return { events, dependencies };
}

test("standalone redemption commits one prepared CAS snapshot and mirrors only after confirmation", async () => {
  const { events, dependencies } = standaloneDependencies();
  const coupons = await redeemMerchantCouponRecords({ siteId: SITE, redemptions: [request()] }, dependencies);
  assert.equal(coupons[0].usedCount, 1);
  assert.deepEqual(events, ["read", "commit", "shadow"]);
});

test("standalone redemption never mirrors, retries or compensates a conflict or ambiguous commit", async () => {
  for (const error of ["merchant_coupons_conflict", "merchant_transaction_unavailable"]) {
    const { events, dependencies } = standaloneDependencies(error);
    await assert.rejects(() => redeemMerchantCouponRecords({ siteId: SITE, redemptions: [request()] }, dependencies), new RegExp(error));
    assert.deepEqual(events, ["read", "commit"]);
  }
});

test("standalone preview remains read-only", async () => {
  const { events, dependencies } = standaloneDependencies();
  const coupons = await redeemMerchantCouponRecords({ siteId: SITE, redemptions: [request()], commit: false }, dependencies);
  assert.equal(coupons[0].usedCount, 1);
  assert.deepEqual(events, ["read"]);
});

test("standalone redemption does not mirror if the commit throws", async () => {
  const { events, dependencies } = standaloneDependencies();
  dependencies.saveCoupons = async () => { events.push("commit"); throw new Error("response lost"); };
  await assert.rejects(() => redeemMerchantCouponRecords({ siteId: SITE, redemptions: [request()] }, dependencies), /response lost/);
  assert.deepEqual(events, ["read", "commit"]);
});

test("standalone coupon mutations retain the shared per-site process lock", async () => {
  const { events, dependencies } = standaloneDependencies();
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let markFirstEntered: () => void = () => undefined;
  const firstEntered = new Promise<void>((resolve) => { markFirstEntered = resolve; });
  let commits = 0;
  dependencies.saveCoupons = async () => {
    commits += 1;
    events.push(`commit-${commits}`);
    if (commits === 1) { markFirstEntered(); await firstGate; }
    return { error: null };
  };
  const first = redeemMerchantCouponRecords({ siteId: SITE, redemptions: [request()] }, dependencies);
  await firstEntered;
  const second = redeemMerchantCouponRecords({ siteId: SITE, redemptions: [request()] }, dependencies);
  await Promise.resolve();
  assert.deepEqual(events, ["read", "commit-1"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["read", "commit-1", "shadow", "read", "commit-2", "shadow"]);
});
