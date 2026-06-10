import type { MerchantCouponDiscountType } from "@/lib/merchantCoupons";

export type MerchantMembershipStatus = "active" | "left";

export const MERCHANT_MEMBER_LEGAL_ALLERGENS = [
  "含麸质谷物",
  "甲壳类",
  "蛋类",
  "鱼类",
  "花生",
  "大豆",
  "乳制品",
  "坚果",
  "芹菜",
  "芥末",
  "芝麻",
  "二氧化硫和亚硫酸盐",
  "羽扇豆",
  "软体动物",
] as const;

export type MerchantMemberLegalAllergen = (typeof MERCHANT_MEMBER_LEGAL_ALLERGENS)[number];
export type MerchantMemberAccountTransactionType = "redeem" | "recharge";

export type MerchantMemberAccountTransaction = {
  id: string;
  type: MerchantMemberAccountTransactionType;
  at: string;
  pointDelta: number;
  balanceDelta: number;
  growthDelta: number;
  note: string;
  operatorId: string;
};

export type MerchantMemberCouponSummary = {
  couponId: string;
  title: string;
  discountLabel: string;
  count: number;
};

export type MerchantMemberCouponHistoryItem = {
  id: string;
  couponId: string;
  couponCode: string;
  title: string;
  discountLabel: string;
  discountType: MerchantCouponDiscountType;
  discountValue: number;
  productName: string;
  productBarcode: string;
  productQuantity: number;
  productAmount: number;
  exchangeItem: string;
  exchangeQuantity: number;
  ticketVenue: string;
  ticketDurationMinutes: number;
  claimedAt: string;
  validUntil: string | null;
  redeemedAt: string | null;
  settlementType: "qr" | "barcode";
  settlementCode: string;
  status: "available" | "used" | "expired" | "inactive";
};

export type MerchantMembershipInsight = {
  pointBalance: number;
  balanceAmount: number;
  availableCouponCount: number;
  availableCoupons: MerchantMemberCouponSummary[];
  couponHistory: MerchantMemberCouponHistoryItem[];
  totalSpendAmount: number;
  totalOrderCount: number;
  consumptionFrequencyPerMonth: number;
  averageOrderAmount: number;
  recentPurchaseAt: string | null;
  firstPurchaseAt: string | null;
  yearlySpendAmount: number;
  productPreferences: string[];
};

export type MerchantMembershipProfileDraft = {
  nickname: string;
  name: string;
  phone: string;
  email: string;
  avatarUrl: string;
  birthday: string;
  birthdayMonthDayOnly: boolean;
  gender: string;
  country: string;
  province: string;
  city: string;
  address: string;
  taxName: string;
  taxNumber: string;
  taxCountry: string;
  taxProvince: string;
  taxCity: string;
  taxAddress: string;
  allergens: string[];
};

export type MerchantMembershipRecord = {
  id: string;
  siteId: string;
  siteName: string;
  memberNo: string;
  serial: number;
  accountId: string;
  userId: string;
  email: string;
  nickname: string;
  name: string;
  phone: string;
  avatarUrl: string;
  birthday: string;
  birthdayMonthDayOnly: boolean;
  gender: string;
  country: string;
  province: string;
  city: string;
  address: string;
  taxName: string;
  taxNumber: string;
  taxCountry: string;
  taxProvince: string;
  taxCity: string;
  taxAddress: string;
  allergens: string[];
  pointBalance: number;
  balanceAmount: number;
  growthValue: number;
  levelId: string;
  transactions: MerchantMemberAccountTransaction[];
  status: MerchantMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
  updatedAt: string;
};

export type PersonalMembershipCard = {
  id: string;
  siteId: string;
  siteName: string;
  memberNo: string;
  qrValue: string;
  status: MerchantMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
};

export type MerchantMembershipListItem = MerchantMembershipRecord & {
  profileVisible: boolean;
  insight?: MerchantMembershipInsight;
};

