import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMerchantCouponRecord,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import {
  buildMerchantCouponBackfillPlan,
  normalizeMerchantCouponBackfillBatchSize,
} from "@/lib/merchantCouponBackfill.server";

function buildCoupon(
  id: string,
  overrides: Parameters<typeof normalizeMerchantCouponRecord>[0] = {},
): MerchantCouponRecord {
  const coupon = normalizeMerchantCouponRecord({
    id,
    siteId: "10000000",
    title: id,
    code: id.toUpperCase(),
    discountType: "amount_off",
    discountValue: 5,
    claimedCount: 1,
    usedCount: 1,
    status: "active",
    claimEvents: [
      {
        id: `claim-${id}`,
        at: "2026-07-25T08:00:00.000Z",
        accountId: "",
        userId: "",
        email: "",
        code: "CLAIM-SECRET",
        customerName: "",
        settlementType: "qr",
        settlementCode: `QR-${id}`,
        validUntil: null,
      },
    ],
    redeemEvents: [
      {
        id: `redeem-${id}`,
        at: "2026-07-25T09:00:00.000Z",
        claimEventId: `claim-${id}`,
        settlementCode: `QR-${id}`,
        accountId: "",
        userId: "",
        operatorId: "",
        note: "",
      },
    ],
    createdAt: "2026-07-25T07:00:00.000Z",
    updatedAt: "2026-07-25T09:00:00.000Z",
    ...overrides,
  });
  assert.ok(coupon);
  return coupon;
}

test("coupon backfill batch size is safely bounded", () => {
  assert.equal(normalizeMerchantCouponBackfillBatchSize(undefined), 10);
  assert.equal(normalizeMerchantCouponBackfillBatchSize(0), 1);
  assert.equal(normalizeMerchantCouponBackfillBatchSize(1000), 50);
});

test("coupon backfill creates deterministic bounded batches without credentials", () => {
  const plan = buildMerchantCouponBackfillPlan({
    merchantId: "10000000",
    coupons: [
      buildCoupon("coupon-3", {
        createdAt: "2026-07-25T10:00:00.000Z",
        updatedAt: "2026-07-25T10:00:00.000Z",
      }),
      buildCoupon("coupon-1"),
      buildCoupon("coupon-2", {
        createdAt: "2026-07-25T08:00:00.000Z",
      }),
    ],
    batchSize: 2,
  });

  assert.equal(plan.couponCount, 3);
  assert.equal(plan.claimCount, 3);
  assert.equal(plan.redemptionCount, 3);
  assert.equal(plan.blockers.length, 0);
  assert.deepEqual(
    plan.batches.map((batch) =>
      batch.map((mutation) => mutation.coupon.id),
    ),
    [["coupon-1", "coupon-2"], ["coupon-3"]],
  );
  const serialized = JSON.stringify(plan.batches);
  assert.equal(serialized.includes("CLAIM-SECRET"), false);
  assert.equal(serialized.includes("QR-coupon"), false);
});

test("coupon backfill reports identity, event and counter blockers", () => {
  const invalid: MerchantCouponRecord = {
    ...buildCoupon("duplicate", {
      code: "DUPLICATE",
    }),
    siteId: "10000001",
    claimedCount: 0,
    usedCount: 2,
    startsAt: "bad",
    expiresAt: "bad",
    claimEvents: [
      {
        id: "claim-duplicate",
        at: "bad",
        accountId: "",
        userId: "",
        email: "",
        code: "",
        customerName: "",
        settlementType: "qr",
        settlementCode: "same",
        validUntil: "bad",
      },
      {
        id: "claim-duplicate",
        at: "bad",
        accountId: "",
        userId: "",
        email: "",
        code: "",
        customerName: "",
        settlementType: "qr",
        settlementCode: "same",
        validUntil: null,
      },
    ],
    redeemEvents: [
      {
        id: "redeem-duplicate",
        at: "bad",
        claimEventId: "missing",
        settlementCode: "same",
        accountId: "",
        userId: "",
        operatorId: "",
        note: "",
      },
      {
        id: "redeem-duplicate",
        at: "bad",
        claimEventId: "missing",
        settlementCode: "same",
        accountId: "",
        userId: "",
        operatorId: "",
        note: "",
      },
    ],
  };
  const plan = buildMerchantCouponBackfillPlan({
    merchantId: "10000000",
    coupons: [
      buildCoupon("duplicate", { code: "DUPLICATE" }),
      {
        ...invalid,
        status: "invalid" as MerchantCouponRecord["status"],
        discountType:
          "invalid" as MerchantCouponRecord["discountType"],
        createdAt: "bad",
        updatedAt: "bad",
      },
    ],
  });

  assert.deepEqual(
    new Set(plan.blockers.map((blocker) => blocker.code)),
    new Set([
      "duplicate_coupon_id",
      "duplicate_coupon_code",
      "merchant_mismatch",
      "invalid_status",
      "invalid_discount_type",
      "invalid_created_at",
      "invalid_updated_at",
      "invalid_starts_at",
      "invalid_expires_at",
      "invalid_claim_at",
      "invalid_claim_valid_until",
      "invalid_redeem_at",
      "duplicate_claim_id",
      "duplicate_redeem_id",
      "duplicate_settlement_code",
      "orphan_redemption",
      "claim_count_below_retained_events",
      "used_count_above_claimed_count",
    ]),
  );
});
