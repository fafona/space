import { hasMutationOperationMarker } from "@/lib/mutationOperationId";
import { matchesExactPersonalIdentity } from "@/lib/personalAccountId";

export const MERCHANT_COUPON_DISCOUNT_TYPES = [
  "amount_off",
  "percent_off",
  "threshold_amount_off",
  "product_voucher",
  "stored_value",
  "exchange_voucher",
  "ticket_voucher",
  "points_voucher",
] as const;
export const MERCHANT_COUPON_STATUSES = ["active", "paused", "archived"] as const;
export const MERCHANT_COUPON_USAGE_SCENARIOS = ["order_cart", "checkout_qr", "checkout_barcode", "points_redemption"] as const;
export const MERCHANT_COUPON_DISPLAY_FIELDS = ["discount", "title", "description", "meta", "button"] as const;
export const MERCHANT_COUPON_DISPLAY_BOX_STYLES = ["none", "soft", "outline", "solid"] as const;
export const MERCHANT_COUPON_BEHAVIOR_TRIGGERS = [
  "favorite_site",
  "first_order",
  "purchase",
  "amount_reached",
  "count_reached",
  "check_in",
  "review",
  "share",
  "favorite_birthday",
  "specific_date",
] as const;
export const MERCHANT_COUPON_TASK_REQUIREMENTS = [
  "browse_page",
  "questionnaire",
  "contact_card_added",
  "watch_ad",
  "invite_people",
  "share_moments",
  "share_tiktok",
  "share_instagram",
] as const;

export type MerchantCouponDiscountType = (typeof MERCHANT_COUPON_DISCOUNT_TYPES)[number];
export const MERCHANT_COUPON_DIRECT_REDEMPTION_DISCOUNT_TYPES = [
  "product_voucher",
  "exchange_voucher",
  "ticket_voucher",
  "points_voucher",
] as const satisfies readonly MerchantCouponDiscountType[];
export type MerchantCouponDirectRedemptionDiscountType =
  (typeof MERCHANT_COUPON_DIRECT_REDEMPTION_DISCOUNT_TYPES)[number];
export type MerchantCouponStatus = (typeof MERCHANT_COUPON_STATUSES)[number];
export type MerchantCouponUsageScenario = (typeof MERCHANT_COUPON_USAGE_SCENARIOS)[number];
export type MerchantCouponDisplayField = (typeof MERCHANT_COUPON_DISPLAY_FIELDS)[number];
export type MerchantCouponDisplayBoxStyle = (typeof MERCHANT_COUPON_DISPLAY_BOX_STYLES)[number];
export type MerchantCouponBehaviorTrigger = (typeof MERCHANT_COUPON_BEHAVIOR_TRIGGERS)[number];
export type MerchantCouponTaskRequirement = (typeof MERCHANT_COUPON_TASK_REQUIREMENTS)[number];

export type MerchantCouponClaimEvent = {
  id: string;
  at: string;
  accountId: string;
  userId: string;
  email: string;
  code: string;
  customerName: string;
  settlementType: "qr" | "barcode";
  settlementCode: string;
  validUntil: string | null;
};

export type MerchantCouponRedeemEvent = {
  id: string;
  at: string;
  claimEventId: string;
  settlementCode: string;
  accountId: string;
  userId: string;
  operatorId: string;
  note: string;
};

