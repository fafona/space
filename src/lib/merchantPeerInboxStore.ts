import {
  MERCHANT_PEER_INBOX_SLUG,
  buildMerchantPeerInboxBlocks,
  mergeMerchantPeerInboxPayloads,
  normalizeMerchantPeerInboxPayload,
  readMerchantPeerInboxFromBlocks,
  type MerchantPeerInboxPayload,
} from "@/lib/merchantPeerInbox";
import {
  mirrorMerchantPeerConversationSnapshot,
  type MerchantConversationShadowClient,
} from "@/lib/merchantConversationDualWrite.server";
import { saveMerchantSnapshotHistory } from "@/lib/merchantSnapshotHistoryStore";

const MERCHANT_PEER_INBOX_HISTORY_SLUG = "__merchant_peer_inbox_history__";
const MERCHANT_PEER_INBOX_HISTORY_BACKUP_SLUG = "__merchant_peer_inbox_history_backup__";
const MERCHANT_PEER_INBOX_HISTORY_SITE_ID = "merchant-peer-inbox";

type StoreErrorLike = { message?: string } | null;

type MerchantPeerQueryBuilder = PromiseLike<{ data?: unknown; error: StoreErrorLike }> & {
  select: (columns: string) => MerchantPeerQueryBuilder;
  update: (payload: Record<string, unknown>) => MerchantPeerQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: StoreErrorLike }>;
  is: (column: string, value: unknown) => MerchantPeerQueryBuilder;
  eq: (column: string, value: unknown) => MerchantPeerQueryBuilder;
  limit: (value: number) => MerchantPeerQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: StoreErrorLike }>;
};

export type MerchantPeerInboxStoreClient = MerchantConversationShadowClient & {
  from: (table: string) => MerchantPeerQueryBuilder;
};

const MERCHANT_PEER_INBOX_CACHE_TTL_MS = 15_000;
let merchantPeerInboxCache:
  | {
      expiresAt: number;
      value: MerchantPeerInboxPayload;
    }
  | null = null;
let merchantPeerInboxWriteQueue: Promise<void> = Promise.resolve();

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "unknown_error";
  const message = (input as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "unknown_error";
}

function throwMerchantPeerInboxReadError(input: unknown): never {
  throw new Error(`merchant_peer_inbox_read_failed:${toErrorMessage(input)}`);
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

export async function loadStoredMerchantPeerInbox(
  supabase: MerchantPeerInboxStoreClient,
  options?: { bypassCache?: boolean },
): Promise<MerchantPeerInboxPayload> {
  if (!options?.bypassCache && merchantPeerInboxCache && merchantPeerInboxCache.expiresAt > Date.now()) {
    return merchantPeerInboxCache.value;
  }

  const initialQuery = await supabase
    .from("pages")
    .select("blocks")
    .is("merchant_id", null)
    .eq("slug", MERCHANT_PEER_INBOX_SLUG)
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
        .eq("slug", MERCHANT_PEER_INBOX_SLUG)
        .limit(1)
        .maybeSingle();
      data = bySlug.data as { blocks?: unknown } | null;
      error = bySlug.error;
    } else if (isMissingSlugColumn(message)) {
      return { contacts: [], threads: [] };
    } else {
      throwMerchantPeerInboxReadError(error);
    }
  }

  if (error) {
    if (isMissingSlugColumn(toErrorMessage(error))) return { contacts: [], threads: [] };
    throwMerchantPeerInboxReadError(error);
  }
  const payload = readMerchantPeerInboxFromBlocks(data?.blocks);
  merchantPeerInboxCache = {
    expiresAt: Date.now() + MERCHANT_PEER_INBOX_CACHE_TTL_MS,
    value: payload,
  };
  return payload;
}

async function saveMerchantPeerInboxUnlocked(
  supabase: MerchantPeerInboxStoreClient,
  payload: MerchantPeerInboxPayload,
  options?: { beforeMutation?: () => Promise<void> },
): Promise<{ error: string | null; payload: MerchantPeerInboxPayload | null }> {
  await options?.beforeMutation?.();
  merchantPeerInboxCache = null;
  const beforePayload = await loadStoredMerchantPeerInbox(supabase, { bypassCache: true });
  const normalizedPayload = mergeMerchantPeerInboxPayloads(
    beforePayload,
    normalizeMerchantPeerInboxPayload(payload),
  );
  const blocks = buildMerchantPeerInboxBlocks(normalizedPayload);
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };
  const history = await saveMerchantSnapshotHistory(supabase, {
    siteId: MERCHANT_PEER_INBOX_HISTORY_SITE_ID,
    slug: MERCHANT_PEER_INBOX_HISTORY_SLUG,
    backupSlug: MERCHANT_PEER_INBOX_HISTORY_BACKUP_SLUG,
    source: "merchant-peer-inbox",
    before: beforePayload,
    after: normalizedPayload,
    at: basePayload.updated_at,
    maxEntries: 20,
    merchantId: null,
  });
  if (history.error) return { error: `merchant_peer_inbox_history_save_failed:${history.error}`, payload: null };

  const queryExisting = async () => {
    const scoped = await supabase
      .from("pages")
      .select("id")
      .is("merchant_id", null)
      .eq("slug", MERCHANT_PEER_INBOX_SLUG)
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
        .eq("slug", MERCHANT_PEER_INBOX_SLUG)
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
        slug: MERCHANT_PEER_INBOX_SLUG,
        ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
      });
      return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
    }

    return { error: "pages_slug_column_missing" };
  };
  const completeSuccessfulSave = async () => {
    merchantPeerInboxCache = {
      expiresAt: Date.now() + MERCHANT_PEER_INBOX_CACHE_TTL_MS,
      value: normalizedPayload,
    };
    await mirrorMerchantPeerConversationSnapshot(supabase, {
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

export function saveMerchantPeerInbox(
  supabase: MerchantPeerInboxStoreClient,
  payload: MerchantPeerInboxPayload,
  options?: { beforeMutation?: () => Promise<void> },
): Promise<{ error: string | null; payload: MerchantPeerInboxPayload | null }> {
  const operation = merchantPeerInboxWriteQueue
    .catch(() => undefined)
    .then(() => saveMerchantPeerInboxUnlocked(supabase, payload, options));
  merchantPeerInboxWriteQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
