import {
  derivePlatformMerchantConfigArchiveEntries,
  mergePlatformMerchantConfigArchivePayloads,
} from "@/lib/platformMerchantConfigArchive";
import {
  loadStoredPlatformMerchantConfigArchive,
  savePlatformMerchantConfigArchive,
  type PlatformMerchantConfigArchiveStoreClient,
} from "@/lib/platformMerchantConfigArchiveStore";
import {
  PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG,
  PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  buildPlatformMerchantSnapshotBlocks,
  createPlatformMerchantSnapshotRevision,
  mergePlatformMerchantConfigHistoryBySiteId,
  normalizePlatformMerchantSnapshotPayload,
  readPlatformMerchantSnapshotFromBlocks,
  type PlatformMerchantSnapshotPayload,
} from "@/lib/platformMerchantSnapshot";
import { mergePublishedMerchantSnapshots } from "@/lib/platformPublished";

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

export type PlatformMerchantSnapshotLoadOptions = {
  bypassCache?: boolean;
};

const PLATFORM_MERCHANT_SNAPSHOT_CACHE_TTL_MS = 30_000;
const PLATFORM_MERCHANT_SNAPSHOT_AUXILIARY_SAVE_TIMEOUT_MS = 3_500;
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

async function waitForAuxiliarySnapshotSaves(tasks: Promise<void>[]) {
  if (tasks.length === 0) return;
  const result = await Promise.race([
    Promise.all(tasks).then(() => "done" as const),
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), PLATFORM_MERCHANT_SNAPSHOT_AUXILIARY_SAVE_TIMEOUT_MS);
    }),
  ]);
  if (result === "timeout" && typeof console !== "undefined") {
    console.warn("[platform-merchant-snapshot] auxiliary saves still running after timeout");
  }
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
    const record = (initialQuery.data ?? null) as SnapshotStoredRow;
    if (!record && slug.startsWith("__")) {
      const bySlug = await supabase.from("pages").select(columns).eq("slug", slug).limit(1).maybeSingle();
      if (!bySlug.error) {
        return {
          record: (bySlug.data ?? null) as SnapshotStoredRow,
          error: null,
          supportsSlug: true,
          supportsMerchantId: true,
        };
      }
      const bySlugMessage = toErrorMessage(bySlug.error);
      if (!isMissingSlugColumn(bySlugMessage)) {
        return {
          record: null,
          error: bySlugMessage,
          supportsSlug: true,
          supportsMerchantId: true,
        };
      }
    }
    return {
      record,
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

type SnapshotStoredPayloadEntry = {
  record: SnapshotStoredRow;
  payload: PlatformMerchantSnapshotPayload | null;
  error: string | null;
  supportsSlug: boolean;
  supportsMerchantId: boolean;
};

async function loadStoredPlatformMerchantSnapshotEntryBySlug(
  supabase: PlatformMerchantSnapshotStoreClient,
  slug: string,
): Promise<SnapshotStoredPayloadEntry> {
  const row = await querySnapshotRowBySlug(supabase, slug, "id,blocks");
  if (row.error) {
    return {
      record: row.record,
      payload: null,
      error: row.error,
      supportsSlug: row.supportsSlug,
      supportsMerchantId: row.supportsMerchantId,
    };
  }
  const payload = readPlatformMerchantSnapshotFromBlocks(row.record?.blocks);
  return {
    record: row.record,
    payload: payload && payload.snapshot.length > 0 ? payload : null,
    error: null,
    supportsSlug: row.supportsSlug,
    supportsMerchantId: row.supportsMerchantId,
  };
}

function mergeSnapshotPayloadHistory(
  primary: PlatformMerchantSnapshotPayload | null,
  ...fallbacks: Array<PlatformMerchantSnapshotPayload | null>
): PlatformMerchantSnapshotPayload | null {
  const base = primary ?? fallbacks.find((item) => !!item) ?? null;
  if (!base) return null;
  let mergedHistoryBySiteId = base.merchantConfigHistoryBySiteId ?? {};
  fallbacks.forEach((payload) => {
    if (!payload) return;
    mergedHistoryBySiteId = mergePlatformMerchantConfigHistoryBySiteId(
      mergedHistoryBySiteId,
      payload.merchantConfigHistoryBySiteId,
    );
  });
  return normalizePlatformMerchantSnapshotPayload({
    ...base,
    merchantConfigHistoryBySiteId: mergedHistoryBySiteId,
  });
}

function mergePlatformMerchantSnapshotPayloads(
  incoming: PlatformMerchantSnapshotPayload,
  existing: PlatformMerchantSnapshotPayload,
): PlatformMerchantSnapshotPayload {
  const mergedCurrent = mergePublishedMerchantSnapshots(incoming.snapshot, existing.snapshot);
  const mergedIds = new Set(mergedCurrent.map((site) => site.id));
  const appendedExisting = existing.snapshot.filter((site) => !mergedIds.has(site.id));
  return normalizePlatformMerchantSnapshotPayload({
    revision: incoming.revision || existing.revision,
    snapshot: [...mergedCurrent, ...appendedExisting],
    defaultSortRule: incoming.defaultSortRule || existing.defaultSortRule,
    merchantConfigHistoryBySiteId: mergePlatformMerchantConfigHistoryBySiteId(
      incoming.merchantConfigHistoryBySiteId,
      existing.merchantConfigHistoryBySiteId,
    ),
  });
}

export async function loadStoredPlatformMerchantSnapshot(
  supabase: PlatformMerchantSnapshotStoreClient,
  options: PlatformMerchantSnapshotLoadOptions = {},
): Promise<PlatformMerchantSnapshotPayload | null> {
  if (!options.bypassCache && platformMerchantSnapshotCache && platformMerchantSnapshotCache.expiresAt > Date.now()) {
    return platformMerchantSnapshotCache.value;
  }

  const [primaryPayload, backupPayload, historyPayload, historyBackupPayload] = await Promise.all([
    loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_SLUG),
    loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG),
    loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG),
    loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG),
  ]);
  const normalizedPayload = mergeSnapshotPayloadHistory(
    primaryPayload,
    backupPayload,
    historyPayload,
    historyBackupPayload,
  );
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
  const [primaryEntry, backupEntry, historyEntry, historyBackupEntry] = await Promise.all([
    loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_SLUG),
    loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG),
    loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG),
    loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG),
  ]);
  const existingPayload = mergeSnapshotPayloadHistory(
    primaryEntry.payload,
    backupEntry.payload,
    historyEntry.payload,
    historyBackupEntry.payload,
  );
  const expectedRevision = String(options.expectedRevision ?? "").trim();
  const currentRevision = String(existingPayload?.revision ?? "").trim();
  if (options.expectedRevision !== undefined && expectedRevision !== currentRevision) {
    return {
      error: "platform_merchant_snapshot_conflict",
      code: "conflict",
      payload: existingPayload ?? undefined,
    };
  }

  const payloadWithExisting = existingPayload
    ? mergePlatformMerchantSnapshotPayloads(payload, existingPayload)
    : payload;
  const payloadToPersist = normalizePlatformMerchantSnapshotPayload({
    ...payloadWithExisting,
    revision: createPlatformMerchantSnapshotRevision(),
    merchantConfigHistoryBySiteId: mergePlatformMerchantConfigHistoryBySiteId(
      payloadWithExisting.merchantConfigHistoryBySiteId,
      existingPayload?.merchantConfigHistoryBySiteId,
    ),
  });
  const blocks = buildPlatformMerchantSnapshotBlocks(payloadToPersist);
  const basePayload = {
    blocks,
    updated_at: new Date().toISOString(),
  };

  const payloadWithoutUpdatedAt = { blocks };
  const persistBySlug = async (slug: string, existing: SnapshotStoredPayloadEntry) => {
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

  const primarySave = await persistBySlug(PLATFORM_MERCHANT_SNAPSHOT_SLUG, primaryEntry);
  if (primarySave.error) {
    return { error: primarySave.error };
  }

  const auxiliarySaves = [
    persistBySlug(PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, backupEntry).then((backupSave) => {
      if (backupSave.error && typeof console !== "undefined") {
        console.error("[platform-merchant-snapshot] backup save failed", backupSave.error);
      }
    }),
    persistBySlug(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, historyEntry).then((historySave) => {
      if (historySave.error && typeof console !== "undefined") {
        console.error("[platform-merchant-snapshot] history save failed", historySave.error);
      }
    }),
    persistBySlug(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG, historyBackupEntry).then((historyBackupSave) => {
      if (historyBackupSave.error && typeof console !== "undefined") {
        console.error("[platform-merchant-snapshot] history backup save failed", historyBackupSave.error);
      }
    }),
  ];

  const archiveDelta = derivePlatformMerchantConfigArchiveEntries({
    previousHistoryBySiteId: existingPayload?.merchantConfigHistoryBySiteId,
    nextHistoryBySiteId: payloadToPersist.merchantConfigHistoryBySiteId,
    nextSnapshot: payloadToPersist.snapshot,
  });
  if (archiveDelta.audits.length > 0 || archiveDelta.backups.length > 0) {
    auxiliarySaves.push(
      (async () => {
        const existingArchive = await loadStoredPlatformMerchantConfigArchive(
          supabase as unknown as PlatformMerchantConfigArchiveStoreClient,
        );
        const archiveSave = await savePlatformMerchantConfigArchive(
          supabase as unknown as PlatformMerchantConfigArchiveStoreClient,
          mergePlatformMerchantConfigArchivePayloads(existingArchive, archiveDelta),
        );
        if (archiveSave.error && typeof console !== "undefined") {
          console.error("[platform-merchant-snapshot] config archive save failed", archiveSave.error);
        }
      })(),
    );
  }
  await waitForAuxiliarySnapshotSaves(auxiliarySaves);

  platformMerchantSnapshotCache = {
    expiresAt: Date.now() + PLATFORM_MERCHANT_SNAPSHOT_CACHE_TTL_MS,
    value: payloadToPersist,
  };
  return {
    error: null,
    payload: payloadToPersist,
  };
}
