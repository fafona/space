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
  buildPeerWriteDecoration,
  buildPersonalPeerDecoration,
  loadCompletePersonalPeerBindingDirectory,
  redactPersonalPeerIdentityData,
} from "@/lib/merchantPeerPrivacy";
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
  readPlatformUsernameFromMetadata,
} from "@/lib/platformAccounts";
import { normalizeCanonicalPersonalAccountId } from "@/lib/personalAccountId";
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
  authUserIdsByAccountId: Map<string, string>;
  knownPersonalAccountIds: Set<string>;
};

type PersonalBindingRow = {
  auth_user_id?: unknown;
  personal_account_id?: unknown;
  status?: unknown;
};

type PersonalBindingListResult = {
  data: PersonalBindingRow[] | null;
  error: unknown;
  count: number | null;
};

type PersonalBindingListQuery = PromiseLike<PersonalBindingListResult> & {
  select: (
    columns: string,
    options: { count: "exact" },
  ) => PersonalBindingListQuery;
  eq: (column: string, value: unknown) => PersonalBindingListQuery;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => PersonalBindingListQuery;
  range: (from: number, to: number) => PersonalBindingListQuery;
};

type PersonalPeerDirectoryClient = PlatformIdentitySupabaseClient & {
  from: (table: string) => PersonalBindingListQuery;
  auth: PlatformIdentitySupabaseClient["auth"] & {
    admin: PlatformIdentitySupabaseClient["auth"]["admin"] & {
      getUserById: (userId: string) => Promise<{
        data: { user: MerchantAuthUserSummary | null } | null;
        error: unknown;
      }>;
    };
  };
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

function normalizePeerAccountId(value: unknown) {
  return typeof value === "string" && /^\d{8}$/.test(value) ? value : "";
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
    // Sensitive contact fields require an explicit visibility/relationship
    // policy. Until that exists, directory lookup never discloses them.
    phone: "",
    email: "",
    contactCard: "",
  };
}

