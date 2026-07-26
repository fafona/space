import {
  MERCHANT_SUPPORT_READ_STATE_SLUG,
  buildMerchantSupportReadStateBlocks,
  mergeMerchantSupportReadStatePayloads,
  normalizeMerchantSupportReadStatePayload,
  readMerchantSupportReadStateFromBlocks,
  type MerchantSupportReadStatePayload,
} from "@/lib/merchantSupportReadState";
import {
  mirrorMerchantConversationReadState,
  type MerchantConversationShadowClient,
} from "@/lib/merchantConversationDualWrite.server";
import { saveMerchantSnapshotHistory } from "@/lib/merchantSnapshotHistoryStore";

const MERCHANT_SUPPORT_READ_STATE_HISTORY_SLUG = "__merchant_support_read_state_history__";
const MERCHANT_SUPPORT_READ_STATE_HISTORY_BACKUP_SLUG = "__merchant_support_read_state_history_backup__";
const MERCHANT_SUPPORT_READ_STATE_HISTORY_SITE_ID = "merchant-support-read-state";

type StoreErrorLike = { message?: string } | null;

type MerchantSupportReadStateQueryBuilder = PromiseLike<{ data?: unknown; error: StoreErrorLike }> & {
  select: (columns: string) => MerchantSupportReadStateQueryBuilder;
  update: (payload: Record<string, unknown>) => MerchantSupportReadStateQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: StoreErrorLike }>;
  is: (column: string, value: unknown) => MerchantSupportReadStateQueryBuilder;
  eq: (column: string, value: unknown) => MerchantSupportReadStateQueryBuilder;
  limit: (value: number) => MerchantSupportReadStateQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: StoreErrorLike }>;
};

export type MerchantSupportReadStateStoreClient =
  MerchantConversationShadowClient & {
  from: (table: string) => MerchantSupportReadStateQueryBuilder;
};

const MERCHANT_SUPPORT_READ_STATE_CACHE_TTL_MS = 2_000;
let merchantSupportReadStateCache:
  | {
      expiresAt: number;
      value: MerchantSupportReadStatePayload;
    }
  | null = null;
let merchantSupportReadStateWriteQueue: Promise<void> = Promise.resolve();

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "unknown_error";
  const message = (input as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "unknown_error";
}

function throwMerchantSupportReadStateReadError(input: unknown): never {
  throw new Error(`merchant_support_read_state_read_failed:${toErrorMessage(input)}`);
}

