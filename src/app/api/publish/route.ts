import { after, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Block } from "@/data/homeBlocks";
import { createDefaultMerchantPermissionConfig } from "@/data/platformControlStore";
import { readMerchantRequestAccessTokens } from "@/lib/merchantAuthSession";
import { assertLegacyMerchantIdentityAllowed } from "@/lib/merchantStaffPrincipal.server";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";
import { saveMerchantBookingRulesSnapshotForSites } from "@/lib/merchantBookingRulesStore";
import { saveStoredMerchantDraft, type MerchantDraftStoreClient } from "@/lib/merchantDraftStore";
import { normalizeDomainPrefix } from "@/lib/merchantIdentity";
import { getMerchantPublishPermissionViolation } from "@/lib/merchantPermissionGuards";
import { getMerchantServiceState } from "@/lib/merchantServiceStatus";
import { getInlinePublishPayloadViolation } from "@/lib/publishPayloadValidation";
import { clearPublishedSiteDataCache } from "@/lib/publishedSiteData";
import {
  loadStoredPlatformMerchantSnapshot,
  type PlatformMerchantSnapshotStoreClient,
} from "@/lib/platformMerchantSnapshotStore";
import { isSuperAdminRequestAuthorized } from "@/lib/superAdminRequestAuth";
import { getTrustedMutationRequestErrorResponse, isTrustedSameOriginMutationRequest } from "@/lib/requestMutationGuard";

type SaveErrorLike = { message: string } | null;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PublishRequestBody = {
  requestId?: string;
  payload?: {
    blocks?: Block[];
    updated_at?: string;
  };
  merchantIds?: string[];
  merchantSlug?: string;
  isPlatformEditor?: boolean;
};

type LoosePostgrestError = { message?: string } | null;
type LoosePostgrestResponse = {
  error: LoosePostgrestError;
  data?: unknown;
};

type LooseQueryBuilder = PromiseLike<LoosePostgrestResponse> & {
  select: (columns: string) => LooseQueryBuilder;
  update: (payload: Record<string, unknown>) => LooseQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<LoosePostgrestResponse>;
  is: (column: string, value: unknown) => LooseQueryBuilder;
  eq: (column: string, value: unknown) => LooseQueryBuilder;
  limit: (value: number) => LooseQueryBuilder;
  maybeSingle: () => Promise<LoosePostgrestResponse>;
};

type LooseSupabaseClient = {
  from: (table: string) => LooseQueryBuilder;
  auth: {
    getUser: (token: string) => Promise<{
      data: {
        user: {
          id?: string;
          email?: string | null;
          user_metadata?: Record<string, unknown> | null;
          app_metadata?: Record<string, unknown> | null;
        } | null;
      };
      error: { message?: string } | null;
    }>;
  };
};

type GlobalPageRecord = {
  id?: string | number | null;
  blocks?: unknown;
} | null;

type MerchantRow = {
  id?: string | null;
};

type PublishCachedResult = {
  at: number;
  status: number;
  body: Record<string, unknown>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 2;
const PUBLISH_ROUTE_DEADLINE_MS = 24_000;
const SUPABASE_REQUEST_TIMEOUT_MS = 6_000;
const PUBLISH_PERMISSION_SNAPSHOT_TIMEOUT_MS = 3_500;
const OPTIONAL_PUBLISH_SYNC_TIMEOUT_MS = 8_000;

const globalState = globalThis as typeof globalThis & {
  __merchantPublishResultCache?: Map<string, PublishCachedResult>;
  __merchantPublishInflight?: Map<string, Promise<NextResponse>>;
};

if (!globalState.__merchantPublishResultCache) {
  globalState.__merchantPublishResultCache = new Map<string, PublishCachedResult>();
}
if (!globalState.__merchantPublishInflight) {
  globalState.__merchantPublishInflight = new Map<string, Promise<NextResponse>>();
}

const resultCache = globalState.__merchantPublishResultCache;
const inflightCache = globalState.__merchantPublishInflight;

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isDuplicatePagesSlugError(message: string) {
  return /duplicate key value violates unique constraint/i.test(message) && /pages_merchant_slug_unique_idx/i.test(message);
}

function isInternalPagesSlug(value: unknown) {
  const slug = typeof value === "string" ? value.trim() : "";
  return slug.startsWith("__");
}

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "未知错误";
  const record = input as { message?: unknown };
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return "未知错误";
}

