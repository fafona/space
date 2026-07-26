import {
  MERCHANT_COUPON_DISCOUNT_TYPES,
  MERCHANT_COUPON_STATUSES,
  type MerchantCouponDiscountType,
  type MerchantCouponRecord,
  type MerchantCouponStatus,
} from "@/lib/merchantCoupons";
import {
  buildMerchantCouponV1Mutation,
  type MerchantCouponV1Mutation,
} from "@/lib/merchantCouponsV1";

export const MERCHANT_COUPON_BACKFILL_DEFAULT_BATCH_SIZE = 10;
export const MERCHANT_COUPON_BACKFILL_MAX_BATCH_SIZE = 50;

export type MerchantCouponBackfillBlocker = {
  code:
    | "merchant_mismatch"
    | "missing_coupon_id"
    | "duplicate_coupon_id"
    | "missing_coupon_code"
    | "duplicate_coupon_code"
    | "invalid_status"
    | "invalid_discount_type"
    | "invalid_created_at"
    | "invalid_updated_at"
    | "invalid_starts_at"
    | "invalid_expires_at"
    | "invalid_claim_at"
    | "invalid_claim_valid_until"
    | "invalid_redeem_at"
    | "duplicate_claim_id"
    | "duplicate_redeem_id"
    | "duplicate_settlement_code"
    | "orphan_redemption"
    | "claim_count_below_retained_events"
    | "used_count_below_active_redemptions"
    | "used_count_above_claimed_count";
  couponId: string;
};

export type MerchantCouponBackfillPlan = {
  merchantId: string;
  batchSize: number;
  couponCount: number;
  claimCount: number;
  redemptionCount: number;
  batches: MerchantCouponV1Mutation[][];
  blockers: MerchantCouponBackfillBlocker[];
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidTimestamp(value: unknown, optional = false) {
  const text = trimText(value);
  if (!text) return optional;
  return Number.isFinite(Date.parse(text));
}

export function normalizeMerchantCouponBackfillBatchSize(value: unknown) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return MERCHANT_COUPON_BACKFILL_DEFAULT_BATCH_SIZE;
  return Math.min(
    MERCHANT_COUPON_BACKFILL_MAX_BATCH_SIZE,
    Math.max(1, parsed),
  );
}

function compareCoupons(left: MerchantCouponRecord, right: MerchantCouponRecord) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    leftTime !== rightTime
  ) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

function pushBlocker(
  blockers: MerchantCouponBackfillBlocker[],
  couponId: string,
  code: MerchantCouponBackfillBlocker["code"],
) {
  if (
    blockers.some(
      (blocker) => blocker.couponId === couponId && blocker.code === code,
    )
  ) {
    return;
  }
  blockers.push({ couponId, code });
}

