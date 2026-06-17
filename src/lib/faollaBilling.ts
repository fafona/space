import {
  createDefaultMerchantPermissionConfig,
  normalizeMerchantPermissionConfig,
  type MerchantServicePermissionConfig,
} from "@/data/platformControlStore";

export const FAOLLA_SUBSCRIPTION_PLAN_KEYS = ["basic", "advanced", "pro"] as const;
export const FAOLLA_SUBSCRIPTION_INTERVALS = ["month", "year"] as const;
export const FAOLLA_SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;

export type FaollaSubscriptionPlanKey = (typeof FAOLLA_SUBSCRIPTION_PLAN_KEYS)[number];
export type FaollaSubscriptionInterval = (typeof FAOLLA_SUBSCRIPTION_INTERVALS)[number];
export type FaollaSubscriptionStatus = (typeof FAOLLA_SUBSCRIPTION_STATUSES)[number];

export type FaollaPlanEntitlements = {
  planKey: FaollaSubscriptionPlanKey;
  label: string;
  permissionConfig: MerchantServicePermissionConfig;
  allowPaymentModule: boolean;
  allowMerchantConnectPayments: boolean;
};

export type FaollaMerchantSubscription = {
  merchantId: string;
  planKey: FaollaSubscriptionPlanKey;
  billingInterval: FaollaSubscriptionInterval;
  status: FaollaSubscriptionStatus;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripeCheckoutSessionId: string;
  stripePriceId: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FaollaBillingEventRecord = {
  id: string;
  type: string;
  merchantId: string;
  processedAt: string;
};

function normalizeText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeFaollaSubscriptionPlanKey(value: unknown): FaollaSubscriptionPlanKey {
  const normalized = normalizeText(value, 40) as FaollaSubscriptionPlanKey;
  return FAOLLA_SUBSCRIPTION_PLAN_KEYS.includes(normalized) ? normalized : "basic";
}

export function normalizeFaollaSubscriptionInterval(value: unknown): FaollaSubscriptionInterval {
  const normalized = normalizeText(value, 20) as FaollaSubscriptionInterval;
  return FAOLLA_SUBSCRIPTION_INTERVALS.includes(normalized) ? normalized : "month";
}

export function normalizeFaollaSubscriptionStatus(value: unknown): FaollaSubscriptionStatus {
  const normalized = normalizeText(value, 40) as FaollaSubscriptionStatus;
  return FAOLLA_SUBSCRIPTION_STATUSES.includes(normalized) ? normalized : "incomplete";
}

function withPermissionPatch(patch: Partial<MerchantServicePermissionConfig>): MerchantServicePermissionConfig {
  return normalizeMerchantPermissionConfig({
    ...createDefaultMerchantPermissionConfig(),
    ...patch,
  });
}

export const FAOLLA_PLAN_ENTITLEMENTS: Record<FaollaSubscriptionPlanKey, FaollaPlanEntitlements> = {
  basic: {
    planKey: "basic",
    label: "Basic",
    permissionConfig: withPermissionPatch({
      planLimit: 1,
      pageLimit: 3,
      businessCardLimit: 1,
      allowBusinessCardLinkMode: true,
      allowButtonBlock: true,
      allowGalleryBlock: true,
      commonBlockImageLimitKb: 300,
      publishSizeLimitMb: 5,
    }),
    allowPaymentModule: false,
    allowMerchantConnectPayments: false,
  },
  advanced: {
    planKey: "advanced",
    label: "Advanced",
    permissionConfig: withPermissionPatch({
      planLimit: 3,
      pageLimit: 8,
      businessCardLimit: 3,
      allowBusinessCardLinkMode: true,
      allowBusinessCardIntroVideo: true,
      businessCardIntroVideoLimitMb: 20,
      allowBookingEmailPrefill: true,
      allowBookingAutoEmail: true,
      allowInsertBackground: true,
      allowThemeEffects: true,
      allowButtonBlock: true,
      allowGalleryBlock: true,
      allowMusicBlock: true,
      allowProductBlock: true,
      allowOrderManagement: true,
      allowCouponModule: true,
      allowCouponBlock: true,
      allowBookingBlock: true,
      publishSizeLimitMb: 20,
    }),
    allowPaymentModule: false,
    allowMerchantConnectPayments: false,
  },
  pro: {
    planKey: "pro",
    label: "Pro",
    permissionConfig: withPermissionPatch({
      planLimit: 10,
      pageLimit: 30,
      businessCardLimit: 10,
      allowBusinessCardLinkMode: true,
      allowBusinessCardIntroVideo: true,
      businessCardIntroVideoLimitMb: 80,
      businessCardBackgroundImageLimitKb: 1000,
      businessCardContactImageLimitKb: 1000,
      businessCardExportImageLimitKb: 1200,
      commonBlockImageLimitKb: 1000,
      galleryBlockImageLimitKb: 1000,
      allowBookingEmailPrefill: true,
      allowBookingAutoEmail: true,
      allowInsertBackground: true,
      allowThemeEffects: true,
      allowButtonBlock: true,
      allowGalleryBlock: true,
      allowMusicBlock: true,
      allowProductBlock: true,
      allowOrderManagement: true,
      allowCouponModule: true,
      allowCouponBlock: true,
      allowMembershipManagement: true,
      allowPointsRedemption: true,
      allowBookingBlock: true,
      publishSizeLimitMb: 80,
    }),
    allowPaymentModule: true,
    allowMerchantConnectPayments: true,
  },
};

export function getFaollaPlanEntitlements(planKey: unknown) {
  return FAOLLA_PLAN_ENTITLEMENTS[normalizeFaollaSubscriptionPlanKey(planKey)];
}

export function normalizeFaollaMerchantSubscription(value: unknown): FaollaMerchantSubscription | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<FaollaMerchantSubscription>;
  const merchantId = normalizeText(source.merchantId, 40);
  if (!/^\d{8}$/.test(merchantId)) return null;
  const createdAt = normalizeText(source.createdAt, 80) || new Date().toISOString();
  const updatedAt = normalizeText(source.updatedAt, 80) || createdAt;
  return {
    merchantId,
    planKey: normalizeFaollaSubscriptionPlanKey(source.planKey),
    billingInterval: normalizeFaollaSubscriptionInterval(source.billingInterval),
    status: normalizeFaollaSubscriptionStatus(source.status),
    stripeCustomerId: normalizeText(source.stripeCustomerId, 200),
    stripeSubscriptionId: normalizeText(source.stripeSubscriptionId, 200),
    stripeCheckoutSessionId: normalizeText(source.stripeCheckoutSessionId, 200),
    stripePriceId: normalizeText(source.stripePriceId, 200),
    currentPeriodStart: normalizeText(source.currentPeriodStart, 80) || null,
    currentPeriodEnd: normalizeText(source.currentPeriodEnd, 80) || null,
    cancelAtPeriodEnd: normalizeBoolean(source.cancelAtPeriodEnd),
    createdAt,
    updatedAt,
  };
}

