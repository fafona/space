import {
  normalizeMerchantCustomerProfile,
  type MerchantCustomerProfile,
} from "@/lib/merchantCustomers";
import { saveMerchantSnapshotHistory } from "@/lib/merchantSnapshotHistoryStore";

const MERCHANT_CUSTOMER_DIRECTORY_SLUG_PREFIX = "__merchant_customer_directory__:";
const MERCHANT_CUSTOMER_DIRECTORY_HISTORY_SLUG_PREFIX = "__merchant_customer_directory_history__:";
const MERCHANT_CUSTOMER_DIRECTORY_HISTORY_BACKUP_SLUG_PREFIX =
  "__merchant_customer_directory_history_backup__:";

export const MAX_STORED_MERCHANT_CUSTOMERS = 10_000;

export type MerchantCustomerDirectoryStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type StoredMerchantCustomerDirectory = {
  siteId: string;
  customers: MerchantCustomerProfile[];
  updatedAt: string | null;
};

type StoredMerchantCustomerDirectoryRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
  updated_at?: unknown;
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function buildDirectorySlug(siteId: string) {
  return `${MERCHANT_CUSTOMER_DIRECTORY_SLUG_PREFIX}${siteId}`;
}

function buildDirectoryHistorySlug(siteId: string) {
  return `${MERCHANT_CUSTOMER_DIRECTORY_HISTORY_SLUG_PREFIX}${siteId}`;
}

function buildDirectoryHistoryBackupSlug(siteId: string) {
  return `${MERCHANT_CUSTOMER_DIRECTORY_HISTORY_BACKUP_SLUG_PREFIX}${siteId}`;
}

function rowTimestamp(row: StoredMerchantCustomerDirectoryRow) {
  const timestamp = Date.parse(trimText(row.updated_at, 64));
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function selectLatestRow(rows: StoredMerchantCustomerDirectoryRow[]) {
  return rows.reduce<StoredMerchantCustomerDirectoryRow | null>((latest, row) => {
    if (!latest) return row;
    const timestampDelta = rowTimestamp(row) - rowTimestamp(latest);
    if (timestampDelta > 0) return row;
    if (timestampDelta < 0) return latest;
    return String(row.id ?? "") > String(latest.id ?? "") ? row : latest;
  }, null);
}

function normalizeStoredCustomers(siteId: string, value: unknown) {
  const record = readRecord(value);
  const source = Array.isArray(value)
    ? value
    : Array.isArray(record.customers)
      ? record.customers
      : [];
  const byId = new Map<string, MerchantCustomerProfile>();
  source.forEach((item) => {
    const profile = normalizeMerchantCustomerProfile(item, { siteId });
    if (!profile || profile.siteId !== siteId) return;
    const previous = byId.get(profile.id);
    if (!previous || Date.parse(profile.updatedAt) >= Date.parse(previous.updatedAt)) {
      byId.set(profile.id, profile);
    }
  });
  return Array.from(byId.values())
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_STORED_MERCHANT_CUSTOMERS);
}

async function queryDirectoryRows(
  supabase: MerchantCustomerDirectoryStoreClient,
  siteId: string,
) {
  const slug = buildDirectorySlug(siteId);
  const runQuery = async (includeMerchantId: boolean, includeUpdatedAt: boolean) => {
    const query = supabase
      .from("pages")
      .select(includeUpdatedAt ? "id,slug,blocks,updated_at" : "id,slug,blocks")
      .eq("slug", slug);
    return includeMerchantId ? query.eq("merchant_id", siteId) : query;
  };

  let includeMerchantId = true;
  let includeUpdatedAt = true;
  let rows: StoredMerchantCustomerDirectoryRow[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await runQuery(includeMerchantId, includeUpdatedAt);
    rows = Array.isArray(result.data)
      ? (result.data as StoredMerchantCustomerDirectoryRow[])
      : [];
    if (!result.error) break;
    const message = toErrorMessage(result.error);
    if (isMissingSlugColumn(message)) return [];
    if (includeMerchantId && isMissingMerchantIdColumn(message)) {
      includeMerchantId = false;
      continue;
    }
    if (includeUpdatedAt && isMissingUpdatedAtColumn(message)) {
      includeUpdatedAt = false;
      continue;
    }
    throw new Error(`merchant_customer_directory_read_failed:${message}`);
  }

  if (rows.length === 0 && includeMerchantId) {
    includeMerchantId = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await runQuery(includeMerchantId, includeUpdatedAt);
      rows = Array.isArray(result.data)
        ? (result.data as StoredMerchantCustomerDirectoryRow[])
        : [];
      if (!result.error) break;
      const message = toErrorMessage(result.error);
      if (isMissingSlugColumn(message)) return [];
      if (includeUpdatedAt && isMissingUpdatedAtColumn(message)) {
        includeUpdatedAt = false;
        continue;
      }
      throw new Error(`merchant_customer_directory_read_failed:${message}`);
    }
  }

  return rows;
}

