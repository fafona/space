"use client";

const CACHE_PREFIX = "faolla:merchant-admin-data-cache:v1";
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_PAYLOAD_CHARS = 1_500_000;

export const MERCHANT_ADMIN_DATA_CACHE_TTL_MS = 2 * 60 * 1000;

type CacheEnvelope<T> = {
  savedAt: number;
  data: T;
  version?: string | null;
};

export type MerchantAdminDataCacheSnapshot<T> = {
  data: T;
  savedAt: number;
  fresh: boolean;
  version: string | null;
};

const adminDataInFlightRequests = new Map<string, Promise<unknown>>();
const adminDataRequestSerials = new Map<string, number>();

function normalizeCachePart(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

export function buildMerchantAdminDataCacheKey(kind: string, siteId: string) {
  return `${CACHE_PREFIX}:${normalizeCachePart(kind)}:${normalizeCachePart(siteId)}`;
}

export function makeMerchantAdminDataCacheKey(...parts: Array<string | number | boolean | null | undefined>) {
  return `${CACHE_PREFIX}:${parts.map((part) => normalizeCachePart(String(part ?? ""))).join(":")}`;
}

export function readMerchantAdminDataCache<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null {
  if (typeof window === "undefined" || !key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    if (raw.length > MAX_CACHE_PAYLOAD_CHARS) {
      window.localStorage.removeItem(key);
      return null;
    }
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

export function readMerchantAdminDataCacheSnapshot<T>(
  key: string,
  freshAgeMs = MERCHANT_ADMIN_DATA_CACHE_TTL_MS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): MerchantAdminDataCacheSnapshot<T> | null {
  if (typeof window === "undefined" || !key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    if (raw.length > MAX_CACHE_PAYLOAD_CHARS) {
      window.localStorage.removeItem(key);
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>> | null;
    const savedAt = Number(parsed?.savedAt ?? 0);
    const ageMs = Date.now() - savedAt;
    if (!Number.isFinite(savedAt) || savedAt <= 0 || ageMs > maxAgeMs || parsed?.data === undefined) {
      window.localStorage.removeItem(key);
      return null;
    }
    return {
      data: parsed.data,
      savedAt,
      fresh: ageMs <= freshAgeMs,
      version: typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null,
    };
  } catch {
    return null;
  }
}

export function readLatestMerchantAdminDataCacheSnapshot<T>(
  keys: string[],
  freshAgeMs = MERCHANT_ADMIN_DATA_CACHE_TTL_MS,
): MerchantAdminDataCacheSnapshot<T> | null {
  let latestSnapshot: MerchantAdminDataCacheSnapshot<T> | null = null;
  for (const key of keys) {
    const snapshot = readMerchantAdminDataCacheSnapshot<T>(key, freshAgeMs);
    if (snapshot && (!latestSnapshot || snapshot.savedAt > latestSnapshot.savedAt)) {
      latestSnapshot = snapshot;
    }
  }
  return latestSnapshot;
}

export function writeMerchantAdminDataCache<T>(key: string, data: T, options: { version?: string | null } = {}) {
  if (typeof window === "undefined" || !key) return;
  try {
    const payload = JSON.stringify({
      savedAt: Date.now(),
      data,
      version: typeof options.version === "string" && options.version.trim() ? options.version.trim() : null,
    } satisfies CacheEnvelope<T>);
    if (payload.length > MAX_CACHE_PAYLOAD_CHARS) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, payload);
  } catch {
    // Ignore cache quota and private-mode failures.
  }
}

export function invalidateMerchantAdminDataCache(key: string) {
  adminDataInFlightRequests.delete(key);
  adminDataRequestSerials.set(key, (adminDataRequestSerials.get(key) ?? 0) + 1);
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

export function invalidateMerchantAdminDataCachePrefix(prefix: string) {
  for (const key of adminDataInFlightRequests.keys()) {
    if (key.startsWith(prefix)) {
      adminDataInFlightRequests.delete(key);
      adminDataRequestSerials.set(key, (adminDataRequestSerials.get(key) ?? 0) + 1);
    }
  }
  if (typeof window === "undefined" || !prefix) return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}

export async function fetchMerchantAdminDataWithCache<T>(
  key: string,
  loader: () => Promise<T>,
  options: {
    force?: boolean;
    ttlMs?: number;
    allowStaleOnError?: boolean;
    dedupe?: boolean;
    cacheVersion?: string | null | ((value: T) => string | null | undefined);
  } = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? MERCHANT_ADMIN_DATA_CACHE_TTL_MS;
  const inFlight = adminDataInFlightRequests.get(key) as Promise<T> | undefined;
  if ((options.dedupe || !options.force) && inFlight) return inFlight;
  if (!options.force) {
    const cached = readMerchantAdminDataCache<T>(key, ttlMs);
    if (cached !== null) return cached;
  }

  const stale = options.allowStaleOnError ? readMerchantAdminDataCache<T>(key, Number.MAX_SAFE_INTEGER) : null;
  const requestSerial = (adminDataRequestSerials.get(key) ?? 0) + 1;
  adminDataRequestSerials.set(key, requestSerial);
  const promise = loader()
    .then((value) => {
      if (adminDataRequestSerials.get(key) === requestSerial) {
        const version =
          typeof options.cacheVersion === "function" ? options.cacheVersion(value) : options.cacheVersion;
        writeMerchantAdminDataCache(key, value, { version });
      }
      return value;
    })
    .catch((error) => {
      if (options.allowStaleOnError && stale !== null) return stale;
      throw error;
    })
    .finally(() => {
      if (adminDataInFlightRequests.get(key) === promise) {
        adminDataInFlightRequests.delete(key);
      }
    });
  adminDataInFlightRequests.set(key, promise);
  return promise;
}