const MAX_PERSONAL_MEMBERSHIPS = 500;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeIsoDateValue(value: unknown, fallback = "") {
  const raw = trimText(value);
  if (!raw) return fallback;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function normalizePositiveInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.floor(numberValue);
}

function normalizeIntegerValue(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.round(numberValue);
}

function normalizeMoneyValue(value: unknown, fallback = 0) {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue)) return fallback;
  return Number(numberValue.toFixed(2));
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

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimText(item, 120)).filter(Boolean);
}

export function normalizeMerchantMemberAllergens(value: unknown) {
  const allowed = new Set<string>(MERCHANT_MEMBER_LEGAL_ALLERGENS);
  return Array.from(new Set(normalizeStringArray(value).filter((item) => allowed.has(item))));
}

export function normalizeMerchantMemberAccountTransactions(value: unknown): MerchantMemberAccountTransaction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readRecord(item);
      if (!record) return null;
      const at = normalizeIsoDateValue(record.at);
      if (!at) return null;
      const type: MerchantMemberAccountTransactionType = record.type === "recharge" ? "recharge" : "redeem";
      return {
        id: trimText(record.id, 120) || `MT${Date.parse(at).toString(36).toUpperCase()}`,
        type,
        at,
        pointDelta: normalizeIntegerValue(record.pointDelta),
        balanceDelta: normalizeMoneyValue(record.balanceDelta),
        growthDelta: normalizeMoneyValue(record.growthDelta),
        note: trimText(record.note, 500),
        operatorId: trimText(record.operatorId, 120),
      };
    })
    .filter((item): item is MerchantMemberAccountTransaction => Boolean(item))
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 500);
}

export function buildMerchantMemberNo(siteId: string, serial: number) {
  const normalizedSiteId = trimText(siteId);
  const normalizedSerial = Math.max(1, Math.floor(Number(serial) || 1));
  return `${normalizedSiteId}${String(normalizedSerial).padStart(6, "0")}`;
}

export function buildMerchantMembershipQrValue(siteId: string, memberNo: string) {
  const normalizedSiteId = trimText(siteId, 64);
  const normalizedMemberNo = trimText(memberNo, 80);
  return `FAOLLA_MEMBER:${normalizedSiteId}:${normalizedMemberNo}`;
}

export function normalizeMerchantMembershipStatus(value: unknown): MerchantMembershipStatus {
  return value === "left" ? "left" : "active";
}

export function normalizeMerchantMembershipProfileDraft(
  value: unknown,
  fallback: Partial<MerchantMembershipProfileDraft> = {},
): MerchantMembershipProfileDraft {
  const record = readRecord(value) ?? {};
  return {
    nickname:
      trimText(record.nickname, 120) ||
      trimText(record.displayName, 120) ||
      trimText(record.display_name, 120) ||
      trimText(fallback.nickname, 120) ||
      trimText(fallback.name, 120),
    name: trimText(record.name, 120) || trimText(record.displayName, 120) || trimText(fallback.name, 120),
    phone: trimText(record.phone, 80) || trimText(fallback.phone, 80),
    email: (trimText(record.email, 320) || trimText(fallback.email, 320)).toLowerCase(),
    avatarUrl: trimText(record.avatarUrl, 1200) || trimText(record.avatar_url, 1200) || trimText(fallback.avatarUrl, 1200),
    birthday: trimText(record.birthday, 32) || trimText(fallback.birthday, 32),
    birthdayMonthDayOnly: normalizeBoolean(record.birthdayMonthDayOnly ?? record.birthday_month_day_only, fallback.birthdayMonthDayOnly === true),
    gender: trimText(record.gender, 32) || trimText(fallback.gender, 32),
    country: trimText(record.country, 80) || trimText(fallback.country, 80),
    province: trimText(record.province, 80) || trimText(fallback.province, 80),
    city: trimText(record.city, 80) || trimText(fallback.city, 80),
    address: trimText(record.address, 240) || trimText(fallback.address, 240),
    taxName: trimText(record.taxName, 160) || trimText(record.tax_name, 160) || trimText(fallback.taxName, 160),
    taxNumber: trimText(record.taxNumber, 120) || trimText(record.tax_number, 120) || trimText(fallback.taxNumber, 120),
    taxCountry: trimText(record.taxCountry, 80) || trimText(record.tax_country, 80) || trimText(fallback.taxCountry, 80),
    taxProvince: trimText(record.taxProvince, 80) || trimText(record.tax_province, 80) || trimText(fallback.taxProvince, 80),
    taxCity: trimText(record.taxCity, 80) || trimText(record.tax_city, 80) || trimText(fallback.taxCity, 80),
    taxAddress: trimText(record.taxAddress, 240) || trimText(record.tax_address, 240) || trimText(fallback.taxAddress, 240),
    allergens: normalizeMerchantMemberAllergens(record.allergens ?? fallback.allergens),
  };
}