export type MerchantCouponInput = {
  id?: string;
  siteId?: string;
  title?: string;
  code?: string;
  description?: string;
  discountType?: MerchantCouponDiscountType;
  discountValue?: number;
  minimumAmount?: number;
  pointsVoucherMaxPerRedemption?: number;
  pointsVoucherMinimumRedeemPoints?: number;
  productName?: string;
  productBarcode?: string;
  productQuantity?: number;
  productAmount?: number;
  exchangeItem?: string;
  exchangeQuantity?: number;
  ticketVenue?: string;
  ticketDurationMinutes?: number;
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
  backgroundImageUrl?: string;
  backgroundImageOpacity?: number;
  usageScenarios?: MerchantCouponUsageScenario[];
  displayTitle?: string;
  displayDescription?: string;
  displayDiscountText?: string;
  displayMetaText?: string;
  displayButtonText?: string;
  displayFieldOrder?: MerchantCouponDisplayField[];
  displayHiddenFields?: MerchantCouponDisplayField[];
  displayBoxStyles?: Partial<Record<MerchantCouponDisplayField, MerchantCouponDisplayBoxStyle>>;
  displayBoxColors?: Partial<Record<MerchantCouponDisplayField, string>>;
  contentFontFamily?: string;
  discountTextColor?: string;
  discountFontSize?: number;
  titleTextColor?: string;
  titleFontSize?: number;
  descriptionTextColor?: string;
  descriptionFontSize?: number;
  metaTextColor?: string;
  metaFontSize?: number;
  buttonTextColor?: string;
  buttonFontSize?: number;
  claimRequiresMember?: boolean;
  claimOldUserOnly?: boolean;
  claimMinRegisteredDays?: number;
  claimMinSpendAmount?: number;
  claimMinOrderCount?: number;
  claimAllowedAccountIds?: string[];
  claimAllowedCountries?: string[];
  claimAllowedProvinces?: string[];
  claimAllowedCities?: string[];
  claimAllowedCodes?: string[];
  claimPerUserTotalLimit?: number;
  claimPerUserDailyLimit?: number;
  claimPerUserWeeklyLimit?: number;
  claimPerUserMonthlyLimit?: number;
  claimDateTimeWindows?: string[];
  claimDailyTimeWindows?: string[];
  claimValidHoursAfterClaim?: number;
  claimValidDaysAfterClaim?: number;
  claimMonthlyStockLimit?: number;
  claimWeeklyStockLimit?: number;
  claimDailyStockLimit?: number;
  claimHourlyStockLimit?: number;
  claimBehaviorTriggers?: MerchantCouponBehaviorTrigger[];
  claimTriggerAmount?: number;
  claimTriggerCount?: number;
  claimTriggerDate?: string | null;
  claimTaskRequirements?: MerchantCouponTaskRequirement[];
  claimTaskPageUrl?: string;
  claimTaskInviteCount?: number;
  claimEvents?: MerchantCouponClaimEvent[];
  redeemEvents?: MerchantCouponRedeemEvent[];
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

function normalizeOpacityValue(value: unknown, fallback = 0.35) {
  const next = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(1, Number(next.toFixed(2))));
}

function normalizeFontSizeValue(value: unknown) {
  const next = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(next) || next <= 0) return 0;
  return Math.max(8, Math.min(72, Math.round(next)));
}

function normalizeColorValue(value: unknown) {
  const raw = trimText(value);
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(raw) ? raw : "";
}

