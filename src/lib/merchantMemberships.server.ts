import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  buildMerchantMemberNo,
  buildMerchantMembershipQrValue,
  normalizeMerchantMemberAllergens,
  normalizeMerchantMembershipRecords,
  normalizeMerchantMembershipProfileDraft,
  toMerchantMembershipListItem,
  toPersonalMembershipCard,
  writePersonalMembershipCardToUserMetadata,
  type MerchantMemberAccountTransactionType,
  type MerchantMembershipProfileDraft,
  type MerchantMembershipListItem,
  type MerchantMembershipRecord,
  type PersonalMembershipCard,
} from "@/lib/merchantMemberships";
import { loadStoredMerchantMemberships, saveStoredMerchantMemberships } from "@/lib/merchantMembershipsStore";
import { readPersonalCustomerProfileFromSession } from "@/lib/personalCustomerProfile";
import type { PersonalAccountSession } from "@/lib/personalAccountSession.server";

function requireMembershipsStoreClient() {
  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    throw new Error("memberships_store_unavailable");
  }
  return supabase;
}

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePositiveInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(trimText(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Math.round(numberValue);
}

function normalizePositiveMoney(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
  return Number(numberValue.toFixed(2));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readProfileAvatarUrl(session: PersonalAccountSession) {
  const metadata = readRecord(session.user.user_metadata);
  const profile = readRecord(metadata?.personal_profile) ?? {};
  return trimText(profile.avatarUrl) || trimText(profile.avatar_url) || trimText(metadata?.avatarUrl) || trimText(metadata?.avatar_url);
}

export function readPersonalMembershipProfileFromSession(session: PersonalAccountSession): MerchantMembershipProfileDraft {
  const metadata = readRecord(session.user.user_metadata);
  const profile = readRecord(metadata?.personal_profile) ?? {};
  const customerProfile = readPersonalCustomerProfileFromSession({
    authenticated: true,
    accountType: "personal",
    accountId: session.accountId,
    user: session.user,
  });
  return normalizeMerchantMembershipProfileDraft(profile, {
    nickname:
      trimText(profile.nickname, 120) ||
      trimText(profile.displayName, 120) ||
      trimText(profile.display_name, 120) ||
      customerProfile.name,
    name: customerProfile.name,
    phone: customerProfile.phone,
    email: session.email || customerProfile.email || customerProfile.loginEmail,
    avatarUrl: readProfileAvatarUrl(session),
    birthday: trimText(profile.birthday, 32),
    birthdayMonthDayOnly:
      profile.birthdayMonthDayOnly === true ||
      profile.birthday_month_day_only === true ||
      profile.birthdayMonthDayOnly === "true" ||
      profile.birthday_month_day_only === "true",
    gender: trimText(profile.gender, 32),
    country: trimText(profile.country, 80),
    province: trimText(profile.province, 80),
    city: trimText(profile.city, 80),
    address: trimText(profile.address, 240),
    taxName: trimText(profile.taxName, 160) || trimText(profile.invoiceName, 160),
    taxNumber: trimText(profile.taxNumber, 120) || trimText(profile.invoiceTaxNumber, 120),
    taxCountry: trimText(profile.taxCountry, 80) || trimText(profile.invoiceCountry, 80),
    taxProvince: trimText(profile.taxProvince, 80) || trimText(profile.invoiceProvince, 80),
    taxCity: trimText(profile.taxCity, 80) || trimText(profile.invoiceCity, 80),
    taxAddress: trimText(profile.taxAddress, 240) || trimText(profile.invoiceAddress, 240),
    allergens: [],
  });
}

async function writePersonalMembershipToMetadata(session: PersonalAccountSession, membership: PersonalMembershipRecordLike) {
  const card = {
    id: membership.id,
    siteId: membership.siteId,
    siteName: membership.siteName,
    memberNo: membership.memberNo,
    qrValue: buildMerchantMembershipQrValue(membership.siteId, membership.memberNo),
    status: membership.status,
    joinedAt: membership.joinedAt,
    leftAt: membership.leftAt,
  } satisfies PersonalMembershipCard;
  const nextMetadata = writePersonalMembershipCardToUserMetadata(session.user.user_metadata ?? {}, card);
  const { error } = await session.adminSupabase.auth.admin.updateUserById(session.userId, { user_metadata: nextMetadata });
  if (error) throw error;
}

type PersonalMembershipRecordLike = Pick<
  MerchantMembershipRecord,
  "id" | "siteId" | "siteName" | "memberNo" | "status" | "joinedAt" | "leftAt"
>;

export async function listMerchantMemberships(siteId: string): Promise<MerchantMembershipListItem[]> {
  const supabase = requireMembershipsStoreClient();
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  return normalizeMerchantMembershipRecords(stored?.memberships ?? []).map(toMerchantMembershipListItem);
}

export async function updateMerchantMembershipAllergens(input: {
  siteId: string;
  membershipId: string;
  allergens: unknown;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  if (!siteId || !membershipId) throw new Error("membership_not_found");
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = current.findIndex((membership) => membership.id === membershipId);
  if (index < 0) throw new Error("membership_not_found");
  const now = new Date().toISOString();
  const nextMembership = {
    ...current[index],
    allergens: normalizeMerchantMemberAllergens(input.allergens),
    updatedAt: now,
  };
  const nextMemberships = [...current];
  nextMemberships[index] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  return toMerchantMembershipListItem(nextMembership);
}

export async function applyMerchantMembershipAccountOperation(input: {
  siteId: string;
  membershipId: string;
  type: MerchantMemberAccountTransactionType;
  points?: unknown;
  balanceAmount?: unknown;
  note?: unknown;
  operatorId?: unknown;
}): Promise<MerchantMembershipListItem> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  const membershipId = trimText(input.membershipId, 160);
  if (!siteId || !membershipId) throw new Error("membership_not_found");
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = current.findIndex((membership) => membership.id === membershipId);
  if (index < 0) throw new Error("membership_not_found");
  if (current[index].status !== "active") throw new Error("membership_not_active");
  const type: MerchantMemberAccountTransactionType = input.type === "recharge" ? "recharge" : "redeem";
  const rawPoints = normalizePositiveInteger(input.points);
  const rawBalance = normalizePositiveMoney(input.balanceAmount);
  if (rawPoints <= 0 && rawBalance <= 0) throw new Error("membership_operation_empty");
  const pointDelta = type === "recharge" ? rawPoints : -rawPoints;
  const balanceDelta = type === "recharge" ? rawBalance : -rawBalance;
  const currentMembership = current[index];
  const nextPointBalance = currentMembership.pointBalance + pointDelta;
  const nextBalanceAmount = Number((currentMembership.balanceAmount + balanceDelta).toFixed(2));
  if (nextPointBalance < 0 || nextBalanceAmount < 0) throw new Error("membership_balance_insufficient");
  const now = new Date().toISOString();
  const nextMembership = {
    ...currentMembership,
    pointBalance: nextPointBalance,
    balanceAmount: nextBalanceAmount,
    transactions: [
      {
        id: `MT${Date.parse(now).toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        type,
        at: now,
        pointDelta,
        balanceDelta,
        note: trimText(input.note, 500),
        operatorId: trimText(input.operatorId, 120),
      },
      ...currentMembership.transactions,
    ].slice(0, 500),
    updatedAt: now,
  };
  const nextMemberships = [...current];
  nextMemberships[index] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  return toMerchantMembershipListItem(nextMembership);
}

export async function joinMerchantMembership(input: {
  siteId: string;
  siteName: string;
  session: PersonalAccountSession;
  profile?: unknown;
}): Promise<MerchantMembershipRecord> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  if (!siteId) throw new Error("invalid_site_id");
  const siteName = trimText(input.siteName, 120) || siteId;
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const profile = normalizeMerchantMembershipProfileDraft(input.profile, readPersonalMembershipProfileFromSession(input.session));
  const existingIndex = current.findIndex(
    (membership) =>
      (membership.accountId && membership.accountId === input.session.accountId) ||
      (membership.userId && membership.userId === input.session.userId),
  );
  const now = new Date().toISOString();
  const baseProfile = {
    siteName,
    accountId: input.session.accountId,
    userId: input.session.userId,
    email: profile.email || input.session.email,
    nickname: profile.nickname,
    name: profile.name,
    phone: profile.phone,
    avatarUrl: profile.avatarUrl,
    birthday: profile.birthday,
    birthdayMonthDayOnly: profile.birthdayMonthDayOnly,
    gender: profile.gender,
    country: profile.country,
    province: profile.province,
    city: profile.city,
    address: profile.address,
    taxName: profile.taxName,
    taxNumber: profile.taxNumber,
    taxCountry: profile.taxCountry,
    taxProvince: profile.taxProvince,
    taxCity: profile.taxCity,
    taxAddress: profile.taxAddress,
    allergens: profile.allergens,
    status: "active" as const,
    leftAt: null,
    updatedAt: now,
  };

  const nextMembership =
    existingIndex >= 0
      ? {
          ...current[existingIndex],
          ...baseProfile,
        }
      : (() => {
          const serial = current.reduce((max, item) => Math.max(max, item.serial), 0) + 1;
          return {
            id: `${siteId}:${input.session.accountId || input.session.userId}`,
            siteId,
            memberNo: buildMerchantMemberNo(siteId, serial),
            serial,
            joinedAt: now,
            pointBalance: 0,
            balanceAmount: 0,
            transactions: [],
            ...baseProfile,
          } satisfies MerchantMembershipRecord;
        })();
  const nextMemberships = existingIndex >= 0 ? [...current] : [nextMembership, ...current];
  if (existingIndex >= 0) nextMemberships[existingIndex] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  await writePersonalMembershipToMetadata(input.session, nextMembership);
  return nextMembership;
}

export async function leaveMerchantMembership(input: {
  siteId: string;
  session: PersonalAccountSession;
}): Promise<MerchantMembershipRecord> {
  const supabase = requireMembershipsStoreClient();
  const siteId = trimText(input.siteId, 64);
  if (!siteId) throw new Error("invalid_site_id");
  const stored = await loadStoredMerchantMemberships(supabase, siteId);
  const current = normalizeMerchantMembershipRecords(stored?.memberships ?? []);
  const index = current.findIndex(
    (membership) =>
      (membership.accountId && membership.accountId === input.session.accountId) ||
      (membership.userId && membership.userId === input.session.userId),
  );
  if (index < 0) throw new Error("membership_not_found");
  const now = new Date().toISOString();
  const nextMembership = {
    ...current[index],
    status: "left" as const,
    leftAt: now,
    updatedAt: now,
  };
  const nextMemberships = [...current];
  nextMemberships[index] = nextMembership;
  const saved = await saveStoredMerchantMemberships(supabase, {
    siteId,
    memberships: nextMemberships,
    updatedAt: now,
  });
  if (saved.error) throw new Error(saved.error);
  await writePersonalMembershipToMetadata(input.session, toPersonalMembershipCard(nextMembership));
  return nextMembership;
}
