import {
  derivePlatformMerchantConfigArchiveEntries,
  mergePlatformMerchantConfigArchivePayloads,
} from "@/lib/platformMerchantConfigArchive";
import {
  loadStoredPlatformMerchantConfigArchive,
  savePlatformMerchantConfigArchive,
  setPlatformMerchantConfigArchiveAtomicCache,
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
import { readPlatformAdminBackupBlocksStrict } from "@/lib/platformAdminBackupStrictRead";
import { assertPlatformAdminBackupMerchantSnapshot, readPlatformMerchantSnapshotBlocksValidated } from "@/lib/platformAdminBackupValidation";
import {
  persistPlatformAdminBackupRowStrict,
  readPlatformAdminBackupRowForWriteStrict,
  type StrictPlatformAdminBackupWriteClient,
} from "@/lib/platformAdminBackupStrictWrite";
import { getPlatformSnapshotWriteMode } from "@/lib/platformSnapshotAtomicMode.server";
import { readPlatformMerchantUserManageAtomic, savePlatformMerchantUserManageAtomic,
  platformMerchantUserManageAtomicError } from "@/lib/platformMerchantUserManageAtomic.server";
import type { PlatformSnapshotAtomicClient } from "@/lib/platformSnapshotAtomic.server";

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
  includeHistory?: boolean;
  strict?: boolean;
};

export type AuthoritativePlatformMerchantSnapshotLoadResult = {
  payload: PlatformMerchantSnapshotPayload | null;
  error: string | null;
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
  if (getPlatformSnapshotWriteMode() === "atomic") {
    const state = await readPlatformMerchantUserManageAtomic(supabase as unknown as PlatformSnapshotAtomicClient);
    return state.snapshot && options.includeHistory === false
      ? normalizePlatformMerchantSnapshotPayload({ ...state.snapshot, merchantConfigHistoryBySiteId: {} })
      : state.snapshot;
  }
  if (options.strict) {
    const blocks = await Promise.all([
      readPlatformAdminBackupBlocksStrict(supabase, PLATFORM_MERCHANT_SNAPSHOT_SLUG),
      readPlatformAdminBackupBlocksStrict(supabase, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG),
      readPlatformAdminBackupBlocksStrict(supabase, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG),
      readPlatformAdminBackupBlocksStrict(supabase, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG),
    ]);
    const [primary, ...fallbacks] = blocks.map(readPlatformMerchantSnapshotBlocksValidated);
    return mergeSnapshotPayloadHistory(primary, ...fallbacks);
  }
  const includeHistory = options.includeHistory !== false;
  if (includeHistory && !options.bypassCache && platformMerchantSnapshotCache && platformMerchantSnapshotCache.expiresAt > Date.now()) {
    return platformMerchantSnapshotCache.value;
  }

  if (!includeHistory) {
    const primaryPayload = await loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_SLUG);
    const fallbackPayload =
      primaryPayload ?? (await loadStoredPlatformMerchantSnapshotBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG));
    return fallbackPayload
      ? normalizePlatformMerchantSnapshotPayload({
          ...fallbackPayload,
          merchantConfigHistoryBySiteId: {},
        })
      : null;
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

export async function loadAuthoritativeStoredPlatformMerchantSnapshot(
  supabase: PlatformMerchantSnapshotStoreClient,
): Promise<AuthoritativePlatformMerchantSnapshotLoadResult> {
  if (getPlatformSnapshotWriteMode() === "atomic") {
    try {
      const { primarySnapshot } = await readPlatformMerchantUserManageAtomic(supabase as unknown as PlatformSnapshotAtomicClient);
      return primarySnapshot?.snapshot.length ? { payload: primarySnapshot, error: null }
        : { payload: null, error: "platform_merchant_snapshot_missing" };
    } catch (error) { return { payload: null, error: platformMerchantUserManageAtomicError(error) }; }
  }
  const primaryEntry = await loadStoredPlatformMerchantSnapshotEntryBySlug(
    supabase,
    PLATFORM_MERCHANT_SNAPSHOT_SLUG,
  );
  if (primaryEntry.error) {
    return {
      payload: null,
      error: primaryEntry.error,
    };
  }
  if (!primaryEntry.payload) {
    return {
      payload: null,
      error: "platform_merchant_snapshot_missing",
    };
  }
  return {
    payload: primaryEntry.payload,
    error: null,
  };
}