export function buildMerchantCouponBackfillPlan(input: {
  merchantId: string;
  coupons: MerchantCouponRecord[];
  batchSize?: unknown;
}): MerchantCouponBackfillPlan {
  const merchantId = trimText(input.merchantId);
  const batchSize = normalizeMerchantCouponBackfillBatchSize(input.batchSize);
  const coupons = [...(Array.isArray(input.coupons) ? input.coupons : [])].sort(
    compareCoupons,
  );
  const blockers: MerchantCouponBackfillBlocker[] = [];
  const couponIds = new Set<string>();
  const couponCodes = new Set<string>();
  let claimCount = 0;
  let redemptionCount = 0;

  for (const coupon of coupons) {
    const couponId = trimText(coupon?.id);
    const couponCode = trimText(coupon?.code).toUpperCase();
    if (trimText(coupon?.siteId) !== merchantId) {
      pushBlocker(blockers, couponId, "merchant_mismatch");
    }
    if (!couponId) {
      pushBlocker(blockers, couponId, "missing_coupon_id");
    } else if (couponIds.has(couponId)) {
      pushBlocker(blockers, couponId, "duplicate_coupon_id");
    } else {
      couponIds.add(couponId);
    }
    if (!couponCode) {
      pushBlocker(blockers, couponId, "missing_coupon_code");
    } else if (couponCodes.has(couponCode)) {
      pushBlocker(blockers, couponId, "duplicate_coupon_code");
    } else {
      couponCodes.add(couponCode);
    }
    if (
      !MERCHANT_COUPON_STATUSES.includes(coupon.status as MerchantCouponStatus)
    ) {
      pushBlocker(blockers, couponId, "invalid_status");
    }
    if (
      !MERCHANT_COUPON_DISCOUNT_TYPES.includes(
        coupon.discountType as MerchantCouponDiscountType,
      )
    ) {
      pushBlocker(blockers, couponId, "invalid_discount_type");
    }
    if (!isValidTimestamp(coupon.createdAt)) {
      pushBlocker(blockers, couponId, "invalid_created_at");
    }
    if (!isValidTimestamp(coupon.updatedAt)) {
      pushBlocker(blockers, couponId, "invalid_updated_at");
    }
    if (!isValidTimestamp(coupon.startsAt, true)) {
      pushBlocker(blockers, couponId, "invalid_starts_at");
    }
    if (!isValidTimestamp(coupon.expiresAt, true)) {
      pushBlocker(blockers, couponId, "invalid_expires_at");
    }

    const claimIds = new Set<string>();
    const settlementCodes = new Set<string>();
    const claims = Array.isArray(coupon.claimEvents) ? coupon.claimEvents : [];
    claimCount += claims.length;
    for (const claim of claims) {
      const claimId = trimText(claim?.id);
      const settlementCode = trimText(claim?.settlementCode);
      if (claimId && claimIds.has(claimId)) {
        pushBlocker(blockers, couponId, "duplicate_claim_id");
      } else if (claimId) {
        claimIds.add(claimId);
      }
      if (settlementCode && settlementCodes.has(settlementCode)) {
        pushBlocker(blockers, couponId, "duplicate_settlement_code");
      } else if (settlementCode) {
        settlementCodes.add(settlementCode);
      }
      if (!isValidTimestamp(claim?.at)) {
        pushBlocker(blockers, couponId, "invalid_claim_at");
      }
      if (!isValidTimestamp(claim?.validUntil, true)) {
        pushBlocker(blockers, couponId, "invalid_claim_valid_until");
      }
    }

    const redemptionIds = new Set<string>();
    const redemptions = Array.isArray(coupon.redeemEvents)
      ? coupon.redeemEvents
      : [];
    redemptionCount += redemptions.length;
    for (const redemption of redemptions) {
      const redemptionId = trimText(redemption?.id);
      if (redemptionId && redemptionIds.has(redemptionId)) {
        pushBlocker(blockers, couponId, "duplicate_redeem_id");
      } else if (redemptionId) {
        redemptionIds.add(redemptionId);
      }
      if (!claimIds.has(trimText(redemption?.claimEventId))) {
        pushBlocker(blockers, couponId, "orphan_redemption");
      }
      if (!isValidTimestamp(redemption?.at)) {
        pushBlocker(blockers, couponId, "invalid_redeem_at");
      }
    }

    if (coupon.claimedCount < claims.length) {
      pushBlocker(
        blockers,
        couponId,
        "claim_count_below_retained_events",
      );
    }
    if (coupon.usedCount < redemptions.length) {
      pushBlocker(
        blockers,
        couponId,
        "used_count_below_active_redemptions",
      );
    }
    if (coupon.usedCount > coupon.claimedCount) {
      pushBlocker(blockers, couponId, "used_count_above_claimed_count");
    }
  }

  const mutations = coupons.map((coupon) =>
    buildMerchantCouponV1Mutation(coupon),
  );
  const batches: MerchantCouponV1Mutation[][] = [];
  for (let index = 0; index < mutations.length; index += batchSize) {
    batches.push(mutations.slice(index, index + batchSize));
  }

  return {
    merchantId,
    batchSize,
    couponCount: coupons.length,
    claimCount,
    redemptionCount,
    batches,
    blockers,
  };
}
