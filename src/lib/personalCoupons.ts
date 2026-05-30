import {
  getMerchantCouponDiscountLabel,
  getMerchantCouponDisplayDescription,
  getMerchantCouponDisplayTitle,
  type MerchantCouponClaimEvent,
  type MerchantCouponRecord,
} from "@/lib/merchantCoupons";

export type PersonalClaimedCoupon = {
  id: string;
  siteId: string;
  siteName: string;
  couponId: string;
  couponTitle: string;
  couponDescription: string;
  discountLabel: string;
  claimEventId: string;
  claimedAt: string;
  validUntil: string | null;
  settlementType: "qr" | "barcode";
  settlementCode: string;
  pageUrl: string;
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeIsoDateValue(value: unknown) {
  const raw = trimText(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function normalizePersonalClaimedCoupon(value: unknown): PersonalClaimedCoupon | null {
  const record = readRecord(value);
  if (!record) return null;
  const siteId = trimText(record.siteId);
  const couponId = trimText(record.couponId);
  const claimEventId = trimText(record.claimEventId);
  const claimedAt = normalizeIsoDateValue(record.claimedAt);
  const settlementCode = trimText(record.settlementCode);
  if (!siteId || !couponId || !claimEventId || !claimedAt || !settlementCode) return null;
  return {
    id: trimText(record.id) || `${siteId}:${couponId}:${claimEventId}`,
    siteId,
    siteName: trimText(record.siteName, 120) || siteId,
    couponId,
    couponTitle: trimText(record.couponTitle, 120) || "Coupon",
    couponDescription: trimText(record.couponDescription, 1000),
    discountLabel: trimText(record.discountLabel, 200),
    claimEventId,
    claimedAt,
    validUntil: normalizeIsoDateValue(record.validUntil),
    settlementType: record.settlementType === "barcode" ? "barcode" : "qr",
    settlementCode,
    pageUrl: trimText(record.pageUrl, 1200),
  };
}

export function normalizePersonalClaimedCoupons(value: unknown): PersonalClaimedCoupon[] {
  if (!Array.isArray(value)) return [];
  const map = new Map<string, PersonalClaimedCoupon>();
  value.forEach((item) => {
    const coupon = normalizePersonalClaimedCoupon(item);
    if (!coupon) return;
    map.set(coupon.id, coupon);
  });
  return Array.from(map.values()).sort((left, right) => Date.parse(right.claimedAt) - Date.parse(left.claimedAt));
}

export function buildPersonalClaimedCoupon(input: {
  coupon: MerchantCouponRecord;
  claimEvent: MerchantCouponClaimEvent;
  siteName: string;
  pageUrl: string;
  pricePrefix?: string;
}): PersonalClaimedCoupon {
  const { coupon, claimEvent } = input;
  return {
    id: `${coupon.siteId}:${coupon.id}:${claimEvent.id}`,
    siteId: coupon.siteId,
    siteName: trimText(input.siteName, 120) || coupon.siteId,
    couponId: coupon.id,
    couponTitle: getMerchantCouponDisplayTitle(coupon),
    couponDescription: getMerchantCouponDisplayDescription(coupon),
    discountLabel: getMerchantCouponDiscountLabel(coupon, input.pricePrefix ?? ""),
    claimEventId: claimEvent.id,
    claimedAt: claimEvent.at,
    validUntil: claimEvent.validUntil,
    settlementType: claimEvent.settlementType,
    settlementCode: claimEvent.settlementCode,
    pageUrl: trimText(input.pageUrl, 1200),
  };
}

export function readPersonalClaimedCouponsFromUserMetadata(userMetadata: Record<string, unknown> | null | undefined) {
  const profile = readRecord(userMetadata?.personal_profile) ?? {};
  return normalizePersonalClaimedCoupons(profile.coupons);
}

export function writePersonalClaimedCouponToUserMetadata(
  userMetadata: Record<string, unknown> | null | undefined,
  claimedCoupon: PersonalClaimedCoupon,
) {
  const nextMetadata = userMetadata && typeof userMetadata === "object" ? { ...userMetadata } : {};
  const profile = readRecord(nextMetadata.personal_profile) ? { ...(nextMetadata.personal_profile as Record<string, unknown>) } : {};
  const current = normalizePersonalClaimedCoupons(profile.coupons);
  profile.coupons = [claimedCoupon, ...current.filter((item) => item.id !== claimedCoupon.id)].slice(0, 500);
  nextMetadata.personal_profile = profile;
  return nextMetadata;
}