export function normalizeMerchantMembershipRecord(value: unknown): MerchantMembershipRecord | null {
  const record = readRecord(value);
  if (!record) return null;
  const siteId = trimText(record.siteId, 64);
  const accountId = trimText(record.accountId, 128);
  const userId = trimText(record.userId, 128);
  const joinedAt = normalizeIsoDateValue(record.joinedAt);
  if (!siteId || (!accountId && !userId) || !joinedAt) return null;
  const serial = normalizePositiveInteger(record.serial) || 1;
  const memberNo = trimText(record.memberNo, 64) || buildMerchantMemberNo(siteId, serial);
  const id = trimText(record.id, 160) || `${siteId}:${accountId || userId}`;
  const status = normalizeMerchantMembershipStatus(record.status);
  return {
    id,
    siteId,
    siteName: trimText(record.siteName, 120) || siteId,
    memberNo,
    serial,
    accountId,
    userId,
    email: trimText(record.email, 320).toLowerCase(),
    nickname: trimText(record.nickname, 120) || trimText(record.name, 120),
    name: trimText(record.name, 120),
    phone: trimText(record.phone, 80),
    avatarUrl: trimText(record.avatarUrl, 1200),
    birthday: trimText(record.birthday, 32),
    birthdayMonthDayOnly: normalizeBoolean(record.birthdayMonthDayOnly ?? record.birthday_month_day_only),
    gender: trimText(record.gender, 32),
    country: trimText(record.country, 80),
    province: trimText(record.province, 80),
    city: trimText(record.city, 80),
    address: trimText(record.address, 240),
    taxName: trimText(record.taxName, 160) || trimText(record.tax_name, 160),
    taxNumber: trimText(record.taxNumber, 120) || trimText(record.tax_number, 120),
    taxCountry: trimText(record.taxCountry, 80) || trimText(record.tax_country, 80),
    taxProvince: trimText(record.taxProvince, 80) || trimText(record.tax_province, 80),
    taxCity: trimText(record.taxCity, 80) || trimText(record.tax_city, 80),
    taxAddress: trimText(record.taxAddress, 240) || trimText(record.tax_address, 240),
    allergens: normalizeMerchantMemberAllergens(record.allergens),
    pointBalance: Math.max(0, normalizeIntegerValue(record.pointBalance)),
    balanceAmount: Math.max(0, normalizeMoneyValue(record.balanceAmount)),
    growthValue: Math.max(0, normalizeMoneyValue(record.growthValue)),
    levelId: trimText(record.levelId, 120),
    transactions: normalizeMerchantMemberAccountTransactions(record.transactions),
    status,
    joinedAt,
    leftAt: status === "left" ? normalizeIsoDateValue(record.leftAt, new Date().toISOString()) : null,
    updatedAt: normalizeIsoDateValue(record.updatedAt, joinedAt),
  };
}

