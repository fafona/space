import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeMerchantCouponRecord,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import {
  buildMerchantCouponV1Mutation,
  hashMerchantCouponSensitiveValue,
  sanitizeMerchantCouponV1SourceSnapshot,
} from "@/lib/merchantCouponsV1";

function buildCoupon(
  overrides: Parameters<typeof normalizeMerchantCouponRecord>[0] = {},
): MerchantCouponRecord {
  const coupon = normalizeMerchantCouponRecord({
    id: "coupon-1",
    siteId: "10000000",
    title: "Welcome",
    code: "WELCOME",
    discountType: "amount_off",
    discountValue: 10,
    minimumAmount: 50,
    totalQuantity: 100,
    claimedCount: 1,
    usedCount: 1,
    status: "active",
    claimAllowedCodes: ["CLAIM-SECRET"],
    claimEvents: [
      {
        id: "claim-1",
        at: "2026-07-25T08:00:00.000Z",
        accountId: "10000000000001",
        userId: "user-1",
        email: "customer@example.com",
        code: "CLAIM-SECRET",
        customerName: "Customer",
        settlementType: "qr",
        settlementCode: "QR-SECRET-1",
        validUntil: "2026-08-25T08:00:00.000Z",
      },
    ],
    redeemEvents: [
      {
        id: "redeem-1",
        at: "2026-07-25T09:00:00.000Z",
        claimEventId: "claim-1",
        settlementCode: "QR-SECRET-1",
        accountId: "10000000000001",
        userId: "user-1",
        operatorId: "operator-1",
        note: "front desk",
      },
    ],
    createdAt: "2026-07-25T07:00:00.000Z",
    updatedAt: "2026-07-25T09:00:00.000Z",
    ...overrides,
  });
  assert.ok(coupon);
  return coupon;
}

test("coupon V1 mapper hashes claim and settlement credentials", () => {
  const coupon = buildCoupon();
  const mutation = buildMerchantCouponV1Mutation(coupon);
  const serialized = JSON.stringify(mutation);

  assert.equal(serialized.includes("CLAIM-SECRET"), false);
  assert.equal(serialized.includes("QR-SECRET-1"), false);
  assert.equal(mutation.claims[0]?.claim_code_hash?.length, 64);
  assert.equal(mutation.claims[0]?.settlement_code_hash?.length, 64);
  assert.equal(
    mutation.claims[0]?.settlement_code_hash,
    hashMerchantCouponSensitiveValue("settlement-code", "QR-SECRET-1"),
  );
  assert.deepEqual(
    sanitizeMerchantCouponV1SourceSnapshot(coupon),
    mutation.coupon.source_snapshot,
  );
});

test("coupon V1 mapper links identifiable claims to canonical customers", () => {
  const mutation = buildMerchantCouponV1Mutation(buildCoupon());
  const claim = mutation.claims[0];

  assert.equal(claim?.customer?.merchant_id, "10000000");
  assert.equal(claim?.customer?.account_id, "10000000000001");
  assert.equal(claim?.customer?.auth_user_id, "user-1");
  assert.equal(claim?.customer?.email, "customer@example.com");
  assert.equal(claim?.status, "redeemed");
  assert.equal(mutation.redemptions[0]?.claim_id, "claim-1");
});

test("coupon V1 mapper records removed redemptions as idempotent releases", () => {
  const previous = buildCoupon();
  const current = buildCoupon({
    usedCount: 0,
    redeemEvents: [],
    updatedAt: "2026-07-25T10:00:00.000Z",
  });
  const mutation = buildMerchantCouponV1Mutation(current, previous);

  assert.deepEqual(mutation.released_redemption_ids, ["redeem-1"]);
  assert.equal(
    mutation.events.some(
      (event) =>
        event.idempotency_key ===
        "legacy-coupon-release:10000000:coupon-1:redeem-1:2026-07-25T10:00:00.000Z",
    ),
    true,
  );
  assert.equal(mutation.claims[0]?.status, "claimed");
});

test("coupon V1 mapping is deterministic for the same normalized snapshot", () => {
  const coupon = buildCoupon();
  assert.deepEqual(
    buildMerchantCouponV1Mutation(coupon),
    buildMerchantCouponV1Mutation(coupon),
  );
});
