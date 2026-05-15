export const MERCHANT_COUPON_DISCOUNT_TYPES = ["amount_off", "percent_off", "threshold_amount_off"] as const;
export const MERCHANT_COUPON_STATUSES = ["active", "paused", "archived"] as const;

export type MerchantCouponDiscountType = (typeof MERCHANT_COUPON_DISCOUNT_TYPES)[number];
export type MerchantCouponStatus = (typeof MERCHANT_COUPON_STATUSES)[number];

export type MerchantCouponInput = {
  id?: string;
  siteId?: string;
  title?: string;
  code?: string;
  description?: string;
  discountType?: MerchantCouponDiscountType;
  discountValue?: number;
  minimumAmount?: number;
  maxDiscountAmount?: number;
  totalQuantity?: number;
  claimedCount?: number;
  usedCount?: number;
  perCustomerLimit?: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  status?: MerchantCouponStatus;
  showOnWebsite?: boolean;
  showOnContactCard?: boolean;
  applicableProductIds?: string[];
  applicableTags?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type MerchantCouponRecord = Required<
  Omit<MerchantCouponInput, "startsAt" | "expiresAt">
> & {
  startsAt: string | null;
  expiresAt: string | null;
};

export type MerchantCouponDiscountResult = {
  ok: boolean;
  discountAmount: number;
  payableAmount: number;
  reason: "ok" | "inactive" | "not_started" | "expired" | "out_of_stock" | "minimum_not_met" | "invalid_coupon";
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMoneyValue(value: unknown, fallback = 0) {
  const next = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Number(next.toFixed(2)));
}

function normalizePositiveInt(value: unknown, fallback = 0) {
  const next = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.round(next));
}

function normalizeIsoDateValue(value: unknown) {
  const raw = trimText(value);
  if (!raw) return null;
  const timestamp = new Date(raw).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimText(item)).filter(Boolean);
}

function normalizeCouponDiscountType(value: unknown): MerchantCouponDiscountType {
  return MERCHANT_COUPON_DISCOUNT_TYPES.includes(value as MerchantCouponDiscountType)
    ? (value as MerchantCouponDiscountType)
    : "amount_off";
}

function normalizeCouponStatus(value: unknown): MerchantCouponStatus {
  return MERCHANT_COUPON_STATUSES.includes(value as MerchantCouponStatus)
    ? (value as MerchantCouponStatus)
    : "active";
}

function normalizeCouponCode(value: unknown) {
  return trimText(value).replace(/\s+/g, "").toUpperCase();
}

export function createMerchantCouponId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `C${stamp}${random}`;
}

