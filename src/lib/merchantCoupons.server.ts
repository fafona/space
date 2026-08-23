import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  claimMerchantCoupon,
  createMerchantCoupon,
  normalizeMerchantCouponRecords,
  redeemMerchantCoupon,
  releaseMerchantCouponRedemption,
  updateMerchantCoupon,
  type MerchantCouponClaimEvent,
  type MerchantCouponDiscountType,
  type MerchantCouponInput,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";
import { loadStoredMerchantCoupons, saveStoredMerchantCoupons } from "@/lib/merchantCouponsStore";
import {
  mirrorMerchantCouponChanges,
  type MerchantCouponShadowChange,
} from "@/lib/merchantCouponDualWrite.server";
import {
  loadMerchantCouponsV1VerificationData,
  readMerchantCouponsWithV1Verification,
  type MerchantCouponV1ReadClient,
} from "@/lib/merchantCouponsV1Read.server";
import {
  appendMutationOperationMarker,
  buildMutationOperationMarker,
  hasMutationOperationMarker,
} from "@/lib/mutationOperationId";
import { matchesExactPersonalIdentity } from "@/lib/personalAccountId";

const merchantCouponMutationTails = new Map<string, Promise<void>>();

async function withMerchantCouponMutationLock<T>(siteId: string, task: () => Promise<T>) {
  const normalizedSiteId = trimText(siteId);
  if (!normalizedSiteId) throw new Error("invalid_site_id");

  const previous = merchantCouponMutationTails.get(normalizedSiteId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  merchantCouponMutationTails.set(normalizedSiteId, tail);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (merchantCouponMutationTails.get(normalizedSiteId) === tail) {
      merchantCouponMutationTails.delete(normalizedSiteId);
    }
  }
}

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

async function mirrorSavedCouponChanges(
  supabase: ReturnType<typeof requireCouponsStoreClient>,
  changes: MerchantCouponShadowChange[],
) {
  await mirrorMerchantCouponChanges(supabase, changes);
}

export type MerchantCouponRedeemRequest = {
  settlementCode: string;
  expectedCouponId?: string;
  expectedClaimEventId?: string;
  operatorId?: string;
  note?: string;
  expectedAccountId?: string;
  expectedUserId?: string;
  operationId?: unknown;
  operationScope?: unknown;
  allowedDiscountTypes?: readonly MerchantCouponDiscountType[];
};

export function matchesMerchantCouponClaimExpectedIdentity(
  claimEvent: Pick<MerchantCouponClaimEvent, "accountId" | "userId" | "email">,
  expected: { accountId?: unknown; userId?: unknown },
) {
  return matchesExactPersonalIdentity(
    { accountId: claimEvent.accountId, userId: claimEvent.userId },
    expected,
  );
}

export async function getMerchantCouponsSnapshot(siteId: string) {
  const supabase = requireCouponsStoreClient();
  const stored = await loadStoredMerchantCoupons(supabase, siteId);
  const legacy = {
    coupons: normalizeMerchantCouponRecords(stored?.coupons ?? []),
    updatedAt: stored?.updatedAt ?? null,
  };
  return readMerchantCouponsWithV1Verification({
    siteId,
    legacy,
    loadV1: () =>
      loadMerchantCouponsV1VerificationData(
        supabase as unknown as MerchantCouponV1ReadClient,
        siteId,
      ),
  });
}

export async function listMerchantCoupons(siteId: string) {
  const snapshot = await getMerchantCouponsSnapshot(siteId);
  return snapshot.coupons;
}

export async function createMerchantCouponRecord(input: MerchantCouponInput) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  if (!siteId) throw new Error("invalid_site_id");
  return withMerchantCouponMutationLock(siteId, async () => {
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
    await mirrorSavedCouponChanges(supabase, [{ current: coupon }]);
    return coupon;
  });
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
  return withMerchantCouponMutationLock(siteId, async () => {
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
    await mirrorSavedCouponChanges(supabase, [
      { current: next, previous: current },
    ]);
    return next;
  });
}