function normalizeFontFamilyValue(value: unknown) {
  return trimText(value).replace(/[;{}<>]/g, "").slice(0, 120);
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

function normalizeUpperStringArray(value: unknown) {
  return normalizeStringArray(value).map((item) => item.toUpperCase());
}

function normalizeCouponDiscountType(value: unknown): MerchantCouponDiscountType {
  return MERCHANT_COUPON_DISCOUNT_TYPES.includes(value as MerchantCouponDiscountType)
    ? (value as MerchantCouponDiscountType)
    : "amount_off";
}

export function isMerchantCouponDirectRedemptionDiscountType(
  value: unknown,
): value is MerchantCouponDirectRedemptionDiscountType {
  return MERCHANT_COUPON_DIRECT_REDEMPTION_DISCOUNT_TYPES.includes(
    value as MerchantCouponDirectRedemptionDiscountType,
  );
}

function normalizeCouponStatus(value: unknown): MerchantCouponStatus {
  return MERCHANT_COUPON_STATUSES.includes(value as MerchantCouponStatus)
    ? (value as MerchantCouponStatus)
    : "active";
}

function normalizeCouponUsageScenarios(value: unknown): MerchantCouponUsageScenario[] {
  if (!Array.isArray(value)) return ["order_cart"];
  const scenarios = value.filter((item): item is MerchantCouponUsageScenario =>
    MERCHANT_COUPON_USAGE_SCENARIOS.includes(item as MerchantCouponUsageScenario),
  );
  return Array.from(new Set(scenarios)).length > 0 ? Array.from(new Set(scenarios)) : ["order_cart"];
}

function normalizeCouponDisplayFields(value: unknown, fallback: MerchantCouponDisplayField[] = [...MERCHANT_COUPON_DISPLAY_FIELDS]) {
  if (!Array.isArray(value)) return fallback;
  const fields = value.filter((item): item is MerchantCouponDisplayField =>
    MERCHANT_COUPON_DISPLAY_FIELDS.includes(item as MerchantCouponDisplayField),
  );
  const uniqueFields = Array.from(new Set(fields));
  return uniqueFields.length > 0 ? uniqueFields : fallback;
}

function normalizeCouponDisplayFieldOrder(value: unknown) {
  const fields = normalizeCouponDisplayFields(value);
  const next = [...fields];
  MERCHANT_COUPON_DISPLAY_FIELDS.forEach((field) => {
    if (!next.includes(field)) next.push(field);
  });
  return next;
}

function normalizeCouponDisplayBoxStyle(value: unknown, fallback: MerchantCouponDisplayBoxStyle = "none") {
  return MERCHANT_COUPON_DISPLAY_BOX_STYLES.includes(value as MerchantCouponDisplayBoxStyle)
    ? (value as MerchantCouponDisplayBoxStyle)
    : fallback;
}

function normalizeCouponDisplayBoxStyles(value: unknown): Record<MerchantCouponDisplayField, MerchantCouponDisplayBoxStyle> {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    discount: normalizeCouponDisplayBoxStyle(raw.discount, "none"),
    title: normalizeCouponDisplayBoxStyle(raw.title, "none"),
    description: normalizeCouponDisplayBoxStyle(raw.description, "none"),
    meta: normalizeCouponDisplayBoxStyle(raw.meta, "none"),
    button: normalizeCouponDisplayBoxStyle(raw.button, "solid"),
  };
}

function normalizeCouponDisplayBoxColors(value: unknown, fallback: Partial<Record<MerchantCouponDisplayField, unknown>> = {}) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const resolve = (field: MerchantCouponDisplayField, defaultColor: string) =>
    normalizeColorValue(raw[field]) || normalizeColorValue(fallback[field]) || defaultColor;
  return {
    discount: resolve("discount", "#f43f5e"),
    title: resolve("title", "#020617"),
    description: resolve("description", "#64748b"),
    meta: resolve("meta", "#64748b"),
    button: resolve("button", "#020617"),
  };
}

function normalizeCouponBehaviorTriggers(value: unknown): MerchantCouponBehaviorTrigger[] {
  if (!Array.isArray(value)) return [];
  const triggers = value.filter((item): item is MerchantCouponBehaviorTrigger =>
    MERCHANT_COUPON_BEHAVIOR_TRIGGERS.includes(item as MerchantCouponBehaviorTrigger),
  );
  return Array.from(new Set(triggers));
}

function normalizeCouponTaskRequirements(value: unknown): MerchantCouponTaskRequirement[] {
  if (!Array.isArray(value)) return [];
  const tasks = value.filter((item): item is MerchantCouponTaskRequirement =>
    MERCHANT_COUPON_TASK_REQUIREMENTS.includes(item as MerchantCouponTaskRequirement),
  );
  return Array.from(new Set(tasks));
}

function normalizeCouponClaimEvents(value: unknown): MerchantCouponClaimEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const at = normalizeIsoDateValue(raw.at);
      if (!at) return null;
      return {
        id: trimText(raw.id) || `CE${Date.parse(at).toString(36).toUpperCase()}`,
        at,
        accountId: trimText(raw.accountId),
        userId: trimText(raw.userId),
        email: trimText(raw.email).toLowerCase(),
        code: normalizeMerchantCouponClaimCode(raw.code),
        customerName: trimText(raw.customerName),
        settlementType: raw.settlementType === "barcode" ? "barcode" : "qr",
        settlementCode: trimText(raw.settlementCode),
        validUntil: normalizeIsoDateValue(raw.validUntil),
      };
    })
    .filter((item): item is MerchantCouponClaimEvent => Boolean(item))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 5000);
}