export function buildMerchantCouponCode(title: string, existingCodes: string[] = []) {
  const base =
    normalizeCouponCode(title)
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12) || "COUPON";
  const existing = new Set(existingCodes.map((item) => normalizeCouponCode(item)).filter(Boolean));
  if (!existing.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}${Date.now().toString(36).toUpperCase()}`;
}

export function normalizeMerchantCouponRecord(input: MerchantCouponInput | null | undefined): MerchantCouponRecord | null {
  const siteId = trimText(input?.siteId);
  const id = trimText(input?.id);
  if (!siteId || !id) return null;
  const now = new Date().toISOString();
  const discountType = normalizeCouponDiscountType(input?.discountType);
  const rawDiscountValue = normalizeMoneyValue(input?.discountValue);
  const discountValue = discountType === "percent_off" ? Math.min(100, rawDiscountValue) : rawDiscountValue;
  const minimumAmount =
    discountType === "threshold_amount_off"
      ? Math.max(0.01, normalizeMoneyValue(input?.minimumAmount))
      : normalizeMoneyValue(input?.minimumAmount);
  return {
    id,
    siteId,
    title: trimText(input?.title) || "优惠券",
    code: normalizeCouponCode(input?.code) || buildMerchantCouponCode(trimText(input?.title)),
    description: trimText(input?.description),
    discountType,
    discountValue,
    minimumAmount,
    maxDiscountAmount: normalizeMoneyValue(input?.maxDiscountAmount),
    totalQuantity: normalizePositiveInt(input?.totalQuantity),
    claimedCount: normalizePositiveInt(input?.claimedCount),
    usedCount: normalizePositiveInt(input?.usedCount),
    perCustomerLimit: normalizePositiveInt(input?.perCustomerLimit, 1),
    startsAt: normalizeIsoDateValue(input?.startsAt),
    expiresAt: normalizeIsoDateValue(input?.expiresAt),
    status: normalizeCouponStatus(input?.status),
    showOnWebsite: input?.showOnWebsite !== false,
    showOnContactCard: input?.showOnContactCard === true,
    applicableProductIds: normalizeStringArray(input?.applicableProductIds),
    applicableTags: normalizeStringArray(input?.applicableTags),
    createdAt: normalizeIsoDateValue(input?.createdAt) ?? now,
    updatedAt: normalizeIsoDateValue(input?.updatedAt) ?? now,
  };
}

export function normalizeMerchantCouponRecords(input: unknown): MerchantCouponRecord[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => normalizeMerchantCouponRecord(item as MerchantCouponInput))
    .filter((item): item is MerchantCouponRecord => Boolean(item))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function createMerchantCoupon(input: MerchantCouponInput, existingCodes: string[] = []) {
  const now = new Date().toISOString();
  const title = trimText(input.title) || "优惠券";
  const normalized = normalizeMerchantCouponRecord({
    ...input,
    id: trimText(input.id) || createMerchantCouponId(),
    title,
    code: normalizeCouponCode(input.code) || buildMerchantCouponCode(title, existingCodes),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  });
  if (!normalized) {
    throw new Error("invalid_coupon");
  }
  return normalized;
}

export function updateMerchantCoupon(
  current: MerchantCouponRecord,
  patch: MerchantCouponInput,
  existingCodes: string[] = [],
  now = new Date().toISOString(),
) {
  const nextCodeSource = patch.code === undefined ? current.code : patch.code;
  const nextTitle = patch.title === undefined ? current.title : patch.title;
  const nextCode =
    normalizeCouponCode(nextCodeSource) ||
    buildMerchantCouponCode(trimText(nextTitle) || current.title, existingCodes.filter((code) => normalizeCouponCode(code) !== current.code));
  const normalized = normalizeMerchantCouponRecord({
    ...current,
    ...patch,
    siteId: current.siteId,
    id: current.id,
    code: nextCode,
    createdAt: current.createdAt,
    updatedAt: now,
  });
  if (!normalized) throw new Error("invalid_coupon");
  return normalized;
}

export function isMerchantCouponCurrentlyUsable(coupon: MerchantCouponRecord, nowInput: Date | string = new Date()) {
  const now = nowInput instanceof Date ? nowInput.getTime() : new Date(nowInput).getTime();
  if (!Number.isFinite(now)) return false;
  if (coupon.status !== "active") return false;
  if (coupon.startsAt && Date.parse(coupon.startsAt) > now) return false;
  if (coupon.expiresAt && Date.parse(coupon.expiresAt) < now) return false;
  if (coupon.totalQuantity > 0 && coupon.usedCount >= coupon.totalQuantity) return false;
  return true;
}

export function getVisibleMerchantCoupons(coupons: MerchantCouponRecord[], nowInput: Date | string = new Date()) {
  return normalizeMerchantCouponRecords(coupons)
    .filter((coupon) => coupon.showOnWebsite && isMerchantCouponCurrentlyUsable(coupon, nowInput))
    .sort((left, right) => {
      const leftExpiry = left.expiresAt ? Date.parse(left.expiresAt) : Number.MAX_SAFE_INTEGER;
      const rightExpiry = right.expiresAt ? Date.parse(right.expiresAt) : Number.MAX_SAFE_INTEGER;
      if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
      return left.title.localeCompare(right.title, "zh-CN");
    });
}

function inactiveReason(coupon: MerchantCouponRecord, nowInput: Date | string): MerchantCouponDiscountResult["reason"] {
  const now = nowInput instanceof Date ? nowInput.getTime() : new Date(nowInput).getTime();
  if (coupon.status !== "active") return "inactive";
  if (coupon.startsAt && Date.parse(coupon.startsAt) > now) return "not_started";
  if (coupon.expiresAt && Date.parse(coupon.expiresAt) < now) return "expired";
  if (coupon.totalQuantity > 0 && coupon.usedCount >= coupon.totalQuantity) return "out_of_stock";
  return "ok";
}

export function calculateMerchantCouponDiscount(
  couponInput: MerchantCouponRecord | null | undefined,
  subtotalInput: number,
  nowInput: Date | string = new Date(),
): MerchantCouponDiscountResult {
  const subtotal = normalizeMoneyValue(subtotalInput);
  const fallback = {
    ok: false,
    discountAmount: 0,
    payableAmount: subtotal,
  };
  if (!couponInput) {
    return { ...fallback, reason: "invalid_coupon" };
  }
  const coupon = normalizeMerchantCouponRecord(couponInput);
  if (!coupon) {
    return { ...fallback, reason: "invalid_coupon" };
  }
  const reason = inactiveReason(coupon, nowInput);
  if (reason !== "ok") {
    return { ...fallback, reason };
  }
  if (subtotal < coupon.minimumAmount) {
    return { ...fallback, reason: "minimum_not_met" };
  }

  let discountAmount = 0;
  if (coupon.discountType === "percent_off") {
    discountAmount = normalizeMoneyValue((subtotal * coupon.discountValue) / 100);
    if (coupon.maxDiscountAmount > 0) {
      discountAmount = Math.min(discountAmount, coupon.maxDiscountAmount);
    }
  } else {
    discountAmount = coupon.discountValue;
  }

  discountAmount = Math.min(subtotal, normalizeMoneyValue(discountAmount));
  return {
    ok: discountAmount > 0,
    discountAmount,
    payableAmount: normalizeMoneyValue(subtotal - discountAmount),
    reason: discountAmount > 0 ? "ok" : "invalid_coupon",
  };
}

export function getMerchantCouponDiscountLabel(coupon: MerchantCouponRecord, pricePrefix = "") {
  if (coupon.discountType === "percent_off") {
    const percent = Number.isInteger(coupon.discountValue) ? coupon.discountValue.toFixed(0) : coupon.discountValue.toFixed(1);
    return `${percent}% OFF`;
  }
  const amount = `${pricePrefix}${coupon.discountValue.toFixed(2)}`;
  if (coupon.discountType === "threshold_amount_off" && coupon.minimumAmount > 0) {
    return `满 ${pricePrefix}${coupon.minimumAmount.toFixed(2)} 减 ${amount}`;
  }
  return `减 ${amount}`;
}
