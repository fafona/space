import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Block } from "@/data/homeBlocks";
import { sanitizeBlocksForRuntime } from "@/lib/blocksSanitizer";

type SaveErrorLike = { message: string } | null;

type PublishRequestBody = {
  requestId?: string;
  payload?: {
    blocks?: Block[];
    updated_at?: string;
  };
  merchantIds?: string[];
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
};

type PublishCachedResult = {
  at: number;
  status: number;
  body: Record<string, unknown>;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 3;

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

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "未知错误";
  const record = input as { message?: unknown };
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return "未知错误";
}

function normalizeMerchantIds(merchantIds: unknown, isPlatformEditor: boolean) {
  if (isPlatformEditor) return [];
  if (!Array.isArray(merchantIds)) return [];
  const ids = merchantIds
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return [...new Set(ids)];
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
) {
  const sanitizedBlocks = sanitizeBlocksForRuntime(payload.blocks).blocks;
  const state = {
    pagesSlugColumnSupported: null as boolean | null,
    pagesUpdatedAtColumnSupported: null as boolean | null,
  };

  const trySaveWithPayload = async (sanitizedPayload: { blocks: Block[]; updated_at?: string }): Promise<SaveErrorLike> => {
    if (merchantIds.length === 0) {
      if (state.pagesSlugColumnSupported !== false) {
        const scopedBySlug = await supabase
          .from("pages")
          .update(sanitizedPayload)
          .is("merchant_id", null)
          .eq("slug", "home");
        if (!scopedBySlug.error) {
          state.pagesSlugColumnSupported = true;
          return null;
        }

        const scopedMessage = toErrorMessage(scopedBySlug.error);
        if (isMissingMerchantIdColumn(scopedMessage)) {
          const bySlug = await supabase.from("pages").update(sanitizedPayload).eq("slug", "home");
          if (!bySlug.error) {
            state.pagesSlugColumnSupported = true;
            return null;
          }
          const slugMessage = toErrorMessage(bySlug.error);
          if (!isMissingSlugColumn(slugMessage)) return { message: slugMessage };
          state.pagesSlugColumnSupported = false;
        } else {
          if (!isMissingSlugColumn(scopedMessage)) return { message: scopedMessage };
          state.pagesSlugColumnSupported = false;
        }
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

      return { message: "未匹配到全局页面记录，无法写入远端。" };
    }

    for (const merchantId of merchantIds) {
      const byMerchant = await supabase
        .from("pages")
        .select("id")
        .eq("merchant_id", merchantId)
        .limit(1)
        .maybeSingle();
      if (byMerchant.error) continue;
      const byMerchantRecord = (byMerchant.data ?? null) as { id?: string | number | null } | null;
      if (byMerchantRecord?.id !== undefined && byMerchantRecord?.id !== null) {
        const byId = await supabase.from("pages").update(sanitizedPayload).eq("id", byMerchantRecord.id);
        if (!byId.error) return null;
        return { message: toErrorMessage(byId.error) };
      }
    }

    const initErrors: string[] = [];
    for (const merchantId of merchantIds) {
      const withSlug = await supabase.from("pages").insert({
        ...sanitizedPayload,
        merchant_id: merchantId,
        slug: "home",
      });
      if (!withSlug.error) return null;
      const withSlugMessage = toErrorMessage(withSlug.error);
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
        slug: "home",
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
) {
  let lastError: SaveErrorLike = null;
  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    const error = await saveBlocksToPagesTable(supabase, payload, merchantIds);
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

export async function POST(request: Request) {
  const now = Date.now();
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
    const payloadBlocks = Array.isArray(body.payload?.blocks) ? body.payload?.blocks : null;
    const updatedAtRaw = String(body.payload?.updated_at ?? "").trim();
    if (!payloadBlocks || !updatedAtRaw) {
      const status = 400;
      const responseBody = { ok: false, code: "invalid_payload", message: "缺少有效的发布内容。" };
      resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
      return makeCachedResponse(status, responseBody);
    }

    const normalizedUpdatedAt = Number.isFinite(new Date(updatedAtRaw).getTime())
      ? new Date(updatedAtRaw).toISOString()
      : new Date().toISOString();
    const isPlatformEditor = body.isPlatformEditor === true;
    const merchantIds = normalizeMerchantIds(body.merchantIds, isPlatformEditor);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: fetch.bind(globalThis),
      },
    });

    const saveError = await saveWithRetry(
      supabase as unknown as LooseSupabaseClient,
      {
        blocks: payloadBlocks,
        updated_at: normalizedUpdatedAt,
      },
      merchantIds,
    );

    if (saveError) {
      const status = 409;
      const responseBody = {
        ok: false,
        code: "publish_failed",
        message: saveError.message || "发布失败",
        requestId,
      };
      resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
      return makeCachedResponse(status, responseBody);
    }

    const status = 200;
    const responseBody = {
      ok: true,
      requestId,
      updatedAt: normalizedUpdatedAt,
      merchantCount: merchantIds.length,
      mode: isPlatformEditor ? "platform" : "merchant",
    };
    resultCache.set(requestId, { at: Date.now(), status, body: responseBody });
    return makeCachedResponse(status, responseBody);
  })().finally(() => {
    inflightCache.delete(requestId);
  });

  inflightCache.set(requestId, task);
  return task;
}
