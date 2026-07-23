import {
  normalizeMerchantManagerPreferencesSnapshot,
  parseStoredMerchantManagerPreferencesSnapshot,
  type MerchantManagerPreferencesSnapshot,
} from "@/lib/merchantManagerPreferences";
import { saveMerchantSnapshotHistory } from "@/lib/merchantSnapshotHistoryStore";

const PREFERENCES_SLUG_PREFIX = "__merchant_manager_preferences__:";
const HISTORY_SLUG_PREFIX = "__merchant_manager_preferences_history__:";
const HISTORY_BACKUP_SLUG_PREFIX = "__merchant_manager_preferences_history_backup__:";

export type MerchantManagerPreferencesStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type StoredPreferencesRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
  updated_at?: unknown;
};

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

function buildPreferencesSlug(siteId: string) {
  return `${PREFERENCES_SLUG_PREFIX}${siteId}`;
}

function buildHistorySlug(siteId: string) {
  return `${HISTORY_SLUG_PREFIX}${siteId}`;
}

function buildHistoryBackupSlug(siteId: string) {
  return `${HISTORY_BACKUP_SLUG_PREFIX}${siteId}`;
}

function rowTimestamp(row: StoredPreferencesRow) {
  const timestamp = Date.parse(normalizeText(row.updated_at));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function sortRowsNewestFirst(rows: StoredPreferencesRow[]) {
  return [...rows].sort((left, right) => {
    const difference = rowTimestamp(right) - rowTimestamp(left);
    if (difference !== 0) return difference;
    return String(right.id ?? "").localeCompare(String(left.id ?? ""), "en");
  });
}

async function queryRows(
  supabase: MerchantManagerPreferencesStoreClient,
  siteId: string,
  slug: string,
): Promise<StoredPreferencesRow[]> {
  const queryRows = async (fields: string, includeMerchantId: boolean) => {
    let query = supabase.from("pages").select(fields).eq("slug", slug);
    if (includeMerchantId) query = query.eq("merchant_id", siteId);
    return query;
  };

  let result = await queryRows("id,slug,blocks,updated_at", true);
  let data = (result.data ?? []) as StoredPreferencesRow[];
  let error = result.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      result = await queryRows("id,slug,blocks,updated_at", false);
      data = (result.data ?? []) as StoredPreferencesRow[];
      error = result.error;
    } else if (isMissingUpdatedAtColumn(message)) {
      result = await queryRows("id,slug,blocks", true);
      data = (result.data ?? []) as StoredPreferencesRow[];
      error = result.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    }
  }

  if (error && isMissingUpdatedAtColumn(toErrorMessage(error))) {
    result = await queryRows("id,slug,blocks", false);
    data = (result.data ?? []) as StoredPreferencesRow[];
    error = result.error;
  }

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingSlugColumn(message)) return [];
    throw new Error(`merchant_manager_preferences_read_failed:${message}`);
  }

  if (data.length === 0) {
    const fallback = await queryRows("id,slug,blocks,updated_at", false);
    if (!fallback.error) return Array.isArray(fallback.data) ? (fallback.data as StoredPreferencesRow[]) : [];
    const fallbackMessage = toErrorMessage(fallback.error);
    if (isMissingUpdatedAtColumn(fallbackMessage)) {
      const withoutUpdatedAt = await queryRows("id,slug,blocks", false);
      if (!withoutUpdatedAt.error) {
        return Array.isArray(withoutUpdatedAt.data)
          ? (withoutUpdatedAt.data as StoredPreferencesRow[])
          : [];
      }
      throw new Error(
        `merchant_manager_preferences_read_failed:${toErrorMessage(withoutUpdatedAt.error)}`,
      );
    }
    if (!isMissingMerchantIdColumn(fallbackMessage)) {
      throw new Error(`merchant_manager_preferences_read_failed:${fallbackMessage}`);
    }
  }

  return Array.isArray(data) ? data : [];
}

function readHistoryCandidates(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as unknown[];
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as { after?: unknown; before?: unknown };
    return [record.after, record.before];
  });
}