export function normalizeFaollaBillingEventRecord(value: unknown): FaollaBillingEventRecord | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<FaollaBillingEventRecord>;
  const id = normalizeText(source.id, 200);
  if (!id) return null;
  return {
    id,
    type: normalizeText(source.type, 120),
    merchantId: normalizeText(source.merchantId, 40),
    processedAt: normalizeText(source.processedAt, 80) || new Date().toISOString(),
  };
}

export function isFaollaSubscriptionEntitled(
  subscription: FaollaMerchantSubscription | null | undefined,
  nowInput: Date | string = new Date(),
) {
  if (!subscription) return false;
  if (subscription.status === "active" || subscription.status === "trialing") return true;
  if (subscription.status !== "past_due") return false;
  if (!subscription.currentPeriodEnd) return false;
  const periodEnd = Date.parse(subscription.currentPeriodEnd);
  const now = nowInput instanceof Date ? nowInput.getTime() : Date.parse(nowInput);
  if (!Number.isFinite(periodEnd) || !Number.isFinite(now)) return false;
  const graceMs = 7 * 24 * 60 * 60 * 1000;
  return now <= periodEnd + graceMs;
}

export function resolveFaollaSubscriptionPermissionConfig(
  subscription: FaollaMerchantSubscription | null | undefined,
  nowInput: Date | string = new Date(),
) {
  if (!isFaollaSubscriptionEntitled(subscription, nowInput)) {
    return getFaollaPlanEntitlements("basic").permissionConfig;
  }
  return getFaollaPlanEntitlements(subscription?.planKey).permissionConfig;
}
