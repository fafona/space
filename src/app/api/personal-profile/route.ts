import { NextResponse } from "next/server";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import { readMerchantAuthCookie, readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PersonalProfilePatch = {
  displayName?: unknown;
  avatarUrl?: unknown;
  signature?: unknown;
  phone?: unknown;
  email?: unknown;
  contactCard?: unknown;
  birthday?: unknown;
  gender?: unknown;
  country?: unknown;
  province?: unknown;
  city?: unknown;
  address?: unknown;
};

function trimText(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeDate(value: unknown) {
  const normalized = trimText(value, 32);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}

function normalizeGender(value: unknown) {
  const normalized = trimText(value, 32);
  return normalized === "male" || normalized === "female" || normalized === "other" ? normalized : "";
}

function normalizeStoragePublicUrl(value: unknown, maxLength = 1200) {
  const normalized = trimText(value, maxLength);
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.protocol === "http:" && url.pathname.startsWith("/storage/v1/object/public/")) {
      url.protocol = "https:";
      return url.toString();
    }
  } catch {
    return normalized;
  }
  return normalized;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolvePersonalUser(request: Request) {
  const authSupabase = createServerSupabaseAuthClient();
  const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
  if (!authSupabase || !adminSupabase) return null;

  const accessTokens = readMerchantRequestAccessTokens(request);
  const fallbackAccessToken = readMerchantAuthCookie(request);
  const candidates = [...accessTokens, fallbackAccessToken].map((value) => trimText(value, 4096)).filter(Boolean);
  let user: MerchantAuthUserSummary | null = null;
  for (const accessToken of candidates) {
    const { data, error } = await authSupabase.auth.getUser(accessToken).catch(() => ({ data: null, error: true }));
    if (!error && data?.user) {
      user = data.user as MerchantAuthUserSummary;
      break;
    }
  }
  if (!user?.id) return null;

  const identity = await resolvePlatformAccountIdentityForUser(adminSupabase, user);
  if (identity.accountType !== "personal" || !identity.accountId) return null;

  return { adminSupabase, user, accountId: identity.accountId };
}

function buildProfileMetadataPatch(user: MerchantAuthUserSummary, patch: PersonalProfilePatch) {
  const userMetadata = user.user_metadata && typeof user.user_metadata === "object" ? { ...user.user_metadata } : {};
  const personalProfile =
    userMetadata.personal_profile && typeof userMetadata.personal_profile === "object"
      ? { ...(userMetadata.personal_profile as Record<string, unknown>) }
      : {};
  const nextProfile = {
    ...personalProfile,
    displayName: trimText(patch.displayName, 80),
    avatarUrl: normalizeStoragePublicUrl(patch.avatarUrl, 1200),
    signature: trimText(patch.signature, 160),
    phone: trimText(patch.phone, 64),
    email: trimText(patch.email, 160),
    contactCard: trimText(patch.contactCard, 1200),
    birthday: normalizeDate(patch.birthday),
    gender: normalizeGender(patch.gender),
    country: trimText(patch.country, 80),
    province: trimText(patch.province, 80),
    city: trimText(patch.city, 80),
    address: trimText(patch.address, 240),
  };

  userMetadata.personal_profile = nextProfile;
  userMetadata.display_name = nextProfile.displayName;
  userMetadata.displayName = nextProfile.displayName;
  userMetadata.avatar_url = nextProfile.avatarUrl;
  userMetadata.avatarUrl = nextProfile.avatarUrl;
  userMetadata.signature = nextProfile.signature;
  userMetadata.phone = nextProfile.phone;
  userMetadata.contact_phone = nextProfile.phone;
  userMetadata.contactPhone = nextProfile.phone;
  userMetadata.email = nextProfile.email;
  userMetadata.contact_email = nextProfile.email;
  userMetadata.contactEmail = nextProfile.email;
  userMetadata.contact_card = nextProfile.contactCard;
  userMetadata.contactCard = nextProfile.contactCard;
  userMetadata.birthday = nextProfile.birthday;
  userMetadata.gender = nextProfile.gender;
  userMetadata.country = nextProfile.country;
  userMetadata.province = nextProfile.province;
  userMetadata.city = nextProfile.city;
  userMetadata.address = nextProfile.address;

  return { userMetadata, personalProfile: nextProfile };
}

export async function GET(request: Request) {
  const session = await resolvePersonalUser(request);
  if (!session) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });
  return noStoreJson({
    ok: true,
    accountId: session.accountId,
    user: session.user,
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const session = await resolvePersonalUser(request);
  if (!session) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });

  const payload = (await request.json().catch(() => null)) as { profile?: PersonalProfilePatch } | null;
  const patch = payload?.profile && typeof payload.profile === "object" ? payload.profile : null;
  if (!patch) return noStoreJson({ ok: false, error: "invalid_profile_payload" }, { status: 400 });

  const { userMetadata, personalProfile } = buildProfileMetadataPatch(session.user, patch);
  const userId = trimText(session.user.id, 128);
  if (!userId) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data, error } = await session.adminSupabase.auth.admin.updateUserById(userId, {
    user_metadata: userMetadata,
  });
  if (error) {
    return noStoreJson({ ok: false, error: "personal_profile_save_failed", message: error.message }, { status: 500 });
  }

  return noStoreJson({
    ok: true,
    accountId: session.accountId,
    profile: personalProfile,
    user: data?.user ?? {
      ...session.user,
      user_metadata: userMetadata,
    },
  });
}
