export type MerchantMemberSettingsView =
  | "list"
  | "rechargePlans"
  | "redemptionCategories"
  | "redemptionItems"
  | "levels"
  | "pointsRules";

export const MERCHANT_MEMBER_HOLIDAY_OPTIONS = [
  "元旦",
  "春节",
  "情人节",
  "妇女节",
  "劳动节",
  "端午节",
  "七夕",
  "中秋节",
  "国庆节",
  "万圣节",
  "黑五",
  "圣诞节",
] as const;

export type MerchantMemberRechargePlan = {
  id: string;
  title: string;
  enabled: boolean;
  rechargeAmount: number;
  giftAmount: number;
  giftPoints: number;
  sort: number;
};

export type MerchantMemberRedemptionCategory = {
  id: string;
  name: string;
  enabled: boolean;
  sort: number;
};

export type MerchantMemberRedemptionItem = {
  id: string;
  categoryId: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  pointsCost: number;
  referenceAmount: number;
  stock: number;
  sort: number;
};

export type MerchantMemberGrowthRules = {
  spendAmountGrowth: number;
  rechargeAmountGrowth: number;
  rechargePointGrowth: number;
  spendPointGrowth: number;
  annualRecalculate: boolean;
};

export type MerchantMemberLevelBenefit = {
  pointDiscount: string;
  oneTimeGiftPoints: number;
  oneTimeGiftItem: string;
  oneTimeGiftProduct: string;
  recurringGiftPoints: number;
  recurringGiftItem: string;
  recurringGiftProduct: string;
  birthdayGiftPoints: number;
  birthdayGiftItem: string;
  birthdayGiftProduct: string;
  servicePriority: boolean;
  inStoreService: boolean;
  dedicatedSupport: boolean;
  nextYearKeepLevel: boolean;
};

export type MerchantMemberLevel = {
  id: string;
  name: string;
  requiredGrowthValue: number;
  benefit: MerchantMemberLevelBenefit;
  enabled: boolean;
  sort: number;
};

export type MerchantMemberPointsRules = {
  paidAmount: number;
  paidPoints: number;
  joinPoints: number;
  checkinPoints: number;
  continuousCheckinPoints: number;
  birthdayPoints: number;
  invitationPoints: number;
  reviewPoints: number;
  holidayNames: string[];
  holidayMultiplier: number;
  deductionAmountPerPoint: number;
  deductionMinOrderAmount: number;
  deductionMaxAmount: number;
  deductionMaxPercent: number;
  pointsNeverExpire: boolean;
  pointsValidDays: number;
};

export type MerchantMembershipSettings = {
  siteId: string;
  rechargePlans: MerchantMemberRechargePlan[];
  redemptionCategories: MerchantMemberRedemptionCategory[];
  redemptionItems: MerchantMemberRedemptionItem[];
  growthRules: MerchantMemberGrowthRules;
  levels: MerchantMemberLevel[];
  pointsRules: MerchantMemberPointsRules;
  updatedAt: string | null;
};

export function calculateMerchantMemberPointDeduction(input: {
  orderAmount: number;
  pointBalance: number;
  requestedPoints: number;
  settings: MerchantMembershipSettings;
}) {
  const orderAmount = normalizeMoney(input.orderAmount);
  const pointBalance = normalizeInteger(input.pointBalance);
  const requestedPoints = normalizeInteger(input.requestedPoints);
  const rules = input.settings.pointsRules;
  const amountPerPoint = normalizeMoney(rules.deductionAmountPerPoint);
  if (orderAmount <= 0 || pointBalance <= 0 || requestedPoints <= 0 || amountPerPoint <= 0) {
    return { points: 0, amount: 0, maxPoints: 0, maxAmount: 0 };
  }
  if (rules.deductionMinOrderAmount > 0 && orderAmount < rules.deductionMinOrderAmount) {
    return { points: 0, amount: 0, maxPoints: 0, maxAmount: 0 };
  }
  const percentLimitAmount =
    rules.deductionMaxPercent > 0 ? Number(((orderAmount * rules.deductionMaxPercent) / 100).toFixed(2)) : orderAmount;
  const amountLimit = Math.min(
    orderAmount,
    percentLimitAmount,
    rules.deductionMaxAmount > 0 ? rules.deductionMaxAmount : orderAmount,
  );
  const maxPointsByAmount = Math.floor(amountLimit / amountPerPoint);
  const maxPoints = Math.max(0, Math.min(pointBalance, maxPointsByAmount));
  const points = Math.min(requestedPoints, maxPoints);
  return {
    points,
    amount: Number((points * amountPerPoint).toFixed(2)),
    maxPoints,
    maxAmount: Number((maxPoints * amountPerPoint).toFixed(2)),
  };
}

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeMoney(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Number(numberValue.toFixed(2)));
}