export function mergeStoredMerchantCustomerDirectoryRows(
  siteIdValue: string,
  rows: StoredMerchantCustomerDirectoryRow[],
): StoredMerchantCustomerDirectory | null {
  const siteId = trimText(siteIdValue, 80);
  if (!siteId || !Array.isArray(rows) || rows.length === 0) return null;
  const slug = buildDirectorySlug(siteId);
  const matchedRows = rows.filter(
    (row) => trimText(row.slug, 200) === slug || !trimText(row.slug, 200),
  );
  const latest = selectLatestRow(matchedRows);
  if (!latest) return null;
  const payloadUpdatedAt = trimText(readRecord(latest.blocks).updatedAt, 64);
  return {
    siteId,
    customers: normalizeStoredCustomers(siteId, latest.blocks),
    updatedAt: trimText(latest.updated_at, 64) || payloadUpdatedAt || null,
  };
}

export async function loadStoredMerchantCustomerDirectory(
  supabase: MerchantCustomerDirectoryStoreClient,
  siteIdValue: string,
): Promise<StoredMerchantCustomerDirectory | null> {
  const siteId = trimText(siteIdValue, 80);
  if (!siteId) return null;
  const rows = await queryDirectoryRows(supabase, siteId);
  return mergeStoredMerchantCustomerDirectoryRows(siteId, rows);
}

export async function saveStoredMerchantCustomerDirectory(
  supabase: MerchantCustomerDirectoryStoreClient,
  input: {
    siteId: string;
    customers: unknown;
    expectedUpdatedAt?: string | null;
    updatedAt?: string | null;
  },
): Promise<{ error: string | null; updatedAt: string | null }> {
  const siteId = trimText(input.siteId, 80);
  if (!siteId) return { error: "invalid_site_id", updatedAt: null };
  const rows = await queryDirectoryRows(supabase, siteId);
  const existingRow = selectLatestRow(rows);
  const existing = mergeStoredMerchantCustomerDirectoryRows(siteId, rows);
  const shouldCheckVersion = Object.prototype.hasOwnProperty.call(input, "expectedUpdatedAt");
  const expectedUpdatedAt = trimText(input.expectedUpdatedAt, 64);
  const currentUpdatedAt = trimText(existing?.updatedAt, 64);
  if (shouldCheckVersion && expectedUpdatedAt !== currentUpdatedAt) {
    return { error: "merchant_customer_directory_conflict", updatedAt: currentUpdatedAt || null };
  }

  const customers = normalizeStoredCustomers(siteId, input.customers);
  const updatedAt = trimText(input.updatedAt, 64) || new Date().toISOString();
  const history = await saveMerchantSnapshotHistory(supabase, {
    siteId,
    slug: buildDirectoryHistorySlug(siteId),
    backupSlug: buildDirectoryHistoryBackupSlug(siteId),
    source: "merchant-customer-directory",
    before: existing?.customers ?? null,
    after: customers,
    at: updatedAt,
  });
  if (history.error) {
    return {
      error: `merchant_customer_directory_history_save_failed:${history.error}`,
      updatedAt: currentUpdatedAt || null,
    };
  }

  const payload = {
    version: 1,
    siteId,
    customers,
    updatedAt,
  };
  const updateExisting = async (
    body: Record<string, unknown>,
    options: { useVersionColumn?: boolean } = {},
  ) => {
    if (existingRow?.id === undefined || existingRow?.id === null) {
      return { error: "missing_existing_id" };
    }
    let query = supabase.from("pages").update(body).eq("id", existingRow.id);
    if (options.useVersionColumn !== false && shouldCheckVersion && expectedUpdatedAt) {
      query = query.eq("updated_at", expectedUpdatedAt).select("id");
    }
    const result = await query;
    if (result.error) return { error: toErrorMessage(result.error) };
    if (
      options.useVersionColumn !== false &&
      shouldCheckVersion &&
      expectedUpdatedAt &&
      Array.isArray(result.data) &&
      result.data.length === 0
    ) {
      return { error: "merchant_customer_directory_conflict" };
    }
    return { error: null };
  };
  const insertNew = async (body: Record<string, unknown>) => {
    const inserted = await supabase.from("pages").insert({
      ...body,
      slug: buildDirectorySlug(siteId),
      merchant_id: siteId,
    });
    const error = inserted.error ? toErrorMessage(inserted.error) : null;
    if (!error || !isMissingMerchantIdColumn(error)) return { error };
    const retry = await supabase.from("pages").insert({
      ...body,
      slug: buildDirectorySlug(siteId),
    });
    return { error: retry.error ? toErrorMessage(retry.error) : null };
  };

  const body = { blocks: payload, updated_at: updatedAt };
  const first = existingRow ? await updateExisting(body) : await insertNew(body);
  if (!first.error) return { error: null, updatedAt };
  if (!isMissingUpdatedAtColumn(first.error)) {
    return { error: first.error, updatedAt: currentUpdatedAt || null };
  }
  const fallback = existingRow
    ? await updateExisting({ blocks: payload }, { useVersionColumn: false })
    : await insertNew({ blocks: payload });
  return {
    error: fallback.error,
    updatedAt: fallback.error ? currentUpdatedAt || null : updatedAt,
  };
}
