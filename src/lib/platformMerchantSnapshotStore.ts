import {
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  buildPlatformMerchantSnapshotBlocks,
  createPlatformMerchantSnapshotRevision,
  normalizePlatformMerchantSnapshotPayload,
  readPlatformMerchantSnapshotFromBlocks,
  type PlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";

type SnapshotErrorLike = { message?: string } | null;

type SnapshotQueryBuilder = PromiseLike<{ data?: unknown; error: SnapshotErrorLike }> & {
  select: (columns: string) => SnapshotQueryBuilder;
  update: (payload: Record<string, unknown>) => SnapshotQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: SnapshotErrorLike }>;
  is: (column: string, value: unknown) => SnapshotQueryBuilder;
  eq: (column: string, value: unknown) => SnapshotQueryBuilder;
  limit: (value: number) => SnapshotQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: SnapshotErrorLike }>;
};

export type PlatformMerchantSnapshotStoreClient = {
  from: (table: string) => SnapshotQueryBuilder;
};

export type PlatformMerchantSnapshotSaveResult = {
  error: string | null;
  code?: "conflict";
  payload?: PlatformMerchantSnapshotPayload;
};

const PLATFORM_MERCHANT_SNAPSHOT_CACHE_TTL_MS = 30_000;
let platformMerchantSnapshotCache:
  | {
      expiresAt: number;
      value: PlatformMerchantSnapshotPayload | null;
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

type SnapshotStoredRow = {
  id?: string | number | null;
  blocks?: unknown;
} | null;

async function querySnapshotRowBySlug(
  supabase: PlatformMerchantSnapshotStoreClient,
  slug: string,
  columns: string,
): Promise<{
  record: SnapshotStoredRow;
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
      record: (initialQuery.data ?? null) as SnapshotStoredRow,
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
        record: (bySlug.data ?? null) as SnapshotStoredRow,
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

async function loadStoredPlatformMerchantSnapshotBySlug(
  supabase: PlatformMerchantSnapshotStoreClient,
  slug: string,
): Promise<PlatformMerchantSnapshotPayload | null> {
  const row = await querySnapshotRowBySlug(supabase, slug, "blocks");
  if (row.error) return null;
  const payload = readPlatformMerchantSnapshotFromBlocks(row.record?.blocks);
  return payload && payload.snapshot.length > 0 ? payload : null;
}

export async function loadStoredPlatformMerchantSnapshot(
  supabase: PlatformMerchantSnapshotStoreClient,
): Promise<PlatformMerchantSnapshotPayload | null> {
  if (platformMerchantSnapshotCache && platformMerchantSnapshotCache.expiresAt > Date.now()) {
    return platformMerchantSnapshotCache.value;
  }

  const primaryPayload = await loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_SLUG);
  const normalizedPayload =
    primaryPayload ??
    (await loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG));
  platformMerchantSnapshotCache = {
    expiresAt: Date.now() + PLATFORM_MERCHANT_SNAPSHOT_CACHE_TTL_MS,
    value: normalizedPayload,
  };
  return normalizedPayload;
}

export async function savePlatformMerchantSnapshot(
  supabase: PlatformMerchantSnapshotStoreClient,
  payload: PlatformMerchantSnapshotPayload,
  options: {
    expectedRevision?: string | null;
  } = {},
): Promise<PlatformMerchantSnapshotSaveResult> {
  const primaryPayload = await loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_SLUG);
  const backupPayload = primaryPayload
    ? null
    : await loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG);
  const existingPayload = primaryPayload ?? backupPayload;
  const expectedRevision = String(options.expectedRevision ?? "").trim();
  const currentRevision = String(existingPayload?.revision ?? "").trim();
  if (options.expectedRevision !== undefined && expectedRevision !== currentRevision) {
    return {
      error: "platform_merchant_snapshot_conflict",
      code: "conflict",
      payload: existingPayload ?? undefined,
    };
  }

  const payloadToPersist = normalizePlatformMerchantSnapshotPayload({
    ...payload,
    revision: createPlatformMerchantSnapshotRevision(),
  });
  const blocks = buildPlatformMerchantSnapshotBlocks(payloadToPersist);
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };

  const payloadWithoutUpdatedAt = { blocks };
  const persistBySlug = async (slug: string) => {
    const existing = await querySnapshotRowBySlug(supabase, slug, "id");
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
    if (!first.error) return { error: null };
    if (!isMissingUpdatedAtColumn(first.error)) return first;
    return updatePayload(payloadWithoutUpdatedAt);
  };

  const primarySave = await persistBySlug(PLATFORM_MERCHANT_SNAPSHOT_SLUG);
  if (primarySave.error) {
    return { error: primarySave.error };
  }

  const backupSave = await persistBySlug(PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG);
  if (backupSave.error && typeof console !== "undefined") {
    console.error("[platform-merchant-snapshot] backup save failed", backupSave.error);
  }

  platformMerchantSnapshotCache = {
    expiresAt: Date.now() + PLATFORM_MERCHANT_SNAPSHOT_CACHE_TTL_MS,
    value: payloadToPersist,
  };
  return {
    error: null,
    payload: payloadToPersist,
  };
}
