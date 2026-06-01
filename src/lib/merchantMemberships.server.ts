import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import {
  buildMerchantMemberNo,
  buildMerchantMembershipQrValue,
  normalizeMerchantMembershipRecords,
  normalizeMerchantMembershipProfileDraft,
  toMerchantMembershipListItem,
  toPersonalMembershipCard,
  writePersonalMembershipCardToUserMetadata,
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
    name: customerProfile.name,
    phone: customerProfile.phone,
    email: session.email || customerProfile.email || customerProfile.loginEmail,
    avatarUrl: readProfileAvatarUrl(session),
    birthday: trimText(profile.birthday, 32),
    gender: trimText(profile.gender, 32),
    country: trimText(profile.country, 80),
    province: trimText(profile.province, 80),
    city: trimText(profile.city, 80),
    address: trimText(profile.address, 240),
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
    name: profile.name,
    phone: profile.phone,
    avatarUrl: profile.avatarUrl,
    birthday: profile.birthday,
    gender: profile.gender,
    country: profile.country,
    province: profile.province,
    city: profile.city,
    address: profile.address,
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
