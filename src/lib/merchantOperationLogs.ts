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
export const MAX_MERCHANT_OPERATION_LOGS = 3000;
export const MERCHANT_OPERATION_LOG_EVENT = "merchant-operation-log-recorded";

export function normalizeMerchantOperationLogText(value: unknown, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getStorageKey(siteId: string) {
  return `${MERCHANT_OPERATION_LOG_KEY_PREFIX}${siteId}`;
}

export function normalizeMerchantOperationLogEntry(value: unknown): MerchantOperationLogEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const siteId = normalizeMerchantOperationLogText(record.siteId, 80);
  const at = normalizeMerchantOperationLogText(record.at, 80);
  const moduleName = normalizeMerchantOperationLogText(record.module, 80);
  const action = normalizeMerchantOperationLogText(record.action, 80);
  const summary = normalizeMerchantOperationLogText(record.summary, 240);
  if (!siteId || !at || !moduleName || !action || !summary) return null;
  return {
    id: normalizeMerchantOperationLogText(record.id, 120) || `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    siteId,
    at,
    module: moduleName,
    action,
    summary,
    status: record.status === "failed" ? "failed" : "success",
    method: normalizeMerchantOperationLogText(record.method, 16) || undefined,
    endpoint: normalizeMerchantOperationLogText(record.endpoint, 160) || undefined,
    detail: normalizeMerchantOperationLogText(record.detail, 240) || undefined,
  };
}

export function shouldKeepMerchantOperationLog(entry: MerchantOperationLogEntry) {
  const isAutomaticBusinessCardShareImageLog =
    entry.endpoint === "/api/assets/upload" &&
    entry.module === "经营中心 > 名片夹" &&
    entry.action === "生成名片分享图";
  return (
    entry.endpoint !== "/api/merchant-chat-business-card" &&
    entry.endpoint !== "/api/merchant-peer-messages" &&
    entry.endpoint !== "/api/support-messages" &&
    entry.endpoint !== "/api/merchant-operation-logs" &&
    !isAutomaticBusinessCardShareImageLog &&
    entry.module !== "会话"
  );
}

export function readMerchantOperationLogs(siteId: string, limit = MAX_MERCHANT_OPERATION_LOGS): MerchantOperationLogEntry[] {
  const normalizedSiteId = normalizeMerchantOperationLogText(siteId, 80);
  if (!normalizedSiteId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(normalizedSiteId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeMerchantOperationLogEntry)
      .filter((item): item is MerchantOperationLogEntry => Boolean(item && shouldKeepMerchantOperationLog(item)))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function recordMerchantOperationLog(input: MerchantOperationLogInput) {
  const siteId = normalizeMerchantOperationLogText(input.siteId, 80);
  if (!siteId || typeof window === "undefined") return;
  const entry: MerchantOperationLogEntry = {
    id: `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    siteId,
    at: input.at || new Date().toISOString(),
    module: normalizeMerchantOperationLogText(input.module, 80) || "商户后台",
    action: normalizeMerchantOperationLogText(input.action, 80) || "未指定操作",
    summary: normalizeMerchantOperationLogText(input.summary, 240) || "商户后台执行了未指定操作",
    status: input.status === "failed" ? "failed" : "success",
    method: normalizeMerchantOperationLogText(input.method, 16) || undefined,
    endpoint: normalizeMerchantOperationLogText(input.endpoint, 160) || undefined,
    detail: normalizeMerchantOperationLogText(input.detail, 240) || undefined,
  };
  if (!shouldKeepMerchantOperationLog(entry)) return;
  try {
    const current = readMerchantOperationLogs(siteId, MAX_MERCHANT_OPERATION_LOGS);
    window.localStorage.setItem(getStorageKey(siteId), JSON.stringify([entry, ...current].slice(0, MAX_MERCHANT_OPERATION_LOGS)));
    window.dispatchEvent(new CustomEvent(MERCHANT_OPERATION_LOG_EVENT, { detail: entry }));
  } catch {
    // Operation logs should never block the actual merchant action.
  }
  fetch("/api/merchant-operation-logs", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(entry),
  }).catch(() => {
    // Server persistence is best-effort; the real merchant action already completed.
  });
}
