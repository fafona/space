import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  claimMerchantCoupon,
  createMerchantCoupon,
  normalizeMerchantCouponRecords,
  redeemMerchantCoupon,
  updateMerchantCoupon,
  type MerchantCouponClaimEvent,
  type MerchantCouponDiscountType,
  type MerchantCouponInput,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { loadStoredMerchantCoupons, saveStoredMerchantCoupons } from "@/lib/merchantCouponsStore";
import {
  appendMutationOperationMarker,
  buildMutationOperationMarker,
  hasMutationOperationMarker,
} from "@/lib/mutationOperationId";

function requireCouponsStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    throw new Error("coupons_store_unavailable");
  }
  return supabase;
}

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

type MerchantCouponRedeemRequest = {
  settlementCode: string;
  expectedCouponId?: string;
  expectedClaimEventId?: string;
  operatorId?: string;
  note?: string;
  expectedAccountId?: string;
  expectedUserId?: string;
  expectedEmail?: string;
  operationId?: unknown;
  operationScope?: unknown;
  allowedDiscountTypes?: readonly MerchantCouponDiscountType[];
};

export async function getMerchantCouponsSnapshot(siteId: string) {
  const supabase = requireCouponsStoreClient();
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  return {
    coupons: normalizeMerchantCouponRecords(stored?.coupons ?? []),
    updatedAt: stored?.updatedAt ?? null,
  };
}

export async function listMerchantCoupons(siteId: string) {
  const snapshot = await getMerchantCouponsSnapshot(siteId);
  return snapshot.coupons;
}

export async function createMerchantCouponRecord(input: MerchantCouponInput) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  if (!siteId) throw new Error("invalid_site_id");
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  const current = normalizeMerchantCouponRecords(stored?.coupons ?? []);
  const coupon = createMerchantCoupon(
    {
      ...input,
      siteId,
    },
    current.map((item) => item.code),
  );
  const saved = await saveStoredMerchantCoupons(supabase, {
    siteId,
    coupons: [coupon, ...current],
    updatedAt: coupon.updatedAt,
    existingRowId: stored?.existingRowId ?? null,
  });
  if (saved.error) throw new Error(saved.error);
  return coupon;
}

export async function updateMerchantCouponRecord(input: {
  siteId: string;
  couponId: string;
  patch: MerchantCouponInput;
}) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  const couponId = trimText(input.couponId);
  if (!siteId || !couponId) throw new Error("coupon_not_found");
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
  const index = coupons.findIndex((coupon) => coupon.id === couponId);
  if (index < 0) throw new Error("coupon_not_found");
  const current = coupons[index];
  const next = updateMerchantCoupon(
    current,
    input.patch,
    coupons.filter((coupon) => coupon.id !== couponId).map((coupon) => coupon.code),
  );
  const updatedCoupons = [...coupons];
  updatedCoupons[index] = next;
  const saved = await saveStoredMerchantCoupons(supabase, {
    siteId,
    coupons: updatedCoupons,
    updatedAt: next.updatedAt,
    existingRowId: stored?.existingRowId ?? null,
  });
  if (saved.error) throw new Error(saved.error);
  return next;
}

export async function archiveMerchantCouponRecord(input: { siteId: string; couponId: string }) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  const couponId = trimText(input.couponId);
  if (!siteId || !couponId) throw new Error("coupon_not_found");
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
  const deletedCoupon = coupons.find((coupon) => coupon.id === couponId);
  if (!deletedCoupon) throw new Error("coupon_not_found");
  const updatedCoupons = coupons.filter((coupon) => coupon.id !== couponId);
  const saved = await saveStoredMerchantCoupons(supabase, {
    siteId,
    coupons: updatedCoupons,
    updatedAt: new Date().toISOString(),
    existingRowId: stored?.existingRowId ?? null,
  });
  if (saved.error) throw new Error(saved.error);
  return deletedCoupon;
}

export async function claimMerchantCouponRecord(input: {
  siteId: string;
  couponId: string;
  beforeClaim?: (coupon: MerchantCouponRecord) => Promise<Partial<MerchantCouponClaimEvent> | void> | Partial<MerchantCouponClaimEvent> | void;
}) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  const couponId = trimText(input.couponId);
  if (!siteId || !couponId) throw new Error("coupon_not_found");
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
  const index = coupons.findIndex((coupon) => coupon.id === couponId);
  if (index < 0) throw new Error("coupon_not_found");
  const claimEvent = await input.beforeClaim?.(coupons[index]);
  const next = claimMerchantCoupon(coupons[index], new Date(), claimEvent ?? undefined);
  const updatedCoupons = [...coupons];
  updatedCoupons[index] = next;
  const saved = await saveStoredMerchantCoupons(supabase, {
    siteId,
    coupons: updatedCoupons,
    updatedAt: next.updatedAt,
    existingRowId: stored?.existingRowId ?? null,
  });
  if (saved.error) throw new Error(saved.error);
  return next;
}