async function loadPersonalPeerProfiles(
  supabase: PlatformIdentitySupabaseClient | null,
  accountIds: string[],
) {
  const targetIds = new Set(accountIds.map((accountId) => normalizePeerAccountId(accountId)).filter(Boolean));
  const profileMap = new Map<string, PersonalPeerProfile>();
  if (!supabase || targetIds.size === 0) return profileMap;
  const directory = await loadPersonalPeerDirectory(supabase);
  targetIds.forEach((accountId) => {
    const profile = directory.profilesById.get(accountId);
    if (profile) {
      profileMap.set(accountId, profile);
    } else if (directory.knownPersonalAccountIds.has(accountId)) {
      profileMap.set(accountId, {
        accountType: "personal",
        displayName: "",
        avatarUrl: "",
        signature: "",
        phone: "",
        email: "",
        contactCard: "",
      });
    }
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
  if (merchantSession) {
    return { ...merchantSession, accountType: "merchant" as const };
  }

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
  return buildPersonalPeerDecoration({
    accountId: identity.accountId,
    publicName: readPlatformUsernameFromMetadata(user),
    privateEmail: user.email,
  });
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

function toResolvedPersonalRecord(
  user: MerchantAuthUserSummary | null | undefined,
  authoritativeAccountId: string,
) {
  const accountId = normalizePeerAccountId(authoritativeAccountId);
  if (!accountId) return null;
  const profile = readPersonalPeerProfile(
    user ?? {
      id: "",
      email: null,
      user_metadata: null,
      app_metadata: null,
    },
  );
  return buildPersonalPeerDecoration({
    accountId,
    publicName:
      profile.displayName || readPlatformUsernameFromMetadata(user),
    privateEmail: user?.email,
  }) satisfies ResolvedPeerRecord;
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
    const directoryClient = supabase as PersonalPeerDirectoryClient;
    const directory: PersonalPeerDirectory = {
      profilesById: new Map(),
      recordsById: new Map(),
      recordsByEmail: new Map(),
      authUserIdsByAccountId: new Map(),
      knownPersonalAccountIds: new Set(),
    };
    const completeBindings = await loadCompletePersonalPeerBindingDirectory(
      (from, to) =>
        Promise.resolve(
          directoryClient
            .from("faolla_personal_accounts")
            .select("auth_user_id,personal_account_id,status", {
              count: "exact",
            })
            .order("personal_account_id", { ascending: true })
            .range(from, to),
        ),
    );
    completeBindings.forEach((binding) => {
      directory.knownPersonalAccountIds.add(binding.accountId);
    });
    const activeBindings = completeBindings.filter(
      (binding) => binding.status === "active",
    );
    // Canonical rows are candidates only. Revalidate each exact UUID through
    // the resolver before adding it to a public peer directory.
    for (let offset = 0; offset < activeBindings.length; offset += 16) {
      const entries = await Promise.all(
        activeBindings.slice(offset, offset + 16).map(async (binding) => {
          const authResult = await directoryClient.auth.admin
            .getUserById(binding.authUserId)
            .catch(() => null);
          const user = authResult && !authResult.error
            ? authResult.data?.user ?? null
            : null;
          if (!user || trimText(user.id) !== binding.authUserId) return null;
          const summary = toAuthUserSummary({
            ...user,
            id: binding.authUserId,
          });
          const identity = await resolvePlatformAccountIdentityForUser(
            supabase,
            summary,
          ).catch(() => null);
          if (
            !identity ||
            identity.accountType !== "personal" ||
            identity.accountId !== binding.accountId
          ) return null;
          const record = toResolvedPersonalRecord(
            summary,
            identity.accountId,
          );
          if (!record) return null;
          return {
            summary,
            record,
            profile: readPersonalPeerProfile(summary),
          };
        }),
      );
      entries.forEach((entry) => {
        if (!entry) return;
        const { summary, record, profile } = entry;
        directory.profilesById.set(record.merchantId, profile);
        directory.recordsById.set(record.merchantId, record);
        directory.authUserIdsByAccountId.set(record.merchantId, summary.id);
        const emails = new Set(
          [normalizeEmail(summary.email), normalizeEmail(profile.email)].filter(
            Boolean,
          ),
        );
        emails.forEach((email) => {
          const current = directory.recordsByEmail.get(email) ?? [];
          if (!current.some((item) => item.merchantId === record.merchantId)) {
            directory.recordsByEmail.set(email, [...current, record]);
          }
        });
      });
    }
    personalPeerDirectoryCache = {
      expiresAt: Date.now() + PERSONAL_PEER_DIRECTORY_CACHE_TTL_MS,
      value: directory,
    };
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
  const normalizedAccountId = normalizeCanonicalPersonalAccountId(accountId);
  if (!supabase || !normalizedAccountId) return null;
  let directory = await loadPersonalPeerDirectory(supabase);
  if (!directory.recordsById.has(normalizedAccountId)) {
    directory = await loadPersonalPeerDirectory(supabase, { forceRefresh: true });
  }
  const authUserId =
    directory.authUserIdsByAccountId.get(normalizedAccountId) ?? "";
  if (!authUserId) return null;
  const directoryClient = supabase as PersonalPeerDirectoryClient;
  const authResult = await directoryClient.auth.admin
    .getUserById(authUserId)
    .catch(() => null);
  const user = authResult && !authResult.error
    ? authResult.data?.user ?? null
    : null;
  if (!user || trimText(user.id) !== authUserId) return null;
  const summary = toAuthUserSummary({ ...user, id: authUserId });
  const identity = await resolvePlatformAccountIdentityForUser(
    supabase,
    summary,
  ).catch(() => null);
  if (
    !identity ||
    identity.accountType !== "personal" ||
    identity.accountId !== normalizedAccountId
  ) return null;
  return toResolvedPersonalRecord(summary, identity.accountId);
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
  const fresh = (
    await Promise.all(
      resolved.map((record) =>
        resolvePersonalById(supabase, record.merchantId),
      ),
    )
  ).filter((record) => record !== null);
  return { record: fresh[0] ?? null, ambiguous: fresh.length > 1 };
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
  const normalizedAccountId = normalizePeerAccountId(accountId);
  if (!supabase || !normalizedAccountId) {
    return { record: null, ambiguous: false };
  }
  const identitySupabase = supabase as unknown as PlatformIdentitySupabaseClient | null;

  const [merchantRecord, personalRecord] = await Promise.all([
    resolveMerchantById(supabase, normalizedAccountId),
    resolvePersonalById(identitySupabase, normalizedAccountId),
  ]);
  if (merchantRecord && personalRecord) {
    return { record: null, ambiguous: true };
  }
  return { record: merchantRecord ?? personalRecord, ambiguous: false };
}

async function resolvePeerContact(
  supabase: ReturnType<typeof createServerSupabaseServiceClient> | null,
  input: {
    accountId?: unknown;
    email?: unknown;
    preferredAccountType?: unknown;
  },
) {
  const accountId = normalizePeerAccountId(input.accountId);
  const email = normalizeEmail(input.email);
  const preferredAccountType =
    input.preferredAccountType === "personal"
      ? "personal"
      : input.preferredAccountType === "merchant"
        ? "merchant"
        : "";
  const identitySupabase = supabase as unknown as PlatformIdentitySupabaseClient | null;

  if (accountId) {
    const resolved = await resolvePeerById(supabase, accountId);
    if (resolved.ambiguous) {
      return { record: null, error: "search_ambiguous" as const };
    }
    if (
      preferredAccountType &&
      resolved.record?.accountType !== preferredAccountType
    ) {
      return { record: null, error: null };
    }
    return { record: resolved.record, error: null };
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
  const initialContacts = listMerchantPeerContactsForMerchant(payload, merchantId);
  const contactMerchantIds = initialContacts.map((contact) => contact.merchantId);
  const [personalProfiles, merchantProfiles] = await Promise.all([
    loadPersonalPeerProfiles(supabase ?? null, [merchantId, ...contactMerchantIds]),
    loadMerchantPeerProfiles(supabase ?? null, contactMerchantIds),
  ]);
  const personalAccountIds = new Set(personalProfiles.keys());
  const responsePayload = redactPersonalPeerIdentityData(
    payload,
    personalAccountIds,
  );
  const contacts = listMerchantPeerContactsForMerchant(
    responsePayload,
    merchantId,
  );
  const enrichedContacts = contacts.map((contact) => {
    const personalProfile = personalProfiles.get(contact.merchantId);
    const merchantProfile = merchantProfiles.get(contact.merchantId);
    const peerProfile = personalProfile ?? merchantProfile ?? null;
    if (!peerProfile) return contact;
    if (personalProfile) {
      const personalDecoration = buildPersonalPeerDecoration({
        accountId: contact.merchantId,
        publicName: personalProfile.displayName,
      });
      return {
        ...contact,
        accountType: "personal" as const,
        merchantName: personalDecoration.merchantName,
        merchantEmail: "",
        avatarImageUrl: personalProfile.avatarUrl,
        chatAvatarImageUrl: personalProfile.avatarUrl,
        signature: personalProfile.signature,
        contactPhone: "",
        contactCard: "",
      };
    }
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
  const threads = listMerchantPeerThreadsForMerchant(responsePayload, merchantId).map((thread) => ({
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
  const contactMerchantId = normalizePeerAccountId(url.searchParams.get("contactMerchantId"));
  let inboxResponse: Awaited<ReturnType<typeof buildInboxResponse>>;
  try {
    inboxResponse = await buildInboxResponse(
      payload,
      session.merchantId,
      supabase as unknown as PlatformIdentitySupabaseClient & PlatformMerchantSnapshotStoreClient,
      readStatePayload,
      contactMerchantId
        ? { threadMessageLimit: Number.MAX_SAFE_INTEGER }
        : undefined,
    );
  } catch {
    return noStoreJson(
      { error: "personal_peer_directory_unavailable" },
      { status: 503 },
    );
  }
  if (contactMerchantId) {
    const offset = normalizeNonNegativeInteger(url.searchParams.get("offset"));
    const limit = normalizePositiveInteger(url.searchParams.get("limit"), MERCHANT_PEER_DEFAULT_THREAD_MESSAGE_LIMIT, 200);
    const fullThread = inboxResponse.threads.find(
      (thread) =>
        thread.threadKey ===
        [session.merchantId, contactMerchantId]
          .sort((left, right) => left.localeCompare(right, "en"))
          .join("::"),
    ) ?? null;
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
    ...inboxResponse,
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
    const contactMerchantId = normalizePeerAccountId(body?.contactMerchantId);
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
    const contactDecoration = buildPeerWriteDecoration(
      resolved.record,
      body?.contactName,
      body?.contactEmail,
    );
    let nextPayload = upsertMerchantPeerContact(payload, {
      ownerMerchantId: session.merchantId,
      contactMerchantId: resolved.record.merchantId,
      contactName: contactDecoration.merchantName,
      contactEmail: contactDecoration.merchantEmail,
    });
    if (resolved.record.accountType === "personal") {
      nextPayload = redactPersonalPeerIdentityData(nextPayload, [
        resolved.record.merchantId,
      ]);
    }
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
    const recipientMerchantId = normalizePeerAccountId(body?.recipientMerchantId);
    if (!recipientMerchantId || !text) {
      return noStoreJson({ error: "merchant_message_invalid" }, { status: 400 });
    }
    if (recipientMerchantId === session.merchantId) {
      return noStoreJson({ error: "cannot_chat_with_self", message: "不能给自己发送消息。" }, { status: 400 });
    }

    const [recipientResolution, senderResolution, payload, readStatePayload] = await Promise.all([
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
    if (recipientResolution.ambiguous) {
      return noStoreJson(
        { error: "peer_identity_conflict" },
        { status: 409 },
      );
    }
    const recipient = recipientResolution.record;
    if (!recipient) {
      return noStoreJson({ error: "merchant_not_found", message: "目标商户不存在。" }, { status: 404 });
    }
    if (
      senderResolution.ambiguous ||
      !senderResolution.record ||
      senderResolution.record.accountType !== session.accountType
    ) {
      return noStoreJson(
        { error: "peer_sender_identity_conflict" },
        { status: 409 },
      );
    }
    const sender = senderResolution.record;
    const senderDecoration = buildPeerWriteDecoration(
      sender,
      body?.merchantName,
      body?.merchantEmail,
    );
    const recipientDecoration = buildPeerWriteDecoration(recipient);
    let nextPayload = upsertMerchantPeerMessage(payload, {
      senderMerchantId: sender.merchantId,
      senderMerchantName: senderDecoration.merchantName,
      senderMerchantEmail: senderDecoration.merchantEmail,
      recipientMerchantId: recipient.merchantId,
      recipientMerchantName: recipientDecoration.merchantName,
      recipientMerchantEmail: recipientDecoration.merchantEmail,
      message: createMerchantPeerMessage({
        senderMerchantId: sender.merchantId,
        text,
      }),
    });
    const personalParticipantIds = [sender, recipient]
      .filter((record) => record.accountType === "personal")
      .map((record) => record.merchantId);
    if (personalParticipantIds.length > 0) {
      nextPayload = redactPersonalPeerIdentityData(
        nextPayload,
        personalParticipantIds,
      );
    }
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