async function recoverSnapshotFromHistory(
  supabase: MerchantManagerPreferencesStoreClient,
  siteId: string,
): Promise<MerchantManagerPreferencesSnapshot | null> {
  for (const slug of [buildHistorySlug(siteId), buildHistoryBackupSlug(siteId)]) {
    const rows = sortRowsNewestFirst(await queryRows(supabase, siteId, slug));
    for (const row of rows) {
      for (const candidate of readHistoryCandidates(row.blocks)) {
        const parsed = parseStoredMerchantManagerPreferencesSnapshot(siteId, candidate);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

export async function loadStoredMerchantManagerPreferences(
  supabase: MerchantManagerPreferencesStoreClient,
  siteId: string,
): Promise<MerchantManagerPreferencesSnapshot | null> {
  const normalizedSiteId = normalizeText(siteId);
  if (!normalizedSiteId) return null;
  const rows = sortRowsNewestFirst(
    await queryRows(supabase, normalizedSiteId, buildPreferencesSlug(normalizedSiteId)),
  );
  for (const row of rows) {
    const parsed = parseStoredMerchantManagerPreferencesSnapshot(normalizedSiteId, row.blocks);
    if (!parsed) continue;
    return {
      ...parsed,
      updatedAt: normalizeText(row.updated_at) || parsed.updatedAt,
    };
  }
  if (rows.length === 0) return null;
  const recovered = await recoverSnapshotFromHistory(supabase, normalizedSiteId);
  if (!recovered) throw new Error("merchant_manager_preferences_corrupt");
  return {
    ...recovered,
    updatedAt: normalizeText(rows[0]?.updated_at) || recovered.updatedAt,
  };
}

export async function saveStoredMerchantManagerPreferences(
  supabase: MerchantManagerPreferencesStoreClient,
  input: {
    siteId: string;
    snapshot: MerchantManagerPreferencesSnapshot;
    expectedUpdatedAt?: string | null;
    source?: string;
  },
): Promise<{ error: string | null }> {
  const siteId = normalizeText(input.siteId);
  if (!siteId) return { error: "invalid_site_id" };
  const slug = buildPreferencesSlug(siteId);
  const rows = sortRowsNewestFirst(await queryRows(supabase, siteId, slug));
  const existing = rows[0];
  const existingUpdatedAt = normalizeText(existing?.updated_at);
  const existingSnapshot = existing
    ? parseStoredMerchantManagerPreferencesSnapshot(siteId, existing.blocks)
    : null;
  const comparableUpdatedAt = existingUpdatedAt || normalizeText(existingSnapshot?.updatedAt);
  const checksVersion = Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt");
  const expectedUpdatedAt = normalizeText(input.expectedUpdatedAt);
  if (checksVersion && comparableUpdatedAt && expectedUpdatedAt !== comparableUpdatedAt) {
    return { error: "merchant_manager_preferences_conflict" };
  }
  if (checksVersion && !existing && expectedUpdatedAt) {
    return { error: "merchant_manager_preferences_conflict" };
  }

  const updatedAt = normalizeText(input.snapshot.updatedAt) || new Date().toISOString();
  const snapshot = normalizeMerchantManagerPreferencesSnapshot(siteId, {
    ...input.snapshot,
    siteId,
    updatedAt,
  });
  const before = existingSnapshot;
  const history = await saveMerchantSnapshotHistory(supabase, {
    siteId,
    slug: buildHistorySlug(siteId),
    backupSlug: buildHistoryBackupSlug(siteId),
    source: normalizeText(input.source) || "manager-preferences",
    before,
    after: snapshot,
    at: updatedAt,
    maxEntries: 120,
  });
  if (history.error) return { error: `manager_preferences_history_save_failed:${history.error}` };

  const updateExisting = async (body: Record<string, unknown>) => {
    if (existing?.id === undefined || existing.id === null) return { error: "missing_existing_id" };
    let query = supabase.from("pages").update(body).eq("id", existing.id);
    if (checksVersion && existingUpdatedAt) {
      query = query.eq("updated_at", existingUpdatedAt).select("id");
    }
    const updated = await query;
    if (updated.error) return { error: toErrorMessage(updated.error) };
    if (
      checksVersion &&
      existingUpdatedAt &&
      Array.isArray(updated.data) &&
      updated.data.length === 0
    ) {
      return { error: "merchant_manager_preferences_conflict" };
    }
    return { error: null };
  };

  const insertNew = async (body: Record<string, unknown>) => {
    const inserted = await supabase.from("pages").insert({
      ...body,
      slug,
      merchant_id: siteId,
    });
    let error = inserted.error ? toErrorMessage(inserted.error) : null;
    if (error && isMissingMerchantIdColumn(error)) {
      const retry = await supabase.from("pages").insert({ ...body, slug });
      error = retry.error ? toErrorMessage(retry.error) : null;
    }
    return { error };
  };

  const body = { blocks: snapshot, updated_at: updatedAt };
  let result = existing ? await updateExisting(body) : await insertNew(body);
  if (result.error && isMissingUpdatedAtColumn(result.error)) {
    result = existing
      ? await updateExisting({ blocks: snapshot })
      : await insertNew({ blocks: snapshot });
  }
  if (!result.error) return result;

  if (!existing && isUniqueConstraintError(result.error)) {
    return { error: "merchant_manager_preferences_conflict" };
  }
  return result;
}
