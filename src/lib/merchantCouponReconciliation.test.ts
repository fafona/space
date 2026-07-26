import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMerchantCouponRecord,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { reconcileMerchantCouponStorage } from "@/lib/merchantCouponReconciliation";
import { buildMerchantCouponV1Mutation } from "@/lib/merchantCouponsV1";

function buildCoupon(): MerchantCouponRecord {
  const coupon = normalizeMerchantCouponRecord({
    id: "coupon-1",
    siteId: "10000000",
    title: "Welcome",
    code: "WELCOME",
    discountType: "amount_off",
    discountValue: 10,
    minimumAmount: 30,
    totalQuantity: 100,
    claimedCount: 1,
    usedCount: 1,
    status: "active",
    claimEvents: [
      {
        id: "claim-1",
        at: "2026-07-25T08:00:00.000Z",
        accountId: "10000000000001",
        userId: "user-1",
        email: "customer@example.com",
        code: "SECRET",
        customerName: "Customer",
        settlementType: "qr",
        settlementCode: "QR-1",
        validUntil: null,
      },
    ],
    redeemEvents: [
      {
        id: "redeem-1",
        at: "2026-07-25T09:00:00.000Z",
        claimEventId: "claim-1",
        settlementCode: "QR-1",
        accountId: "10000000000001",
        userId: "user-1",
        operatorId: "operator",
        note: "desk",
      },
    ],
    createdAt: "2026-07-25T07:00:00.000Z",
    updatedAt: "2026-07-25T09:00:00.000Z",
  });
  assert.ok(coupon);
  return coupon;
}

function buildMatchingRows(coupon: MerchantCouponRecord) {
  const mutation = buildMerchantCouponV1Mutation(coupon);
  return {
    coupons: [{ ...mutation.coupon }],
    claims: mutation.claims.map((claim) => ({
      merchant_id: coupon.siteId,
      id: claim.id,
      coupon_id: coupon.id,
      customer_id: claim.customer ? "customer-uuid" : null,
      settlement_type: claim.settlement_type,
      settlement_code_hash: claim.settlement_code_hash,
      claim_code_hash: claim.claim_code_hash,
      status: claim.status,
      customer_snapshot: claim.customer_snapshot,
      source_snapshot: claim.source_snapshot,
      claimed_at: claim.claimed_at,
      valid_until: claim.valid_until,
      source_updated_at: claim.source_updated_at,
    })),
    redemptions: mutation.redemptions.map((redemption) => ({
      merchant_id: coupon.siteId,
      id: redemption.id,
      coupon_id: coupon.id,
      claim_id: redemption.claim_id,
      customer_id: "customer-uuid",
      state: "active",
      settlement_code_hash: redemption.settlement_code_hash,
      operator_id: redemption.operator_id,
      note: redemption.note,
      source_snapshot: redemption.source_snapshot,
      redeemed_at: redemption.redeemed_at,
      source_updated_at: redemption.source_updated_at,
    })),
    events: mutation.events.map((event) => ({
      merchant_id: coupon.siteId,
      coupon_id: coupon.id,
      idempotency_key: event.idempotency_key,
    })),
  };
}

test("coupon reconciliation accepts an exact V1 projection", () => {
  const coupon = buildCoupon();
  const rows = buildMatchingRows(coupon);
  const report = reconcileMerchantCouponStorage({
    merchantId: "10000000",
    legacyCoupons: [coupon],
    v1Coupons: rows.coupons,
    v1Claims: rows.claims,
    v1Redemptions: rows.redemptions,
    v1Events: rows.events,
  });

  assert.equal(report.isMatch, true);
  assert.equal(report.matchedCouponCount, 1);
  assert.deepEqual(report.mismatches, []);
});

test("coupon reconciliation reports missing events and record mismatches", () => {
  const coupon = buildCoupon();
  const rows = buildMatchingRows(coupon);
  rows.coupons[0] = { ...rows.coupons[0], used_count: 0 };
  rows.claims[0] = { ...rows.claims[0], customer_id: null };
  rows.redemptions[0] = { ...rows.redemptions[0], state: "released" };
  const report = reconcileMerchantCouponStorage({
    merchantId: "10000000",
    legacyCoupons: [coupon],
    v1Coupons: rows.coupons,
    v1Claims: rows.claims,
    v1Redemptions: rows.redemptions,
    v1Events: rows.events.slice(1),
  });

  assert.equal(report.isMatch, false);
  assert.equal(report.missingEventKeys.length, 1);
  assert.deepEqual(
    new Set(report.mismatches.flatMap((mismatch) => mismatch.fields)),
    new Set(["usedCount", "customerLink", "state"]),
  );
});

test("coupon reconciliation permits preserved released history but rejects extra active redemptions", () => {
  const coupon = buildCoupon();
  const rows = buildMatchingRows(coupon);
  const historical = {
    ...rows.redemptions[0],
    id: "historical",
    state: "released",
  };
  const releasedReport = reconcileMerchantCouponStorage({
    merchantId: "10000000",
    legacyCoupons: [coupon],
    v1Coupons: rows.coupons,
    v1Claims: rows.claims,
    v1Redemptions: [...rows.redemptions, historical],
    v1Events: rows.events,
  });
  assert.equal(releasedReport.isMatch, true);

  const activeReport = reconcileMerchantCouponStorage({
    merchantId: "10000000",
    legacyCoupons: [coupon],
    v1Coupons: rows.coupons,
    v1Claims: rows.claims,
    v1Redemptions: [
      ...rows.redemptions,
      { ...historical, state: "active" },
    ],
    v1Events: rows.events,
  });
  assert.equal(activeReport.isMatch, false);
  assert.deepEqual(activeReport.unexpectedActiveRedemptions, [
    "coupon-1:historical",
  ]);
});
