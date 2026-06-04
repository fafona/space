export type MerchantOperationLogStatus = "success" | "failed";

export type MerchantOperationLogEntry = {
  id: string;
  siteId: string;
  at: string;
  module: string;
  action: string;
  summary: string;
  status: MerchantOperationLogStatus;
  method?: string;
  endpoint?: string;
  detail?: string;
};

export type MerchantOperationLogInput = Omit<MerchantOperationLogEntry, "id" | "at"> & {
  at?: string;
};

const MERCHANT_OPERATION_LOG_KEY_PREFIX = "merchant-space:merchant-operation-logs:v1:";
const MAX_MERCHANT_OPERATION_LOGS = 3000;
export const MERCHANT_OPERATION_LOG_EVENT = "merchant-operation-log-recorded";

function normalizeText(value: unknown, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getStorageKey(siteId: string) {
  return `${MERCHANT_OPERATION_LOG_KEY_PREFIX}${siteId}`;
}

function normalizeLogEntry(value: unknown): MerchantOperationLogEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const siteId = normalizeText(record.siteId, 80);
  const at = normalizeText(record.at, 80);
  const moduleName = normalizeText(record.module, 80);
  const action = normalizeText(record.action, 80);
  const summary = normalizeText(record.summary, 240);
  if (!siteId || !at || !moduleName || !action || !summary) return null;
  return {
    id: normalizeText(record.id, 120) || `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    siteId,
    at,
    module: moduleName,
    action,
    summary,
    status: record.status === "failed" ? "failed" : "success",
    method: normalizeText(record.method, 16) || undefined,
    endpoint: normalizeText(record.endpoint, 160) || undefined,
    detail: normalizeText(record.detail, 240) || undefined,
  };
}

function isSystemSyncNoise(entry: MerchantOperationLogEntry) {
  return entry.endpoint === "/api/business-card-share" && entry.action === "保存名片";
}

function isChatOperationLog(entry: MerchantOperationLogEntry) {
  return (
    entry.endpoint === "/api/merchant-chat-business-card" ||
    entry.endpoint === "/api/merchant-peer-messages" ||
    entry.endpoint === "/api/support-messages" ||
    entry.module === "会话"
  );
}

export function readMerchantOperationLogs(siteId: string, limit = MAX_MERCHANT_OPERATION_LOGS): MerchantOperationLogEntry[] {
  const normalizedSiteId = normalizeText(siteId, 80);
  if (!normalizedSiteId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(normalizedSiteId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeLogEntry)
      .filter((item): item is MerchantOperationLogEntry => {
        if (!item) return false;
        return !isSystemSyncNoise(item) && !isChatOperationLog(item);
      })
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function recordMerchantOperationLog(input: MerchantOperationLogInput) {
  const siteId = normalizeText(input.siteId, 80);
  if (!siteId || typeof window === "undefined") return;
  const entry: MerchantOperationLogEntry = {
    id: `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    siteId,
    at: input.at || new Date().toISOString(),
    module: normalizeText(input.module, 80) || "后台",
    action: normalizeText(input.action, 80) || "操作",
    summary: normalizeText(input.summary, 240) || "商户后台操作",
    status: input.status === "failed" ? "failed" : "success",
    method: normalizeText(input.method, 16) || undefined,
    endpoint: normalizeText(input.endpoint, 160) || undefined,
    detail: normalizeText(input.detail, 240) || undefined,
  };
  if (isSystemSyncNoise(entry) || isChatOperationLog(entry)) return;
  try {
    const current = readMerchantOperationLogs(siteId, MAX_MERCHANT_OPERATION_LOGS);
    window.localStorage.setItem(getStorageKey(siteId), JSON.stringify([entry, ...current].slice(0, MAX_MERCHANT_OPERATION_LOGS)));
    window.dispatchEvent(new CustomEvent(MERCHANT_OPERATION_LOG_EVENT, { detail: entry }));
  } catch {
    // Operation logs should never block the actual merchant action.
  }
}
