import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import { loadMerchantIdRulesFromStore } from "@/lib/merchantIdRuleStore";
import { findBlockingMerchantIdRule } from "@/lib/merchantIdRules";
import { isMerchantNumericId } from "@/lib/merchantIdentity";
import { loadStoredPlatformMerchantSnapshot, type PlatformMerchantSnapshotStoreClient } from "@/lib/platformMerchantSnapshotStore";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MERCHANT_ACCOUNTS_CACHE_TTL_MS = 30_000;

type MerchantRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  owner_email?: string | null;
  contact_email?: string | null;
  user_email?: string | null;
  user_id?: string | null;
  auth_user_id?: string | null;
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

function readEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

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

function readMetadataString(metadata: AuthMetadata, ...keys: string[]) {
  if (!metadata || typeof metadata !== "object") return "";
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return "";
}

function readAccountMetadata(user?: AuthUserSummary | null) {
  const userMetadata = user?.user_metadata ?? null;
  const appMetadata = user?.app_metadata ?? null;
  const username =
    readMetadataString(userMetadata, "display_name", "username", "name") ||
    readMetadataString(appMetadata, "display_name", "username", "name");
  const loginId =
    readMetadataString(userMetadata, "login_id", "loginId", "merchant_id", "merchantId", "merchantID") ||
    readMetadataString(appMetadata, "login_id", "loginId", "merchant_id", "merchantId", "merchantID");
  const merchantId =
    readMetadataString(userMetadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId") ||
    readMetadataString(appMetadata, "merchant_id", "merchantId", "merchantID", "login_id", "loginId");
  const manualCreated =
    userMetadata?.manual_user === true ||
    userMetadata?.manualUser === true ||
    appMetadata?.manual_user === true ||
    appMetadata?.manualUser === true;

  return {
    username,
    usernameKey: normalizeAccountValue(username),
    loginId,
    merchantId,
    manualCreated,
  };
}

function buildManualUserEmail(merchantId: string) {
  return `merchant-${merchantId}@manual.merchant-space.invalid`;
}

function isNumericMerchantId(value: string | null | undefined) {
  return /^\d+$/.test(String(value ?? "").trim());
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (typeof record.code === "string" && record.code === "23505") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /duplicate key|already exists|unique constraint/i.test(message);
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
  const payload = await loadStoredPlatformMerchantSnapshot(supabase);
  return new Map((payload?.snapshot ?? []).map((site) => [site.id, site] as const));
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

function isMissingRelationError(message: string) {
  return /relation .* does not exist/i.test(message) || /table .* does not exist/i.test(message);
}

function choosePreferredMerchantAccount(current: MerchantAccountItem | undefined, candidate: MerchantAccountItem) {
  if (!current) return candidate;
  const currentNumeric = isNumericMerchantId(current.merchantId);
  const candidateNumeric = isNumericMerchantId(candidate.merchantId);
  if (candidateNumeric && !currentNumeric) return candidate;
  if (currentNumeric && !candidateNumeric) return current;
  const currentTs = new Date(current.createdAt ?? 0).getTime();
  const candidateTs = new Date(candidate.createdAt ?? 0).getTime();
  return candidateTs > currentTs ? candidate : current;
}

function createServerSupabaseClient() {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey =
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    readEnv("NEXT_SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
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
  return cached.items;
}

function writeMerchantAccountsCache(scope: MerchantAccountsScope, items: MerchantAccountItem[]) {
  merchantAccountsCache.set(scope, {
    expiresAt: Date.now() + MERCHANT_ACCOUNTS_CACHE_TTL_MS,
    items,
  });
}

function buildSupportScopeItems(merchants: MerchantRow[]) {
  return sortByCreatedAtDesc(
    merchants.map((merchant) => {
      const merchantId = String(merchant.id ?? "").trim();
      const email = normalizeEmail(
        merchant.user_email,
        merchant.email,
        merchant.owner_email,
        merchant.contact_email,
      );
      const merchantName = String(merchant.name ?? "").trim() || merchantId;
      const authUserId = String(merchant.auth_user_id ?? merchant.user_id ?? "").trim() || null;
      const manualEmail = merchantId ? buildManualUserEmail(merchantId) : "";
      return {
        merchantId,
        merchantName,
        email,
        username: merchantName,
        loginId: merchantId,
        createdAt: merchant.created_at ?? null,
        authUserId,
        emailConfirmed: email === manualEmail ? true : false,
        emailConfirmedAt: null,
        lastSignInAt: null,
        manualCreated: email === manualEmail,
        hasPublishedSite: false,
        siteSlug: "",
        siteUpdatedAt: null,
        publishedBytes: 0,
        publishedBytesKnown: false,
        visits: { today: 0, day7: 0, day30: 0, total: 0 },
        visitsKnown: false,
        profileSnapshot: null,
      } satisfies MerchantAccountItem;
    }),
  );
}

function ensureAuthorized(request: Request) {
  return isSuperAdminRequestAuthorized(request);
}

export async function GET(request: Request) {
  if (!ensureAuthorized(request)) {
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
    if (scope === "support") {
      const { data: merchants, error: merchantError } = await supabase
        .from("merchants")
        .select("id,name,email,owner_email,contact_email,user_email,user_id,auth_user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (merchantError) throw merchantError;
      const items = buildSupportScopeItems((merchants ?? []) as MerchantRow[]);
      writeMerchantAccountsCache(scope, items);
      return NextResponse.json({ items });
    }

    const [{ data: merchants, error: merchantError }, authUsers] = await Promise.all([
      supabase
        .from("merchants")
        .select("id,name,email,owner_email,contact_email,user_email,user_id,auth_user_id,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      listAuthUsers(supabase),
    ]);

    if (merchantError) throw merchantError;

    const authById = new Map(authUsers.map((user) => [user.id, user] as const));
    const authByEmail = new Map(
      authUsers
        .map((user) => [normalizeEmail(user.email), user] as const)
        .filter(([email]) => Boolean(email)),
    );

    const snapshotByMerchantId = await loadPlatformMerchantSnapshotByMerchantId(
      supabase as unknown as PlatformMerchantSnapshotStoreClient,
    );

    const merchantItems: MerchantAccountItem[] = ((merchants ?? []) as MerchantRow[]).map((merchant) => {
      const email = normalizeEmail(
        merchant.user_email,
        merchant.email,
        merchant.owner_email,
        merchant.contact_email,
      );
      const fallbackAuthUserId = String(merchant.auth_user_id ?? merchant.user_id ?? "").trim();
      const authUser =
        authById.get(String(merchant.auth_user_id ?? "").trim()) ??
        authById.get(String(merchant.user_id ?? "").trim()) ??
        authByEmail.get(email) ??
        null;
      const metadata = readAccountMetadata(authUser);
      const merchantId = String(merchant.id ?? "").trim();
      const snapshotSite = snapshotByMerchantId.get(merchantId) ?? null;
      const merchantName = String(merchant.name ?? "").trim() || String(snapshotSite?.merchantName ?? "").trim();

      return {
        merchantId,
        merchantName,
        email,
        username: metadata.username || merchantName,
        loginId: metadata.loginId || metadata.merchantId || merchantId,
        createdAt: merchant.created_at ?? authUser?.created_at ?? null,
        authUserId: (authUser?.id ?? fallbackAuthUserId) || null,
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
      };
    });

    const linkedAuthKeys = new Set(
      merchantItems.flatMap((item) => {
        const keys: string[] = [];
        if (item.authUserId) keys.push(`id:${item.authUserId}`);
        if (item.email) keys.push(`email:${item.email}`);
        return keys;
      }),
    );

    const authOnlyItems: MerchantAccountItem[] = authUsers
      .filter((user) => {
        const email = normalizeEmail(user.email);
        return !linkedAuthKeys.has(`id:${user.id}`) && (!email || !linkedAuthKeys.has(`email:${email}`));
      })
      .map((user) => {
        const metadata = readAccountMetadata(user);
        return {
          merchantId: metadata.merchantId,
          merchantName: String((snapshotByMerchantId.get(metadata.merchantId)?.merchantName ?? "")).trim(),
          email: normalizeEmail(user.email),
          username: metadata.username,
          loginId: metadata.loginId || metadata.merchantId,
          createdAt: user.created_at ?? null,
          authUserId: user.id,
          emailConfirmed: Boolean(user.email_confirmed_at),
          emailConfirmedAt: user.email_confirmed_at ?? null,
          lastSignInAt: user.last_sign_in_at ?? null,
          manualCreated: metadata.manualCreated,
          hasPublishedSite: false,
          siteSlug: String(snapshotByMerchantId.get(metadata.merchantId)?.domainPrefix ?? snapshotByMerchantId.get(metadata.merchantId)?.domainSuffix ?? "").trim(),
          siteUpdatedAt: null,
          publishedBytes: 0,
          publishedBytesKnown: false,
          visits: { today: 0, day7: 0, day30: 0, total: 0 },
          visitsKnown: false,
          profileSnapshot: snapshotByMerchantId.get(metadata.merchantId) ?? null,
        };
      });

    const dedupedByEmail = new Map<string, MerchantAccountItem>();
    for (const item of [...merchantItems, ...authOnlyItems]) {
      const key = item.email || item.authUserId || `${item.merchantId}:${item.createdAt ?? ""}`;
      dedupedByEmail.set(key, choosePreferredMerchantAccount(dedupedByEmail.get(key), item));
    }

    const normalizedItems = [...dedupedByEmail.values()].map((item) => ({
      ...item,
      merchantId: isNumericMerchantId(item.merchantId) ? item.merchantId : "",
      profileSnapshot:
        isNumericMerchantId(item.merchantId) ? snapshotByMerchantId.get(item.merchantId) ?? item.profileSnapshot ?? null : null,
    }));
    const merchantIds = [...new Set(normalizedItems.map((item) => item.merchantId).filter((item) => isNumericMerchantId(item)))];
    let publishedSiteInfoByMerchantId = new Map<
      string,
      { hasPublishedSite: boolean; siteSlug: string; siteUpdatedAt: string | null; publishedBytes: number; publishedBytesKnown: boolean }
    >();
    if (merchantIds.length > 0) {
      const { data: pageRows, error: pageError } = await supabase
        .from("pages")
        .select("merchant_id,slug,updated_at,blocks")
        .in("merchant_id", merchantIds)
        .limit(Math.max(merchantIds.length * 4, 100));
      if (!pageError && Array.isArray(pageRows)) {
        publishedSiteInfoByMerchantId = buildPublishedSiteInfoByMerchantId(pageRows as PageRow[]);
      }
    }

    let visitsByMerchantId = new Map<string, MerchantVisitSummary>();
    let visitsKnown = false;
    if (merchantIds.length > 0) {
      const { data: pageEvents, error: pageEventsError } = await supabase
        .from("page_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (!pageEventsError && Array.isArray(pageEvents)) {
        visitsByMerchantId = buildMerchantVisitsByMerchantId(pageEvents, Date.now());
        visitsKnown = true;
      } else if (pageEventsError && isMissingRelationError(pageEventsError.message)) {
        visitsKnown = false;
      }
    }

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

    writeMerchantAccountsCache(scope, items);

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_account_load_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!ensureAuthorized(request)) {
    return unauthorizedJson();
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return envMissingJson();
  }

  try {
    const payload = (await request.json().catch(() => null)) as {
      merchantId?: unknown;
      username?: unknown;
      password?: unknown;
    } | null;
    const merchantId = typeof payload?.merchantId === "string" ? payload.merchantId.trim() : "";
    const username = typeof payload?.username === "string" ? payload.username.trim() : "";
    const password = typeof payload?.password === "string" ? payload.password : "";

    if (!isMerchantNumericId(merchantId)) {
      return badRequestJson("invalid_merchant_id", "ID 必须是 8 位数字");
    }
    if (!username) {
      return badRequestJson("invalid_username", "请输入用户名");
    }
    if (password.length < 6) {
      return badRequestJson("invalid_password", "密码至少 6 位");
    }

    const usernameKey = normalizeAccountValue(username);
    const manualEmail = buildManualUserEmail(merchantId);

    const [{ rules: blockedRules }, existingMerchantById, existingMerchantByName, authUsers] = await Promise.all([
      loadMerchantIdRulesFromStore(supabase),
      supabase.from("merchants").select("id").eq("id", merchantId).limit(1).maybeSingle(),
      supabase.from("merchants").select("id").eq("name", username).limit(1).maybeSingle(),
      listAuthUsers(supabase),
    ]);

    if (existingMerchantById.error) throw existingMerchantById.error;
    if (existingMerchantByName.error) throw existingMerchantByName.error;

    if (existingMerchantById.data?.id) {
      return conflictJson("merchant_id_exists", "ID 已存在，请更换后重试");
    }
    if (existingMerchantByName.data?.id) {
      return conflictJson("username_exists", "用户名已存在，请更换后重试");
    }
    if (findBlockingMerchantIdRule(merchantId, blockedRules)) {
      return conflictJson("merchant_id_disabled", "该 ID 已在禁用设置中，不能用于创建用户");
    }

    const duplicateIdUser = authUsers.find((user) => {
      const metadata = readAccountMetadata(user);
      return (
        metadata.loginId === merchantId ||
        metadata.merchantId === merchantId ||
        normalizeEmail(user.email) === manualEmail
      );
    });
    if (duplicateIdUser) {
      return conflictJson("merchant_id_exists", "ID 已存在，请更换后重试");
    }

    const duplicateUsernameUser = authUsers.find((user) => readAccountMetadata(user).usernameKey === usernameKey);
    if (duplicateUsernameUser) {
      return conflictJson("username_exists", "用户名已存在，请更换后重试");
    }

    const { data: createdUserData, error: createUserError } = await supabase.auth.admin.createUser({
      email: manualEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username: usernameKey,
        display_name: username,
        merchant_id: merchantId,
        login_id: merchantId,
        manual_user: true,
      },
      app_metadata: {
        merchant_id: merchantId,
        login_id: merchantId,
        manual_user: true,
      },
    });

    if (createUserError || !createdUserData.user) {
      if (createUserError && isDuplicateKeyError(createUserError)) {
        return conflictJson("merchant_id_exists", "ID 已存在，请更换后重试");
      }
      throw createUserError ?? new Error("auth_user_create_failed");
    }

    const authUser = createdUserData.user;
    const authUserId = String(authUser.id ?? "").trim();
    const { error: merchantInsertError } = await supabase.from("merchants").insert({
      id: merchantId,
      name: username,
      email: manualEmail,
      owner_email: manualEmail,
      contact_email: manualEmail,
      user_email: manualEmail,
      user_id: authUserId,
      auth_user_id: authUserId,
      owner_user_id: authUserId,
      owner_id: authUserId,
      auth_id: authUserId,
      created_by: authUserId,
      created_by_user_id: authUserId,
    });

    if (merchantInsertError) {
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {
        // Ignore cleanup failure and surface the original insert error below.
      });
      if (isDuplicateKeyError(merchantInsertError)) {
        return conflictJson("merchant_id_exists", "ID 已存在，请更换后重试");
      }
      throw merchantInsertError;
    }

    const item: MerchantAccountItem = {
      merchantId,
      merchantName: username,
      email: manualEmail,
      username,
      loginId: merchantId,
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
    };

    merchantAccountsCache.clear();
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "merchant_account_create_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
