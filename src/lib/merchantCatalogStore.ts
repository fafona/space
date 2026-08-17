import { isMerchantNumericId } from "@/lib/merchantIdentity";
import {
  getMerchantCatalogValidationError,
  normalizeMerchantCatalog,
  parseStrictMerchantCatalog,
  type MerchantCatalog,
} from "@/lib/merchantCatalog";
import { saveMerchantSnapshotHistory } from "@/lib/merchantSnapshotHistoryStore";
import { createServerSupabaseServiceClient } from "@/lib/superAdminServer";

const CATALOG_SLUG_PREFIX = "__merchant_catalog__:";
const HISTORY_SLUG_PREFIX = "__merchant_catalog_history__:";
const HISTORY_BACKUP_SLUG_PREFIX = "__merchant_catalog_history_backup__:";

export type MerchantCatalogStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type StoredCatalogRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
  updated_at?: unknown;
};

type StoredCatalogEnvelope = {
  kind: "merchant_catalog";
  siteId: string;
  catalog: MerchantCatalog;
};

export type MerchantCatalogStoreResult = {
  error: string | null;
  catalog: MerchantCatalog | null;
  warning?: string | null;
};

export type MerchantCatalogStoreMutation =
  | { ok: true; catalog: MerchantCatalog }
  | { ok: false; error: string };

const writeLocks = new Map<string, Promise<void>>();

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

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

function isUniqueConstraintError(message: string) {
  return /duplicate key|unique constraint|23505/i.test(message);
}

function catalogSlug(siteId: string) {
  return `${CATALOG_SLUG_PREFIX}${siteId}`;
}

function historySlug(siteId: string) {
  return `${HISTORY_SLUG_PREFIX}${siteId}`;
}

function historyBackupSlug(siteId: string) {
  return `${HISTORY_BACKUP_SLUG_PREFIX}${siteId}`;
}

function rowTimestamp(row: StoredCatalogRow) {
  const timestamp = Date.parse(normalizeText(row.updated_at));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function sortRowsNewestFirst(rows: StoredCatalogRow[]) {
  return [...rows].sort((left, right) => {
    const difference = rowTimestamp(right) - rowTimestamp(left);
    if (difference !== 0) return difference;
    return String(right.id ?? "").localeCompare(String(left.id ?? ""), "en");
  });
}

function catalogEnvelope(siteId: string, catalog: MerchantCatalog): StoredCatalogEnvelope {
  return { kind: "merchant_catalog", siteId, catalog };
}

function parseStoredCatalogEnvelope(siteId: string, value: unknown): MerchantCatalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.kind !== "merchant_catalog" || normalizeText(envelope.siteId) !== siteId) return null;
  if (!envelope.catalog || typeof envelope.catalog !== "object" || Array.isArray(envelope.catalog)) return null;
  const rawCatalog = envelope.catalog as Record<string, unknown>;
  if (!Number.isSafeInteger(rawCatalog.revision) || Number(rawCatalog.revision) <= 0) return null;
  if (!normalizeText(rawCatalog.updatedAt)) return null;
  return parseStrictMerchantCatalog(rawCatalog);
}

async function withCatalogWriteLock<T>(siteId: string, task: () => Promise<T>) {
  const previous = writeLocks.get(siteId) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  writeLocks.set(siteId, queued);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (writeLocks.get(siteId) === queued) writeLocks.delete(siteId);
  }
}