function toPublishErrorMessage(input: unknown) {
  if (input instanceof Error && input.message.trim()) return input.message.trim();
  if (typeof input === "string" && input.trim()) return input.trim();
  return "publish_request_failed";
}

function createDeadlineFetch(deadlineAt: number): typeof fetch {
  return async (input, init) => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 250) throw new Error("publish_request_deadline_exceeded");
    const timeoutMs = Math.max(250, Math.min(SUPABASE_REQUEST_TIMEOUT_MS, remainingMs - 250));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const upstreamSignal = init?.signal;
    const abortFromUpstream = () => controller.abort();
    if (upstreamSignal) {
      if (upstreamSignal.aborted) controller.abort();
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("publish_backend_request_timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
    }
  };
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeMerchantIds(merchantIds: unknown, isPlatformEditor: boolean) {
  if (isPlatformEditor) return [];
  if (!Array.isArray(merchantIds)) return [];
  const ids = merchantIds
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return [...new Set(ids)];
}

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function readMetadataMerchantIds(user: {
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
} | null) {
  const merchantIds: string[] = [];
  const metadata = {
    ...(user?.user_metadata ?? {}),
    ...(user?.app_metadata ?? {}),
  } as Record<string, unknown>;
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || merchantIds.includes(trimmed)) return;
    merchantIds.push(trimmed);
  };
  push(metadata.merchant_id);
  push(metadata.merchantId);
  push(metadata.merchantID);
  push(metadata.site_id);
  push(metadata.siteId);
  push(metadata.shop_id);
  push(metadata.shopId);
  return merchantIds;
}

async function getAuthorizedMerchantIds(
  supabase: LooseSupabaseClient,
  userId: string,
  email: string,
) {
  const lookups: LooseQueryBuilder[] = [];

  if (userId) {
    ["user_id", "auth_user_id", "owner_user_id", "owner_id", "auth_id", "created_by", "created_by_user_id"].forEach(
      (column) => {
        lookups.push(supabase.from("merchants").select("id").eq(column, userId).limit(20));
      },
    );
  }

  if (email) {
    ["email", "owner_email", "contact_email", "user_email"].forEach((column) => {
      lookups.push(supabase.from("merchants").select("id").eq(column, email).limit(20));
    });
  }

  const settled = await Promise.allSettled(lookups);
  const merchantIds: string[] = [];
  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    if (result.value.error) return;
    ((result.value.data ?? []) as MerchantRow[]).forEach((row) => {
      const merchantId = String(row.id ?? "").trim();
      if (!merchantId || merchantIds.includes(merchantId)) return;
      merchantIds.push(merchantId);
    });
  });
  return merchantIds;
}

async function isAuthorizedForMerchantIds(
  request: Request,
  supabase: LooseSupabaseClient,
  merchantIds: string[],
) {
  if (isSuperAdminRequestAuthorized(request)) {
    return true;
  }

  const targetMerchantIds = [...new Set(merchantIds.map((item) => item.trim()).filter(Boolean))];
  if (targetMerchantIds.length === 0) {
    return false;
  }

  const authorizedMerchantIds = new Set<string>();
  const accessTokens = readMerchantRequestAccessTokens(request);
  for (const accessToken of accessTokens) {
    const authResult = await supabase.auth.getUser(accessToken);
    if (authResult.error || !authResult.data.user) continue;
    const legacyIdentityAllowed = await assertLegacyMerchantIdentityAllowed(
      supabase,
      authResult.data.user,
    ).then(
      () => true,
      () => false,
    );
    if (!legacyIdentityAllowed) continue;

    readMetadataMerchantIds(authResult.data.user).forEach((merchantId) => {
      authorizedMerchantIds.add(merchantId);
    });
    if (targetMerchantIds.every((merchantId) => authorizedMerchantIds.has(merchantId))) {
      return true;
    }

    const linkedMerchantIds = await getAuthorizedMerchantIds(
      supabase,
      String(authResult.data.user.id ?? "").trim(),
      normalizeEmail(authResult.data.user.email),
    );
    linkedMerchantIds.forEach((merchantId) => {
      authorizedMerchantIds.add(merchantId);
    });
    if (targetMerchantIds.every((merchantId) => authorizedMerchantIds.has(merchantId))) {
      return true;
    }
  }

  if (authorizedMerchantIds.size === 0) {
    return false;
  }

  return targetMerchantIds.every((merchantId) => authorizedMerchantIds.has(merchantId));
}

