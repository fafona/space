import {
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG,
  PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  buildPlatformMerchantConfigArchiveBlocks,
  mergePlatformMerchantConfigArchivePayloads,
  normalizePlatformMerchantConfigArchivePayload,
  readPlatformMerchantConfigArchiveFromBlocks,
  type PlatformMerchantConfigArchivePayload,
} from "@/lib/platformMerchantConfigArchive";

type ArchiveErrorLike = { message?: string } | null;

type ArchiveQueryBuilder = PromiseLike<{ data?: unknown; error: ArchiveErrorLike }> & {
  select: (columns: string) => ArchiveQueryBuilder;
  update: (payload: Record<string, unknown>) => ArchiveQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: ArchiveErrorLike }>;
  is: (column: string, value: unknown) => ArchiveQueryBuilder;
  eq: (column: string, value: unknown) => ArchiveQueryBuilder;
  limit: (value: number) => ArchiveQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: ArchiveErrorLike }>;
};

export type PlatformMerchantConfigArchiveStoreClient = {
  from: (table: string) => ArchiveQueryBuilder;
};

const PLATFORM_MERCHANT_CONFIG_ARCHIVE_CACHE_TTL_MS = 15_000;
let platformMerchantConfigArchiveCache:
  | {
      expiresAt: number;
      value: PlatformMerchantConfigArchivePayload;
    }
  | null = null;

function toErrorMessage(input: unknown) {
  if (!input || typeof input !== "object") return "unknown_error";
  const message = (input as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "unknown_error";
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

type ArchiveStoredRow = {
  id?: string | number | null;
  blocks?: unknown;
} | null;

async function queryArchiveRowBySlug(
  supabase: PlatformMerchantConfigArchiveStoreClient,
  slug: string,
  columns: string,
): Promise<{
  record: ArchiveStoredRow;
  error: string | null;
  supportsSlug: boolean;
  supportsMerchantId: boolean;
}> {
  const initialQuery = await supabase
    .from("pages")
    .select(columns)
    .is("merchant_id", null)
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();

  if (!initialQuery.error) {
    return {
      record: (initialQuery.data ?? null) as ArchiveStoredRow,
      error: null,
      supportsSlug: true,
      supportsMerchantId: true,
    };
  }

  const initialMessage = toErrorMessage(initialQuery.error);
  if (isMissingMerchantIdColumn(initialMessage)) {
    const bySlug = await supabase.from("pages").select(columns).eq("slug", slug).limit(1).maybeSingle();
    if (!bySlug.error) {
      return {
        record: (bySlug.data ?? null) as ArchiveStoredRow,
        error: null,
        supportsSlug: true,
        supportsMerchantId: false,
      };
    }
    const bySlugMessage = toErrorMessage(bySlug.error);
    return {
      record: null,
      error: isMissingSlugColumn(bySlugMessage) ? "pages_slug_column_missing" : bySlugMessage,
      supportsSlug: !isMissingSlugColumn(bySlugMessage),
      supportsMerchantId: false,
    };
  }

  if (isMissingSlugColumn(initialMessage)) {
    return {
      record: null,
      error: "pages_slug_column_missing",
      supportsSlug: false,
      supportsMerchantId: false,
    };
  }

  return {
    record: null,
    error: initialMessage,
    supportsSlug: true,
    supportsMerchantId: true,
  };
}

async function loadStoredPlatformMerchantConfigArchiveBySlug(
  supabase: PlatformMerchantConfigArchiveStoreClient,
  slug: string,
): Promise<PlatformMerchantConfigArchivePayload> {
  const row = await queryArchiveRowBySlug(supabase, slug, "blocks");
  if (row.error) return { audits: [], backups: [] };
  return readPlatformMerchantConfigArchiveFromBlocks(row.record?.blocks);
}

export async function loadStoredPlatformMerchantConfigArchive(
  supabase: PlatformMerchantConfigArchiveStoreClient,
): Promise<PlatformMerchantConfigArchivePayload> {
  if (platformMerchantConfigArchiveCache && platformMerchantConfigArchiveCache.expiresAt > Date.now()) {
    return platformMerchantConfigArchiveCache.value;
  }

  const primaryPayload = await loadStoredPlatformMerchantConfigArchiveBySlug(
    supabase,
    PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG,
  );
  const backupPayload = await loadStoredPlatformMerchantConfigArchiveBySlug(
    supabase,
    PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG,
  );
  const merged = mergePlatformMerchantConfigArchivePayloads(primaryPayload, backupPayload);
  platformMerchantConfigArchiveCache = {
    expiresAt: Date.now() + PLATFORM_MERCHANT_CONFIG_ARCHIVE_CACHE_TTL_MS,
    value: merged,
  };
  return merged;
}

export async function savePlatformMerchantConfigArchive(
  supabase: PlatformMerchantConfigArchiveStoreClient,
  payload: PlatformMerchantConfigArchivePayload,
): Promise<{ error: string | null; payload?: PlatformMerchantConfigArchivePayload }> {
  const normalizedPayload = normalizePlatformMerchantConfigArchivePayload(payload);
  const blocks = buildPlatformMerchantConfigArchiveBlocks(normalizedPayload);
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };
  const payloadWithoutUpdatedAt = { blocks };

  const persistBySlug = async (slug: string) => {
    const existing = await queryArchiveRowBySlug(supabase, slug, "id");
    if (existing.error) {
      return { error: existing.error };
    }
    const recordId = existing.record?.id;
    const updatePayload = async (body: Record<string, unknown>) => {
      if (recordId !== undefined && recordId !== null) {
        const updated = await supabase.from("pages").update(body).eq("id", recordId);
        return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
      }

      if (existing.supportsSlug) {
        const inserted = await supabase.from("pages").insert({
          ...body,
          slug,
          ...(existing.supportsMerchantId ? { merchant_id: null } : {}),
        });
        return inserted.error ? { error: toErrorMessage(inserted.error) } : { error: null };
      }

      return { error: "pages_slug_column_missing" };
    };

    const first = await updatePayload(basePayload);
    if (!first.error) return first;
    if (!isMissingUpdatedAtColumn(first.error)) return first;
    return updatePayload(payloadWithoutUpdatedAt);
  };

  const primarySave = await persistBySlug(PLATFORM_MERCHANT_CONFIG_ARCHIVE_SLUG);
  if (primarySave.error) return { error: primarySave.error };

  const backupSave = await persistBySlug(PLATFORM_MERCHANT_CONFIG_ARCHIVE_BACKUP_SLUG);
  if (backupSave.error && typeof console !== "undefined") {
    console.error("[platform-merchant-config-archive] backup save failed", backupSave.error);
  }

  platformMerchantConfigArchiveCache = {
    expiresAt: Date.now() + PLATFORM_MERCHANT_CONFIG_ARCHIVE_CACHE_TTL_MS,
    value: normalizedPayload,
  };
  return { error: null, payload: normalizedPayload };
}