function normalizeInteger(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.round(numberValue));
}

function normalizeSort(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.round(numberValue);
}

function normalizeStringList(value: unknown, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => trimText(item, maxLength))
        .filter(Boolean),
    ),
  );
}

function normalizeId(value: unknown, prefix: string, index: number) {
  return trimText(value, 120) || `${prefix}-${Date.now().toString(36)}-${index}`;
}

export function createEmptyMerchantMembershipSettings(siteId: string): MerchantMembershipSettings {
  return {
    siteId: trimText(siteId, 64),
    rechargePlans: [],
    redemptionCategories: [],
    redemptionItems: [],
    growthRules: {
      spendAmountGrowth: 0,
      rechargeAmountGrowth: 0,
      rechargePointGrowth: 0,
      spendPointGrowth: 0,
      annualRecalculate: false,
    },
    levels: [],
    pointsRules: {
      paidAmount: 1,
      paidPoints: 0,
      joinPoints: 0,
      checkinPoints: 0,
      continuousCheckinPoints: 0,
      birthdayPoints: 0,
      invitationPoints: 0,
      reviewPoints: 0,
      holidayNames: [],
      holidayMultiplier: 1,
      deductionAmountPerPoint: 0,
      deductionMinOrderAmount: 0,
      deductionMaxAmount: 0,
      deductionMaxPercent: 0,
      pointsNeverExpire: true,
      pointsValidDays: 0,
    },
    updatedAt: null,
  };
}

function normalizeRechargePlans(value: unknown): MerchantMemberRechargePlan[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      const rechargeAmount = normalizeMoney(record.rechargeAmount ?? record.amount);
      const giftAmount = normalizeMoney(record.giftAmount);
      const giftPoints = normalizeInteger(record.giftPoints);
      const title =
        trimText(record.title, 120) ||
        (rechargeAmount > 0 ? `充 ${rechargeAmount.toFixed(2)}` : `充值方案 ${index + 1}`);
      return {
        id: normalizeId(record.id, "recharge", index),
        title,
        enabled: normalizeBoolean(record.enabled, true),
        rechargeAmount,
        giftAmount,
        giftPoints,
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberRechargePlan => Boolean(item))
    .sort((left, right) => left.sort - right.sort);
}

function normalizeRedemptionCategories(value: unknown): MerchantMemberRedemptionCategory[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      return {
        id: normalizeId(record.id, "category", index),
        name: trimText(record.name ?? record.title, 120) || `分类 ${index + 1}`,
        enabled: normalizeBoolean(record.enabled, true),
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberRedemptionCategory => Boolean(item))
    .sort((left, right) => left.sort - right.sort);
}

function normalizeRedemptionItems(value: unknown): MerchantMemberRedemptionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      return {
        id: normalizeId(record.id, "item", index),
        categoryId: trimText(record.categoryId, 120),
        code: trimText(record.code, 120),
        name: trimText(record.name ?? record.title, 160) || `兑换项目 ${index + 1}`,
        description: trimText(record.description, 500),
        enabled: normalizeBoolean(record.enabled, true),
        pointsCost: normalizeInteger(record.pointsCost ?? record.points),
        referenceAmount: normalizeMoney(record.referenceAmount ?? record.price),
        stock: normalizeInteger(record.stock),
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberRedemptionItem => Boolean(item))
    .sort((left, right) => left.sort - right.sort);
}