export async function redeemMerchantCouponRecord(input: {
  siteId: string;
  settlementCode: string;
  operatorId?: string;
  note?: string;
  operationId?: unknown;
}) {
  const [coupon] = await redeemMerchantCouponRecords({
    siteId: input.siteId,
    operatorId: input.operatorId,
    redemptions: [
      {
        settlementCode: input.settlementCode,
        note: input.note,
        operationId: input.operationId,
        operationScope: "coupon-redeem",
      },
    ],
  });
  return coupon;
}

export async function redeemMerchantCouponRecords(input: {
  siteId: string;
  operatorId?: string;
  redemptions: MerchantCouponRedeemRequest[];
  commit?: boolean;
}) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  if (!siteId) throw new Error("coupon_not_found");
  const seenSettlementCodes = new Set<string>();
  const redemptions = (Array.isArray(input.redemptions) ? input.redemptions : [])
    .map((redemption) => ({
      settlementCode: trimText(redemption.settlementCode),
      expectedCouponId: trimText(redemption.expectedCouponId, 160),
      expectedClaimEventId: trimText(redemption.expectedClaimEventId, 160),
      operatorId: trimText(redemption.operatorId) || trimText(input.operatorId),
      note: trimText(redemption.note),
      expectedAccountId: trimText(redemption.expectedAccountId),
      expectedUserId: trimText(redemption.expectedUserId),
      expectedEmail: trimText(redemption.expectedEmail).toLowerCase(),
      allowedDiscountTypes: redemption.allowedDiscountTypes,
      operationMarker: buildMutationOperationMarker(trimText(redemption.operationScope, 80) || "coupon-redeem", redemption.operationId),
    }))
    .filter((redemption) => {
      if (!redemption.settlementCode || seenSettlementCodes.has(redemption.settlementCode)) return false;
      seenSettlementCodes.add(redemption.settlementCode);
      return true;
    });
  if (redemptions.length === 0) throw new Error("invalid_settlement_code");
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
  const redeemedCoupons: MerchantCouponRecord[] = [];
  redemptions.forEach((redemption) => {
    const index = coupons.findIndex((coupon) =>
      coupon.claimEvents.some((event) => event.settlementCode === redemption.settlementCode),
    );
    if (index < 0) throw new Error("coupon_claim_not_found");
    const claimEvent = coupons[index].claimEvents.find((event) => event.settlementCode === redemption.settlementCode);
    if (!claimEvent) throw new Error("coupon_claim_not_found");
    if (redemption.expectedCouponId && coupons[index].id !== redemption.expectedCouponId) {
      throw new Error("coupon_claim_not_found");
    }
    if (redemption.expectedClaimEventId && claimEvent.id !== redemption.expectedClaimEventId) {
      throw new Error("coupon_claim_not_found");
    }
    if (
      redemption.allowedDiscountTypes?.length &&
      !redemption.allowedDiscountTypes.includes(coupons[index].discountType)
    ) {
      throw new Error("coupon_not_direct_redeemable");
    }
    const existingRedeemEvent = coupons[index].redeemEvents.find(
      (event) => event.settlementCode === redemption.settlementCode || event.claimEventId === claimEvent.id,
    );
    if (existingRedeemEvent) {
      if (hasMutationOperationMarker(existingRedeemEvent.note, redemption.operationMarker)) {
        redeemedCoupons.push(coupons[index]);
        return;
      }
      throw new Error("coupon_already_redeemed");
    }
    const hasExpectedIdentity = Boolean(
      redemption.expectedAccountId || redemption.expectedUserId || redemption.expectedEmail,
    );
    const identityMatches = Boolean(
      (redemption.expectedAccountId && claimEvent.accountId === redemption.expectedAccountId) ||
        (redemption.expectedUserId && claimEvent.userId === redemption.expectedUserId) ||
        (redemption.expectedEmail && claimEvent.email.toLowerCase() === redemption.expectedEmail),
    );
    if (hasExpectedIdentity && !identityMatches) throw new Error("coupon_claim_member_mismatch");
    const next = redeemMerchantCoupon(coupons[index], {
      settlementCode: redemption.settlementCode,
      operatorId: redemption.operatorId,
      note: appendMutationOperationMarker(redemption.note, redemption.operationMarker),
    });
    coupons[index] = next;
    redeemedCoupons.push(next);
  });
  if (input.commit === false) {
    return redeemedCoupons;
  }
  const saved = await saveStoredMerchantCoupons(supabase, {
    siteId,
    coupons,
    updatedAt: new Date().toISOString(),
    existingRowId: stored?.existingRowId ?? null,
  });
  if (saved.error) throw new Error(saved.error);
  return redeemedCoupons;
}