function isTransientSaveError(message: string) {
  const normalized = (message ?? "").toLowerCase();
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("upstream") ||
    normalized.includes("cooldown") ||
    normalized.includes("temporarily") ||
    normalized.includes("connection")
  );
}

async function sleep(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function saveBlocksToPagesTable(
  supabase: LooseSupabaseClient,
  payload: { blocks: Block[]; updated_at: string },
  merchantIds: string[],
  merchantSlug: string,
) {
  const sanitizedBlocks = sanitizeBlocksForRuntime(payload.blocks).blocks;
  const normalizedMerchantSlug = normalizeDomainPrefix(merchantSlug) || "home";
  const state = {
    pagesSlugColumnSupported: null as boolean | null,
    pagesMerchantIdColumnSupported: null as boolean | null,
    pagesUpdatedAtColumnSupported: null as boolean | null,
  };

  const queryGlobalPageRecord = async (columns: string): Promise<{ record: GlobalPageRecord; error: SaveErrorLike }> => {
    if (state.pagesSlugColumnSupported !== false && state.pagesMerchantIdColumnSupported !== false) {
      const scopedBySlug = await supabase
        .from("pages")
        .select(columns)
        .is("merchant_id", null)
        .eq("slug", "home")
        .limit(1)
        .maybeSingle();
      if (!scopedBySlug.error) {
        state.pagesSlugColumnSupported = true;
        state.pagesMerchantIdColumnSupported = true;
        return {
          record: (scopedBySlug.data ?? null) as GlobalPageRecord,
          error: null,
        };
      }

      const scopedMessage = toErrorMessage(scopedBySlug.error);
      if (isMissingMerchantIdColumn(scopedMessage)) {
        state.pagesMerchantIdColumnSupported = false;
      } else if (isMissingSlugColumn(scopedMessage)) {
        state.pagesSlugColumnSupported = false;
      } else {
        return { record: null, error: { message: scopedMessage } };
      }
    }

    if (state.pagesSlugColumnSupported !== false) {
      const bySlug = await supabase.from("pages").select(columns).eq("slug", "home").limit(1).maybeSingle();
      if (!bySlug.error) {
        state.pagesSlugColumnSupported = true;
        return {
          record: (bySlug.data ?? null) as GlobalPageRecord,
          error: null,
        };
      }

      const slugMessage = toErrorMessage(bySlug.error);
      if (isMissingSlugColumn(slugMessage)) {
        state.pagesSlugColumnSupported = false;
      } else {
        return { record: null, error: { message: slugMessage } };
      }
    }

    if (state.pagesMerchantIdColumnSupported !== false) {
      const byMerchantId = await supabase.from("pages").select(columns).is("merchant_id", null).limit(1).maybeSingle();
      if (!byMerchantId.error) {
        state.pagesMerchantIdColumnSupported = true;
        return {
          record: (byMerchantId.data ?? null) as GlobalPageRecord,
          error: null,
        };
      }

      const merchantMessage = toErrorMessage(byMerchantId.error);
      if (isMissingMerchantIdColumn(merchantMessage)) {
        state.pagesMerchantIdColumnSupported = false;
      } else {
        return { record: null, error: { message: merchantMessage } };
      }
    }

    const fallback = await supabase.from("pages").select(columns).limit(1).maybeSingle();
    if (fallback.error) {
      return { record: null, error: { message: toErrorMessage(fallback.error) } };
    }

    return {
      record: (fallback.data ?? null) as GlobalPageRecord,
      error: null,
    };
  };

  const trySaveWithPayload = async (sanitizedPayload: { blocks: Block[]; updated_at?: string }): Promise<SaveErrorLike> => {
    if (merchantIds.length === 0) {
      const existingGlobal = await queryGlobalPageRecord("id");
      if (existingGlobal.error) return existingGlobal.error;

      const globalRowId = existingGlobal.record?.id;
      if (globalRowId !== undefined && globalRowId !== null) {
        const byId = await supabase.from("pages").update(sanitizedPayload).eq("id", globalRowId);
        if (!byId.error) return null;
        return { message: toErrorMessage(byId.error) };
      }

      if (state.pagesSlugColumnSupported !== false) {
        const initHome = await supabase.from("pages").insert({
          ...sanitizedPayload,
          slug: "home",
        });
        if (!initHome.error) {
          state.pagesSlugColumnSupported = true;
          return null;
        }
        const initMessage = toErrorMessage(initHome.error);
        if (isMissingSlugColumn(initMessage)) {
          state.pagesSlugColumnSupported = false;
        } else {
          return { message: initMessage };
        }
      }

      const initWithoutSlug = await supabase.from("pages").insert(sanitizedPayload);
      if (!initWithoutSlug.error) return null;
      return { message: toErrorMessage(initWithoutSlug.error) };
    }

    const updateMerchantPageById = async (rowId: string | number) => {
      if (state.pagesSlugColumnSupported !== false) {
        const byIdWithSlug = await supabase
          .from("pages")
          .update({ ...sanitizedPayload, slug: normalizedMerchantSlug })
          .eq("id", rowId);
        if (!byIdWithSlug.error) {
          state.pagesSlugColumnSupported = true;
          return null;
        }
        const byIdWithSlugMessage = toErrorMessage(byIdWithSlug.error);
        if (!isMissingSlugColumn(byIdWithSlugMessage)) {
          return { message: byIdWithSlugMessage };
        }
        state.pagesSlugColumnSupported = false;
      }

      const byId = await supabase.from("pages").update(sanitizedPayload).eq("id", rowId);
      if (!byId.error) return null;
      return { message: toErrorMessage(byId.error) };
    };

    const queryMerchantPublicPageBySlug = async (merchantId: string) => {
      if (state.pagesSlugColumnSupported === false || state.pagesMerchantIdColumnSupported === false) return null;
      const byMerchantSlug = await supabase
        .from("pages")
        .select("id")
        .eq("merchant_id", merchantId)
        .eq("slug", normalizedMerchantSlug)
        .limit(1)
        .maybeSingle();
      if (!byMerchantSlug.error) {
        state.pagesSlugColumnSupported = true;
        state.pagesMerchantIdColumnSupported = true;
        return (byMerchantSlug.data ?? null) as { id?: string | number | null } | null;
      }
      const message = toErrorMessage(byMerchantSlug.error);
      if (isMissingSlugColumn(message)) {
        state.pagesSlugColumnSupported = false;
        return null;
      }
      if (isMissingMerchantIdColumn(message)) {
        state.pagesMerchantIdColumnSupported = false;
        return null;
      }
      return null;
    };

    const queryLegacyMerchantPublicPage = async (merchantId: string) => {
      if (state.pagesMerchantIdColumnSupported === false) return null;
      const columns = state.pagesSlugColumnSupported === false ? "id" : "id,slug";
      const byMerchant = await supabase.from("pages").select(columns).eq("merchant_id", merchantId).limit(20);
      if (byMerchant.error) {
        const message = toErrorMessage(byMerchant.error);
        if (isMissingSlugColumn(message)) state.pagesSlugColumnSupported = false;
        if (isMissingMerchantIdColumn(message)) state.pagesMerchantIdColumnSupported = false;
        return null;
      }
      const rows = Array.isArray(byMerchant.data)
        ? (byMerchant.data as Array<{ id?: string | number | null; slug?: unknown }>)
        : [];
      return (
        rows.find((row) => row.slug === normalizedMerchantSlug) ??
        rows.find((row) => !row.slug || row.slug === "home") ??
        rows.find((row) => !isInternalPagesSlug(row.slug)) ??
        null
      );
    };

    for (const merchantId of merchantIds) {
      const byMerchantRecord =
        (await queryMerchantPublicPageBySlug(merchantId)) ?? (await queryLegacyMerchantPublicPage(merchantId));
      if (byMerchantRecord?.id !== undefined && byMerchantRecord?.id !== null) {
        return updateMerchantPageById(byMerchantRecord.id);
      }
    }

    const initErrors: string[] = [];
    for (const merchantId of merchantIds) {
      const withSlug = await supabase.from("pages").insert({
        ...sanitizedPayload,
        merchant_id: merchantId,
        slug: normalizedMerchantSlug,
      });
      if (!withSlug.error) return null;
      const withSlugMessage = toErrorMessage(withSlug.error);
      if (isDuplicatePagesSlugError(withSlugMessage)) {
        const existingAfterConflict = await queryMerchantPublicPageBySlug(merchantId);
        if (existingAfterConflict?.id !== undefined && existingAfterConflict?.id !== null) {
          return updateMerchantPageById(existingAfterConflict.id);
        }
      }
      initErrors.push(`pages 初始化（含 slug）失败(${merchantId}): ${withSlugMessage}`);

      if (isMissingSlugColumn(withSlugMessage)) {
        const withoutSlug = await supabase.from("pages").insert({
          ...sanitizedPayload,
          merchant_id: merchantId,
        });
        if (!withoutSlug.error) return null;
        initErrors.push(`pages 初始化（无 slug）失败(${merchantId}): ${toErrorMessage(withoutSlug.error)}`);
      }

      const autoMerchantWithSlug = await supabase.from("pages").insert({
        ...sanitizedPayload,
        slug: normalizedMerchantSlug,
      });
      if (!autoMerchantWithSlug.error) return null;
      const autoWithSlugMessage = toErrorMessage(autoMerchantWithSlug.error);
      initErrors.push(`pages 初始化（自动 merchant_id，含 slug）失败(${merchantId}): ${autoWithSlugMessage}`);

      if (isMissingSlugColumn(autoWithSlugMessage)) {
        const autoMerchantWithoutSlug = await supabase.from("pages").insert(sanitizedPayload);
        if (!autoMerchantWithoutSlug.error) return null;
        initErrors.push(`pages 初始化（自动 merchant_id，无 slug）失败(${merchantId}): ${toErrorMessage(autoMerchantWithoutSlug.error)}`);
      }
    }

    return {
      message:
        initErrors.length > 0
          ? `存在可更新 pages 记录，但自动初始化失败：${initErrors.join("；")}`
          : "存在可更新 pages 记录，但初始化失败",
    };
  };

  const withUpdatedAt = { blocks: sanitizedBlocks, updated_at: payload.updated_at };
  if (state.pagesUpdatedAtColumnSupported !== false) {
    const first = await trySaveWithPayload(withUpdatedAt);
    if (!first) {
      state.pagesUpdatedAtColumnSupported = true;
      return null;
    }
    if (!isMissingUpdatedAtColumn(first.message)) return first;
    state.pagesUpdatedAtColumnSupported = false;
  }

  return trySaveWithPayload({ blocks: sanitizedBlocks });
}

async function saveWithRetry(
  supabase: LooseSupabaseClient,
  payload: { blocks: Block[]; updated_at: string },
  merchantIds: string[],
  merchantSlug: string,
) {
  let lastError: SaveErrorLike = null;
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    const error = await saveBlocksToPagesTable(supabase, payload, merchantIds, merchantSlug).catch((saveError: unknown) => ({
      message: toPublishErrorMessage(saveError),
    }));
    if (!error) return null;
    lastError = error;
    if (!isTransientSaveError(error.message) || attempt === MAX_RETRY_ATTEMPTS) break;
    await sleep(250 * attempt);
  }
  return lastError;
}