async function queryRows(
  supabase: MerchantCatalogStoreClient,
  siteId: string,
  slug: string,
): Promise<StoredCatalogRow[]> {
  const runQuery = async (fields: string, includeMerchantId: boolean) => {
    let query = supabase.from("pages").select(fields).eq("slug", slug);
    if (includeMerchantId) query = query.eq("merchant_id", siteId);
    return query;
  };

  let result = await runQuery("id,slug,blocks,updated_at", true);
  let error = result.error;
  let data = (result.data ?? []) as StoredCatalogRow[];
  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      result = await runQuery("id,slug,blocks,updated_at", false);
    } else if (isMissingUpdatedAtColumn(message)) {
      result = await runQuery("id,slug,blocks", true);
    } else if (isMissingSlugColumn(message)) {
      return [];
    }
    error = result.error;
    data = (result.data ?? []) as StoredCatalogRow[];
  }
  if (error && isMissingUpdatedAtColumn(toErrorMessage(error))) {
    result = await runQuery("id,slug,blocks", false);
    error = result.error;
    data = (result.data ?? []) as StoredCatalogRow[];
  }
  if (error) {
    const message = toErrorMessage(error);
    if (isMissingSlugColumn(message)) return [];
    throw new Error(`merchant_catalog_read_failed:${message}`);
  }

  if (data.length === 0) {
    const fallback = await runQuery("id,slug,blocks,updated_at", false);
    if (!fallback.error) return Array.isArray(fallback.data) ? (fallback.data as StoredCatalogRow[]) : [];
    const message = toErrorMessage(fallback.error);
    if (isMissingUpdatedAtColumn(message)) {
      const withoutUpdatedAt = await runQuery("id,slug,blocks", false);
      if (!withoutUpdatedAt.error) {
        return Array.isArray(withoutUpdatedAt.data) ? (withoutUpdatedAt.data as StoredCatalogRow[]) : [];
      }
      throw new Error(`merchant_catalog_read_failed:${toErrorMessage(withoutUpdatedAt.error)}`);
    }
    if (!isMissingMerchantIdColumn(message)) throw new Error(`merchant_catalog_read_failed:${message}`);
  }
  return Array.isArray(data) ? data : [];
}

function historyCandidates(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as unknown[];
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as { after?: unknown; before?: unknown };
    return [record.after, record.before];
  });
}