function isMissingSlugColumn(message: string) {
  return (
    /column\s+pages\.slug\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]slug['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingMerchantIdColumn(message: string) {
  return (
    /column\s+pages\.merchant_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]merchant_id['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

function isMissingUpdatedAtColumn(message: string) {
  return (
    /column\s+pages\.updated_at\s+does\s+not\s+exist/i.test(message) ||
    /could not find the ['"]updated_at['"] column of ['"]pages['"] in the schema cache/i.test(message)
  );
}

export async function loadStoredMerchantSupportReadState(
  supabase: MerchantSupportReadStateStoreClient,
  options?: { bypassCache?: boolean },
): Promise<MerchantSupportReadStatePayload> {
  if (!options?.bypassCache && merchantSupportReadStateCache && merchantSupportReadStateCache.expiresAt > Date.now()) {
    return merchantSupportReadStateCache.value;
  }

  const initialQuery = await supabase
    .from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", MERCHANT_SUPPORT_READ_STATE_SLUG)
    .limit(1)
    .maybeSingle();

  let data = initialQuery.data as { blocks?: unknown } | null;
  let error = initialQuery.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const bySlug = await supabase
        .from("pages")
        .select("blocks")
        .eq("slug", MERCHANT_SUPPORT_READ_STATE_SLUG)
        .limit(1)
        .maybeSingle();
      data = bySlug.data as { blocks?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return { accounts: [] };
    } else {
      throwMerchantSupportReadStateReadError(error);
    }
  }

  if (error) {
    if (isMissingSlugColumn(toErrorMessage(error))) return { accounts: [] };
    throwMerchantSupportReadStateReadError(error);
  }
  const payload = readMerchantSupportReadStateFromBlocks(data?.blocks);
  merchantSupportReadStateCache = {
    expiresAt: Date.now() + MERCHANT_SUPPORT_READ_STATE_CACHE_TTL_MS,
    value: payload,
  };
  return payload;
}

async function saveMerchantSupportReadStateUnlocked(
  supabase: MerchantSupportReadStateStoreClient,
  payload: MerchantSupportReadStatePayload,
): Promise<{ error: string | null; payload: MerchantSupportReadStatePayload | null }> {
  merchantSupportReadStateCache = null;
  const beforePayload = await loadStoredMerchantSupportReadState(supabase, { bypassCache: true });
  const normalizedPayload = mergeMerchantSupportReadStatePayloads(
    beforePayload,
    normalizeMerchantSupportReadStatePayload(payload),
  );
  const blocks = buildMerchantSupportReadStateBlocks(normalizedPayload);
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };
  const history = await saveMerchantSnapshotHistory(supabase, {
    siteId: MERCHANT_SUPPORT_READ_STATE_HISTORY_SITE_ID,
    slug: MERCHANT_SUPPORT_READ_STATE_HISTORY_SLUG,
    backupSlug: MERCHANT_SUPPORT_READ_STATE_HISTORY_BACKUP_SLUG,
    source: "merchant-support-read-state",
    before: beforePayload,
    after: normalizedPayload,
    at: basePayload.updated_at,
    maxEntries: 20,
    merchantId: null,
  });
  if (history.error) return { error: `merchant_support_read_state_history_save_failed:${history.error}`, payload: null };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", MERCHANT_SUPPORT_READ_STATE_SLUG)
      .limit(1)
      .maybeSingle();
    if (!scoped.error) {
      return {
        record: (scoped.data ?? null) as { id?: string | number | null } | null,
        supportsSlug: true,
        supportsMerchantId: true,
      };
    }

    const scopedMessage = toErrorMessage(scoped.error);
    if (isMissingMerchantIdColumn(scopedMessage)) {
      const bySlug = await supabase
        .from("pages")
        .select("id")
        .eq("slug", MERCHANT_SUPPORT_READ_STATE_SLUG)
        .limit(1)
        .maybeSingle();
      if (!bySlug.error) {
        return {
          record: (bySlug.data ?? null) as { id?: string | number | null } | null,
          supportsSlug: true,
          supportsMerchantId: false,
        };
      }
      return { error: toErrorMessage(bySlug.error) };
    }

    if (isMissingSlugColumn(scopedMessage)) {
      return { error: "pages_slug_column_missing" };
    }

    return { error: scopedMessage };
  };

  const existing = await queryExisting();
  if ("error" in existing && existing.error) {
    return { error: existing.error, payload: null };
  }

  const recordId = existing.record?.id;
  const payloadWithoutUpdatedAt = { blocks };
  const updatePayload = async (body: Record<string, unknown>) => {
    if (recordId !== undefined && recordId !== null) {
      const updated = await supabase.from("pages").update(body).eq("id", recordId);
      return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
    }

    if (existing.supportsSlug) {
      const inserted = await supabase.from("pages").insert({
        ...body,
        slug: MERCHANT_SUPPORT_READ_STATE_SLUG,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };
  const completeSuccessfulSave = async () => {
    merchantSupportReadStateCache = {
      expiresAt: Date.now() + MERCHANT_SUPPORT_READ_STATE_CACHE_TTL_MS,
      value: normalizedPayload,
    };
    await mirrorMerchantConversationReadState(supabase, {
      current: normalizedPayload,
      previous: beforePayload,
    });
    return { error: null, payload: normalizedPayload };
  };

  const first = await updatePayload(basePayload);
  if (!first.error) {
    return completeSuccessfulSave();
  }
  if (!isMissingUpdatedAtColumn(first.error)) return { error: first.error, payload: null };
  const fallback = await updatePayload(payloadWithoutUpdatedAt);
  if (!fallback.error) {
    return completeSuccessfulSave();
  }
  return {
    error: fallback.error,
    payload: null,
  };
}

export function saveMerchantSupportReadState(
  supabase: MerchantSupportReadStateStoreClient,
  payload: MerchantSupportReadStatePayload,
): Promise<{ error: string | null; payload: MerchantSupportReadStatePayload | null }> {
  const operation = merchantSupportReadStateWriteQueue
    .catch(() => undefined)
    .then(() => saveMerchantSupportReadStateUnlocked(supabase, payload));
  merchantSupportReadStateWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
