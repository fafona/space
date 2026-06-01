export type MerchantMemberSettingsView = "list" | "rechargePlans" | "redemptionItems" | "levels" | "pointsRules";

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
  oneTimeGift: string;
  recurringGift: string;
  birthdayGift: string;
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
  holidayMultiplier: number;
  deductionAmountPerPoint: number;
  deductionLimit: string;
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
      holidayMultiplier: 1,
      deductionAmountPerPoint: 0,
      deductionLimit: "",
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
        stock: normalizeInteger(record.stock),
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberRedemptionItem => Boolean(item))
    .sort((left, right) => left.sort - right.sort);
}

function normalizeLevelBenefit(value: unknown): MerchantMemberLevelBenefit {
  const record = readRecord(value) ?? {};
  return {
    pointDiscount: trimText(record.pointDiscount, 120),
    oneTimeGift: trimText(record.oneTimeGift, 500),
    recurringGift: trimText(record.recurringGift, 500),
    birthdayGift: trimText(record.birthdayGift, 500),
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
        name: trimText(record.name, 120) || `等级 ${index + 1}`,
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
  return {
    paidAmount: normalizeMoney(record.paidAmount, 1),
    paidPoints: normalizeInteger(record.paidPoints),
    joinPoints: normalizeInteger(record.joinPoints),
    checkinPoints: normalizeInteger(record.checkinPoints),
    continuousCheckinPoints: normalizeInteger(record.continuousCheckinPoints),
    birthdayPoints: normalizeInteger(record.birthdayPoints),
    invitationPoints: normalizeInteger(record.invitationPoints),
    reviewPoints: normalizeInteger(record.reviewPoints),
    holidayMultiplier: normalizeMoney(record.holidayMultiplier, 1),
    deductionAmountPerPoint: normalizeMoney(record.deductionAmountPerPoint),
    deductionLimit: trimText(record.deductionLimit, 240),
    pointsValidDays: normalizeInteger(record.pointsValidDays),
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
