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
  "元宵节",
  "情人节",
  "妇女节",
  "清明节",
  "复活节",
  "劳动节",
  "儿童节",
  "端午节",
  "母亲节",
  "父亲节",
  "七夕",
  "中元节",
  "中秋节",
  "国庆节",
  "重阳节",
  "腊八节",
  "感恩节",
  "万圣节",
  "黑五",
  "平安夜",
  "圣诞节",
] as const;

export type MerchantMemberHolidayPointRule = {
  id: string;
  date: string;
  name: string;
  multiplier: number;
  enabled: boolean;
  sort: number;
};

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
  holidayRules: MerchantMemberHolidayPointRule[];
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

export type MerchantMemberHolidayPreset = {
  date: string;
  name: string;
};

function formatDateYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getNthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, nth: number) {
  const date = new Date(year, monthIndex, 1);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (nth - 1) * 7);
  return date;
}

function getChineseMonthDayKey(date: Date) {
  try {
    const parts = new Intl.DateTimeFormat("zh-u-ca-chinese", { month: "long", day: "numeric" }).formatToParts(date);
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return month && day ? `${month}-${day}` : "";
  } catch {
    return "";
  }
}

function getQingmingDate(year: number) {
  const shortYear = year % 100;
  const day = Math.floor(shortYear * 0.2422 + 4.81) - Math.floor(shortYear / 4);
  return new Date(year, 3, Math.max(4, Math.min(6, day)));
}

function getEasterDate(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function getMerchantMemberHolidayNamesForDate(date: Date) {
  if (!Number.isFinite(date.getTime())) return [];
  const year = date.getFullYear();
  const monthDay = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const holidays: string[] = [];
  const fixedHolidayMap: Record<string, string[]> = {
    "01-01": ["元旦"],
    "02-14": ["情人节"],
    "03-08": ["妇女节"],
    "05-01": ["劳动节"],
    "06-01": ["儿童节"],
    "10-01": ["国庆节"],
    "10-31": ["万圣节"],
    "12-24": ["平安夜"],
    "12-25": ["圣诞节"],
  };
  fixedHolidayMap[monthDay]?.forEach((name) => holidays.push(name));
  if (formatDateYmd(getQingmingDate(year)) === formatDateYmd(date)) holidays.push("清明节");
  if (formatDateYmd(getNthWeekdayOfMonth(year, 4, 0, 2)) === formatDateYmd(date)) holidays.push("母亲节");
  if (formatDateYmd(getNthWeekdayOfMonth(year, 5, 0, 3)) === formatDateYmd(date)) holidays.push("父亲节");
  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4);
  if (formatDateYmd(thanksgiving) === formatDateYmd(date)) holidays.push("感恩节");
  const blackFriday = new Date(thanksgiving);
  blackFriday.setDate(thanksgiving.getDate() + 1);
  if (formatDateYmd(blackFriday) === formatDateYmd(date)) holidays.push("黑五");
  const easter = getEasterDate(year);
  if (formatDateYmd(easter) === formatDateYmd(date)) holidays.push("复活节");

  const lunarHolidayMap: Record<string, string> = {
    "正月-1": "春节",
    "正月-15": "元宵节",
    "五月-5": "端午节",
    "七月-7": "七夕",
    "七月-15": "中元节",
    "八月-15": "中秋节",
    "九月-9": "重阳节",
    "腊月-8": "腊八节",
  };
  const lunarHoliday = lunarHolidayMap[getChineseMonthDayKey(date)];
  if (lunarHoliday) holidays.push(lunarHoliday);
  return Array.from(new Set(holidays));
}

export function buildMerchantMemberHolidayPresets(year = new Date().getFullYear()): MerchantMemberHolidayPreset[] {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const presets: MerchantMemberHolidayPreset[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    getMerchantMemberHolidayNamesForDate(cursor).forEach((name) => {
      presets.push({ date: formatDateYmd(cursor), name });
    });
  }
  return presets.sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name));
}

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

export function parseMerchantMemberPointDiscountRate(value: unknown) {
  const text = trimText(value, 32).replace(/\s+/g, "");
  if (!text) return 1;
  const numericMatch = text.match(/\d+(?:\.\d+)?/);
  if (!numericMatch) return 1;
  const numberValue = Number.parseFloat(numericMatch[0]);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 1;
  if (text.includes("折")) return Math.min(1, Math.max(0.01, numberValue / 10));
  if (text.includes("%") || text.includes("％")) return Math.min(1, Math.max(0.01, numberValue / 100));
  if (numberValue <= 1) return Math.min(1, Math.max(0.01, numberValue));
  if (numberValue <= 10) return Math.min(1, Math.max(0.01, numberValue / 10));
  if (numberValue <= 100) return Math.min(1, Math.max(0.01, numberValue / 100));
  return 1;
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
      holidayRules: [],
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

function normalizeDateText(value: unknown) {
  const raw = trimText(value, 32);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(`${raw}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  const [year, month, day] = match.slice(1);
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day)
  ) {
    return "";
  }
  return raw;
}

function normalizeHolidayRules(value: unknown, fallbackMultiplier = 1): MerchantMemberHolidayPointRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item, index) => {
      const record = readRecord(item);
      if (!record) return null;
      const date = normalizeDateText(record.date);
      const name = trimText(record.name ?? record.title, 120);
      if (!date || !name) return null;
      const key = `${date}:${name.toLowerCase()}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: normalizeId(record.id, "holiday", index),
        date,
        name,
        multiplier: normalizeMoney(record.multiplier ?? record.holidayMultiplier ?? record.pointsMultiplier, fallbackMultiplier),
        enabled: normalizeBoolean(record.enabled, true),
        sort: normalizeSort(record.sort, index),
      };
    })
    .filter((item): item is MerchantMemberHolidayPointRule => Boolean(item))
    .sort((left, right) => left.date.localeCompare(right.date) || left.sort - right.sort);
}

function normalizePointsRules(value: unknown): MerchantMemberPointsRules {
  const record = readRecord(value) ?? {};
  const pointsValidDays = normalizeInteger(record.pointsValidDays);
  const pointsNeverExpire = normalizeBoolean(record.pointsNeverExpire, pointsValidDays <= 0);
  const holidayMultiplier = normalizeMoney(record.holidayMultiplier, 1);
  return {
    paidAmount: normalizeMoney(record.paidAmount, 1),
    paidPoints: normalizeInteger(record.paidPoints),
    joinPoints: normalizeInteger(record.joinPoints),
    checkinPoints: normalizeInteger(record.checkinPoints),
    continuousCheckinPoints: normalizeInteger(record.continuousCheckinPoints),
    birthdayPoints: normalizeInteger(record.birthdayPoints),
    invitationPoints: normalizeInteger(record.invitationPoints),
    reviewPoints: normalizeInteger(record.reviewPoints),
    holidayRules: normalizeHolidayRules(record.holidayRules, holidayMultiplier),
    holidayNames: normalizeStringList(record.holidayNames),
    holidayMultiplier,
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
