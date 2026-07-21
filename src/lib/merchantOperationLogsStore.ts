import {
  filterMerchantOperationLogs,
  MAX_MERCHANT_OPERATION_LOGS,
  normalizeMerchantOperationLogEntry,
  shouldKeepMerchantOperationLog,
  type MerchantOperationLogEntry,
  type MerchantOperationLogStatus,
} from "@/lib/merchantOperationLogs";

const MERCHANT_OPERATION_LOGS_SLUG_PREFIX = "__merchant_operation_logs__:";

export type MerchantOperationLogsStoreClient = {
  // Supabase query builders are heavily generic; this store only relies on runtime chaining.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export type MerchantOperationLogQuery = {
  module?: string;
  status?: "all" | MerchantOperationLogStatus;
  startDate?: string;
  endDate?: string;
  startAt?: string;
  endAt?: string;
  offset?: number;
  limit?: number;
};

export type MerchantOperationLogQueryResult = {
  logs: MerchantOperationLogEntry[];
  total: number;
  allTotal: number;
  successCount: number;
  failedCount: number;
  modules: string[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type StoredMerchantOperationLogsRow = {
  id?: string | number | null;
  slug?: unknown;
  blocks?: unknown;
  updated_at?: unknown;
};

function normalizeText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

function throwOperationLogsStoreQueryError(error: unknown): never {
  throw new Error(`merchant_operation_logs_read_failed:${toErrorMessage(error)}`);
}

function buildOperationLogsSlug(siteId: string) {
  return `${MERCHANT_OPERATION_LOGS_SLUG_PREFIX}${siteId}`;
}

async function queryStoredOperationLogRows(supabase: MerchantOperationLogsStoreClient, siteId: string) {
  const normalizedSiteId = normalizeText(siteId, 80);
  if (!normalizedSiteId) return [] as StoredMerchantOperationLogsRow[];
  const slug = buildOperationLogsSlug(normalizedSiteId);

  const runQuery = async (includeMerchantId: boolean, includeUpdatedAt: boolean) => {
    const query = supabase
      .from("pages")
      .select(includeUpdatedAt ? "id,slug,blocks,updated_at" : "id,slug,blocks")
      .eq("slug", slug);
    return includeMerchantId ? query.eq("merchant_id", normalizedSiteId) : query;
  };

  let includeMerchantId = true;
  let includeUpdatedAt = true;
  let data: StoredMerchantOperationLogsRow[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await runQuery(includeMerchantId, includeUpdatedAt);
    data = (result.data ?? []) as StoredMerchantOperationLogsRow[];
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
    throwOperationLogsStoreQueryError(result.error);
  }

  if (data.length === 0 && includeMerchantId) {
    includeMerchantId = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await runQuery(includeMerchantId, includeUpdatedAt);
      data = (result.data ?? []) as StoredMerchantOperationLogsRow[];
      if (!result.error) break;
      const message = toErrorMessage(result.error);
      if (isMissingSlugColumn(message)) return [];
      if (includeUpdatedAt && isMissingUpdatedAtColumn(message)) {
        includeUpdatedAt = false;
        continue;
      }
      throwOperationLogsStoreQueryError(result.error);
    }
  }

  return Array.isArray(data) ? data : [];
}

function normalizeStoredLogs(siteId: string, value: unknown) {
  const normalizedSiteId = normalizeText(siteId, 80);
  const source = Array.isArray(value)
    ? value
    : Array.isArray((value as { logs?: unknown } | null | undefined)?.logs)
      ? (value as { logs: unknown[] }).logs
      : [];
  const logs = source
    .map(normalizeMerchantOperationLogEntry)
    .filter((item): item is MerchantOperationLogEntry => {
      return Boolean(item && item.siteId === normalizedSiteId && shouldKeepMerchantOperationLog(item));
    });
  return filterMerchantOperationLogs(logs);
}

export function mergeStoredMerchantOperationLogRows(siteId: string, rows: StoredMerchantOperationLogsRow[]) {
  const normalizedSiteId = normalizeText(siteId, 80);
  if (!normalizedSiteId || !Array.isArray(rows) || rows.length === 0) {
    return { logs: [] as MerchantOperationLogEntry[], existingRowId: null as string | number | null };
  }
  const slug = buildOperationLogsSlug(normalizedSiteId);
  const matchedRows = rows.filter((row) => normalizeText(row.slug) === slug || !normalizeText(row.slug));
  const logs = filterMerchantOperationLogs(
    matchedRows.flatMap((row) => normalizeStoredLogs(normalizedSiteId, row.blocks)),
  ).filter((item) => item.siteId === normalizedSiteId);
  return {
    logs: logs.slice(0, MAX_MERCHANT_OPERATION_LOGS),
    existingRowId: matchedRows.find((row) => row.id !== undefined && row.id !== null)?.id ?? null,
  };
}

export async function loadStoredMerchantOperationLogs(
  supabase: MerchantOperationLogsStoreClient,
  siteId: string,
): Promise<MerchantOperationLogEntry[]> {
  const normalizedSiteId = normalizeText(siteId, 80);
  if (!normalizedSiteId) return [];
  const rows = await queryStoredOperationLogRows(supabase, normalizedSiteId);
  return mergeStoredMerchantOperationLogRows(normalizedSiteId, rows).logs;
}

export async function saveStoredMerchantOperationLogs(
  supabase: MerchantOperationLogsStoreClient,
  input: {
    siteId: string;
    logs: MerchantOperationLogEntry[];
    updatedAt?: string | null;
  },
): Promise<{ error: string | null }> {
  const normalizedSiteId = normalizeText(input.siteId, 80);
  if (!normalizedSiteId) return { error: "invalid_site_id" };
  const slug = buildOperationLogsSlug(normalizedSiteId);
  const rows = await queryStoredOperationLogRows(supabase, normalizedSiteId);
  const merged = mergeStoredMerchantOperationLogRows(normalizedSiteId, rows);
  const logs = filterMerchantOperationLogs([...input.logs, ...merged.logs])
    .filter((item) => item.siteId === normalizedSiteId)
    .slice(0, MAX_MERCHANT_OPERATION_LOGS);
  const requestedUpdatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const latestLogAt = logs[0]?.at ?? "";
  const updatedAt =
    Number.isFinite(Date.parse(latestLogAt)) && Date.parse(latestLogAt) > Date.parse(requestedUpdatedAt)
      ? latestLogAt
      : requestedUpdatedAt;
  const existingRowId = merged.existingRowId;

  const updateExisting = async (body: Record<string, unknown>) => {
    if (existingRowId === undefined || existingRowId === null) return { error: "missing_existing_id" };
    const updated = await supabase.from("pages").update(body).eq("id", existingRowId);
    return updated.error ? { error: toErrorMessage(updated.error) } : { error: null };
  };

  const insertNew = async (body: Record<string, unknown>) => {
    const inserted = await supabase.from("pages").insert({
      ...body,
      slug,
      merchant_id: normalizedSiteId,
    });
    const error = inserted.error ? toErrorMessage(inserted.error) : null;
    if (!error || !isMissingMerchantIdColumn(error)) return { error };
    const retry = await supabase.from("pages").insert({
      ...body,
      slug,
    });
    return retry.error ? { error: toErrorMessage(retry.error) } : { error: null };
  };

  const basePayload = {
    blocks: { logs },
    updated_at: updatedAt,
  };
  const first = existingRowId !== null ? await updateExisting(basePayload) : await insertNew(basePayload);
  if (!first.error) return first;
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return existingRowId !== null ? updateExisting({ blocks: { logs } }) : insertNew({ blocks: { logs } });
}

const merchantOperationLogMutationTails = new Map<string, Promise<void>>();

async function withMerchantOperationLogMutationLock<T>(siteId: string, task: () => Promise<T>) {
  const previous = merchantOperationLogMutationTails.get(siteId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  merchantOperationLogMutationTails.set(siteId, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (merchantOperationLogMutationTails.get(siteId) === tail) merchantOperationLogMutationTails.delete(siteId);
  }
}

export async function appendStoredMerchantOperationLog(
  supabase: MerchantOperationLogsStoreClient,
  entry: MerchantOperationLogEntry,
) {
  const normalized = normalizeMerchantOperationLogEntry(entry);
  if (!normalized || !shouldKeepMerchantOperationLog(normalized)) return { error: "invalid_operation_log" };
  return withMerchantOperationLogMutationLock(normalized.siteId, () =>
    saveStoredMerchantOperationLogs(supabase, {
      siteId: normalized.siteId,
      logs: [normalized],
      updatedAt: normalized.at,
    }),
  );
}

export function parseMerchantOperationLogBoundary(value: string | undefined, boundary: "start" | "end") {
  const normalized = normalizeText(value, 64);
  if (!normalized) return null;
  const dateOnly = normalized.replace(/[./]/g, "-");
  const match = dateOnly.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      return null;
    }
    return boundary === "start"
      ? Date.UTC(year, month - 1, day, 0, 0, 0, 0)
      : Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function queryMerchantOperationLogs(
  logs: MerchantOperationLogEntry[],
  query: MerchantOperationLogQuery = {},
): MerchantOperationLogQueryResult {
  const moduleName = normalizeText(query.module, 80);
  const status = query.status === "success" || query.status === "failed" ? query.status : "all";
  const startAt = parseMerchantOperationLogBoundary(query.startAt || query.startDate, "start");
  const endAt = parseMerchantOperationLogBoundary(query.endAt || query.endDate, "end");
  const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
  const limit = Math.min(MAX_MERCHANT_OPERATION_LOGS, Math.max(1, Math.floor(Number(query.limit) || 100)));
  const normalizedLogs = filterMerchantOperationLogs(logs);
  const modules = Array.from(new Set(normalizedLogs.map((item) => item.module).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
  const filtered = filterMerchantOperationLogs(normalizedLogs, {
    module: moduleName,
    status,
    startAt,
    endAt,
  });
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  return {
    logs: page,
    total,
    allTotal: normalizedLogs.length,
    successCount: filtered.filter((item) => item.status === "success").length,
    failedCount: filtered.filter((item) => item.status === "failed").length,
    modules,
    offset,
    limit,
    hasMore: offset + page.length < total,
  };
}
