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

export type MerchantOperationLogFilter = {
  module?: string;
  status?: "all" | MerchantOperationLogStatus;
  startAt?: number | null;
  endAt?: number | null;
};

export function normalizeMerchantOperationLogText(value: unknown, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function buildLegacyMerchantOperationLogId(parts: string[]) {
  let hash = 2166136261;
  const source = parts.join("\u001f");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `op-legacy-${(hash >>> 0).toString(36)}`;
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
  const atTime = Date.parse(at);
  if (!siteId || !Number.isFinite(atTime) || !moduleName || !action || !summary) return null;
  const normalizedAt = new Date(atTime).toISOString();
  return {
    id:
      normalizeMerchantOperationLogText(record.id, 120) ||
      buildLegacyMerchantOperationLogId([siteId, normalizedAt, moduleName, action, summary]),
    siteId,
    at: normalizedAt,
    module: moduleName,
    action,
    summary,
    status: record.status === "failed" ? "failed" : "success",
    method: normalizeMerchantOperationLogText(record.method, 16).toUpperCase() || undefined,
    endpoint: normalizeMerchantOperationLogText(record.endpoint, 160) || undefined,
    detail: normalizeMerchantOperationLogText(record.detail, 240) || undefined,
  };
}

export function filterMerchantOperationLogs(
  logs: MerchantOperationLogEntry[],
  filter: MerchantOperationLogFilter = {},
) {
  const moduleName = normalizeMerchantOperationLogText(filter.module, 80);
  const status = filter.status === "success" || filter.status === "failed" ? filter.status : "all";
  const startAt = Number.isFinite(filter.startAt) ? Number(filter.startAt) : null;
  const endAt = Number.isFinite(filter.endAt) ? Number(filter.endAt) : null;
  const deduped = new Map<string, MerchantOperationLogEntry>();

  logs.forEach((value) => {
    const item = normalizeMerchantOperationLogEntry(value);
    if (!item || !shouldKeepMerchantOperationLog(item)) return;
    const key = `${item.siteId}:${item.id}`;
    const existing = deduped.get(key);
    if (!existing || Date.parse(item.at) >= Date.parse(existing.at)) deduped.set(key, item);
  });

  return Array.from(deduped.values())
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || right.id.localeCompare(left.id, "en"))
    .filter((item) => {
      if (moduleName && moduleName !== "all" && item.module !== moduleName) return false;
      if (status !== "all" && item.status !== status) return false;
      const itemTime = Date.parse(item.at);
      if (startAt !== null && itemTime < startAt) return false;
      if (endAt !== null && itemTime > endAt) return false;
      return true;
    });
}

function merchantOperationLogCsvCell(value: unknown) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function buildMerchantOperationLogsCsv(logs: MerchantOperationLogEntry[]) {
  const rows = [
    ["时间", "状态", "菜单", "操作", "说明", "详情", "方法", "接口"],
    ...filterMerchantOperationLogs(logs).map((item) => [
      item.at,
      item.status === "success" ? "成功" : "失败",
      item.module,
      item.action,
      item.summary,
      item.detail ?? "",
      item.method ?? "",
      item.endpoint ?? "",
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(merchantOperationLogCsvCell).join(",")).join("\r\n")}`;
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
    at: Number.isFinite(Date.parse(input.at || "")) ? new Date(Date.parse(input.at || "")).toISOString() : new Date().toISOString(),
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
  } catch {
    // Operation logs should never block the actual merchant action.
  }

  void (async () => {
    const retryDelays = [0, 700, 2000];
    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      if (retryDelays[attempt]) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, retryDelays[attempt]));
      }
      try {
        const response = await fetch("/api/merchant-operation-logs", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(entry),
        });
        if (response.ok) {
          window.dispatchEvent(new CustomEvent(MERCHANT_OPERATION_LOG_EVENT, { detail: entry }));
          return;
        }
        if (response.status < 500 && response.status !== 408 && response.status !== 429) return;
      } catch {
        // Retry transient network failures without affecting the merchant action.
      }
    }
  })();
}
