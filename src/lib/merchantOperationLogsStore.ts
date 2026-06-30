import {
  MAX_MERCHANT_OPERATION_LOGS,
  normalizeMerchantOperationLogEntry,
  shouldKeepMerchantOperationLog,
  type MerchantOperationLogEntry,
  type MerchantOperationLogStatus,
} from "@/lib/merchantOperationLogs";
import { saveMerchantSnapshotHistory } from "@/lib/merchantSnapshotHistoryStore";

const MERCHANT_OPERATION_LOGS_SLUG_PREFIX = "__merchant_operation_logs__:";
const MERCHANT_OPERATION_LOGS_HISTORY_SLUG_PREFIX = "__merchant_operation_logs_history__:";
const MERCHANT_OPERATION_LOGS_HISTORY_BACKUP_SLUG_PREFIX = "__merchant_operation_logs_history_backup__:";

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

type StoredMerchantOperationLogsRow = {
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

function buildOperationLogsSlug(siteId: string) {
  return `${MERCHANT_OPERATION_LOGS_SLUG_PREFIX}${siteId}`;
}

function buildOperationLogsHistorySlug(siteId: string) {
  return `${MERCHANT_OPERATION_LOGS_HISTORY_SLUG_PREFIX}${siteId}`;
}

function buildOperationLogsHistoryBackupSlug(siteId: string) {
  return `${MERCHANT_OPERATION_LOGS_HISTORY_BACKUP_SLUG_PREFIX}${siteId}`;
}

async function queryStoredOperationLogRows(supabase: MerchantOperationLogsStoreClient, siteId: string) {
  const normalizedSiteId = normalizeText(siteId, 80);
  if (!normalizedSiteId) return [] as StoredMerchantOperationLogsRow[];
  const slug = buildOperationLogsSlug(normalizedSiteId);

  const initial = await supabase
    .from("pages")
    .select("id,slug,blocks,updated_at")
    .eq("merchant_id", normalizedSiteId)
    .eq("slug", slug);

  let data = (initial.data ?? []) as StoredMerchantOperationLogsRow[];
  let error = initial.error;

  if (error) {
    const message = toErrorMessage(error);
    if (isMissingMerchantIdColumn(message)) {
      const retry = await supabase.from("pages").select("id,slug,blocks,updated_at").eq("slug", slug);
      data = (retry.data ?? []) as StoredMerchantOperationLogsRow[];
      error = retry.error;
    } else if (isMissingSlugColumn(message)) {
      return [];
    } else if (isMissingUpdatedAtColumn(message)) {
      const retry = await supabase
        .from("pages")
        .select("id,slug,blocks")
        .eq("merchant_id", normalizedSiteId)
        .eq("slug", slug);
      data = (retry.data ?? []) as StoredMerchantOperationLogsRow[];
      error = retry.error;
    }
  }

  if (!error && data.length === 0) {
    const retry = await supabase.from("pages").select("id,slug,blocks,updated_at").eq("slug", slug);
    data = (retry.data ?? []) as StoredMerchantOperationLogsRow[];
    error = retry.error;
    if (error && isMissingUpdatedAtColumn(toErrorMessage(error))) {
      const retryWithoutUpdatedAt = await supabase.from("pages").select("id,slug,blocks").eq("slug", slug);
      data = (retryWithoutUpdatedAt.data ?? []) as StoredMerchantOperationLogsRow[];
      error = retryWithoutUpdatedAt.error;
    }
  }

  if (error) return [];
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
  const map = new Map<string, MerchantOperationLogEntry>();
  logs.forEach((item) => {
    const existing = map.get(item.id);
    if (!existing || Date.parse(item.at) >= Date.parse(existing.at)) {
      map.set(item.id, item);
    }
  });
  return Array.from(map.values()).sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

export async function loadStoredMerchantOperationLogs(
  supabase: MerchantOperationLogsStoreClient,
  siteId: string,
): Promise<MerchantOperationLogEntry[]> {
  const normalizedSiteId = normalizeText(siteId, 80);
  if (!normalizedSiteId) return [];
  const rows = await queryStoredOperationLogRows(supabase, normalizedSiteId);
  const slug = buildOperationLogsSlug(normalizedSiteId);
  const row = rows.find((item) => normalizeText(item.slug) === slug) ?? rows[0];
  return row ? normalizeStoredLogs(normalizedSiteId, row.blocks) : [];
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
  const logs = normalizeStoredLogs(normalizedSiteId, input.logs).slice(0, MAX_MERCHANT_OPERATION_LOGS);
  const updatedAt = normalizeText(input.updatedAt) || new Date().toISOString();
  const beforeLogs = await loadStoredMerchantOperationLogs(supabase, normalizedSiteId);
  const history = await saveMerchantSnapshotHistory(supabase, {
    siteId: normalizedSiteId,
    slug: buildOperationLogsHistorySlug(normalizedSiteId),
    backupSlug: buildOperationLogsHistoryBackupSlug(normalizedSiteId),
    source: "merchant-operation-logs",
    before: beforeLogs,
    after: logs,
    at: updatedAt,
    maxEntries: 10,
  });
  if (history.error) return { error: `merchant_operation_logs_history_save_failed:${history.error}` };
  const existing = (await queryStoredOperationLogRows(supabase, normalizedSiteId))[0];

  const updateExisting = async (body: Record<string, unknown>) => {
    if (existing?.id === undefined || existing?.id === null) return { error: "missing_existing_id" };
    const updated = await supabase.from("pages").update(body).eq("id", existing.id);
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
  const first = existing ? await updateExisting(basePayload) : await insertNew(basePayload);
  if (!first.error) return first;
  if (!isMissingUpdatedAtColumn(first.error)) return first;
  return existing ? updateExisting({ blocks: { logs } }) : insertNew({ blocks: { logs } });
}

function readDateBoundary(value: string | undefined, boundary: "start" | "end") {
  const normalized = normalizeText(value, 32).replace(/[./]/g, "-");
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date =
    boundary === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

export function queryMerchantOperationLogs(
  logs: MerchantOperationLogEntry[],
  query: MerchantOperationLogQuery = {},
): MerchantOperationLogQueryResult {
  const moduleName = normalizeText(query.module, 80);
  const status = query.status === "success" || query.status === "failed" ? query.status : "all";
  const startAt = readDateBoundary(query.startDate, "start");
  const endAt = readDateBoundary(query.endDate, "end");
  const offset = Math.max(0, Math.floor(Number(query.offset) || 0));
  const limit = Math.min(MAX_MERCHANT_OPERATION_LOGS, Math.max(1, Math.floor(Number(query.limit) || 100)));
  const normalizedLogs = logs.filter(shouldKeepMerchantOperationLog);
  const modules = Array.from(new Set(normalizedLogs.map((item) => item.module).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
  const filtered = normalizedLogs.filter((item) => {
    if (moduleName && moduleName !== "all" && item.module !== moduleName) return false;
    if (status !== "all" && item.status !== status) return false;
    const itemTime = Date.parse(item.at);
    if (Number.isFinite(itemTime)) {
      if (startAt !== null && itemTime < startAt) return false;
      if (endAt !== null && itemTime > endAt) return false;
    }
    return true;
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