function normalizeCouponRedeemEvents(value: unknown): MerchantCouponRedeemEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as Record<string, unknown>;
      const at = normalizeIsoDateValue(raw.at);
      if (!at) return null;
      return {
        id: trimText(raw.id) || `RE${Date.parse(at).toString(36).toUpperCase()}`,
        at,
        claimEventId: trimText(raw.claimEventId),
        settlementCode: trimText(raw.settlementCode),
        accountId: trimText(raw.accountId),
        userId: trimText(raw.userId),
        operatorId: trimText(raw.operatorId),
        note: trimText(raw.note).slice(0, 500),
      };
    })
    .filter((item): item is MerchantCouponRedeemEvent => Boolean(item))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 5000);
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
  const discountValue =
    discountType === "percent_off"
      ? Math.min(100, rawDiscountValue)
      : discountType === "points_voucher"
        ? normalizePositiveInt(input?.discountValue)
        : rawDiscountValue;
  const minimumAmount =
    discountType === "threshold_amount_off"
      ? Math.max(0.01, normalizeMoneyValue(input?.minimumAmount))
      : normalizeMoneyValue(input?.minimumAmount);
  const pointsVoucherMaxPerRedemption =
    discountType === "points_voucher" ? normalizePositiveInt(input?.pointsVoucherMaxPerRedemption) : 0;
  const pointsVoucherMinimumRedeemPoints =
    discountType === "points_voucher" ? normalizePositiveInt(input?.pointsVoucherMinimumRedeemPoints) : 0;
  return {
    id,
    siteId,
    title: trimText(input?.title) || "优惠券",
    code: normalizeCouponCode(input?.code) || buildMerchantCouponCode(trimText(input?.title)),
    description: trimText(input?.description),
    discountType,
    discountValue,
    minimumAmount,
    pointsVoucherMaxPerRedemption,
    pointsVoucherMinimumRedeemPoints,
    productName: trimText(input?.productName),
    productBarcode: trimText(input?.productBarcode),
    productQuantity: normalizePositiveInt(input?.productQuantity),
    productAmount: normalizeMoneyValue(input?.productAmount),
    exchangeItem: trimText(input?.exchangeItem),
    exchangeQuantity: normalizePositiveInt(input?.exchangeQuantity),
    ticketVenue: trimText(input?.ticketVenue),
    ticketDurationMinutes: normalizePositiveInt(input?.ticketDurationMinutes),
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
    backgroundImageUrl: trimText(input?.backgroundImageUrl),
    backgroundImageOpacity: normalizeOpacityValue(input?.backgroundImageOpacity),
    usageScenarios: normalizeCouponUsageScenarios(input?.usageScenarios),
    displayTitle: trimText(input?.displayTitle),
    displayDescription: trimText(input?.displayDescription),
    displayDiscountText: trimText(input?.displayDiscountText),
    displayMetaText: trimText(input?.displayMetaText),
    displayButtonText: trimText(input?.displayButtonText) || "立即领取",
    displayFieldOrder: normalizeCouponDisplayFieldOrder(input?.displayFieldOrder),
    displayHiddenFields: normalizeCouponDisplayFields(input?.displayHiddenFields, []),
    displayBoxStyles: normalizeCouponDisplayBoxStyles(input?.displayBoxStyles),
    displayBoxColors: normalizeCouponDisplayBoxColors(input?.displayBoxColors, {
      discount: input?.discountTextColor,
      title: input?.titleTextColor,
      description: input?.descriptionTextColor,
      meta: input?.metaTextColor,
      button: input?.buttonTextColor,
    }),
    contentFontFamily: normalizeFontFamilyValue(input?.contentFontFamily),
    discountTextColor: normalizeColorValue(input?.discountTextColor),
    discountFontSize: normalizeFontSizeValue(input?.discountFontSize),
    titleTextColor: normalizeColorValue(input?.titleTextColor),
    titleFontSize: normalizeFontSizeValue(input?.titleFontSize),
    descriptionTextColor: normalizeColorValue(input?.descriptionTextColor),
    descriptionFontSize: normalizeFontSizeValue(input?.descriptionFontSize),
    metaTextColor: normalizeColorValue(input?.metaTextColor),
    metaFontSize: normalizeFontSizeValue(input?.metaFontSize),
    buttonTextColor:
      input?.displayBoxColors === undefined && normalizeColorValue(input?.buttonTextColor)
        ? "#ffffff"
        : normalizeColorValue(input?.buttonTextColor) || "#ffffff",
    buttonFontSize: normalizeFontSizeValue(input?.buttonFontSize),
    claimRequiresMember: input?.claimRequiresMember === true,
    claimOldUserOnly: input?.claimOldUserOnly === true,
    claimMinRegisteredDays: normalizePositiveInt(input?.claimMinRegisteredDays),
    claimMinSpendAmount: normalizeMoneyValue(input?.claimMinSpendAmount),
    claimMinOrderCount: normalizePositiveInt(input?.claimMinOrderCount),
    claimAllowedAccountIds: normalizeStringArray(input?.claimAllowedAccountIds),
    claimAllowedCountries: normalizeStringArray(input?.claimAllowedCountries),
    claimAllowedProvinces: normalizeStringArray(input?.claimAllowedProvinces),
    claimAllowedCities: normalizeStringArray(input?.claimAllowedCities),
    claimAllowedCodes: normalizeUpperStringArray(input?.claimAllowedCodes),
    claimPerUserTotalLimit: normalizePositiveInt(input?.claimPerUserTotalLimit),
    claimPerUserDailyLimit: normalizePositiveInt(input?.claimPerUserDailyLimit),
    claimPerUserWeeklyLimit: normalizePositiveInt(input?.claimPerUserWeeklyLimit),
    claimPerUserMonthlyLimit: normalizePositiveInt(input?.claimPerUserMonthlyLimit),
    claimDateTimeWindows: normalizeStringArray(input?.claimDateTimeWindows),
    claimDailyTimeWindows: normalizeStringArray(input?.claimDailyTimeWindows),
    claimValidHoursAfterClaim: normalizePositiveInt(input?.claimValidHoursAfterClaim),
    claimValidDaysAfterClaim: normalizePositiveInt(input?.claimValidDaysAfterClaim),
    claimMonthlyStockLimit: normalizePositiveInt(input?.claimMonthlyStockLimit),
    claimWeeklyStockLimit: normalizePositiveInt(input?.claimWeeklyStockLimit),
    claimDailyStockLimit: normalizePositiveInt(input?.claimDailyStockLimit),
    claimHourlyStockLimit: normalizePositiveInt(input?.claimHourlyStockLimit),
    claimBehaviorTriggers: normalizeCouponBehaviorTriggers(input?.claimBehaviorTriggers),
    claimTriggerAmount: normalizeMoneyValue(input?.claimTriggerAmount),
    claimTriggerCount: normalizePositiveInt(input?.claimTriggerCount),
    claimTriggerDate: normalizeIsoDateValue(input?.claimTriggerDate),
    claimTaskRequirements: normalizeCouponTaskRequirements(input?.claimTaskRequirements),
    claimTaskPageUrl: trimText(input?.claimTaskPageUrl).slice(0, 1200),
    claimTaskInviteCount: normalizePositiveInt(input?.claimTaskInviteCount),
    claimEvents: normalizeCouponClaimEvents(input?.claimEvents),
    redeemEvents: normalizeCouponRedeemEvents(input?.redeemEvents),
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
  if (getMerchantCouponRemainingCount(coupon) === 0) return false;
  return true;
}

