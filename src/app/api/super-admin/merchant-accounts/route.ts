import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import type { MerchantConfigHistoryEntry } from "@/data/platformControlStore";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  createActiveOrdinaryAccountAuthorization,
  isOrdinaryAccountPrincipalError,
  normalizeExplicitOrdinaryAccountId,
  OrdinaryAccountPrincipalError,
  resolveOrdinaryAccountPlatformIdentity,
} from "@/lib/ordinaryAccountPrincipal.server";
import {
  loadOrdinaryAccountAuthorization,
  type OrdinaryAccountAuthorization,
} from "@/lib/ordinaryAccountAuthorization.server";
import { loadStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "@/lib/platformMerchantSnapshotStore";
import {
  buildPersonalAccountServiceMetadataPatch,
  createDefaultPersonalAccountServiceConfig,
  normalizePersonalAccountServiceConfig,
  readPersonalAccountServiceConfigFromMetadata,
  type PersonalAccountServiceConfig,
} from "@/lib/personalAccountServiceConfig";
import {
  buildPlatformAccountMetadataPatch,
  readPlatformUsernameFromMetadata,
  type PlatformAccountType,
} from "@/lib/platformAccounts";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";
import {
  createServerSupabaseAuthClient,
  createServerSupabaseServiceClient as createServerSupabaseClient,
  maskEmailAddress,
} from "@/lib/superAdminServer";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MERCHANT_ACCOUNTS_CACHE_TTL_MS = 30_000;
const ACCOUNT_DELETE_VERIFICATION_EMAIL = "caimin6669@qq.com";
const AUTH_USERS_LOAD_TIMEOUT_MS = 5_000;
const MERCHANT_ROWS_LOAD_TIMEOUT_MS = 8_000;
const SNAPSHOT_LOAD_TIMEOUT_MS = 6_000;
const PUBLISHED_SITE_INFO_TIMEOUT_MS = 4_000;
const PAGE_EVENTS_TIMEOUT_MS = 2_500;

type MerchantRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  owner_email?: string | null;
  contact_email?: string | null;
  user_email?: string | null;
  created_at?: string | null;
};

type AuthMetadata = Record<string, unknown> | null;

type AuthUserSummary = {
  id: string;
  email?: string | null;
  created_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  user_metadata?: AuthMetadata;
  app_metadata?: AuthMetadata;
};

type PageRow = {
  merchant_id?: string | null;
  slug?: string | null;
  updated_at?: string | null;
  blocks?: unknown;
};

type MerchantVisitSummary = {
  today: number;
  day7: number;
  day30: number;
  total: number;
};

type MerchantAccountItem = {
  accountType: PlatformAccountType;
  accountId: string;
  merchantId: string;
  merchantName: string;
  email: string;
  username: string;
  loginId: string;
  createdAt: string | null;
  authUserId: string | null;
  emailConfirmed: boolean;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  manualCreated: boolean;
  hasPublishedSite: boolean;
  siteSlug: string;
  siteUpdatedAt: string | null;
  publishedBytes: number;
  publishedBytesKnown: boolean;
  visits: MerchantVisitSummary;
  visitsKnown: boolean;
  profileSnapshot: MerchantListPublishedSite | null;
  profileConfigHistory: MerchantConfigHistoryEntry[];
  personalServiceConfig: PersonalAccountServiceConfig | null;
  personalServicePaused: boolean;
};

type MerchantAccountsScope = "full" | "support";

const merchantAccountsCache = new Map<
  MerchantAccountsScope,
  {
    expiresAt: number;
    items: MerchantAccountItem[];
  }
>();

type AdminListUsersClient = {
  auth: {
    admin: {
      listUsers: (params: { page: number; perPage: number }) => Promise<{
        data: { users: AuthUserSummary[] } | null;
        error: Error | null;
      }>;
    };
  };
};

type AuthUsersLoadResult = {
  users: AuthUserSummary[];
  errorMessage: string;
};

type MerchantRowsLoadResult = {
  rows: MerchantRow[];
  errorMessage: string;
};

type AuthoritativeAccountRecord = {
  user: AuthUserSummary;
  authorization: OrdinaryAccountAuthorization;
};

type AuthoritativeAccountsLoadResult = {
  records: AuthoritativeAccountRecord[];
  errorCount: number;
};

function normalizeEmail(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
}

function normalizeAccountValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeLoginEmail(value: string | null | undefined) {
  const normalized = normalizeAccountValue(value);
  if (!normalized || !normalized.includes("@")) return "";
  const [localPart, domainPart] = normalized.split("@");
  if (!localPart || !domainPart || !domainPart.includes(".")) return "";
  return normalized;
}

function readAccountDecoration(user?: AuthUserSummary | null) {
  const userMetadata = user?.user_metadata ?? null;
  const appMetadata = user?.app_metadata ?? null;
  const username = readPlatformUsernameFromMetadata(user);
  const manualCreated =
    userMetadata?.manual_user === true ||
    userMetadata?.manualUser === true ||
    appMetadata?.manual_user === true ||
    appMetadata?.manualUser === true;
  const personalServiceConfig = readPersonalAccountServiceConfigFromMetadata(
    user ?? null,
  );

  return {
    username,
    manualCreated,
    personalServiceConfig,
    personalServicePaused: personalServiceConfig?.servicePaused === true,
  };
}