function normalizeLevelBenefit(value: unknown): MerchantMemberLevelBenefit {
  const record = readRecord(value) ?? {};
  const legacyOneTimeGift = trimText(record.oneTimeGift, 500);
  const legacyRecurringGift = trimText(record.recurringGift, 500);
  const legacyBirthdayGift = trimText(record.birthdayGift, 500);
  return {
    pointDiscount: trimText(record.pointDiscount, 120),
    oneTimeGiftPoints: normalizeInteger(record.oneTimeGiftPoints),
    oneTimeGiftItem: trimText(record.oneTimeGiftItem, 500) || legacyOneTimeGift,
    oneTimeGiftProduct: trimText(record.oneTimeGiftProduct, 500),
    recurringGiftPoints: normalizeInteger(record.recurringGiftPoints),
    recurringGiftItem: trimText(record.recurringGiftItem, 500) || legacyRecurringGift,
    recurringGiftProduct: trimText(record.recurringGiftProduct, 500),
    birthdayGiftPoints: normalizeInteger(record.birthdayGiftPoints),
    birthdayGiftItem: trimText(record.birthdayGiftItem, 500) || legacyBirthdayGift,
    birthdayGiftProduct: trimText(record.birthdayGiftProduct, 500),
    servicePriority: normalizeBoolean(record.servicePriority),
    inStoreService: normalizeBoolean(record.inStoreService),
    dedicatedSupport: normalizeBoolean(record.dedicatedSupport),
    nextYearKeepLevel: normalizeBoolean(record.nextYearKeepLevel),
  };
}

function normalizeLevels(value: unknown): MerchantMemberLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      return {
        id: normalizeId(record.id, "level", index),
        name: trimText(record.name, 120),
        requiredGrowthValue: normalizeInteger(record.requiredGrowthValue),
        benefit: normalizeLevelBenefit(record.benefit),
        enabled: normalizeBoolean(record.enabled, true),
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberLevel => Boolean(item))
    .sort((left, right) => left.requiredGrowthValue - right.requiredGrowthValue || left.sort - right.sort);
}

function normalizeGrowthRules(value: unknown): MerchantMemberGrowthRules {
  const record = readRecord(value) ?? {};
  return {
    spendAmountGrowth: normalizeMoney(record.spendAmountGrowth),
    rechargeAmountGrowth: normalizeMoney(record.rechargeAmountGrowth),
    rechargePointGrowth: normalizeMoney(record.rechargePointGrowth),
    spendPointGrowth: normalizeMoney(record.spendPointGrowth),
    annualRecalculate: normalizeBoolean(record.annualRecalculate),
  };
}

function normalizePointsRules(value: unknown): MerchantMemberPointsRules {
  const record = readRecord(value) ?? {};
  const pointsValidDays = normalizeInteger(record.pointsValidDays);
  const pointsNeverExpire = normalizeBoolean(record.pointsNeverExpire, pointsValidDays <= 0);
  return {
    paidAmount: normalizeMoney(record.paidAmount, 1),
    paidPoints: normalizeInteger(record.paidPoints),
    joinPoints: normalizeInteger(record.joinPoints),
    checkinPoints: normalizeInteger(record.checkinPoints),
    continuousCheckinPoints: normalizeInteger(record.continuousCheckinPoints),
    birthdayPoints: normalizeInteger(record.birthdayPoints),
    invitationPoints: normalizeInteger(record.invitationPoints),
    reviewPoints: normalizeInteger(record.reviewPoints),
    holidayNames: normalizeStringList(record.holidayNames),
    holidayMultiplier: normalizeMoney(record.holidayMultiplier, 1),
    deductionAmountPerPoint: normalizeMoney(record.deductionAmountPerPoint),
    deductionMinOrderAmount: normalizeMoney(record.deductionMinOrderAmount),
    deductionMaxAmount: normalizeMoney(record.deductionMaxAmount),
    deductionMaxPercent: Math.min(100, normalizeMoney(record.deductionMaxPercent)),
    pointsNeverExpire,
    pointsValidDays: pointsNeverExpire ? 0 : pointsValidDays,
  };
}

export function normalizeMerchantMembershipSettings(siteId: string, value: unknown): MerchantMembershipSettings {
  const fallback = createEmptyMerchantMembershipSettings(siteId);
  const record = readRecord(value) ?? {};
  return {
    siteId: trimText(record.siteId, 64) || fallback.siteId,
    rechargePlans: normalizeRechargePlans(record.rechargePlans),
    redemptionCategories: normalizeRedemptionCategories(record.redemptionCategories),
    redemptionItems: normalizeRedemptionItems(record.redemptionItems),
    growthRules: normalizeGrowthRules(record.growthRules),
    levels: normalizeLevels(record.levels),
    pointsRules: normalizePointsRules(record.pointsRules),
    updatedAt: trimText(record.updatedAt, 80) || null,
  };
}

export function createMerchantMemberSettingsId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