export function getMerchantCouponRemainingCount(coupon: MerchantCouponRecord) {
  if (coupon.totalQuantity <= 0) return null;
  return Math.max(0, coupon.totalQuantity - Math.max(coupon.claimedCount, coupon.usedCount));
}

export function merchantCouponSupportsUsageScenario(
  coupon: MerchantCouponRecord,
  scenario: MerchantCouponUsageScenario,
) {
  return normalizeCouponUsageScenarios(coupon.usageScenarios).includes(scenario);
}

export function buildMerchantCouponSettlementCode(
  coupon: MerchantCouponRecord,
  scenario: Extract<MerchantCouponUsageScenario, "checkout_qr" | "checkout_barcode">,
  sequenceInput = Math.max(1, coupon.claimedCount, coupon.usedCount),
  codeOverride = "",
) {
  const prefix = scenario === "checkout_qr" ? "QR" : "BAR";
  const sitePart = coupon.siteId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || "SITE";
  const overridePart = trimText(codeOverride).replace(/[^a-z0-9]/gi, "").slice(0, 16).toUpperCase();
  const couponPart = overridePart || coupon.id.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || coupon.code.slice(0, 8) || "COUPON";
  const sequence = Math.max(1, Math.round(sequenceInput));
  return `${prefix}${sitePart}${couponPart}${String(sequence).padStart(4, "0")}`;
}

