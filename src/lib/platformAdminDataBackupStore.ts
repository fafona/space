import {
  PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG,
  PLATFORM_ADMIN_DATA_BACKUP_SLUG,
  buildPlatformAdminDataBackupBlocks,
  mergePlatformAdminDataBackupPayloads,
  normalizePlatformAdminDataBackupPayload,
  readPlatformAdminDataBackupFromBlocks,
  type PlatformAdminDataBackupPayload,
} from "@/lib/platformAdminDataBackup";

type BackupErrorLike = { message?: string } | null;

type BackupQueryBuilder = PromiseLike<{ data?: unknown; error: BackupErrorLike }> & {
  select: (columns: string) => BackupQueryBuilder;
  update: (payload: Record<string, unknown>) => BackupQueryBuilder;
  insert: (payload: Record<string, unknown>) => Promise<{ data?: unknown; error: BackupErrorLike }>;
  is: (column: string, value: unknown) => BackupQueryBuilder;
  eq: (column: string, value: unknown) => BackupQueryBuilder;
  limit: (value: number) => BackupQueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error: BackupErrorLike }>;
};

export type PlatformAdminDataBackupStoreClient = {
  from: (table: string) => BackupQueryBuilder;
};

const PLATFORM_ADMIN_DATA_BACKUP_CACHE_TTL_MS = 15_000;
let platformAdminDataBackupCache:
  | {
      expiresAt: number;
      value: PlatformAdminDataBackupPayload;
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

type BackupStoredRow = {
  id?: string | number | null;
  blocks?: unknown;
} | null;

async function queryBackupRowBySlug(
  supabase: PlatformAdminDataBackupStoreClient,
  slug: string,
  columns: string,
): Promise<{
  record: BackupStoredRow;
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
      record: (initialQuery.data ?? null) as BackupStoredRow,
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
        record: (bySlug.data ?? null) as BackupStoredRow,
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

async function loadStoredPlatformAdminDataBackupBySlug(
  supabase: PlatformAdminDataBackupStoreClient,
  slug: string,
) {
  const row = await queryBackupRowBySlug(supabase, slug, "blocks");
  if (row.error) return { backups: [] };
  return readPlatformAdminDataBackupFromBlocks(row.record?.blocks);
}

export async function loadStoredPlatformAdminDataBackups(
  supabase: PlatformAdminDataBackupStoreClient,
): Promise<PlatformAdminDataBackupPayload> {
  if (platformAdminDataBackupCache && platformAdminDataBackupCache.expiresAt > Date.now()) {
    return platformAdminDataBackupCache.value;
  }

  const primaryPayload = await loadStoredPlatformAdminDataBackupBySlug(supabase, PLATFORM_ADMIN_DATA_BACKUP_SLUG);
  const backupPayload = await loadStoredPlatformAdminDataBackupBySlug(supabase, PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG);
  const merged = mergePlatformAdminDataBackupPayloads(primaryPayload, backupPayload);
  platformAdminDataBackupCache = {
    expiresAt: Date.now() + PLATFORM_ADMIN_DATA_BACKUP_CACHE_TTL_MS,
    value: merged,
  };
  return merged;
}

export async function savePlatformAdminDataBackups(
  supabase: PlatformAdminDataBackupStoreClient,
  payload: PlatformAdminDataBackupPayload,
): Promise<{ error: string | null; payload?: PlatformAdminDataBackupPayload }> {
  const normalizedPayload = normalizePlatformAdminDataBackupPayload(payload);
  const blocks = buildPlatformAdminDataBackupBlocks(normalizedPayload);
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };
  const payloadWithoutUpdatedAt = { blocks };

  const persistBySlug = async (slug: string) => {
    const existing = await queryBackupRowBySlug(supabase, slug, "id");
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

  const primarySave = await persistBySlug(PLATFORM_ADMIN_DATA_BACKUP_SLUG);
  if (primarySave.error) return { error: primarySave.error };

  const backupSave = await persistBySlug(PLATFORM_ADMIN_DATA_BACKUP_BACKUP_SLUG);
  if (backupSave.error && typeof console !== "undefined") {
    console.error("[platform-admin-data-backup] backup save failed", backupSave.error);
  }

  platformAdminDataBackupCache = {
    expiresAt: Date.now() + PLATFORM_ADMIN_DATA_BACKUP_CACHE_TTL_MS,
    value: normalizedPayload,
  };
  return { error: null, payload: normalizedPayload };
}
