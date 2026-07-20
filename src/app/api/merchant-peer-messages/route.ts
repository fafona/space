import { NextResponse } from "next/server";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import {
  createMerchantPeerMessage,
  findMerchantPeerThreadForMerchants,
  listMerchantPeerContactsForMerchant,
  listMerchantPeerThreadsForMerchant,
  upsertMerchantPeerContact,
  upsertMerchantPeerMessage,
} from "@/lib/merchantPeerInbox";
import {
  loadStoredMerchantPeerInbox,
  saveMerchantPeerInbox,
  type MerchantPeerInboxStoreClient,
} from "@/lib/merchantPeerInboxStore";
import {
  getLatestSupportReadTimestampAtOrBefore,
  getMerchantSupportReadState,
  mergeMerchantSupportReadState,
  type MerchantSupportReadStatePayload,
} from "@/lib/merchantSupportReadState";
import {
  loadStoredMerchantSupportReadState,
  saveMerchantSupportReadState,
  type MerchantSupportReadStateStoreClient,
} from "@/lib/merchantSupportReadStateStore";
import { buildMerchantPeerPushNotification } from "@/lib/merchantPushEvents";
import { type MerchantAuthUserSummary } from "@/lib/merchantAuthIdentity";
import {
  readMerchantAuthCookie,
  readMerchantRequestAccessTokens,
} from "@/lib/merchantAuthSession";
import {
  resolvePlatformAccountIdentityForUser,
  type PlatformIdentitySupabaseClient,
} from "@/lib/platformAccountIdentity";
import {
  readPlatformAccountIdFromMetadata,
  readPlatformAccountTypeHintFromMetadata,
  readPlatformUsernameFromMetadata,
} from "@/lib/platformAccounts";
import {
  loadStoredPlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import { createServerSupabaseAuthClient, createServerSupabaseServiceClient } from "@/lib/superAdminServer";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import { resolveMerchantSessionFromRequest } from "@/lib/serverMerchantSession";
import { notifyMerchantPushSubscribers } from "@/lib/webPush";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResolvedPeerRecord = {
  merchantId: string;
  merchantName: string;
  merchantEmail: string;
  accountType: "merchant" | "personal";
};

type PersonalPeerProfile = {
  accountType: "personal";
  displayName: string;
  avatarUrl: string;
  signature: string;
  phone: string;
  email: string;
  contactCard: string;
};

type MerchantPeerProfile = {
  accountType: "merchant";
  displayName: string;
  avatarUrl: string;
  signature: string;
  email: string;
  phone: string;
  contactCard: string;
  industry: string;
  location: MerchantListPublishedSite["location"] | null;
  contactName: string;
  contactAddress: string;
  domain: string;
  domainPrefix: string;
  domainSuffix: string;
  merchantCardImageUrl: string;
  contactVisibility: MerchantListPublishedSite["contactVisibility"] | null;
  chatBusinessCard: MerchantListPublishedSite["chatBusinessCard"] | null;
};

type MerchantPeerSessionHintInput = {
  siteId?: unknown;
  merchantEmail?: unknown;
  merchantName?: unknown;
} | null;

const MERCHANT_PEER_DEFAULT_THREAD_MESSAGE_LIMIT = 80;
const PERSONAL_PEER_DIRECTORY_CACHE_TTL_MS = 60_000;

type PersonalPeerDirectory = {
  profilesById: Map<string, PersonalPeerProfile>;
  recordsById: Map<string, ResolvedPeerRecord>;
  recordsByEmail: Map<string, ResolvedPeerRecord[]>;
};

let personalPeerDirectoryCache:
  | {
      expiresAt: number;
      value: PersonalPeerDirectory;
    }
  | null = null;
let personalPeerDirectoryLoad: Promise<PersonalPeerDirectory> | null = null;

function normalizeNonNegativeInteger(value: unknown) {
  const numberValue = Number(trimText(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0;
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  const numberValue = Number(trimText(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(numberValue)));
}

function readMerchantPeerThreadWindow(
  thread: ReturnType<typeof findMerchantPeerThreadForMerchants>,
  offset: number,
  limit: number,
) {
  if (!thread) {
    return {
      thread: null,
      total: 0,
      offset: 0,
      limit,
      hasMore: false,
    };
  }
  const messages = thread.messages;
  const normalizedOffset = Math.max(0, Math.floor(offset));
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const end = Math.max(0, messages.length - normalizedOffset);
  const start = Math.max(0, end - normalizedLimit);
  return {
    thread: {
      ...thread,
      messages: messages.slice(start, end),
    },
    total: messages.length,
    offset: normalizedOffset,
    limit: normalizedLimit,
    hasMore: start > 0,
  };
}

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown) {
  return trimText(value).toLowerCase();
}

function normalizeMerchantId(value: unknown) {
  const normalized = trimText(value);
  return /^\d{8}$/.test(normalized) ? normalized : "";
}

function normalizeIsoString(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) return "";
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeSupportText(value: unknown) {
  return trimText(value).slice(0, 5000);
}

function findLatestReadablePeerTimestamp(
  thread: ReturnType<typeof findMerchantPeerThreadForMerchants>,
  readerMerchantId: string,
  requestedLastReadAt: string,
) {
  return getLatestSupportReadTimestampAtOrBefore(
    (thread?.messages ?? [])
      .filter((message) => message.senderMerchantId !== readerMerchantId)
      .map((message) => message.createdAt),
    requestedLastReadAt,
  );
}

function readMetadataString(metadata: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeStoragePublicUrl(value: unknown) {
  const normalized = trimText(value);
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

function toAuthUserSummary(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
}) {
  return {
    id: user.id,
    email: user.email ?? null,
    user_metadata: user.user_metadata ?? null,
    app_metadata: user.app_metadata ?? null,
  } satisfies MerchantAuthUserSummary;
}

function readPersonalPeerProfile(user: MerchantAuthUserSummary): PersonalPeerProfile {
  const userMetadata = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const appMetadata = user.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata : {};
  const profile =
    userMetadata.personal_profile && typeof userMetadata.personal_profile === "object"
      ? (userMetadata.personal_profile as Record<string, unknown>)
      : {};
  const read = (...keys: string[]) =>
    readMetadataString(profile, ...keys) || readMetadataString(userMetadata, ...keys) || readMetadataString(appMetadata, ...keys);

  return {
    accountType: "personal",
    displayName: read("displayName", "display_name", "username", "name"),
    avatarUrl: normalizeStoragePublicUrl(read("avatarUrl", "avatar_url", "personalAvatarUrl", "chatAvatarImageUrl")),
    signature: read("signature", "bio"),
    phone: read("phone", "contact_phone", "contactPhone"),
    email: read("email", "contact_email", "contactEmail") || normalizeEmail(user.email),
    contactCard: read("contactCard", "contact_card", "businessCardUrl", "business_card_url"),
  };
}

async function loadPersonalPeerProfiles(
  supabase: PlatformIdentitySupabaseClient | null,
  accountIds: string[],
) {
  const targetIds = new Set(accountIds.map((accountId) => normalizeMerchantId(accountId)).filter(Boolean));
  const profileMap = new Map<string, PersonalPeerProfile>();
  if (!supabase || targetIds.size === 0) return profileMap;
  const directory = await loadPersonalPeerDirectory(supabase);
  targetIds.forEach((accountId) => {
    const profile = directory.profilesById.get(accountId);
    if (profile) profileMap.set(accountId, profile);
  });
  return profileMap;
}

function readMerchantPeerProfile(site: MerchantListPublishedSite): MerchantPeerProfile {
  const merchantCardImageUrl = normalizeStoragePublicUrl(site.merchantCardImageUrl);
  const avatarUrl = normalizeStoragePublicUrl(site.chatAvatarImageUrl) || merchantCardImageUrl;
  const chatBusinessCard =
    site.chatBusinessCard ??
    (Array.isArray(site.businessCards)
      ? site.businessCards.find((card) => card && card.showInChat !== false && card.chatDisplayDisabled !== true) ?? null
      : null);
  return {
    accountType: "merchant",
    displayName: trimText(site.merchantName) || trimText(site.name) || trimText(site.id),
    avatarUrl,
    signature: trimText(site.signature),
    email: normalizeEmail(site.contactEmail),
    phone: trimText(site.contactPhone),
    contactCard: merchantCardImageUrl,
    industry: trimText(site.industry),
    location: site.location ?? null,
    contactName: trimText(site.contactName),
    contactAddress: trimText(site.contactAddress),
    domain: trimText(site.domain),
    domainPrefix: trimText(site.domainPrefix),
    domainSuffix: trimText(site.domainSuffix),
    merchantCardImageUrl,
    contactVisibility: site.contactVisibility ?? null,
    chatBusinessCard,
  };
}

async function loadMerchantPeerProfiles(
  supabase: PlatformMerchantSnapshotStoreClient | null,
  accountIds: string[],
) {
  const targetIds = new Set(accountIds.map((accountId) => normalizeMerchantId(accountId)).filter(Boolean));
  const profileMap = new Map<string, MerchantPeerProfile>();
  if (!supabase || targetIds.size === 0) return profileMap;

  const snapshotPayload = await loadStoredPlatformMerchantSnapshot(supabase).catch(() => null);
  (snapshotPayload?.snapshot ?? []).forEach((site) => {
    const siteId = normalizeMerchantId(site.id);
    if (!siteId || !targetIds.has(siteId)) return;
    profileMap.set(siteId, readMerchantPeerProfile(site));
  });
  return profileMap;
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

async function resolveMerchantPeerSession(request: Request, hint?: MerchantPeerSessionHintInput) {
  const merchantSession = await resolveMerchantSessionFromRequest(request, {
    hintedMerchantId: normalizeMerchantId(hint?.siteId),
    hintedMerchantEmail: normalizeEmail(hint?.merchantEmail),
    hintedMerchantName: trimText(hint?.merchantName),
  });
  if (merchantSession) return merchantSession;

  const authSupabase = createServerSupabaseAuthClient();
  const adminSupabase = createServerSupabaseServiceClient() as unknown as PlatformIdentitySupabaseClient | null;
  if (!authSupabase) return null;

  const accessTokens = readMerchantRequestAccessTokens(request);
  const fallbackAccessToken = readMerchantAuthCookie(request);
  const candidates = [...accessTokens, fallbackAccessToken].map((value) => trimText(value)).filter(Boolean);
  let user: MerchantAuthUserSummary | null = null;
  for (const accessToken of candidates) {
    const { data, error } = await authSupabase.auth
      .getUser(accessToken)
      .catch(() => ({ data: null, error: true }));
    if (!error && data?.user) {
      user = data.user as MerchantAuthUserSummary;
      break;
    }
  }
  if (!user) return null;

  const identity = await resolvePlatformAccountIdentityForUser(adminSupabase, user);
  if (identity.accountType !== "personal" || !identity.accountId) return null;

  return {
    merchantId: identity.accountId,
    merchantEmail: normalizeEmail(user.email),
    merchantName: trimText(hint?.merchantName) || readPlatformUsernameFromMetadata(user) || normalizeEmail(user.email),
  };
}

function readResolvedMerchantEmail(record: Record<string, unknown> | null | undefined) {
  const candidates = [
    record?.user_email,
    record?.email,
    record?.owner_email,
    record?.contact_email,
  ];
  return candidates.map((value) => normalizeEmail(value)).find(Boolean) ?? "";
}

function toResolvedMerchantRecord(record: Record<string, unknown> | null | undefined) {
  const merchantId = normalizeMerchantId(record?.id);
  if (!merchantId) return null;
  return {
    merchantId,
    merchantName: trimText(record?.name) || merchantId,
    merchantEmail: readResolvedMerchantEmail(record),
    accountType: "merchant",
  } satisfies ResolvedPeerRecord;
}

function toResolvedPersonalRecord(user: MerchantAuthUserSummary | null | undefined) {
  const accountId = readPlatformAccountIdFromMetadata(user);
  if (!accountId || readPlatformAccountTypeHintFromMetadata(user, "") !== "personal") return null;
  const profile = readPersonalPeerProfile(
    user ?? {
      id: "",
      email: null,
      user_metadata: null,
      app_metadata: null,
    },
  );
  return {
    merchantId: accountId,
    merchantName: profile.displayName || readPlatformUsernameFromMetadata(user) || normalizeEmail(user?.email) || accountId,
    merchantEmail: profile.email || normalizeEmail(user?.email),
    accountType: "personal",
  } satisfies ResolvedPeerRecord;
}

async function loadPersonalPeerDirectory(
  supabase: PlatformIdentitySupabaseClient,
  options?: { forceRefresh?: boolean },
): Promise<PersonalPeerDirectory> {
  if (!options?.forceRefresh && personalPeerDirectoryCache && personalPeerDirectoryCache.expiresAt > Date.now()) {
    return personalPeerDirectoryCache.value;
  }
  if (personalPeerDirectoryLoad) return personalPeerDirectoryLoad;

  const task = (async () => {
    const directory: PersonalPeerDirectory = {
      profilesById: new Map(),
      recordsById: new Map(),
      recordsByEmail: new Map(),
    };
    let page = 1;
    let completed = false;
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 }).catch(() => ({
        data: null,
        error: new Error("list_users_failed"),
      }));
      if (error) break;
      const users = data?.users ?? [];
      for (const user of users) {
        const summary = toAuthUserSummary(user);
        if (readPlatformAccountTypeHintFromMetadata(summary, "") !== "personal") continue;
        const record = toResolvedPersonalRecord(summary);
        if (!record) continue;
        const profile = readPersonalPeerProfile(summary);
        directory.profilesById.set(record.merchantId, profile);
        directory.recordsById.set(record.merchantId, record);
        const emails = new Set([normalizeEmail(summary.email), normalizeEmail(profile.email)].filter(Boolean));
        emails.forEach((email) => {
          const current = directory.recordsByEmail.get(email) ?? [];
          if (!current.some((item) => item.merchantId === record.merchantId)) {
            directory.recordsByEmail.set(email, [...current, record]);
          }
        });
      }
      if (users.length < 200) {
        completed = true;
        break;
      }
      page += 1;
    }
    if (completed) {
      personalPeerDirectoryCache = {
        expiresAt: Date.now() + PERSONAL_PEER_DIRECTORY_CACHE_TTL_MS,
        value: directory,
      };
    }
    return directory;
  })();
  personalPeerDirectoryLoad = task;
  try {
    return await task;
  } finally {
    if (personalPeerDirectoryLoad === task) personalPeerDirectoryLoad = null;
  }
}

async function resolveMerchantById(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  merchantId: string,
) {
  const normalizedMerchantId = normalizeMerchantId(merchantId);
  if (!supabase || !normalizedMerchantId) return null;
  const { data, error } = await supabase
    .from("merchants")
    .select("id,name,email,owner_email,contact_email,user_email")
    .eq("id", normalizedMerchantId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return toResolvedMerchantRecord((data ?? null) as Record<string, unknown> | null);
}

async function resolveMerchantByEmail(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  email: string,
) {
  const normalizedEmail = normalizeEmail(email);
  if (!supabase || !normalizedEmail) return { record: null, ambiguous: false };

  const lookups = await Promise.allSettled(
    ["email", "owner_email", "contact_email", "user_email"].map((column) =>
      supabase
        .from("merchants")
        .select("id,name,email,owner_email,contact_email,user_email")
        .eq(column, normalizedEmail)
        .limit(10),
    ),
  );
  const records = new Map<string, ResolvedPeerRecord>();
  lookups.forEach((result) => {
    if (result.status !== "fulfilled" || result.value.error) return;
    const rows = Array.isArray(result.value.data) ? result.value.data : [];
    rows.forEach((row) => {
      const record = toResolvedMerchantRecord((row ?? null) as Record<string, unknown> | null);
      if (!record || records.has(record.merchantId)) return;
      records.set(record.merchantId, record);
    });
  });
  const resolved = [...records.values()];
  return {
    record: resolved[0] ?? null,
    ambiguous: resolved.length > 1,
  };
}

async function resolvePersonalById(
  supabase: PlatformIdentitySupabaseClient | null,
  accountId: string,
) {
  const normalizedAccountId = normalizeMerchantId(accountId);
  if (!supabase || !normalizedAccountId) return null;
  const directory = await loadPersonalPeerDirectory(supabase);
  const cachedRecord = directory.recordsById.get(normalizedAccountId) ?? null;
  if (cachedRecord) return cachedRecord;
  const refreshedDirectory = await loadPersonalPeerDirectory(supabase, { forceRefresh: true });
  return refreshedDirectory.recordsById.get(normalizedAccountId) ?? null;
}

async function resolvePersonalByEmail(
  supabase: PlatformIdentitySupabaseClient | null,
  email: string,
) {
  const normalizedEmail = normalizeEmail(email);
  if (!supabase || !normalizedEmail || !normalizedEmail.includes("@")) {
    return { record: null, ambiguous: false };
  }
  const directory = await loadPersonalPeerDirectory(supabase);
  let resolved = directory.recordsByEmail.get(normalizedEmail) ?? [];
  if (resolved.length === 0) {
    const refreshedDirectory = await loadPersonalPeerDirectory(supabase, { forceRefresh: true });
    resolved = refreshedDirectory.recordsByEmail.get(normalizedEmail) ?? [];
  }
  return {
    record: resolved[0] ?? null,
    ambiguous: resolved.length > 1,
  };
}

async function resolveMerchantByExactQuery(
  supabase: ReturnType<typeof createServerSupabaseServiceClient>,
  query: string,
) {
  const normalizedQuery = trimText(query);
  if (!normalizedQuery) {
    return { record: null, error: "search_empty" as const };
  }
  const merchantId = normalizeMerchantId(normalizedQuery);
  if (merchantId) {
    return {
      record: await resolveMerchantById(supabase, merchantId),
      error: null,
    };
  }

  const email = normalizeEmail(normalizedQuery);
  if (email && email.includes("@")) {
    const resolved = await resolveMerchantByEmail(supabase, email);
    if (resolved.ambiguous) {
      return { record: null, error: "search_ambiguous" as const };
    }
    return {
      record: resolved.record,
      error: null,
    };
  }

  return { record: null, error: "search_requires_exact_id_or_email" as const };
}

async function resolvePeerById(
  supabase: ReturnType<typeof createServerSupabaseServiceClient> | null,
  accountId: string,
) {
  const normalizedAccountId = normalizeMerchantId(accountId);
  if (!supabase || !normalizedAccountId) return null;
  const identitySupabase = supabase as unknown as PlatformIdentitySupabaseClient | null;

  const merchantRecord = await resolveMerchantById(supabase, normalizedAccountId);
  return merchantRecord ?? (await resolvePersonalById(identitySupabase, normalizedAccountId));
}

async function resolvePeerContact(
  supabase: ReturnType<typeof createServerSupabaseServiceClient> | null,
  input: {
    accountId?: unknown;
    email?: unknown;
    preferredAccountType?: unknown;
  },
) {
  const accountId = normalizeMerchantId(input.accountId);
  const email = normalizeEmail(input.email);
  const preferredAccountType =
    input.preferredAccountType === "personal"
      ? "personal"
      : input.preferredAccountType === "merchant"
        ? "merchant"
        : "";
  const identitySupabase = supabase as unknown as PlatformIdentitySupabaseClient | null;

  if (accountId) {
    if (preferredAccountType === "personal") {
      const personalRecord = await resolvePersonalById(identitySupabase, accountId);
      const merchantRecord = personalRecord ? null : await resolveMerchantById(supabase, accountId);
      return {
        record: personalRecord ?? merchantRecord,
        error: null,
      };
    }
    if (preferredAccountType === "merchant") {
      const merchantRecord = await resolveMerchantById(supabase, accountId);
      const personalRecord = merchantRecord ? null : await resolvePersonalById(identitySupabase, accountId);
      return {
        record: merchantRecord ?? personalRecord,
        error: null,
      };
    }
    return { record: await resolvePeerById(supabase, accountId), error: null };
  }

  if (!email || !email.includes("@")) {
    return { record: null, error: "search_requires_exact_id_or_email" as const };
  }

  if (preferredAccountType === "personal") {
    const resolved = await resolvePersonalByEmail(identitySupabase, email);
    if (resolved.ambiguous) return { record: null, error: "search_ambiguous" as const };
    return { record: resolved.record, error: null };
  }

  if (preferredAccountType === "merchant") {
    const resolved = await resolveMerchantByEmail(supabase, email);
    if (resolved.ambiguous) return { record: null, error: "search_ambiguous" as const };
    return { record: resolved.record, error: null };
  }

  const personalResolved = await resolvePersonalByEmail(identitySupabase, email);
  const merchantResolved = await resolveMerchantByEmail(supabase, email);
  const candidates = [personalResolved.record, merchantResolved.record].filter(
    (record): record is ResolvedPeerRecord => Boolean(record),
  );
  if (personalResolved.ambiguous || merchantResolved.ambiguous || candidates.length > 1) {
    return { record: null, error: "search_ambiguous" as const };
  }
  return { record: candidates[0] ?? null, error: null };
}

async function buildInboxResponse(
  payload: Awaited<ReturnType<typeof loadStoredMerchantPeerInbox>>,
  merchantId: string,
  supabase?: (PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient) | null,
  readStatePayload?: MerchantSupportReadStatePayload | null,
  options?: { threadMessageLimit?: number },
) {
  const contacts = listMerchantPeerContactsForMerchant(payload, merchantId);
  const contactMerchantIds = contacts.map((contact) => contact.merchantId);
  const [personalProfiles, merchantProfiles] = await Promise.all([
    loadPersonalPeerProfiles(supabase ?? null, contactMerchantIds),
    loadMerchantPeerProfiles(supabase ?? null, contactMerchantIds),
  ]);
  const enrichedContacts = contacts.map((contact) => {
    const personalProfile = personalProfiles.get(contact.merchantId);
    const merchantProfile = merchantProfiles.get(contact.merchantId);
    const peerProfile = personalProfile ?? merchantProfile ?? null;
    if (!peerProfile) return contact;
    return {
      ...contact,
      accountType: peerProfile.accountType,
      merchantName: peerProfile.displayName || contact.merchantName,
      merchantEmail: peerProfile.email || contact.merchantEmail,
      avatarImageUrl: peerProfile.avatarUrl,
      chatAvatarImageUrl: peerProfile.avatarUrl,
      signature: peerProfile.signature,
      contactPhone: peerProfile.phone,
      contactCard: peerProfile.contactCard,
      ...(merchantProfile
        ? {
            industry: merchantProfile.industry,
            location: merchantProfile.location,
            contactName: merchantProfile.contactName,
            contactAddress: merchantProfile.contactAddress,
            domain: merchantProfile.domain,
            domainPrefix: merchantProfile.domainPrefix,
            domainSuffix: merchantProfile.domainSuffix,
            merchantCardImageUrl: merchantProfile.merchantCardImageUrl,
            contactVisibility: merchantProfile.contactVisibility,
            chatBusinessCard: merchantProfile.chatBusinessCard,
          }
        : {}),
    };
  });
  const threadMessageLimit = Math.max(1, options?.threadMessageLimit ?? MERCHANT_PEER_DEFAULT_THREAD_MESSAGE_LIMIT);
  const threads = listMerchantPeerThreadsForMerchant(payload, merchantId).map((thread) => ({
    ...thread,
    messages: thread.messages.slice(-threadMessageLimit),
  }));
  const readState = readStatePayload ? getMerchantSupportReadState(readStatePayload, merchantId) : null;
  return {
    ok: true,
    contacts: enrichedContacts,
    threads,
    ...(readState ? { readState: { peerLastRead: readState.peerLastRead } } : {}),
  };
}

export async function GET(request: Request) {
  const session = await resolveMerchantPeerSession(request);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_peer_inbox_env_missing" }, { status: 503 });
  }

  const [payload, readStatePayload] = await Promise.all([
    loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient),
    loadStoredMerchantSupportReadState(supabase as unknown as MerchantSupportReadStateStoreClient),
  ]);
  const url = new URL(request.url);
  const contactMerchantId = normalizeMerchantId(url.searchParams.get("contactMerchantId"));
  if (contactMerchantId) {
    const offset = normalizeNonNegativeInteger(url.searchParams.get("offset"));
    const limit = normalizePositiveInteger(url.searchParams.get("limit"), MERCHANT_PEER_DEFAULT_THREAD_MESSAGE_LIMIT, 200);
    const fullThread = findMerchantPeerThreadForMerchants(payload, session.merchantId, contactMerchantId);
    const windowResult = readMerchantPeerThreadWindow(fullThread, offset, limit);
    return noStoreJson({
      ok: true,
      thread: windowResult.thread,
      messagePage: {
        total: windowResult.total,
        offset: windowResult.offset,
        limit: windowResult.limit,
        hasMore: windowResult.hasMore,
      },
      currentMerchantId: session.merchantId,
      currentMerchantEmail: session.merchantEmail,
    });
  }
  return noStoreJson({
    ...(await buildInboxResponse(
      payload,
      session.merchantId,
      supabase as unknown as PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient,
      readStatePayload,
    )),
    currentMerchantId: session.merchantId,
    currentMerchantEmail: session.merchantEmail,
  });
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  const body = (await request.json().catch(() => null)) as
      | {
          action?: unknown;
          query?: unknown;
          text?: unknown;
          recipientMerchantId?: unknown;
          contactMerchantId?: unknown;
          lastReadAt?: unknown;
          merchantName?: unknown;
          merchantEmail?: unknown;
          siteId?: unknown;
          contactAccountId?: unknown;
          contactEmail?: unknown;
          contactName?: unknown;
          contactAccountType?: unknown;
        }
      | null;
  const session = await resolveMerchantPeerSession(request, body);
  if (!session) {
    return noStoreJson({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServerSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ error: "merchant_peer_inbox_env_missing" }, { status: 503 });
  }

  const action = trimText(body?.action);

  if (action === "mark_read") {
    const contactMerchantId = normalizeMerchantId(body?.contactMerchantId);
    const requestedLastReadAt = normalizeIsoString(body?.lastReadAt);
    if (!contactMerchantId || !requestedLastReadAt || contactMerchantId === session.merchantId) {
      return noStoreJson({ error: "merchant_read_state_invalid" }, { status: 400 });
    }

    const [inboxPayload, readStatePayload] = await Promise.all([
      loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient),
      loadStoredMerchantSupportReadState(supabase as unknown as MerchantSupportReadStateStoreClient),
    ]);
    const thread = findMerchantPeerThreadForMerchants(inboxPayload, session.merchantId, contactMerchantId);
    const lastReadAt = findLatestReadablePeerTimestamp(thread, session.merchantId, requestedLastReadAt);
    if (!lastReadAt) {
      const readState = getMerchantSupportReadState(readStatePayload, session.merchantId);
      return noStoreJson({
        ok: true,
        readState: {
          peerLastRead: readState.peerLastRead,
        },
      });
    }
    const nextReadStatePayload = mergeMerchantSupportReadState(readStatePayload, session.merchantId, {
      peerLastRead: {
        [contactMerchantId]: lastReadAt,
      },
    });
    const saveReadStateResult = await saveMerchantSupportReadState(
      supabase as unknown as MerchantSupportReadStateStoreClient,
      nextReadStatePayload,
    );
    if (saveReadStateResult.error) {
      return noStoreJson(
        { error: "merchant_read_state_save_failed", message: saveReadStateResult.error },
        { status: 500 },
      );
    }
    const readState = getMerchantSupportReadState(
      saveReadStateResult.payload ?? nextReadStatePayload,
      session.merchantId,
    );
    return noStoreJson({
      ok: true,
      readState: {
        peerLastRead: readState.peerLastRead,
      },
    });
  }

  if (action === "search") {
    const resolved = await resolveMerchantByExactQuery(supabase, trimText(body?.query));
    if (resolved.error === "search_empty") {
      return noStoreJson({ error: "search_empty", message: "请输入完整的商户ID或邮箱。" }, { status: 400 });
    }
    if (resolved.error === "search_requires_exact_id_or_email") {
      return noStoreJson(
        { error: "search_requires_exact_id_or_email", message: "只支持精确搜索 8 位商户ID或完整邮箱。" },
        { status: 400 },
      );
    }
    if (resolved.error === "search_ambiguous") {
      return noStoreJson(
        { error: "search_ambiguous", message: "这个邮箱对应多个商户，请改用商户ID精确搜索。" },
        { status: 409 },
      );
    }
    if (!resolved.record) {
      return noStoreJson({ error: "merchant_not_found", message: "没有找到匹配的商户。" }, { status: 404 });
    }
    if (resolved.record.merchantId === session.merchantId) {
      return noStoreJson(
        { error: "cannot_chat_with_self", message: "不能搜索自己，请输入其他商户的ID或邮箱。" },
        { status: 400 },
      );
    }

    const [payload, readStatePayload] = await Promise.all([
      loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient),
      loadStoredMerchantSupportReadState(supabase as unknown as MerchantSupportReadStateStoreClient),
    ]);
    const nextPayload = upsertMerchantPeerContact(payload, {
      ownerMerchantId: session.merchantId,
      contactMerchantId: resolved.record.merchantId,
      contactName: resolved.record.merchantName,
      contactEmail: resolved.record.merchantEmail,
    });
    const saveResult = await saveMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient, nextPayload);
    if (saveResult.error) {
      return noStoreJson(
        { error: "merchant_contact_save_failed", message: saveResult.error },
        { status: 500 },
      );
    }
    const persistedPayload = saveResult.payload ?? nextPayload;

    return noStoreJson({
      ...(await buildInboxResponse(
        persistedPayload,
        session.merchantId,
        supabase as unknown as PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient,
        readStatePayload,
      )),
      contact: resolved.record,
    });
  }

  if (action === "ensure_contact") {
    const resolved = await resolvePeerContact(
      supabase as unknown as ReturnType<typeof createServerSupabaseServiceClient>,
      {
        accountId: body?.contactAccountId,
        email: body?.contactEmail,
        preferredAccountType: body?.contactAccountType,
      },
    );
    if (resolved.error === "search_requires_exact_id_or_email") {
      return noStoreJson(
        { error: "search_requires_exact_id_or_email", message: "请提供完整的 8 位账号 ID 或邮箱。" },
        { status: 400 },
      );
    }
    if (resolved.error === "search_ambiguous") {
      return noStoreJson(
        { error: "search_ambiguous", message: "这个邮箱对应多个账号，请改用 8 位账号 ID。" },
        { status: 409 },
      );
    }
    if (!resolved.record) {
      return noStoreJson({ error: "peer_not_found", message: "没有找到匹配的用户。" }, { status: 404 });
    }
    if (resolved.record.merchantId === session.merchantId) {
      return noStoreJson({ error: "cannot_chat_with_self", message: "不能和自己发起会话。" }, { status: 400 });
    }

    const [payload, readStatePayload] = await Promise.all([
      loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient),
      loadStoredMerchantSupportReadState(supabase as unknown as MerchantSupportReadStateStoreClient),
    ]);
    const nextPayload = upsertMerchantPeerContact(payload, {
      ownerMerchantId: session.merchantId,
      contactMerchantId: resolved.record.merchantId,
      contactName: trimText(body?.contactName) || resolved.record.merchantName,
      contactEmail: normalizeEmail(body?.contactEmail) || resolved.record.merchantEmail,
    });
    const saveResult = await saveMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient, nextPayload);
    if (saveResult.error) {
      return noStoreJson(
        { error: "merchant_contact_save_failed", message: saveResult.error },
        { status: 500 },
      );
    }
    const persistedPayload = saveResult.payload ?? nextPayload;

    return noStoreJson({
      ...(await buildInboxResponse(
        persistedPayload,
        session.merchantId,
        supabase as unknown as PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient,
        readStatePayload,
      )),
      contact: resolved.record,
    });
  }

  if (action === "send") {
    const text = normalizeSupportText(body?.text);
    const recipientMerchantId = normalizeMerchantId(body?.recipientMerchantId);
    if (!recipientMerchantId || !text) {
      return noStoreJson({ error: "merchant_message_invalid" }, { status: 400 });
    }
    if (recipientMerchantId === session.merchantId) {
      return noStoreJson({ error: "cannot_chat_with_self", message: "不能给自己发送消息。" }, { status: 400 });
    }

    const [recipient, senderRecord, payload, readStatePayload] = await Promise.all([
      resolvePeerById(
        supabase as unknown as ReturnType<typeof createServerSupabaseServiceClient>,
        recipientMerchantId,
      ),
      resolvePeerById(
        supabase as unknown as ReturnType<typeof createServerSupabaseServiceClient>,
        session.merchantId,
      ),
      loadStoredMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient),
      loadStoredMerchantSupportReadState(supabase as unknown as MerchantSupportReadStateStoreClient),
    ]);
    if (!recipient) {
      return noStoreJson({ error: "merchant_not_found", message: "目标商户不存在。" }, { status: 404 });
    }
    const sender =
      senderRecord ??
      ({
        merchantId: session.merchantId,
        merchantName: trimText(body?.merchantName) || session.merchantName || session.merchantId,
        merchantEmail: normalizeEmail(body?.merchantEmail) || session.merchantEmail,
        accountType: "merchant",
      } satisfies ResolvedPeerRecord);
    const nextPayload = upsertMerchantPeerMessage(payload, {
      senderMerchantId: sender.merchantId,
      senderMerchantName: trimText(body?.merchantName) || sender.merchantName,
      senderMerchantEmail: normalizeEmail(body?.merchantEmail) || sender.merchantEmail,
      recipientMerchantId: recipient.merchantId,
      recipientMerchantName: recipient.merchantName,
      recipientMerchantEmail: recipient.merchantEmail,
      message: createMerchantPeerMessage({
        senderMerchantId: sender.merchantId,
        text,
      }),
    });
    const saveResult = await saveMerchantPeerInbox(supabase as unknown as MerchantPeerInboxStoreClient, nextPayload);
    if (saveResult.error) {
      return noStoreJson(
        { error: "merchant_message_save_failed", message: saveResult.error },
        { status: 500 },
      );
    }
    const persistedPayload = saveResult.payload ?? nextPayload;

    if (recipient.accountType === "merchant") {
      const notification = buildMerchantPeerPushNotification({
        recipientMerchantId: recipient.merchantId,
        senderMerchantId: sender.merchantId,
        senderMerchantName: sender.merchantName,
        text,
      });

      void notifyMerchantPushSubscribers(supabase as unknown as MerchantPeerInboxStoreClient, {
        merchantId: recipient.merchantId,
        ...notification,
      }).catch(() => {
        // Ignore notification delivery failures; the saved message should still succeed.
      });
    }

    return noStoreJson({
      ...(await buildInboxResponse(
        persistedPayload,
        session.merchantId,
        supabase as unknown as PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient,
        readStatePayload,
      )),
      thread: findMerchantPeerThreadForMerchants(persistedPayload, session.merchantId, recipient.merchantId),
    });
  }

  return noStoreJson({ error: "unsupported_action" }, { status: 400 });
}