async function recoverCatalogFromHistory(
  supabase: MerchantCatalogStoreClient,
  siteId: string,
): Promise<MerchantCatalog | null> {
  for (const slug of [historySlug(siteId), historyBackupSlug(siteId)]) {
    const rows = sortRowsNewestFirst(await queryRows(supabase, siteId, slug));
    for (const row of rows) {
      for (const candidate of historyCandidates(row.blocks)) {
        const parsed = parseStoredCatalogEnvelope(siteId, candidate);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

async function repairRecoveredCatalogPrimary(
  supabase: MerchantCatalogStoreClient,
  siteId: string,
  row: StoredCatalogRow | undefined,
  recovered: MerchantCatalog,
) {
  if (row?.id === undefined || row.id === null) throw new Error("merchant_catalog_repair_unavailable");
  const repairedAt = new Date().toISOString();
  const repairedCatalog = normalizeMerchantCatalog({ ...recovered, updatedAt: repairedAt });
  const envelope = catalogEnvelope(siteId, repairedCatalog);
  const existingUpdatedAt = normalizeText(row.updated_at);

  const write = async (includeUpdatedAt: boolean) => {
    let query = supabase
      .from("pages")
      .update(includeUpdatedAt ? { blocks: envelope, updated_at: repairedAt } : { blocks: envelope })
      .eq("id", row.id);
    if (includeUpdatedAt && existingUpdatedAt) query = query.eq("updated_at", existingUpdatedAt);
    return query.select("id,blocks,updated_at");
  };

  let result = await write(true);
  if (result.error && isMissingUpdatedAtColumn(toErrorMessage(result.error))) {
    result = await write(false);
  }
  if (result.error) throw new Error(`merchant_catalog_repair_failed:${toErrorMessage(result.error)}`);
  if (Array.isArray(result.data) && result.data.length === 0) {
    const latestRows = sortRowsNewestFirst(await queryRows(supabase, siteId, catalogSlug(siteId)));
    for (const latestRow of latestRows) {
      const latest = parseStoredCatalogEnvelope(siteId, latestRow.blocks);
      if (latest) return latest;
    }
    throw new Error("merchant_catalog_repair_conflict");
  }
  return repairedCatalog;
}

export async function loadStoredMerchantCatalog(
  supabase: MerchantCatalogStoreClient,
  siteId: string,
): Promise<MerchantCatalog | null> {
  const normalizedSiteId = normalizeText(siteId);
  if (!isMerchantNumericId(normalizedSiteId)) return null;
  const rows = sortRowsNewestFirst(await queryRows(supabase, normalizedSiteId, catalogSlug(normalizedSiteId)));
  for (const row of rows) {
    const catalog = parseStoredCatalogEnvelope(normalizedSiteId, row.blocks);
    if (!catalog) continue;
    return { ...catalog, updatedAt: normalizeText(row.updated_at) || catalog.updatedAt };
  }
  if (rows.length === 0) return null;
  const recovered = await recoverCatalogFromHistory(supabase, normalizedSiteId);
  if (!recovered) throw new Error("merchant_catalog_corrupt");
  return repairRecoveredCatalogPrimary(supabase, normalizedSiteId, rows[0], recovered);
}

export async function loadMerchantCatalog(siteId: string): Promise<MerchantCatalog | null> {
  const supabase = createServerSupabaseServiceClient();
  // `null` is reserved for a confirmed "catalog not created" result. Treat a
  // missing service client as an outage so public display and order quoting do
  // not silently fall back to stale published product data.
  if (!supabase) throw new Error("merchant_catalog_storage_unavailable");
  return loadStoredMerchantCatalog(supabase as unknown as MerchantCatalogStoreClient, siteId);
}

async function saveStoredMerchantCatalogUnlocked(
  supabase: MerchantCatalogStoreClient,
  input: {
    siteId: string;
    catalog: MerchantCatalog;
    expectedRevision: number;
    source?: string;
    updatedAt?: string;
  },
): Promise<MerchantCatalogStoreResult> {
  const siteId = normalizeText(input.siteId);
  if (!isMerchantNumericId(siteId)) return { error: "invalid_site_id", catalog: null };
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    return { error: "invalid_merchant_catalog_expected_revision", catalog: null };
  }

  const slug = catalogSlug(siteId);
  const rows = sortRowsNewestFirst(await queryRows(supabase, siteId, slug));
  const existing = rows[0];
  const current = existing ? parseStoredCatalogEnvelope(siteId, existing.blocks) : null;
  if (existing && !current) return { error: "merchant_catalog_corrupt", catalog: null };
  const currentRevision = current?.revision ?? 0;
  if (input.expectedRevision !== currentRevision) {
    return { error: "merchant_catalog_revision_conflict", catalog: current };
  }

  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const next = normalizeMerchantCatalog({
    ...input.catalog,
    revision: currentRevision + 1,
    updatedAt,
  });
  const validationError = getMerchantCatalogValidationError(next);
  if (validationError) return { error: validationError, catalog: current };
  const afterEnvelope = catalogEnvelope(siteId, next);

  const existingUpdatedAt = normalizeText(existing?.updated_at);
  const updateExisting = async (body: Record<string, unknown>, useUpdatedAtGuard: boolean) => {
    if (existing?.id === undefined || existing.id === null) return { error: "missing_existing_id", conflict: false };
    let query = supabase.from("pages").update(body).eq("id", existing.id);
    if (useUpdatedAtGuard && existingUpdatedAt) query = query.eq("updated_at", existingUpdatedAt);
    const result = await query.select("id");
    if (result.error) return { error: toErrorMessage(result.error), conflict: false };
    if (useUpdatedAtGuard && existingUpdatedAt && Array.isArray(result.data) && result.data.length === 0) {
      return { error: "merchant_catalog_revision_conflict", conflict: true };
    }
    return { error: null, conflict: false };
  };

  const insertNew = async (body: Record<string, unknown>) => {
    const inserted = await supabase.from("pages").insert({ ...body, slug, merchant_id: siteId });
    let error = inserted.error ? toErrorMessage(inserted.error) : null;
    if (error && isMissingMerchantIdColumn(error)) {
      const retry = await supabase.from("pages").insert({ ...body, slug });
      error = retry.error ? toErrorMessage(retry.error) : null;
    }
    return { error, conflict: Boolean(error && isUniqueConstraintError(error)) };
  };

  const withUpdatedAt = { blocks: afterEnvelope, updated_at: updatedAt };
  let result = existing
    ? await updateExisting(withUpdatedAt, true)
    : await insertNew(withUpdatedAt);
  if (result.error && isMissingUpdatedAtColumn(result.error)) {
    result = existing
      ? await updateExisting({ blocks: afterEnvelope }, false)
      : await insertNew({ blocks: afterEnvelope });
  }
  if (!result.error) {
    // Only committed primary writes may enter recovery history. Writing the
    // candidate first would let a losing cross-instance CAS become a future
    // recovery value even though it never took effect.
    const history = await saveMerchantSnapshotHistory(supabase, {
      siteId,
      slug: historySlug(siteId),
      backupSlug: historyBackupSlug(siteId),
      source: normalizeText(input.source) || "merchant-catalog",
      before: null,
      after: afterEnvelope,
      at: updatedAt,
      // Each entry contains one full post-commit recovery snapshot. Keep the
      // cumulative row near 1.5 MB even when a catalog reaches its 512 KB cap.
      maxEntries: 3,
      requireCompareAndSwap: true,
    });
    const warning = history.error ? `merchant_catalog_history_save_failed:${history.error}` : null;
    if (warning && typeof console !== "undefined") {
      console.error("[merchant-catalog] committed without history", warning);
    }
    return { error: null, catalog: next, warning };
  }
  if (result.conflict || isUniqueConstraintError(result.error)) {
    const latest = await loadStoredMerchantCatalog(supabase, siteId).catch(() => current);
    return { error: "merchant_catalog_revision_conflict", catalog: latest };
  }
  return { error: `merchant_catalog_save_failed:${result.error}`, catalog: current };
}

export async function saveStoredMerchantCatalog(
  supabase: MerchantCatalogStoreClient,
  input: {
    siteId: string;
    catalog: MerchantCatalog;
    expectedRevision: number;
    source?: string;
    updatedAt?: string;
  },
) {
  const siteId = normalizeText(input.siteId);
  if (!isMerchantNumericId(siteId)) return { error: "invalid_site_id", catalog: null };
  return withCatalogWriteLock(siteId, () => saveStoredMerchantCatalogUnlocked(supabase, { ...input, siteId }));
}

export async function mutateStoredMerchantCatalog(
  supabase: MerchantCatalogStoreClient,
  input: {
    siteId: string;
    expectedRevision: number;
    source?: string;
    updatedAt?: string;
    mutate: (current: MerchantCatalog | null) => MerchantCatalogStoreMutation | Promise<MerchantCatalogStoreMutation>;
  },
): Promise<MerchantCatalogStoreResult> {
  const siteId = normalizeText(input.siteId);
  if (!isMerchantNumericId(siteId)) return { error: "invalid_site_id", catalog: null };
  return withCatalogWriteLock(siteId, async () => {
    const current = await loadStoredMerchantCatalog(supabase, siteId);
    const currentRevision = current?.revision ?? 0;
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      return { error: "invalid_merchant_catalog_expected_revision", catalog: current };
    }
    if (input.expectedRevision !== currentRevision) {
      return { error: "merchant_catalog_revision_conflict", catalog: current };
    }
    const decision = await input.mutate(current);
    if (!decision.ok) return { error: decision.error, catalog: current };
    return saveStoredMerchantCatalogUnlocked(supabase, {
      siteId,
      catalog: decision.catalog,
      expectedRevision: currentRevision,
      source: input.source,
      updatedAt: input.updatedAt,
    });
  });
}