export async function archiveMerchantCouponRecord(input: { siteId: string; couponId: string }) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  const couponId = trimText(input.couponId);
  if (!siteId || !couponId) throw new Error("coupon_not_found");
  return withMerchantCouponMutationLock(siteId, async () => {
    const stored = await loadStoredMerchantCoupons(supabase, siteId);
    const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
    const index = coupons.findIndex((coupon) => coupon.id === couponId);
    if (index < 0) throw new Error("coupon_not_found");
    const previousCoupon = coupons[index];
    const archivedCoupon = updateMerchantCoupon(
      previousCoupon,
      {
        status: "archived",
        showOnWebsite: false,
        showOnContactCard: false,
      },
      coupons.filter((coupon) => coupon.id !== couponId).map((coupon) => coupon.code),
    );
    const updatedCoupons = [...coupons];
    updatedCoupons[index] = archivedCoupon;
    const saved = await saveStoredMerchantCoupons(supabase, {
      siteId,
      coupons: updatedCoupons,
      updatedAt: archivedCoupon.updatedAt,
      existingRowId: stored?.existingRowId ?? null,
    });
    if (saved.error) throw new Error(saved.error);
    await mirrorSavedCouponChanges(supabase, [
      { current: archivedCoupon, previous: previousCoupon },
    ]);
    return archivedCoupon;
  });
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
  return withMerchantCouponMutationLock(siteId, async () => {
    const stored = await loadStoredMerchantCoupons(supabase, siteId);
    const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
    const index = coupons.findIndex((coupon) => coupon.id === couponId);
    if (index < 0) throw new Error("coupon_not_found");
    const previousCoupon = coupons[index];
    const claimEvent = await input.beforeClaim?.(previousCoupon);
    const next = claimMerchantCoupon(previousCoupon, new Date(), claimEvent ?? undefined);
    const updatedCoupons = [...coupons];
    updatedCoupons[index] = next;
    const saved = await saveStoredMerchantCoupons(supabase, {
      siteId,
      coupons: updatedCoupons,
      updatedAt: next.updatedAt,
      existingRowId: stored?.existingRowId ?? null,
    });
    if (saved.error) throw new Error(saved.error);
    await mirrorSavedCouponChanges(supabase, [
      { current: next, previous: previousCoupon },
    ]);
    return next;
  });
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
      allowedDiscountTypes: redemption.allowedDiscountTypes,
      operationMarker: buildMutationOperationMarker(trimText(redemption.operationScope, 80) || "coupon-redeem", redemption.operationId),
    }))
    .filter((redemption) => {
      if (!redemption.settlementCode || seenSettlementCodes.has(redemption.settlementCode)) return false;
      seenSettlementCodes.add(redemption.settlementCode);
      return true;
    });
  if (redemptions.length === 0) throw new Error("invalid_settlement_code");
  return withMerchantCouponMutationLock(siteId, async () => {
    const stored = await loadStoredMerchantCoupons(supabase, siteId);
    const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
    const redeemedCoupons: MerchantCouponRecord[] = [];
    const shadowChanges: MerchantCouponShadowChange[] = [];
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
        redemption.expectedAccountId || redemption.expectedUserId,
      );
      const identityMatches = matchesMerchantCouponClaimExpectedIdentity(
        claimEvent,
        {
          accountId: redemption.expectedAccountId,
          userId: redemption.expectedUserId,
        },
      );
      if (hasExpectedIdentity && !identityMatches) throw new Error("coupon_claim_member_mismatch");
      const previousCoupon = coupons[index];
      const next = redeemMerchantCoupon(previousCoupon, {
        settlementCode: redemption.settlementCode,
        operatorId: redemption.operatorId,
        note: appendMutationOperationMarker(redemption.note, redemption.operationMarker),
      });
      coupons[index] = next;
      redeemedCoupons.push(next);
      shadowChanges.push({ current: next, previous: previousCoupon });
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
    await mirrorSavedCouponChanges(supabase, shadowChanges);
    return redeemedCoupons;
  });
}

export async function releaseMerchantCouponRedemptions(input: {
  siteId: string;
  redemptions: MerchantCouponRedeemRequest[];
}) {
  const supabase = requireCouponsStoreClient();
  const siteId = trimText(input.siteId);
  if (!siteId) throw new Error("coupon_not_found");
  const redemptions = (Array.isArray(input.redemptions) ? input.redemptions : [])
    .map((redemption) => ({
      settlementCode: trimText(redemption.settlementCode),
      expectedCouponId: trimText(redemption.expectedCouponId, 160),
      expectedClaimEventId: trimText(redemption.expectedClaimEventId, 160),
      operationMarker: buildMutationOperationMarker(
        trimText(redemption.operationScope, 80) || "coupon-redeem",
        redemption.operationId,
      ),
    }))
    .filter((redemption) => redemption.settlementCode);
  if (redemptions.length === 0) throw new Error("invalid_settlement_code");
  if (redemptions.some((redemption) => !redemption.operationMarker)) {
    throw new Error("mutation_operation_id_required");
  }

  return withMerchantCouponMutationLock(siteId, async () => {
    const stored = await loadStoredMerchantCoupons(supabase, siteId);
    const coupons = normalizeMerchantCouponRecords(stored?.coupons ?? []);
    const shadowChanges: MerchantCouponShadowChange[] = [];
    let changed = false;
    redemptions.forEach((redemption) => {
      const index = coupons.findIndex((coupon) =>
        coupon.claimEvents.some((event) => event.settlementCode === redemption.settlementCode),
      );
      if (index < 0) throw new Error("coupon_claim_not_found");
      const coupon = coupons[index];
      const claimEvent = coupon.claimEvents.find((event) => event.settlementCode === redemption.settlementCode);
      if (!claimEvent) throw new Error("coupon_claim_not_found");
      if (redemption.expectedCouponId && coupon.id !== redemption.expectedCouponId) {
        throw new Error("coupon_claim_not_found");
      }
      if (redemption.expectedClaimEventId && claimEvent.id !== redemption.expectedClaimEventId) {
        throw new Error("coupon_claim_not_found");
      }
      const release = releaseMerchantCouponRedemption(coupon, {
        settlementCode: redemption.settlementCode,
        operationMarker: redemption.operationMarker,
      });
      coupons[index] = release.coupon;
      changed = changed || !release.alreadyReleased;
      if (!release.alreadyReleased) {
        shadowChanges.push({
          current: release.coupon,
          previous: coupon,
        });
      }
    });
    if (!changed) return coupons;
    const saved = await saveStoredMerchantCoupons(supabase, {
      siteId,
      coupons,
      updatedAt: new Date().toISOString(),
      existingRowId: stored?.existingRowId ?? null,
    });
    if (saved.error) throw new Error(saved.error);
    await mirrorSavedCouponChanges(supabase, shadowChanges);
    return coupons;
  });
}