export function normalizeMerchantMembershipRecords(value: unknown): MerchantMembershipRecord[] {
  if (!Array.isArray(value)) return [];
  const map = new Map<string, MerchantMembershipRecord>();
  value.forEach((item) => {
    const membership = normalizeMerchantMembershipRecord(item);
    if (!membership) return;
    const existing = map.get(membership.id);
    if (!existing || Date.parse(membership.updatedAt) >= Date.parse(existing.updatedAt)) {
      map.set(membership.id, membership);
    }
  });
  return Array.from(map.values()).sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function toPersonalMembershipCard(record: MerchantMembershipRecord): PersonalMembershipCard {
  return {
    id: record.id,
    siteId: record.siteId,
    siteName: record.siteName,
    memberNo: record.memberNo,
    qrValue: buildMerchantMembershipQrValue(record.siteId, record.memberNo),
    status: record.status,
    joinedAt: record.joinedAt,
    leftAt: record.leftAt,
  };
}

export function normalizePersonalMembershipCard(value: unknown): PersonalMembershipCard | null {
  const record = readRecord(value);
  if (!record) return null;
  const siteId = trimText(record.siteId, 64);
  const memberNo = trimText(record.memberNo, 64);
  const joinedAt = normalizeIsoDateValue(record.joinedAt);
  if (!siteId || !memberNo || !joinedAt) return null;
  const qrValue = trimText(record.qrValue, 200) || buildMerchantMembershipQrValue(siteId, memberNo);
  return {
    id: trimText(record.id, 160) || `${siteId}:${memberNo}`,
    siteId,
    siteName: trimText(record.siteName, 120) || siteId,
    memberNo,
    qrValue,
    status: normalizeMerchantMembershipStatus(record.status),
    joinedAt,
    leftAt: normalizeMerchantMembershipStatus(record.status) === "left" ? normalizeIsoDateValue(record.leftAt, new Date().toISOString()) : null,
  };
}

export function normalizePersonalMembershipCards(value: unknown): PersonalMembershipCard[] {
  if (!Array.isArray(value)) return [];
  const map = new Map<string, PersonalMembershipCard>();
  value.forEach((item) => {
    const membership = normalizePersonalMembershipCard(item);
    if (!membership) return;
    map.set(membership.id, membership);
  });
  return Array.from(map.values()).sort((left, right) => Date.parse(right.joinedAt) - Date.parse(left.joinedAt));
}

export function readPersonalMembershipCardsFromUserMetadata(userMetadata: Record<string, unknown> | null | undefined) {
  const profile = readRecord(userMetadata?.personal_profile) ?? {};
  return normalizePersonalMembershipCards(profile.memberships);
}

export function writePersonalMembershipCardToUserMetadata(
  userMetadata: Record<string, unknown> | null | undefined,
  membership: PersonalMembershipCard,
) {
  const nextMetadata = userMetadata && typeof userMetadata === "object" ? { ...userMetadata } : {};
  const profile = readRecord(nextMetadata.personal_profile) ? { ...(nextMetadata.personal_profile as Record<string, unknown>) } : {};
  const current = normalizePersonalMembershipCards(profile.memberships);
  profile.memberships = [membership, ...current.filter((item) => item.id !== membership.id)].slice(0, MAX_PERSONAL_MEMBERSHIPS);
  nextMetadata.personal_profile = profile;
  return nextMetadata;
}

export function toMerchantMembershipListItem(record: MerchantMembershipRecord): MerchantMembershipListItem {
  if (record.status === "active") {
    return {
      ...record,
      profileVisible: true,
    };
  }
  return {
    ...record,
    nickname: "",
    email: "",
    name: "已退会会员",
    phone: "",
    avatarUrl: "",
    birthday: "",
    birthdayMonthDayOnly: false,
    gender: "",
    country: "",
    province: "",
    city: "",
    address: "",
    taxName: "",
    taxNumber: "",
    taxCountry: "",
    taxProvince: "",
    taxCity: "",
    taxAddress: "",
    allergens: [],
    pointBalance: 0,
    balanceAmount: 0,
    growthValue: 0,
    levelId: "",
    transactions: [],
    profileVisible: false,
  };
}