function makeCachedResponse(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function scheduleOptionalPostPublishSync(input: {
  supabase: LooseSupabaseClient;
  merchantIds: string[];
  blocks: Block[];
  updatedAt: string;
}) {
  const merchantIds = [...new Set(input.merchantIds.map((merchantId) => merchantId.trim()).filter(Boolean))];
  if (merchantIds.length === 0) return false;
  after(async () => {
    await Promise.allSettled([
      withTimeout(
        saveMerchantBookingRulesSnapshotForSites(merchantIds, input.blocks, input.updatedAt),
        OPTIONAL_PUBLISH_SYNC_TIMEOUT_MS,
        "booking_rules_snapshot_timeout",
      ),
      withTimeout(
        Promise.allSettled(
          merchantIds.map((merchantId) =>
            saveStoredMerchantDraft(input.supabase as unknown as MerchantDraftStoreClient, {
              siteId: merchantId,
              blocks: input.blocks,
              updatedAt: input.updatedAt,
            }),
          ),
        ),
        OPTIONAL_PUBLISH_SYNC_TIMEOUT_MS,
        "merchant_draft_backup_timeout",
      ),
    ]).catch(() => null);
  });
  return true;
}

export async function POST(request: Request) {
  if (!isTrustedSameOriginMutationRequest(request)) {
    return getTrustedMutationRequestErrorResponse();
  }
  const now = Date.now();
  const deadlineAt = now + PUBLISH_ROUTE_DEADLINE_MS;
  for (const [key, value] of resultCache.entries()) {
    if (now - value.at > CACHE_TTL_MS) resultCache.delete(key);
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey =
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() ||
    (process.env.NEXT_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return makeCachedResponse(503, {
      ok: false,
      code: "publish_service_unavailable",
      message: "服务端发布通道未配置（缺少 SUPABASE_SERVICE_ROLE_KEY）。",
    });
  }

  let body: PublishRequestBody;
  try {
    body = (await request.json()) as PublishRequestBody;
  } catch {
    return makeCachedResponse(400, { ok: false, code: "invalid_json", message: "请求体不是有效 JSON。" });
  }

  const requestId = String(body.requestId ?? "").trim() || `publish-${Date.now()}`;
  const cached = resultCache.get(requestId);
  if (cached && now - cached.at <= CACHE_TTL_MS) {
    return makeCachedResponse(cached.status, cached.body);
  }

  const inflight = inflightCache.get(requestId);
  if (inflight) return inflight;

  const task = (async () => {
    try {
    const payloadBlocks = Array.isArray(body.payload?.blocks) ? body.payload?.blocks : null;
    const updatedAtRaw = String(body.payload?.updated_at ?? "").trim();
    if (!payloadBlocks || !updatedAtRaw) {
      const status = 400;
      const responseBody = { ok: false, code: "invalid_payload", message: "缺少有效的发布内容。" };
      resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
      return makeCachedResponse(status, responseBody);
    }

    const inlineViolation = getInlinePublishPayloadViolation(payloadBlocks);
    if (inlineViolation) {
      const status = 400;
      const responseBody = {
        ok: false,
        code: "inline_assets_not_allowed",
        message: inlineViolation,
        requestId,
      };
      resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
      return makeCachedResponse(status, responseBody);
    }
    const sanitizedPublishedBlocks = sanitizeBlocksForRuntime(payloadBlocks).blocks;
    const normalizedUpdatedAt = Number.isFinite(new Date(updatedAtRaw).getTime())
      ? new Date(updatedAtRaw).toISOString()
      : new Date().toISOString();
    const isPlatformEditor = body.isPlatformEditor === true;
    const merchantIds = normalizeMerchantIds(body.merchantIds, isPlatformEditor);
    const merchantSlug = isPlatformEditor ? "home" : normalizeDomainPrefix(body.merchantSlug);
    if (!isPlatformEditor && merchantIds.length === 0) {
      const status = 400;
      const responseBody = {
        ok: false,
        code: "invalid_merchant_scope",
        message: "发布缺少有效商户站点，请重新进入后台后再发布",
        requestId,
      };
      resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
      return makeCachedResponse(status, responseBody);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: createDeadlineFetch(deadlineAt),
      },
    }) as unknown as LooseSupabaseClient;

    if (isPlatformEditor) {
      if (!isSuperAdminRequestAuthorized(request)) {
        const status = 401;
        const responseBody = {
          ok: false,
          code: "unauthorized",
          message: "发布未授权，请重新登录超级管理员后再发布",
          requestId,
        };
        resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
        return makeCachedResponse(status, responseBody);
      }
    } else {
      const authorized = await isAuthorizedForMerchantIds(request, supabase, merchantIds);
      if (!authorized) {
        const status = 401;
        const responseBody = {
          ok: false,
          code: "unauthorized",
          message: "发布未授权，请重新登录商户账号后再发布",
          requestId,
        };
        resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
        return makeCachedResponse(status, responseBody);
      }
    }

    if (!isPlatformEditor && merchantIds.length > 0) {
      const snapshotPayload = await withTimeout(
        loadStoredPlatformMerchantSnapshot(
          supabase as unknown as PlatformMerchantSnapshotStoreClient,
          { bypassCache: true, includeHistory: false },
        ),
        PUBLISH_PERMISSION_SNAPSHOT_TIMEOUT_MS,
        "merchant_permission_snapshot_timeout",
      ).catch(() => null);
      if (!snapshotPayload) {
        const saveError = await saveWithRetry(
          supabase,
          {
            blocks: sanitizedPublishedBlocks,
            updated_at: normalizedUpdatedAt,
          },
          merchantIds,
          merchantSlug,
        );

        if (saveError) {
          const transient = isTransientSaveError(saveError.message);
          const status = transient ? 503 : 409;
          const responseBody = {
            ok: false,
            code: transient ? "publish_backend_request_timeout" : "publish_failed",
            message: saveError.message || "鍙戝竷澶辫触",
            requestId,
          };
          resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
          return makeCachedResponse(status, responseBody);
        }

        clearPublishedSiteDataCache(merchantIds);

        const status = 200;
        const responseBody = {
          ok: true,
          requestId,
          updatedAt: normalizedUpdatedAt,
          merchantCount: merchantIds.length,
          mode: "merchant",
          postPublishSyncScheduled: scheduleOptionalPostPublishSync({
            supabase,
            merchantIds,
            blocks: sanitizedPublishedBlocks,
            updatedAt: normalizedUpdatedAt,
          }),
          permissionSnapshotSkipped: true,
        };
        resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
        return makeCachedResponse(status, responseBody);
      }
      const snapshotByMerchantId = new Map(
        snapshotPayload.snapshot.map((site) => [site.id, site] as const),
      );
      const blockedState = merchantIds
        .map((merchantId) => {
          const snapshotSite = snapshotByMerchantId.get(merchantId) ?? null;
          if (!snapshotSite) return null;
          return getMerchantServiceState(snapshotSite.status, snapshotSite.serviceExpiresAt);
        })
        .find((item) => item?.maintenance) ?? null;
      if (blockedState) {
        const status = 409;
        const responseBody = {
          ok: false,
          code: "merchant_service_paused",
          message: "服务到期，详询官方客服",
          requestId,
        };
        resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
        return makeCachedResponse(status, responseBody);
      }

      const violation = merchantIds
        .map((merchantId) => {
          const snapshotSite = snapshotByMerchantId.get(merchantId) ?? null;
          return getMerchantPublishPermissionViolation(
            snapshotSite?.permissionConfig ?? createDefaultMerchantPermissionConfig(),
            sanitizedPublishedBlocks,
          );
        })
        .find((item) => !!item);
      if (violation) {
        const status = 403;
        const responseBody = {
          ok: false,
          code: violation.code,
          message: violation.message,
          requestId,
        };
        resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
        return makeCachedResponse(status, responseBody);
      }
    }

    const saveError = await saveWithRetry(
      supabase,
      {
        blocks: sanitizedPublishedBlocks,
        updated_at: normalizedUpdatedAt,
      },
      merchantIds,
      merchantSlug,
    );

    if (saveError) {
      const transient = isTransientSaveError(saveError.message);
      const status = transient ? 503 : 409;
      const responseBody = {
        ok: false,
        code: transient ? "publish_backend_request_timeout" : "publish_failed",
        message: saveError.message || "发布失败",
        requestId,
      };
      resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
      return makeCachedResponse(status, responseBody);
    }

    clearPublishedSiteDataCache(merchantIds);

    const postPublishSyncScheduled =
      !isPlatformEditor &&
      scheduleOptionalPostPublishSync({
        supabase,
        merchantIds,
        blocks: sanitizedPublishedBlocks,
        updatedAt: normalizedUpdatedAt,
      });

    const status = 200;
    const responseBody = {
      ok: true,
      requestId,
      updatedAt: normalizedUpdatedAt,
      merchantCount: merchantIds.length,
      mode: isPlatformEditor ? "platform" : "merchant",
      ...(postPublishSyncScheduled ? { postPublishSyncScheduled } : {}),
    };
    resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
    return makeCachedResponse(status, responseBody);
    } catch (error) {
      const status = 503;
      const responseBody = {
        ok: false,
        code: "publish_request_failed",
        message: toPublishErrorMessage(error),
        requestId,
      };
      resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
      return makeCachedResponse(status, responseBody);
    }
  })().finally(() => {
    inflightCache.delete(requestId);
  });

  inflightCache.set(requestId, task);
  return task;
}