export function buildMerchantCouponClaimValidUntil(coupon: MerchantCouponRecord, claimedAtInput: Date | string = new Date()) {
  const claimedAt = claimedAtInput instanceof Date ? claimedAtInput.getTime() : Date.parse(claimedAtInput);
  if (!Number.isFinite(claimedAt)) return null;
  const candidates = [
    coupon.claimValidHoursAfterClaim > 0 ? claimedAt + coupon.claimValidHoursAfterClaim * 3_600_000 : null,
    coupon.claimValidDaysAfterClaim > 0 ? claimedAt + coupon.claimValidDaysAfterClaim * 86_400_000 : null,
  ].filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates)).toISOString();
}

export function claimMerchantCoupon(
  coupon: MerchantCouponRecord,
  nowInput: Date | string = new Date(),
  claimEvent: Partial<MerchantCouponClaimEvent> = {},
) {
  if (!isMerchantCouponCurrentlyUsable(coupon, nowInput)) {
    throw new Error("coupon_not_claimable");
  }
  const now = nowInput instanceof Date ? nowInput.toISOString() : normalizeIsoDateValue(nowInput) ?? new Date().toISOString();
  const event: MerchantCouponClaimEvent = {
    id: trimText(claimEvent.id) || `CE${Date.parse(now).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    at: now,
    accountId: trimText(claimEvent.accountId),
    userId: trimText(claimEvent.userId),
    email: trimText(claimEvent.email).toLowerCase(),
    code: normalizeMerchantCouponClaimCode(claimEvent.code),
    customerName: trimText(claimEvent.customerName),
    settlementType: claimEvent.settlementType === "barcode" ? "barcode" : "qr",
    settlementCode: trimText(claimEvent.settlementCode),
    validUntil: normalizeIsoDateValue(claimEvent.validUntil) ?? buildMerchantCouponClaimValidUntil(coupon, now),
  };
  return updateMerchantCoupon(
    coupon,
    {
      claimedCount: coupon.claimedCount + 1,
      claimEvents: [event, ...coupon.claimEvents].slice(0, 5000),
    },
    [coupon.code],
    now,
  );
}

export function redeemMerchantCoupon(
  coupon: MerchantCouponRecord,
  input: {
    settlementCode: string;
    operatorId?: string;
    note?: string;
    now?: Date | string;
  },
) {
  const settlementCode = trimText(input.settlementCode);
  if (!settlementCode) throw new Error("invalid_settlement_code");
  const now = input.now instanceof Date ? input.now.toISOString() : normalizeIsoDateValue(input.now) ?? new Date().toISOString();
  const nowTime = Date.parse(now);
  if (coupon.status !== "active") throw new Error("coupon_not_active");
  const startsAtTime = coupon.startsAt ? Date.parse(coupon.startsAt) : Number.NaN;
  if (Number.isFinite(startsAtTime) && startsAtTime > nowTime) throw new Error("coupon_not_started");
  const expiresAtTime = coupon.expiresAt ? Date.parse(coupon.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAtTime) && expiresAtTime < nowTime) throw new Error("coupon_expired");
  const claimEvent = coupon.claimEvents.find((event) => event.settlementCode === settlementCode);
  if (!claimEvent) throw new Error("coupon_claim_not_found");
  if (coupon.redeemEvents.some((event) => event.settlementCode === settlementCode || event.claimEventId === claimEvent.id)) {
    throw new Error("coupon_already_redeemed");
  }
  const claimValidUntilTime = claimEvent.validUntil ? Date.parse(claimEvent.validUntil) : Number.NaN;
  if (Number.isFinite(claimValidUntilTime) && claimValidUntilTime < nowTime) throw new Error("coupon_claim_expired");
  const redeemEvent: MerchantCouponRedeemEvent = {
    id: `RE${Date.parse(now).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    at: now,
    claimEventId: claimEvent.id,
    settlementCode,
    accountId: claimEvent.accountId,
    userId: claimEvent.userId,
    operatorId: trimText(input.operatorId),
    note: trimText(input.note).slice(0, 500),
  };
  return updateMerchantCoupon(
    coupon,
    {
      usedCount: coupon.usedCount + 1,
      redeemEvents: [redeemEvent, ...coupon.redeemEvents].slice(0, 5000),
    },
    [coupon.code],
    now,
  );
}

export function releaseMerchantCouponRedemption(
  coupon: MerchantCouponRecord,
  input: { settlementCode: string; operationMarker: string; now?: Date | string },
) {
  const settlementCode = trimText(input.settlementCode);
  const operationMarker = trimText(input.operationMarker);
  if (!settlementCode) throw new Error("invalid_settlement_code");
  if (!operationMarker) throw new Error("mutation_operation_id_required");
  const claimEvent = coupon.claimEvents.find((event) => event.settlementCode === settlementCode);
  if (!claimEvent) throw new Error("coupon_claim_not_found");
  const redeemEvent = coupon.redeemEvents.find(
    (event) => event.settlementCode === settlementCode || event.claimEventId === claimEvent.id,
  );
  if (!redeemEvent) return { coupon, alreadyReleased: true };
  if (!hasMutationOperationMarker(redeemEvent.note, operationMarker)) {
    throw new Error("coupon_redemption_rollback_conflict");
  }
  const now = input.now instanceof Date ? input.now.toISOString() : normalizeIsoDateValue(input.now) ?? new Date().toISOString();
  return {
    alreadyReleased: false,
    coupon: updateMerchantCoupon(
      coupon,
      {
        usedCount: Math.max(0, coupon.usedCount - 1),
        redeemEvents: coupon.redeemEvents.filter((event) => event.id !== redeemEvent.id),
      },
      [coupon.code],
      now,
    ),
  };
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

export function getContactCardVisibleMerchantCoupons(coupons: MerchantCouponRecord[], nowInput: Date | string = new Date()) {
  return normalizeMerchantCouponRecords(coupons)
    .filter((coupon) => coupon.showOnContactCard && isMerchantCouponCurrentlyUsable(coupon, nowInput))
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
  if (getMerchantCouponRemainingCount(coupon) === 0) return "out_of_stock";
  return "ok";
}

export function calculateMerchantCouponDiscount(
  couponInput: MerchantCouponRecord | null | undefined,
  subtotalInput: number,
  nowInput: Date | string = new Date(),
  scenario: MerchantCouponUsageScenario = "order_cart",
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
  if (!merchantCouponSupportsUsageScenario(coupon, scenario)) {
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
  } else if (
    coupon.discountType === "amount_off" ||
    coupon.discountType === "threshold_amount_off" ||
    coupon.discountType === "stored_value"
  ) {
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
  const customText = trimText(coupon.displayDiscountText);
  if (customText) return customText;
  if (coupon.discountType === "percent_off") {
    const percent = Number.isInteger(coupon.discountValue) ? coupon.discountValue.toFixed(0) : coupon.discountValue.toFixed(1);
    return `${percent}% OFF`;
  }
  if (coupon.discountType === "product_voucher") return coupon.productName ? `商品券：${coupon.productName}` : "商品券";
  if (coupon.discountType === "exchange_voucher") return coupon.exchangeItem ? `兑换券：${coupon.exchangeItem}` : "兑换券";
  if (coupon.discountType === "ticket_voucher") return coupon.ticketVenue ? `门票券：${coupon.ticketVenue}` : "门票券";
  if (coupon.discountType === "points_voucher") return `积分券：抵扣 ${Math.max(0, Math.round(coupon.discountValue))} 积分`;
  const amount = `${pricePrefix}${coupon.discountValue.toFixed(2)}`;
  if (coupon.discountType === "stored_value") return `储值 ${amount}`;
  if (coupon.discountType === "threshold_amount_off" && coupon.minimumAmount > 0) {
    return `满 ${pricePrefix}${coupon.minimumAmount.toFixed(2)} 减 ${amount}`;
  }
  return `减 ${amount}`;
}

export function getMerchantCouponDisplayTitle(coupon: MerchantCouponRecord) {
  return trimText(coupon.displayTitle) || coupon.title;
}

export function getMerchantCouponDisplayDescription(coupon: MerchantCouponRecord) {
  return trimText(coupon.displayDescription) || coupon.description;
}

export function getMerchantCouponDisplayMetaText(coupon: MerchantCouponRecord) {
  return trimText(coupon.displayMetaText);
}

export function getMerchantCouponDisplayButtonText(coupon: MerchantCouponRecord) {
  return trimText(coupon.displayButtonText) || "立即领取";
}

export function getMerchantCouponDisplayFieldOrder(coupon: MerchantCouponRecord) {
  return normalizeCouponDisplayFieldOrder(coupon.displayFieldOrder);
}

export function isMerchantCouponDisplayFieldHidden(coupon: MerchantCouponRecord, field: MerchantCouponDisplayField) {
  return normalizeCouponDisplayFields(coupon.displayHiddenFields, []).includes(field);
}

export function getMerchantCouponDisplayBoxStyle(coupon: MerchantCouponRecord, field: MerchantCouponDisplayField) {
  return normalizeCouponDisplayBoxStyles(coupon.displayBoxStyles)[field];
}

export function getMerchantCouponDisplayBoxColor(coupon: MerchantCouponRecord, field: MerchantCouponDisplayField) {
  return normalizeCouponDisplayBoxColors(coupon.displayBoxColors, {
    discount: coupon.discountTextColor,
    title: coupon.titleTextColor,
    description: coupon.descriptionTextColor,
    meta: coupon.metaTextColor,
    button: coupon.buttonTextColor,
  })[field];
}

export function merchantCouponRequiresPersonalClaim(coupon: MerchantCouponRecord) {
  return Boolean(
    coupon.claimRequiresMember ||
      coupon.claimOldUserOnly ||
      coupon.claimMinRegisteredDays > 0 ||
      coupon.claimMinSpendAmount > 0 ||
      coupon.claimMinOrderCount > 0 ||
      coupon.claimAllowedAccountIds.length > 0 ||
      coupon.claimAllowedCountries.length > 0 ||
      coupon.claimAllowedProvinces.length > 0 ||
      coupon.claimAllowedCities.length > 0 ||
      coupon.claimPerUserTotalLimit > 0 ||
      coupon.claimPerUserDailyLimit > 0 ||
      coupon.claimPerUserWeeklyLimit > 0 ||
      coupon.claimPerUserMonthlyLimit > 0,
  );
}

export function hasActiveMerchantMembershipForCouponClaim(
  memberships: Array<{
    status?: unknown;
    accountId?: unknown;
    userId?: unknown;
    email?: unknown;
  }>,
  identity: { accountId?: unknown; userId?: unknown; email?: unknown },
) {
  return memberships.some((membership) => {
    if (membership.status !== "active") return false;
    return matchesExactPersonalIdentity(
      { accountId: membership.accountId, userId: membership.userId },
      identity,
    );
  });
}

export function isMerchantCouponOldUserEligible(coupon: MerchantCouponRecord, userCreatedAt: unknown) {
  if (!coupon.claimOldUserOnly) return true;
  const userCreatedTimestamp = Date.parse(trimText(userCreatedAt));
  const couponCreatedTimestamp = Date.parse(trimText(coupon.createdAt));
  return (
    Number.isFinite(userCreatedTimestamp) &&
    Number.isFinite(couponCreatedTimestamp) &&
    userCreatedTimestamp <= couponCreatedTimestamp
  );
}

export function toPublicMerchantCouponRecord(coupon: MerchantCouponRecord): MerchantCouponRecord {
  return {
    ...coupon,
    claimAllowedAccountIds: coupon.claimAllowedAccountIds.length > 0 ? ["__restricted__"] : [],
    claimAllowedCodes: coupon.claimAllowedCodes.length > 0 ? ["__required__"] : [],
    claimEvents: [],
    redeemEvents: [],
  };
}

export function merchantCouponRequiresClaimCode(coupon: MerchantCouponRecord) {
  return coupon.claimAllowedCodes.length > 0;
}

export function normalizeMerchantCouponClaimCode(value: unknown) {
  return trimText(value).replace(/\s+/g, "").toUpperCase();
}
