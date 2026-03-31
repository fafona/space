import type { SiteStatus } from "@/data/platformControlStore";

export const OFFICIAL_SERVICE_CONTACT = {
  serviceProviderUrl: "https://www.faolla.com",
  contactName: "Felix",
  whatsapp: "+34633130577",
  wechat: "KD66769",
  email: "fafona.felix@gmail.com",
} as const;

export type MerchantServiceRestrictionReason = "expired" | "paused" | null;

function normalizeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

export function normalizeSiteStatus(value: string | null | undefined): SiteStatus {
  const normalized = normalizeText(value);
  if (normalized === "maintenance" || normalized === "offline") return normalized;
  return "online";
}

export function normalizeServiceExpiresAt(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function isMerchantServiceExpired(serviceExpiresAt: string | null | undefined, nowMs = Date.now()) {
  const normalized = normalizeServiceExpiresAt(serviceExpiresAt);
  if (!normalized) return true;
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return timestamp <= nowMs;
}

export function getMerchantServiceState(
  status: string | null | undefined,
  serviceExpiresAt: string | null | undefined,
  nowMs = Date.now(),
) {
  const normalizedStatus = normalizeSiteStatus(status);
  const normalizedExpiresAt = normalizeServiceExpiresAt(serviceExpiresAt);
  const expired = isMerchantServiceExpired(normalizedExpiresAt, nowMs);
  const manuallyPaused = normalizedStatus !== "online";
  const maintenance = expired || manuallyPaused;
  const reason: MerchantServiceRestrictionReason = expired ? "expired" : manuallyPaused ? "paused" : null;
  return {
    status: normalizedStatus,
    serviceExpiresAt: normalizedExpiresAt,
    expired,
    manuallyPaused,
    maintenance,
    reason,
  };
}

export function describeMerchantServiceRestriction(reason: MerchantServiceRestrictionReason) {
  if (reason === "expired") return "商户服务已到期或未设置到期时间";
  if (reason === "paused") return "商户服务已暂停";
  return "商户服务不可用";
}

export function describeMerchantMaintenanceMessage(reason: MerchantServiceRestrictionReason) {
  if (reason === "expired") {
    return "该商户服务已到期，或尚未设置到期时间，当前已自动暂停。";
  }
  return "该商户服务当前处于维护状态，暂不对外开放。";
}
