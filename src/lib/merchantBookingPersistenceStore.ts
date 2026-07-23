import { isDeepStrictEqual } from "node:util";

const BOOKING_PERSISTENCE_MERCHANT_ID = "__faolla_booking_persistence__";

const BOOKING_PERSISTENCE_SLUGS = {
  records: "__merchant_booking_records__:v1",
  workbench: "__merchant_booking_workbench__:v1",
  rules: "__merchant_booking_rules__:v1",
} as const;

export type MerchantBookingPersistenceKey = keyof typeof BOOKING_PERSISTENCE_SLUGS;

export type MerchantBookingPersistenceStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

type MerchantBookingPersistenceRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
  updated_at?: unknown;
};

export type StoredMerchantBookingPersistenceValue<T> = {
  value: T;
  updatedAt: string | null;
  recoveredFromBackup: boolean;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function persistedRecordTimestamp(record: { updatedAt?: unknown; createdAt?: unknown }) {
  const timestamp = Date.parse(normalizeText(record.updatedAt) || normalizeText(record.createdAt));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function merchantBookingPersistenceValuesEqual(left: unknown, right: unknown) {
  return isDeepStrictEqual(left, right);
}

export function mergeMerchantBookingPersistenceRecords<
  T extends { id?: unknown; updatedAt?: unknown; createdAt?: unknown },
>(localRecords: T[], remoteRecords: T[]) {
  const merged = new Map<string, T>();
  const recordsWithoutId: T[] = [];
  const mergeRecord = (record: T) => {
    const id = normalizeText(record?.id);
    if (!id) {
      if (!recordsWithoutId.some((current) => merchantBookingPersistenceValuesEqual(current, record))) {
        recordsWithoutId.push(record);
      }
      return;
    }
    const current = merged.get(id);
    if (!current || persistedRecordTimestamp(record) >= persistedRecordTimestamp(current)) {
      merged.set(id, record);
    }
  };
  localRecords.forEach(mergeRecord);
  remoteRecords.forEach(mergeRecord);
  return [...merged.values(), ...recordsWithoutId].sort(
    (left, right) => persistedRecordTimestamp(right) - persistedRecordTimestamp(left),
  );
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

function buildPersistenceSlug(key: MerchantBookingPersistenceKey, backup = false) {
  const slug = BOOKING_PERSISTENCE_SLUGS[key];
  return backup ? `${slug}:backup` : slug;
}

function rowTimestamp(row: MerchantBookingPersistenceRow) {
  const timestamp = Date.parse(normalizeText(row.updated_at));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function sortRowsNewestFirst(rows: MerchantBookingPersistenceRow[]) {
  return [...rows].sort((left, right) => {
    const difference = rowTimestamp(right) - rowTimestamp(left);
    if (difference !== 0) return difference;
    return String(right.id ?? "").localeCompare(String(left.id ?? ""));
  });
}

async function queryPersistenceRows(
  supabase: MerchantBookingPersistenceStoreClient,
  slug: string,
): Promise<MerchantBookingPersistenceRow[]> {
  const queryRows = async (fields: string, includeMerchantId: boolean) => {
    let query = supabase.from("pages").select(fields).eq("slug", slug);
    if (includeMerchantId) {
      query = query.eq("merchant_id", BOOKING_PERSISTENCE_MERCHANT_ID);
    }
    return query;
  };

  let query = await queryRows("id,slug,blocks,updated_at", true);
  let data = (query.data ?? []) as MerchantBookingPersistenceRow[];
  let error = query.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      query = await queryRows("id,slug,blocks,updated_at", false);
      data = (query.data ?? []) as MerchantBookingPersistenceRow[];
      error = query.error;
    } else if (isMissingUpdatedAtColumn(message)) {
      query = await queryRows("id,slug,blocks", true);
      data = (query.data ?? []) as MerchantBookingPersistenceRow[];
      error = query.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    }
  }

  if (error && isMissingUpdatedAtColumn(toErrorMessage(error))) {
    query = await queryRows("id,slug,blocks", false);
    data = (query.data ?? []) as MerchantBookingPersistenceRow[];
    error = query.error;
  }

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingSlugColumn(message)) return [];
    throw new Error(`merchant_booking_persistence_read_failed:${message}`);
  }
  return Array.isArray(data) ? data : [];
}

function selectNormalizedValue<T>(
  rows: MerchantBookingPersistenceRow[],
  normalize: (value: unknown) => T | null,
) {
  for (const row of sortRowsNewestFirst(rows)) {
    let value: T | null = null;
    try {
      value = normalize(row.blocks);
    } catch {
      value = null;
    }
    if (!value) continue;
    return {
      value,
      updatedAt: normalizeText(row.updated_at) || null,
    };
  }
  return null;
}

