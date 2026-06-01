export type MerchantMembershipStatus = "active" | "left";

export type MerchantMembershipRecord = {
  id: string;
  siteId: string;
  siteName: string;
  memberNo: string;
  serial: number;
  accountId: string;
  userId: string;
  email: string;
  name: string;
  phone: string;
  avatarUrl: string;
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
  status: MerchantMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
};

export type MerchantMembershipListItem = MerchantMembershipRecord & {
  profileVisible: boolean;
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

export function buildMerchantMemberNo(siteId: string, serial: number) {
  const normalizedSiteId = trimText(siteId);
  const normalizedSerial = Math.max(1, Math.floor(Number(serial) || 1));
  return `${normalizedSiteId}${String(normalizedSerial).padStart(6, "0")}`;
}

export function normalizeMerchantMembershipStatus(value: unknown): MerchantMembershipStatus {
  return value === "left" ? "left" : "active";
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
    name: trimText(record.name, 120),
    phone: trimText(record.phone, 80),
    avatarUrl: trimText(record.avatarUrl, 1200),
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
  return {
    id: trimText(record.id, 160) || `${siteId}:${memberNo}`,
    siteId,
    siteName: trimText(record.siteName, 120) || siteId,
    memberNo,
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
    email: "",
    name: "已退会会员",
    phone: "",
    avatarUrl: "",
    profileVisible: false,
  };
}
