"use client";

const CACHE_PREFIX = "faolla:merchant-admin-data-cache:v1";
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type CacheEnvelope<T> = {
  savedAt: number;
  data: T;
};

function normalizeCachePart(value: string) {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export function buildMerchantAdminDataCacheKey(kind: string, siteId: string) {
  return `${CACHE_PREFIX}:${normalizeCachePart(kind)}:${normalizeCachePart(siteId)}`;
}

export function readMerchantAdminDataCache<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null {
  if (typeof window === "undefined" || !key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>> | null;
    const savedAt = Number(parsed?.savedAt ?? 0);
    if (!Number.isFinite(savedAt) || savedAt <= 0 || Date.now() - savedAt > maxAgeMs) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

export function writeMerchantAdminDataCache<T>(key: string, data: T) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        data,
      } satisfies CacheEnvelope<T>),
    );
  } catch {
    // Ignore cache quota and private-mode failures.
  }
}
