import {
  PLATFORM_SUPPORT_INBOX_SLUG,
  buildPlatformSupportInboxBlocks,
  mergePlatformSupportInboxPayloads,
  normalizePlatformSupportInboxPayload,
  readPlatformSupportInboxFromBlocks,
  type PlatformSupportInboxPayload,
} from "@/lib/platformSupportInbox";
import {
  mirrorPlatformSupportConversationSnapshot,
  type MerchantConversationShadowClient,
} from "@/lib/merchantConversationDualWrite.server";
import { saveMerchantSnapshotHistory } from "@/lib/merchantSnapshotHistoryStore";

const PLATFORM_SUPPORT_INBOX_HISTORY_SLUG = "__platform_support_inbox_history__";
const PLATFORM_SUPPORT_INBOX_HISTORY_BACKUP_SLUG = "__platform_support_inbox_history_backup__";
const PLATFORM_SUPPORT_INBOX_HISTORY_SITE_ID = "platform-support-inbox";

type StoreErrorLike = { message?: string } | null;

type SupportQueryBuilder = PromiseLike<{ data?: unknown; error: StoreErrorLike }> & {
  select: (columns: string) => SupportQueryBuilder;
  update: (payload: Record<string, unknown>) => SupportQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: StoreErrorLike }>;
  is: (column: string, value: unknown) => SupportQueryBuilder;
  eq: (column: string, value: unknown) => SupportQueryBuilder;
  limit: (value: number) => SupportQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: StoreErrorLike }>;
};

export type PlatformSupportInboxStoreClient = MerchantConversationShadowClient & {
  from: (table: string) => SupportQueryBuilder;
};

const PLATFORM_SUPPORT_INBOX_CACHE_TTL_MS = 15_000;
let platformSupportInboxCache:
  | {
      expiresAt: number;
      value: PlatformSupportInboxPayload;
    }
  | null = null;
let platformSupportInboxWriteQueue: Promise<void> = Promise.resolve();

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "unknown_error";
  const message = (input as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "unknown_error";
}

function throwPlatformSupportInboxReadError(input: unknown): never {
  throw new Error(`platform_support_inbox_read_failed:${toErrorMessage(input)}`);
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

export async function loadStoredPlatformSupportInbox(
  supabase: PlatformSupportInboxStoreClient,
  options?: { bypassCache?: boolean },
): Promise<PlatformSupportInboxPayload> {
  if (!options?.bypassCache && platformSupportInboxCache && platformSupportInboxCache.expiresAt > Date.now()) {
    return platformSupportInboxCache.value;
  }

  const initialQuery = await supabase
    .from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", PLATFORM_SUPPORT_INBOX_SLUG)
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
        .eq("slug", PLATFORM_SUPPORT_INBOX_SLUG)
        .limit(1)
        .maybeSingle();
      data = bySlug.data as { blocks?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return { threads: [] };
    } else {
      throwPlatformSupportInboxReadError(error);
    }
  }

  if (error) {
    if (isMissingSlugColumn(toErrorMessage(error))) return { threads: [] };
    throwPlatformSupportInboxReadError(error);
  }
  const payload = readPlatformSupportInboxFromBlocks(data?.blocks);
  platformSupportInboxCache = {
    expiresAt: Date.now() + PLATFORM_SUPPORT_INBOX_CACHE_TTL_MS,
    value: payload,
  };
  return payload;
}

async function savePlatformSupportInboxUnlocked(
  supabase: PlatformSupportInboxStoreClient,
  payload: PlatformSupportInboxPayload,
  options?: { replace?: boolean },
): Promise<{ error: string | null; payload: PlatformSupportInboxPayload | null }> {
  platformSupportInboxCache = null;
  const beforePayload = await loadStoredPlatformSupportInbox(supabase, { bypassCache: true });
  const incomingPayload = normalizePlatformSupportInboxPayload(payload);
  const normalizedPayload = options?.replace
    ? incomingPayload
    : mergePlatformSupportInboxPayloads(beforePayload, incomingPayload);
  const blocks = buildPlatformSupportInboxBlocks(normalizedPayload);
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };
  const history = await saveMerchantSnapshotHistory(supabase, {
    siteId: PLATFORM_SUPPORT_INBOX_HISTORY_SITE_ID,
    slug: PLATFORM_SUPPORT_INBOX_HISTORY_SLUG,
    backupSlug: PLATFORM_SUPPORT_INBOX_HISTORY_BACKUP_SLUG,
    source: "platform-support-inbox",
    before: beforePayload,
    after: normalizedPayload,
    at: basePayload.updated_at,
    maxEntries: 20,
    merchantId: null,
  });
  if (history.error) return { error: `platform_support_inbox_history_save_failed:${history.error}`, payload: null };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", PLATFORM_SUPPORT_INBOX_SLUG)
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
        .eq("slug", PLATFORM_SUPPORT_INBOX_SLUG)
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
        slug: PLATFORM_SUPPORT_INBOX_SLUG,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };
  const completeSuccessfulSave = async () => {
    platformSupportInboxCache = {
      expiresAt: Date.now() + PLATFORM_SUPPORT_INBOX_CACHE_TTL_MS,
      value: normalizedPayload,
    };
    await mirrorPlatformSupportConversationSnapshot(supabase, {
      current: normalizedPayload,
      previous: beforePayload,
      replace: options?.replace,
      operationAt: basePayload.updated_at,
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

export function savePlatformSupportInbox(
  supabase: PlatformSupportInboxStoreClient,
  payload: PlatformSupportInboxPayload,
  options?: { replace?: boolean },
): Promise<{ error: string | null; payload: PlatformSupportInboxPayload | null }> {
  const operation = platformSupportInboxWriteQueue
    .catch(() => undefined)
    .then(() => savePlatformSupportInboxUnlocked(supabase, payload, options));
  platformSupportInboxWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