function isImmutableManualAccountCandidate(
  user: AuthUserSummary,
  accountType: PlatformAccountType,
  accountId: string,
  authEmail: string,
) {
  const appMetadata = user.app_metadata;
  if (!appMetadata || typeof appMetadata !== "object") return false;
  const typedId =
    accountType === "merchant"
      ? appMetadata.merchant_id
      : appMetadata.personal_id;
  return (
    appMetadata.manual_user === true &&
    appMetadata.account_type === accountType &&
    appMetadata.accountType === accountType &&
    appMetadata.account_id === accountId &&
    appMetadata.accountId === accountId &&
    typedId === accountId &&
    normalizeEmail(user.email) === authEmail
  );
}

async function sendAccountDeleteVerificationCode() {
  const supabase = createServerSupabaseAuthClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error: "account_delete_verification_env_missing",
        message: "删除验证码服务暂不可用",
      },
      { status: 503 },
    );
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: ACCOUNT_DELETE_VERIFICATION_EMAIL,
    options: {
      shouldCreateUser: true,
    },
  });
  if (error) {
    return NextResponse.json(
      {
        error: "account_delete_verification_send_failed",
        message: error.message || "删除验证码发送失败，请稍后重试",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    verificationEmail: ACCOUNT_DELETE_VERIFICATION_EMAIL,
    maskedEmail: maskEmailAddress(ACCOUNT_DELETE_VERIFICATION_EMAIL),
  });
}

function isNumericMerchantId(value: string | null | undefined) {
  return /^\d+$/.test(String(value ?? "").trim());
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.code === "string" && ["23505", "email_exists", "user_already_exists"].includes(record.code)) {
    return true;
  }
  const message = typeof record.message === "string" ? record.message : "";
  return /duplicate key|already exists|already registered|already been registered|user_already_exists|unique constraint/i.test(message);
}

function readErrorMessage(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    const message = typeof record.message === "string" ? record.message.trim() : "";
    const code = typeof record.code === "string" ? record.code.trim() : "";
    return [code, message].filter(Boolean).join(": ") || "unknown_error";
  }
  return String(error);
}

function isTransientSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  if (code === "PGRST002") return true;
  if (Number(record.status) === 503) return true;
  return /schema cache|retrying|temporarily|timeout|connection|database error finding users/i.test(message);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withSoftTimeout<T>(task: PromiseLike<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const safeTask = Promise.resolve(task).catch((error) => {
    if (timedOut) return fallback;
    throw error;
  });
  const timeoutTask = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(fallback);
    }, Math.max(500, timeoutMs));
  });

  try {
    return await Promise.race([safeTask, timeoutTask]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runSupabaseQueryWithRetry<T extends { error?: unknown }>(
  task: () => PromiseLike<T>,
  attempts = 3,
) {
  let result = await task();
  for (let attempt = 1; attempt < attempts && result.error && isTransientSupabaseError(result.error); attempt += 1) {
    await wait(350 * attempt);
    result = await task();
  }
  return result;
}

async function listAuthUsers(supabase: AdminListUsersClient) {
  const users: AuthUserSummary[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const chunk = (data?.users ?? []).map((user) => ({
      id: user.id,
      email: user.email,
      created_at: user.created_at ?? null,
      email_confirmed_at: user.email_confirmed_at,
      last_sign_in_at: user.last_sign_in_at,
      user_metadata: user.user_metadata ?? null,
      app_metadata: user.app_metadata ?? null,
    }));
    users.push(...chunk);
    if (chunk.length < 200) break;
    page += 1;
  }
  return users;
}

async function listAuthUsersBestEffort(supabase: AdminListUsersClient): Promise<AuthUsersLoadResult> {
  return withSoftTimeout(
    listAuthUsers(supabase)
      .then((users) => ({
        users,
        errorMessage: "",
      }))
      .catch((error) => ({
        users: [],
        errorMessage: readErrorMessage(error) || "auth_users_load_failed",
      })),
    AUTH_USERS_LOAD_TIMEOUT_MS,
    { users: [], errorMessage: "auth_users_timeout" },
  );
}

async function listMerchantRows(supabase: SupabaseClient) {
  const { data, error } = await runSupabaseQueryWithRetry(() =>
    supabase
      .from("merchants")
      .select("id,name,email,owner_email,contact_email,user_email,created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  );
  if (error) throw error;
  return (data ?? []) as MerchantRow[];
}

async function listMerchantRowsBestEffort(
  supabase: SupabaseClient,
  timeoutMs = MERCHANT_ROWS_LOAD_TIMEOUT_MS,
): Promise<MerchantRowsLoadResult> {
  return withSoftTimeout(
    listMerchantRows(supabase)
      .then((rows) => ({
        rows,
        errorMessage: "",
      }))
      .catch((error) => ({
        rows: [],
        errorMessage: readErrorMessage(error) || "merchant_rows_load_failed",
      })),
    timeoutMs,
    { rows: [], errorMessage: "merchant_rows_timeout" },
  );
}

function sortByCreatedAtDesc(items: MerchantAccountItem[]) {
  return [...items].sort((left, right) => {
    const leftTs = new Date(left.createdAt ?? 0).getTime();
    const rightTs = new Date(right.createdAt ?? 0).getTime();
    return rightTs - leftTs;
  });
}

async function loadPlatformMerchantSnapshotByMerchantId(
  supabase: PlatformMerchantSnapshotStoreClient,
) {
  const payload = await withSoftTimeout(
    loadStoredPlatformMerchantSnapshot(supabase, { bypassCache: true, includeHistory: false }).catch(() => null),
    SNAPSHOT_LOAD_TIMEOUT_MS,
    null,
  );
  return {
    snapshotByMerchantId: new Map((payload?.snapshot ?? []).map((site) => [site.id, site] as const)),
    configHistoryByMerchantId: payload?.merchantConfigHistoryBySiteId ?? {},
  };
}

function normalizeSlug(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function estimateUtf8Size(text: string) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return Buffer.byteLength(text, "utf8");
}

function countBlocksBytes(blocks: unknown) {
  if (typeof blocks === "undefined") return { bytes: 0, known: false };
  try {
    return { bytes: estimateUtf8Size(JSON.stringify(blocks ?? null)), known: true };
  } catch {
    return { bytes: 0, known: false };
  }
}

function buildPublishedSiteInfoByMerchantId(rows: PageRow[]) {
  const map = new Map<
    string,
    { hasPublishedSite: boolean; siteSlug: string; siteUpdatedAt: string | null; publishedBytes: number; publishedBytesKnown: boolean }
  >();
  rows.forEach((row) => {
    const merchantId = String(row.merchant_id ?? "").trim();
    if (!merchantId) return;
    const slug = normalizeSlug(row.slug);
    const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
    const bytes = countBlocksBytes(row.blocks);
    const current = map.get(merchantId);
    if (!current) {
      map.set(merchantId, {
        hasPublishedSite: true,
        siteSlug: slug,
        siteUpdatedAt: updatedAt,
        publishedBytes: bytes.bytes,
        publishedBytesKnown: bytes.known,
      });
      return;
    }
    const currentTs = new Date(current.siteUpdatedAt ?? 0).getTime();
    const nextTs = new Date(updatedAt ?? 0).getTime();
    const preferSlug = slug && slug.toLowerCase() !== "home";
    const preferNext = nextTs >= currentTs;
    if (preferSlug || preferNext) {
      map.set(merchantId, {
        hasPublishedSite: true,
        siteSlug: preferSlug ? slug : current.siteSlug,
        siteUpdatedAt: preferNext ? updatedAt : current.siteUpdatedAt,
        publishedBytes: current.publishedBytes + bytes.bytes,
        publishedBytesKnown: current.publishedBytesKnown || bytes.known,
      });
      return;
    }
    map.set(merchantId, {
      ...current,
      publishedBytes: current.publishedBytes + bytes.bytes,
      publishedBytesKnown: current.publishedBytesKnown || bytes.known,
    });
  });
  return map;
}

function normalizeEventString(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

function daysBetweenNow(isoDate: string, nowMs: number) {
  const at = new Date(isoDate).getTime();
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return (nowMs - at) / 86400_000;
}

function buildMerchantVisitsByMerchantId(rows: unknown[], nowMs: number) {
  const map = new Map<string, MerchantVisitSummary>();
  rows.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const eventType = normalizeEventString(record, "event_type", "type", "event").toLowerCase();
    if (eventType !== "page_view") return;
    const channel = normalizeEventString(record, "channel", "page_path").toLowerCase();
    const merchantId = channel.match(/^site:(\d+):/i)?.[1] ?? "";
    if (!merchantId) return;
    const at = normalizeEventString(record, "created_at", "at", "timestamp");
    if (!at) return;
    const current = map.get(merchantId) ?? { today: 0, day7: 0, day30: 0, total: 0 };
    current.total += 1;
    const diff = daysBetweenNow(at, nowMs);
    if (diff < 1) current.today += 1;
    if (diff < 7) current.day7 += 1;
    if (diff < 30) current.day30 += 1;
    map.set(merchantId, current);
  });
  return map;
}

function unauthorizedJson() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function envMissingJson() {
  return NextResponse.json({ error: "merchant_account_env_missing" }, { status: 503 });
}

function badRequestJson(error: string, message: string) {
  return NextResponse.json({ error, message }, { status: 400 });
}

function conflictJson(error: string, message: string) {
  return NextResponse.json({ error, message }, { status: 409 });
}

function notFoundJson(error: string, message: string) {
  return NextResponse.json({ error, message }, { status: 404 });
}

function readMerchantAccountsScope(request: Request): MerchantAccountsScope {
  const scope = new URL(request.url).searchParams.get("scope");
  return scope === "support" ? "support" : "full";
}

function readMerchantAccountsCache(scope: MerchantAccountsScope) {
  const cached = merchantAccountsCache.get(scope);
  if (!cached || cached.expiresAt <= Date.now()) {
    merchantAccountsCache.delete(scope);
    return null;
  }
  if (scope === "full" && cached.items.length === 0) {
    merchantAccountsCache.delete(scope);
    return null;
  }
  return cached.items;
}

function writeMerchantAccountsCache(scope: MerchantAccountsScope, items: MerchantAccountItem[]) {
  merchantAccountsCache.set(scope, {
    expiresAt: Date.now() + MERCHANT_ACCOUNTS_CACHE_TTL_MS,
    items,
  });
}

function buildPersonalAccountItemFromAuthUser(
  user: AuthUserSummary,
  authoritativeAccountId: string,
): MerchantAccountItem {
  const metadata = readAccountDecoration(user);
  const personalServiceConfig = normalizePersonalAccountServiceConfig(
    metadata.personalServiceConfig ?? createDefaultPersonalAccountServiceConfig(),
  );
  const email = normalizeEmail(user.email);
  const username = metadata.username || email || authoritativeAccountId || "个人用户";
  return {
    accountType: "personal",
    accountId: authoritativeAccountId,
    merchantId: "",
    merchantName: "",
    email,
    username,
    loginId: authoritativeAccountId,
    createdAt: user.created_at ?? null,
    authUserId: String(user.id ?? "").trim() || null,
    emailConfirmed: Boolean(user.email_confirmed_at),
    emailConfirmedAt: user.email_confirmed_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    manualCreated: metadata.manualCreated,
    hasPublishedSite: false,
    siteSlug: "",
    siteUpdatedAt: null,
    publishedBytes: 0,
    publishedBytesKnown: false,
    visits: { today: 0, day7: 0, day30: 0, total: 0 },
    visitsKnown: false,
    profileSnapshot: null,
    profileConfigHistory: [],
    personalServiceConfig,
    personalServicePaused: personalServiceConfig.servicePaused,
  };
}

async function ensureAuthorized(request: Request) {
  return isSuperAdminRequestAuthorized(request);
}

export async function GET(request: Request) {
  if (!(await ensureAuthorized(request))) {
    return unauthorizedJson();
  }

  const scope = readMerchantAccountsScope(request);
  const cachedItems = readMerchantAccountsCache(scope);
  if (cachedItems) {
    return NextResponse.json({ items: cachedItems });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return envMissingJson();
  }

  try {
    const [
      merchantRowsResult,
      authUsersResult,
      { snapshotByMerchantId, configHistoryByMerchantId },
    ] = await Promise.all([
      listMerchantRowsBestEffort(supabase),
      listAuthUsersBestEffort(supabase),
      loadPlatformMerchantSnapshotByMerchantId(supabase as unknown as PlatformMerchantSnapshotStoreClient),
    ]);

    const authUsers = authUsersResult.users;
    const authoritativeAccounts = authUsersResult.errorMessage
      ? { records: [], errorCount: 0 }
      : await loadAuthoritativeAccountsBestEffort(supabase, authUsers);

    const authoritativeUserByMerchantId = new Map<string, AuthUserSummary>();
    const conflictingMerchantIds = new Set<string>();
    for (const { user, authorization } of authoritativeAccounts.records) {
      if (
        authorization.status !== "resolved" ||
        authorization.accountType !== "merchant"
      ) {
        continue;
      }
      for (const merchantId of authorization.merchantIds) {
        const current = authoritativeUserByMerchantId.get(merchantId);
        if (current && current.id !== user.id) {
          conflictingMerchantIds.add(merchantId);
          authoritativeUserByMerchantId.delete(merchantId);
          continue;
        }
        if (!conflictingMerchantIds.has(merchantId)) {
          authoritativeUserByMerchantId.set(merchantId, user);
        }
      }
    }

    const shouldUseSnapshotMerchantFallback =
      Boolean(merchantRowsResult.errorMessage) ||
      (merchantRowsResult.rows.length === 0 && snapshotByMerchantId.size > 0);
    const merchantRowsById = new Map(
      merchantRowsResult.rows.map((row) => [String(row.id ?? "").trim(), row] as const),
    );
    const merchantIdsForItems = new Set<string>(
      shouldUseSnapshotMerchantFallback
        ? [...snapshotByMerchantId.keys()]
        : merchantRowsResult.rows.map((row) => String(row.id ?? "").trim()),
    );
    authoritativeUserByMerchantId.forEach((_user, merchantId) => {
      merchantIdsForItems.add(merchantId);
    });

    const merchantItems: MerchantAccountItem[] = [...merchantIdsForItems]
      .filter((merchantId) => isMerchantNumericId(merchantId))
      .map((merchantId) => {
        const merchant = merchantRowsById.get(merchantId) ?? null;
        const authUser = authoritativeUserByMerchantId.get(merchantId) ?? null;
        const metadata = readAccountDecoration(authUser);
        const snapshotSite = snapshotByMerchantId.get(merchantId) ?? null;
        const merchantName =
          String(merchant?.name ?? "").trim() ||
          String(snapshotSite?.merchantName ?? "").trim() ||
          merchantId;
        const email = normalizeEmail(
          authUser?.email,
          merchant?.user_email,
          merchant?.email,
          merchant?.owner_email,
          merchant?.contact_email,
        );
        return {
          accountType: "merchant",
          accountId: merchantId,
          merchantId,
          merchantName,
          email,
          username: metadata.username || merchantName,
          loginId: merchantId,
          createdAt: merchant?.created_at ?? authUser?.created_at ?? null,
          authUserId: authUser?.id ?? null,
          emailConfirmed: Boolean(authUser?.email_confirmed_at),
          emailConfirmedAt: authUser?.email_confirmed_at ?? null,
          lastSignInAt: authUser?.last_sign_in_at ?? null,
          manualCreated: metadata.manualCreated,
          hasPublishedSite: false,
          siteSlug: String(snapshotSite?.domainPrefix ?? snapshotSite?.domainSuffix ?? "").trim(),
          siteUpdatedAt: null,
          publishedBytes: 0,
          publishedBytesKnown: false,
          visits: { today: 0, day7: 0, day30: 0, total: 0 },
          visitsKnown: false,
          profileSnapshot: snapshotSite,
          profileConfigHistory: configHistoryByMerchantId[merchantId] ?? [],
          personalServiceConfig: null,
          personalServicePaused: false,
        };
      });

    const personalItems = authoritativeAccounts.records.flatMap(
      ({ user, authorization }) =>
        authorization.accountType === "personal" &&
        (authorization.status === "resolved" || authorization.status === "disabled")
          ? [
              buildPersonalAccountItemFromAuthUser(
                user,
                authorization.personalAccountId,
              ),
            ]
          : [],
    );
    const normalizedItems: MerchantAccountItem[] = [
      ...merchantItems,
      ...personalItems,
    ];
    const merchantIds = [
      ...new Set(
        normalizedItems
          .filter((item) => item.accountType === "merchant")
          .map((item) => item.merchantId)
          .filter((item) => isNumericMerchantId(item)),
      ),
    ];
    const [publishedSiteInfoResult, pageEventsResult] =
      merchantIds.length > 0
        ? await Promise.all([
            withSoftTimeout(
              runSupabaseQueryWithRetry(() =>
                supabase
                  .from("pages")
                  .select("merchant_id,slug,updated_at")
                  .in("merchant_id", merchantIds)
                  .limit(Math.max(merchantIds.length * 2, 100)),
              ).catch((error) => ({ data: null, error })),
              PUBLISHED_SITE_INFO_TIMEOUT_MS,
              { data: null, error: new Error("published_site_info_timeout") },
            ),
            withSoftTimeout(
              runSupabaseQueryWithRetry(() =>
                supabase
                  .from("page_events")
                  .select("*")
                  .order("created_at", { ascending: false })
                  .limit(1000),
              ).catch((error) => ({ data: null, error })),
              PAGE_EVENTS_TIMEOUT_MS,
              { data: null, error: new Error("page_events_timeout") },
            ),
          ])
        : [
            { data: null, error: null },
            { data: null, error: null },
          ];

    const publishedSiteInfoByMerchantId = !publishedSiteInfoResult.error && Array.isArray(publishedSiteInfoResult.data)
      ? buildPublishedSiteInfoByMerchantId(publishedSiteInfoResult.data as PageRow[])
      : new Map<
          string,
          { hasPublishedSite: boolean; siteSlug: string; siteUpdatedAt: string | null; publishedBytes: number; publishedBytesKnown: boolean }
        >();
    const visitsByMerchantId =
      !pageEventsResult.error && Array.isArray(pageEventsResult.data)
        ? buildMerchantVisitsByMerchantId(pageEventsResult.data, Date.now())
        : new Map<string, MerchantVisitSummary>();
    const visitsKnown = !pageEventsResult.error && Array.isArray(pageEventsResult.data);

    const items = sortByCreatedAtDesc(
      normalizedItems.map((item) => {
        const publishedSiteInfo = publishedSiteInfoByMerchantId.get(item.merchantId);
        return {
          ...item,
          hasPublishedSite: publishedSiteInfo?.hasPublishedSite === true,
          siteSlug:
            publishedSiteInfo?.siteSlug ??
            String(item.profileSnapshot?.domainPrefix ?? item.profileSnapshot?.domainSuffix ?? "").trim(),
          siteUpdatedAt: publishedSiteInfo?.siteUpdatedAt ?? null,
          publishedBytes: publishedSiteInfo?.publishedBytes ?? 0,
          publishedBytesKnown: publishedSiteInfo?.publishedBytesKnown === true,
          visits: visitsByMerchantId.get(item.merchantId) ?? { today: 0, day7: 0, day30: 0, total: 0 },
          visitsKnown,
        };
      }),
    );

    if (
      !authUsersResult.errorMessage &&
      authoritativeAccounts.errorCount === 0 &&
      (!merchantRowsResult.errorMessage || shouldUseSnapshotMerchantFallback)
    ) {
      writeMerchantAccountsCache(scope, items);
    }
    return NextResponse.json({
      items,
      merchantRowsUnavailable: Boolean(merchantRowsResult.errorMessage),
      merchantRowsEmptyFallback: !merchantRowsResult.errorMessage && shouldUseSnapshotMerchantFallback,
      merchantRowsError: merchantRowsResult.errorMessage,
      authUsersUnavailable: Boolean(authUsersResult.errorMessage),
      authUsersError: authUsersResult.errorMessage,
      authorizationResolverErrorCount: authoritativeAccounts.errorCount,
    });
  } catch (error) {
    const cachedFallback = readMerchantAccountsCache(scope);
    if (cachedFallback) {
      return NextResponse.json({
        items: cachedFallback,
        merchantRowsUnavailable: true,
        merchantRowsError: readErrorMessage(error) || "merchant_account_load_failed",
      });
    }
    return NextResponse.json(
      {
        error: "merchant_account_load_failed",
        message: readErrorMessage(error) || "unknown_error",
      },
      { status: isTransientSupabaseError(error) ? 503 : 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  if (!(await ensureAuthorized(request))) {
    return unauthorizedJson();
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return envMissingJson();
  }

  try {
    const payload = (await request.json().catch(() => null)) as {
      action?: unknown;
      accountType?: unknown;
      accountId?: unknown;
      merchantId?: unknown;
      loginAccount?: unknown;
      username?: unknown;
      password?: unknown;
    } | null;
    if (payload?.action === "request_delete_code") {
      return sendAccountDeleteVerificationCode();
    }

    const accountType: PlatformAccountType = payload?.accountType === "personal" ? "personal" : "merchant";
    const rawAccountId =
      typeof payload?.accountId === "string"
        ? payload.accountId
        : typeof payload?.merchantId === "string"
          ? payload.merchantId
          : "";
    const accountId = normalizeExplicitOrdinaryAccountId(
      accountType,
      rawAccountId,
    );
    const merchantId = accountType === "merchant" ? accountId : "";
    const loginAccount =
      typeof payload?.loginAccount === "string"
        ? payload.loginAccount.trim()
        : typeof payload?.username === "string"
          ? payload.username.trim()
          : "";
    const password = typeof payload?.password === "string" ? payload.password : "";
    if (
      !accountId ||
      (accountType === "personal" && /\s/u.test(accountId))
    ) {
      return badRequestJson("invalid_account_id", accountType === "personal" ? "请输入个人 ID" : "请输入商户 ID");
    }
    if (accountType === "merchant" && !isMerchantNumericId(accountId)) {
      return badRequestJson("invalid_account_id", "商户 ID 必须是 8 位数字");
    }

    if (!loginAccount) {
      return badRequestJson("invalid_login_account", "请输入邮箱");
    }
    if (password.length < 6) {
      return badRequestJson("invalid_password", "密码至少 6 位");
    }

    const loginEmail = normalizeLoginEmail(loginAccount);
    if (!loginEmail) {
      return badRequestJson("invalid_login_account", "请输入有效邮箱");
    }
    const authEmail = loginEmail;
    const merchantDisplayName = accountType === "merchant" ? accountId : "";

    const [existingMerchantById, authUsersResult] = await Promise.all([
      runSupabaseQueryWithRetry(() =>
        supabase
          .from("merchants")
          .select("id")
          .eq("id", accountId)
          .limit(1)
          .maybeSingle(),
      ),
      listAuthUsersBestEffort(supabase),
    ]);
    if (authUsersResult.errorMessage) {
      return NextResponse.json(
        { error: "ordinary_account_authorization_lookup_failed" },
        { status: 503 },
      );
    }

    if (existingMerchantById.error) throw existingMerchantById.error;
    const resumableAuthUserCandidate =
      authUsersResult.users.find((user) =>
        isImmutableManualAccountCandidate(
          user,
          accountType,
          accountId,
          authEmail,
        ),
      ) ?? null;
    const authoritativeAccounts = await loadAuthoritativeAccountsBestEffort(
      supabase,
      authUsersResult.users,
    );
    if (authoritativeAccounts.errorCount > 0) {
      return NextResponse.json(
        { error: "ordinary_account_authorization_lookup_failed" },
        { status: 503 },
      );
    }
    const authoritativeTargetRecords = authoritativeAccounts.records.filter(
      ({ authorization }) =>
        authorization.accountType === "merchant"
          ? authorization.status === "resolved" &&
            authorization.merchantIds.includes(accountId)
          : authorization.accountType === "personal" &&
            authorization.personalAccountId === accountId,
    );
    if (authoritativeTargetRecords.length > 1) {
      return conflictJson(
        "ordinary_account_identifier_collision",
        "The account ID has conflicting authoritative bindings.",
      );
    }
    const authoritativeTargetRecord = authoritativeTargetRecords[0] ?? null;
    const resumableAuthorization = resumableAuthUserCandidate
      ? authoritativeAccounts.records.find(
          ({ user }) => user.id === resumableAuthUserCandidate.id,
        )?.authorization ?? null
      : null;
    if (
      authoritativeTargetRecord &&
      (authoritativeTargetRecord.authorization.accountType !== accountType ||
        authoritativeTargetRecord.user.id !== resumableAuthUserCandidate?.id)
    ) {
      if (
        resumableAuthUserCandidate &&
        resumableAuthorization?.status === "unbound"
      ) {
        let cleanupError: unknown = null;
        try {
          const cleanupResult = await supabase.auth.admin.deleteUser(
            resumableAuthUserCandidate.id,
          );
          cleanupError = cleanupResult.error;
        } catch (error) {
          cleanupError = error;
        }
        if (cleanupError) {
          return NextResponse.json(
            { error: "ordinary_account_orphan_cleanup_unconfirmed" },
            { status: 503 },
          );
        }
      }
      return conflictJson(
        "ordinary_account_id_exists",
        "The account ID already has an authoritative Auth binding.",
      );
    }

    const isExactResumableExistingMerchant = Boolean(
      existingMerchantById.data?.id &&
        accountType === "merchant" &&
        resumableAuthUserCandidate &&
        authoritativeTargetRecord?.authorization.accountType === "merchant" &&
        authoritativeTargetRecord.user.id === resumableAuthUserCandidate.id,
    );
    if (existingMerchantById.data?.id && !isExactResumableExistingMerchant) {
      // A bare merchant row is not an authorization binding. If a prior
      // create attempt left an immutable, explicitly-unbound Auth record, it
      // is safe to remove that orphan before returning the deterministic
      // collision. Never reuse or bind the pre-existing row from metadata.
      if (
        resumableAuthUserCandidate &&
        resumableAuthorization?.status === "unbound"
      ) {
        let cleanupError: unknown = null;
        try {
          const cleanupResult = await supabase.auth.admin.deleteUser(
            resumableAuthUserCandidate.id,
          );
          cleanupError = cleanupResult.error;
        } catch (error) {
          cleanupError = error;
        }
        if (cleanupError) {
          return NextResponse.json(
            { error: "ordinary_account_orphan_cleanup_unconfirmed" },
            { status: 503 },
          );
        }
      }
      return conflictJson("ordinary_account_id_exists", "ID 已存在，请更换后重试");
    }
    const activeAuthUsers = authUsersResult.users;
    const resumableAuthUser = resumableAuthUserCandidate
      ? activeAuthUsers.find(
          (user) => user.id === resumableAuthUserCandidate.id,
        ) ?? null
      : null;

    const duplicateLoginAccountUser = activeAuthUsers.find((user) => {
      if (user.id === resumableAuthUser?.id) return false;
      return normalizeEmail(user.email) === authEmail;
    });
    if (duplicateLoginAccountUser) {
      return conflictJson("login_account_exists", "账号已存在，请更换后重试");
    }

    const metadataPatchBase = buildPlatformAccountMetadataPatch(
      {
        user_metadata: {
          manual_user: true,
        },
        app_metadata: {
          manual_user: true,
        },
      },
      accountType,
      accountId,
    );
    const personalServiceConfig = createDefaultPersonalAccountServiceConfig();
    const metadataPatch =
      accountType === "personal"
        ? buildPersonalAccountServiceMetadataPatch(
            {
              user_metadata: metadataPatchBase.user_metadata,
              app_metadata: metadataPatchBase.app_metadata,
            },
            personalServiceConfig,
          )
        : metadataPatchBase;

    let authUser = resumableAuthUser;
    let createdAuthUserThisRequest = false;
    if (!authUser) {
      const { data: createdUserData, error: createUserError } =
        await supabase.auth.admin.createUser({
          email: authEmail,
          password,
          email_confirm: true,
          user_metadata: metadataPatch.user_metadata,
          app_metadata: metadataPatch.app_metadata,
        });

      if (createUserError || !createdUserData.user) {
        if (createUserError && isDuplicateKeyError(createUserError)) {
          return conflictJson("login_account_exists", "账号已存在，请更换后重试");
        }
        throw createUserError ?? new Error("auth_user_create_failed");
      }
      authUser = createdUserData.user as AuthUserSummary;
      createdAuthUserThisRequest = true;
    }

    const authUserId = String(authUser.id ?? "").trim();
    try {
      await createActiveOrdinaryAccountAuthorization(
        supabase,
        authUser,
        accountType,
        accountId,
      );
    } catch (bindingError) {
      if (!createdAuthUserThisRequest) throw bindingError;

      let postFailureAuthorization: OrdinaryAccountAuthorization;
      try {
        postFailureAuthorization = await loadOrdinaryAccountAuthorization(
          supabase,
          authUserId,
        );
      } catch {
        // The binding outcome is unknown. Keep the immutable resumable Auth
        // record and never guess that it is safe to delete.
        throw new OrdinaryAccountPrincipalError(
          "ordinary_account_principal_unavailable",
          503,
        );
      }
      const exactBindingCommitted =
        postFailureAuthorization.status === "resolved" &&
        postFailureAuthorization.accountType === accountType &&
        (postFailureAuthorization.accountType === "merchant"
          ? postFailureAuthorization.merchantIds.includes(accountId)
          : postFailureAuthorization.personalAccountId === accountId);
      if (exactBindingCommitted) {
        // The create-only RPC committed and only its response was lost.
      } else {
        const deterministicConflict =
          isOrdinaryAccountPrincipalError(bindingError) &&
          [
            "ordinary_account_binding_conflict",
            "ordinary_account_personal_binding_conflict",
            "ordinary_account_principal_type_conflict",
            "ordinary_account_personal_disabled",
            "ordinary_account_system_site_forbidden",
            "invalid_ordinary_personal_id",
            "merchant_staff_identity_forbidden",
          ].includes(bindingError.code);
        if (
          deterministicConflict &&
          postFailureAuthorization.status === "unbound"
        ) {
          let cleanupError: unknown = null;
          try {
            const cleanupResult = await supabase.auth.admin.deleteUser(
              authUserId,
            );
            cleanupError = cleanupResult.error;
          } catch (error) {
            cleanupError = error;
          }
          if (cleanupError) {
            throw new OrdinaryAccountPrincipalError(
              "ordinary_account_principal_unavailable",
              503,
            );
          }
          throw bindingError;
        }
        // Unknown or non-empty resolver state is deliberately retained for a
        // safe same-request retry; deleting here could orphan a committed bind.
        throw new OrdinaryAccountPrincipalError(
          "ordinary_account_principal_unavailable",
          503,
        );
      }
    }

    if (accountType === "merchant") {
      // The create-only RPC owns identity creation. Update display data only
      // after the resolver has confirmed the exact requested merchant binding.
      const { error: merchantNameUpdateError } = await runSupabaseQueryWithRetry(
        () =>
          supabase
            .from("merchants")
            .update({ name: merchantDisplayName })
            .eq("id", merchantId),
      );
      if (merchantNameUpdateError) throw merchantNameUpdateError;
    }

    const item: MerchantAccountItem = {
      accountType,
      accountId,
      merchantId: accountType === "merchant" ? merchantId : "",
      merchantName: merchantDisplayName,
      email: authEmail,
      username: "",
      loginId: accountId,
      createdAt: authUser.created_at ?? new Date().toISOString(),
      authUserId,
      emailConfirmed: true,
      emailConfirmedAt: authUser.email_confirmed_at ?? new Date().toISOString(),
      lastSignInAt: null,
      manualCreated: true,
      hasPublishedSite: false,
      siteSlug: "",
      siteUpdatedAt: null,
      publishedBytes: 0,
      publishedBytesKnown: false,
      visits: { today: 0, day7: 0, day30: 0, total: 0 },
      visitsKnown: false,
      profileSnapshot: null,
      profileConfigHistory: [],
      personalServiceConfig:
        accountType === "personal"
          ? normalizePersonalAccountServiceConfig(
              readPersonalAccountServiceConfigFromMetadata(authUser),
            )
          : null,
      personalServicePaused: false,
    };

    merchantAccountsCache.clear();
    return NextResponse.json(
      { item, resumed: Boolean(resumableAuthUser) },
      { status: resumableAuthUser ? 200 : 201 },
    );
  } catch (error) {
    if (isOrdinaryAccountPrincipalError(error)) {
      return NextResponse.json(
        { error: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: "merchant_account_create_failed",
        message: readErrorMessage(error) || "unknown_error",
      },
      { status: isTransientSupabaseError(error) ? 503 : 500 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  if (!(await ensureAuthorized(request))) {
    return unauthorizedJson();
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return envMissingJson();
  }

  try {
    const payload = (await request.json().catch(() => null)) as {
      accountId?: unknown;
      authUserId?: unknown;
      servicePaused?: unknown;
      config?: unknown;
    } | null;
    const hasAccountId = typeof payload?.accountId === "string";
    const accountId = hasAccountId
      ? normalizeExplicitOrdinaryAccountId("personal", payload?.accountId)
      : "";
    const authUserId = typeof payload?.authUserId === "string" ? payload.authUserId.trim() : "";
    const servicePaused =
      typeof payload?.servicePaused === "boolean"
        ? payload.servicePaused
        : payload?.servicePaused === null
          ? null
          : undefined;
    const configPatch =
      payload?.config && typeof payload.config === "object" && !Array.isArray(payload.config)
        ? (payload.config as Partial<PersonalAccountServiceConfig>)
        : null;

    if (hasAccountId && !accountId) {
      return badRequestJson("invalid_personal_account", "个人账号 ID 无效");
    }
    if (!accountId && !authUserId) {
      return badRequestJson("invalid_personal_account", "请选择要操作的个人账号");
    }
    if (servicePaused === undefined && !configPatch) {
      return badRequestJson("invalid_personal_service_update", "请提供要更新的个人账号服务配置");
    }

    const authUsers = await listAuthUsers(supabase);
    const authoritativeAccounts = await loadAuthoritativeAccountsBestEffort(
      supabase,
      authUsers,
    );
    let targetUser = authUserId
      ? authUsers.find((user) => String(user.id ?? "").trim() === authUserId) ??
        null
      : null;
    if (!targetUser && accountId) {
      const candidates = authoritativeAccounts.records.filter(
        ({ authorization }) =>
          authorization.accountType === "personal" &&
          authorization.personalAccountId === accountId,
      );
      if (candidates.length > 1) {
        return conflictJson(
          "personal_account_authorization_conflict",
          "The canonical personal account has multiple Auth bindings.",
        );
      }
      targetUser = candidates[0]?.user ?? null;
    }

    if (!targetUser) {
      if (authoritativeAccounts.errorCount > 0) {
        throw new Error("ordinary_account_authorization_lookup_failed");
      }
      return notFoundJson("personal_account_not_found", "未找到对应的个人账号");
    }

    const authoritativeIdentity = await resolveOrdinaryAccountPlatformIdentity(
      supabase,
      targetUser,
    );
    if (
      authoritativeIdentity.accountType !== "personal" ||
      (accountId && authoritativeIdentity.accountId !== accountId)
    ) {
      return notFoundJson(
        "personal_account_not_found",
        "未找到对应的个人账号",
      );
    }

    const currentConfig = normalizePersonalAccountServiceConfig(
      readPersonalAccountServiceConfigFromMetadata(targetUser ?? null),
    );
    const nextConfig = normalizePersonalAccountServiceConfig({
      ...currentConfig,
      ...(configPatch ?? {}),
      ...(typeof servicePaused === "boolean" ? { servicePaused } : {}),
    });

    const { data, error } = await supabase.auth.admin.updateUserById(
      String(targetUser.id ?? "").trim(),
      buildPersonalAccountServiceMetadataPatch(targetUser, nextConfig),
    );
    if (error || !data.user) {
      throw error ?? new Error("personal_account_update_failed");
    }

    const updatedUser: AuthUserSummary = {
      id: data.user.id,
      email: data.user.email ?? null,
      created_at: data.user.created_at ?? null,
      email_confirmed_at: data.user.email_confirmed_at ?? null,
      last_sign_in_at: data.user.last_sign_in_at ?? null,
      user_metadata: data.user.user_metadata ?? null,
      app_metadata: data.user.app_metadata ?? null,
    };

    merchantAccountsCache.clear();
    return NextResponse.json({
      item: buildPersonalAccountItemFromAuthUser(
        updatedUser,
        authoritativeIdentity.accountId,
      ),
    });
  } catch (error) {
    if (isOrdinaryAccountPrincipalError(error)) {
      return NextResponse.json(
        { error: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: "personal_account_update_failed",
        message: readErrorMessage(error) || "unknown_error",
      },
      { status: isTransientSupabaseError(error) ? 503 : 500 },
    );
  }
}

export async function DELETE(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }

  if (!ensureAuthorized(request)) {
    return unauthorizedJson();
  }

  // No retirement RPC exists in this release. Keeping this endpoint as a
  // response-only failure avoids orphaning a canonical personal binding or
  // deleting an Auth UUID that still owns another merchant.
  return NextResponse.json(
    {
      error: "ordinary_account_safe_retirement_required",
      message:
        "This account must be safely retired through the authoritative binding service before it can be deleted.",
    },
    { status: 503 },
  );
}

async function loadAuthoritativeAccountsBestEffort(
  supabase: SupabaseClient,
  users: AuthUserSummary[],
): Promise<AuthoritativeAccountsLoadResult> {
  const records: AuthoritativeAccountRecord[] = [];
  let errorCount = 0;
  let nextIndex = 0;
  const workerCount = Math.min(24, Math.max(1, users.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < users.length) {
        const index = nextIndex;
        nextIndex += 1;
        const user = users[index];
        try {
          const authorization = await loadOrdinaryAccountAuthorization(
            supabase,
            user.id,
          );
          records.push({ user, authorization });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "ordinary_account_staff_identity_forbidden"
          ) {
            continue;
          }
          errorCount += 1;
        }
      }
    }),
  );

  return { records, errorCount };
}