export async function loadMerchantBookingPersistenceValue<T>(
  supabase: MerchantBookingPersistenceStoreClient,
  key: MerchantBookingPersistenceKey,
  normalize: (value: unknown) => T | null,
): Promise<StoredMerchantBookingPersistenceValue<T> | null> {
  const primaryRows = await queryPersistenceRows(supabase, buildPersistenceSlug(key));
  const primary = selectNormalizedValue(primaryRows, normalize);
  if (primary) {
    return {
      ...primary,
      recoveredFromBackup: false,
    };
  }

  const backupRows = await queryPersistenceRows(supabase, buildPersistenceSlug(key, true));
  const backup = selectNormalizedValue(backupRows, normalize);
  if (backup) {
    return {
      ...backup,
      recoveredFromBackup: true,
    };
  }

  if (primaryRows.length > 0 || backupRows.length > 0) {
    throw new Error(`merchant_booking_persistence_corrupt:${key}`);
  }
  return null;
}

async function writePersistenceRow(
  supabase: MerchantBookingPersistenceStoreClient,
  slug: string,
  value: unknown,
  updatedAt: string,
  knownRows?: MerchantBookingPersistenceRow[],
) {
  const rows = knownRows ?? (await queryPersistenceRows(supabase, slug));
  const existing = sortRowsNewestFirst(rows)[0];

  const updateExisting = async (body: Record<string, unknown>) => {
    if (existing?.id === undefined || existing?.id === null) {
      return { error: "missing_existing_id" };
    }
    const updated = await supabase.from("pages").update(body).eq("id", existing.id);
    return { error: updated.error ? toErrorMessage(updated.error) : null };
  };

  const insertNew = async (body: Record<string, unknown>) => {
    const inserted = await supabase.from("pages").insert({
      ...body,
      slug,
      merchant_id: BOOKING_PERSISTENCE_MERCHANT_ID,
    });
    let error = inserted.error ? toErrorMessage(inserted.error) : null;
    if (error && isMissingMerchantIdColumn(error)) {
      const retry = await supabase.from("pages").insert({
        ...body,
        slug,
      });
      error = retry.error ? toErrorMessage(retry.error) : null;
    }
    return { error };
  };

  const body = {
    blocks: value,
    updated_at: updatedAt,
  };
  let result = existing ? await updateExisting(body) : await insertNew(body);
  if (result.error && isMissingUpdatedAtColumn(result.error)) {
    result = existing ? await updateExisting({ blocks: value }) : await insertNew({ blocks: value });
  }
  if (!result.error) return;

  if (!existing && isUniqueConstraintError(result.error)) {
    const concurrentRows = await queryPersistenceRows(supabase, slug);
    const concurrent = sortRowsNewestFirst(concurrentRows)[0];
    if (concurrent?.id !== undefined && concurrent.id !== null) {
      let retry = await supabase
        .from("pages")
        .update(body)
        .eq("id", concurrent.id);
      if (retry.error && isMissingUpdatedAtColumn(toErrorMessage(retry.error))) {
        retry = await supabase
          .from("pages")
          .update({ blocks: value })
          .eq("id", concurrent.id);
      }
      if (!retry.error) return;
      result = { error: toErrorMessage(retry.error) };
    }
  }

  throw new Error(`merchant_booking_persistence_write_failed:${result.error}`);
}

export async function saveMerchantBookingPersistenceValue(
  supabase: MerchantBookingPersistenceStoreClient,
  key: MerchantBookingPersistenceKey,
  value: unknown,
  updatedAt = new Date().toISOString(),
  options?: {
    preserveCurrentAsBackup?: boolean;
  },
) {
  const normalizedUpdatedAt = normalizeText(updatedAt) || new Date().toISOString();
  const primarySlug = buildPersistenceSlug(key);
  const primaryRows = await queryPersistenceRows(supabase, primarySlug);
  const current = sortRowsNewestFirst(primaryRows)[0];

  if (
    options?.preserveCurrentAsBackup !== false &&
    current &&
    !merchantBookingPersistenceValuesEqual(current.blocks, value)
  ) {
    await writePersistenceRow(
      supabase,
      buildPersistenceSlug(key, true),
      current.blocks,
      normalizeText(current.updated_at) || normalizedUpdatedAt,
    );
  }

  await writePersistenceRow(supabase, primarySlug, value, normalizedUpdatedAt, primaryRows);
}