export async function savePlatformMerchantSnapshot(
  supabase: PlatformMerchantSnapshotStoreClient,
  payload: PlatformMerchantSnapshotPayload,
  options: {
    expectedRevision?: string | null;
    requireAllWrites?: boolean;
  } = {},
): Promise<PlatformMerchantSnapshotSaveResult> {
  // The mode gate takes precedence over strict/legacy paths; an atomic error must never scatter writes.
  if (getPlatformSnapshotWriteMode() === "atomic") {
    platformMerchantSnapshotCache = null;
    setPlatformMerchantConfigArchiveAtomicCache(null);
    try {
      const result = await savePlatformMerchantUserManageAtomic(
        supabase as unknown as PlatformSnapshotAtomicClient, payload, options.expectedRevision,
      );
      if (result.error) return result;
      platformMerchantSnapshotCache = { expiresAt: Date.now() + PLATFORM_MERCHANT_SNAPSHOT_CACHE_TTL_MS, value: result.payload };
      setPlatformMerchantConfigArchiveAtomicCache(result.archive);
      return { error: null, payload: result.payload };
    } catch (error) { return { error: platformMerchantUserManageAtomicError(error) }; }
  }
  if (options.requireAllWrites) return savePlatformMerchantSnapshotStrict(supabase, payload, options);
  const [primaryEntry, historyEntry] = await Promise.all([
    loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_SLUG),
    loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG),
  ]);
  const requiredLoadErrors = [
    primaryEntry.error
      ? `platform_merchant_snapshot_primary_load_failed:${primaryEntry.error}`
      : "",
    historyEntry.error
      ? `platform_merchant_snapshot_history_load_failed:${historyEntry.error}`
      : "",
  ].filter(Boolean);
  if (requiredLoadErrors.length > 0) {
    return {
      error: requiredLoadErrors.join(";"),
    };
  }
  const backupEntry =
    primaryEntry.payload || primaryEntry.error
      ? null
      : await loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG);
  const historyBackupEntry =
    historyEntry.payload || historyEntry.error
      ? null
      : await loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG);
  const existingPayload = mergeSnapshotPayloadHistory(
    primaryEntry.payload,
    historyEntry.payload,
    backupEntry?.payload ?? null,
    historyBackupEntry?.payload ?? null,
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
  const currentBlocks = buildPlatformMerchantSnapshotBlocks(payloadToPersist, { includeHistory: false });
  const historyBlocks = buildPlatformMerchantSnapshotBlocks(payloadToPersist);
  const updatedAt = new Date().toISOString();
  const buildPersistPayload = (slug: string, includeUpdatedAt: boolean) => ({
    blocks:
      slug === PLATFORM_MERCHANT_SNAPSHOT_SLUG || slug === PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG
        ? currentBlocks
        : historyBlocks,
    ...(includeUpdatedAt ? { updated_at: updatedAt } : {}),
  });
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

    const first = await updatePayload(buildPersistPayload(slug, true));
    if (!first.error) return { error: null };
    if (!isMissingUpdatedAtColumn(first.error)) return first;
    return updatePayload(buildPersistPayload(slug, false));
  };

  const [primarySave, historySave] = await Promise.all([
    persistBySlug(PLATFORM_MERCHANT_SNAPSHOT_SLUG, primaryEntry),
    persistBySlug(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG, historyEntry),
  ]);
  if (primarySave.error) {
    if (historySave.error) {
      return {
        error: [
          `platform_merchant_snapshot_primary_save_failed:${primarySave.error}`,
          `platform_merchant_snapshot_history_save_failed:${historySave.error}`,
        ].join(";"),
      };
    }
    return { error: primarySave.error };
  }

  if (historySave.error) {
    return { error: `platform_merchant_snapshot_history_save_failed:${historySave.error}` };
  }

  const persistAuxiliaryBySlug = async (slug: string, loadedEntry: SnapshotStoredPayloadEntry | null) => {
    const entry = loadedEntry ?? (await loadStoredPlatformMerchantSnapshotEntryBySlug(supabase, slug));
    return persistBySlug(slug, entry);
  };

  const auxiliarySaves = [
    persistAuxiliaryBySlug(PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, backupEntry).then((backupSave) => {
      if (backupSave.error && typeof console !== "undefined") {
        console.error("[platform-merchant-snapshot] backup save failed", backupSave.error);
      }
    }),
    persistAuxiliaryBySlug(PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG, historyBackupEntry).then((historyBackupSave) => {
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

/** Restore-only completion contract. This is NOT an atomic transaction or a cross-instance write lock. */
async function savePlatformMerchantSnapshotStrict(
  supabase: PlatformMerchantSnapshotStoreClient,
  payload: PlatformMerchantSnapshotPayload,
  options: { expectedRevision?: string | null },
): Promise<PlatformMerchantSnapshotSaveResult> {
  platformMerchantSnapshotCache = null;
  const client = supabase as unknown as StrictPlatformAdminBackupWriteClient;
  const fail = () => {
    platformMerchantSnapshotCache = null;
    return { error: "super_admin_backup_write_unconfirmed" };
  };
  try {
    assertPlatformAdminBackupMerchantSnapshot(payload);
    const slugs = [PLATFORM_MERCHANT_SNAPSHOT_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_SLUG,
      PLATFORM_MERCHANT_SNAPSHOT_BACKUP_SLUG, PLATFORM_MERCHANT_SNAPSHOT_HISTORY_BACKUP_SLUG];
    const rows = await Promise.all(slugs.map((slug) => readPlatformAdminBackupRowForWriteStrict(client, slug)));
    const stored = rows.map((row) => {
      if (row === null) return null;
      if (!Array.isArray(row.blocks)) throw new Error("super_admin_backup_write_unconfirmed");
      // An existing empty directory may still hold valid history and a version.
      return readPlatformMerchantSnapshotBlocksValidated(row.blocks);
    });
    const existingPayload = mergeSnapshotPayloadHistory(stored[0], ...stored.slice(1));
    if (options.expectedRevision !== undefined && String(options.expectedRevision ?? "").trim() !== String(existingPayload?.revision ?? "").trim()) {
      return { error: "platform_merchant_snapshot_conflict", code: "conflict", payload: existingPayload ?? undefined };
    }
    const merged = existingPayload ? mergePlatformMerchantSnapshotPayloads(payload, existingPayload) : payload;
    const next = normalizePlatformMerchantSnapshotPayload({
      ...merged, revision: createPlatformMerchantSnapshotRevision(),
      merchantConfigHistoryBySiteId: mergePlatformMerchantConfigHistoryBySiteId(merged.merchantConfigHistoryBySiteId, existingPayload?.merchantConfigHistoryBySiteId),
    });
    const currentBlocks = buildPlatformMerchantSnapshotBlocks(next, { includeHistory: false });
    const historyBlocks = buildPlatformMerchantSnapshotBlocks(next);
    const archiveDelta = derivePlatformMerchantConfigArchiveEntries({
      previousHistoryBySiteId: existingPayload?.merchantConfigHistoryBySiteId,
      nextHistoryBySiteId: next.merchantConfigHistoryBySiteId, nextSnapshot: next.snapshot,
    });
    const archiveClient = supabase as unknown as PlatformMerchantConfigArchiveStoreClient;
    const archive = archiveDelta.audits.length > 0 || archiveDelta.backups.length > 0
      ? mergePlatformMerchantConfigArchivePayloads(await loadStoredPlatformMerchantConfigArchive(archiveClient, { strict: true }), archiveDelta)
      : null;
    const persist = (index: number) => persistPlatformAdminBackupRowStrict(client, slugs[index],
      index === 0 || index === 2 ? currentBlocks : historyBlocks, rows[index]);
    // A rejected branch must not abandon another already-started branch.
    const main = await Promise.allSettled([persist(0), persist(1)]);
    if (main.some((result) => result.status === "rejected")) return fail();
    const auxiliary = [persist(2), persist(3)];
    if (archive) auxiliary.push((async () => {
      const saved = await savePlatformMerchantConfigArchive(archiveClient, archive, { requireAllWrites: true });
      if (saved.error) throw new Error("super_admin_backup_write_unconfirmed");
    })());
    // Deliberately no legacy 3.5s Promise.race: PATCH must not start target-archive restoration while these still write.
    const completed = await Promise.allSettled(auxiliary);
    if (completed.some((result) => result.status === "rejected")) return fail();
    platformMerchantSnapshotCache = { expiresAt: Date.now() + PLATFORM_MERCHANT_SNAPSHOT_CACHE_TTL_MS, value: next };
    return { error: null, payload: next };
  } catch { return fail(); }
}
