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
const adminDataParsedEnvelopes = new Map<
  string,
  { raw: string; envelope: CacheEnvelope<unknown> }
>();

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

function removeMerchantAdminDataCacheEntry(key: string) {
  adminDataParsedEnvelopes.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function readMerchantAdminDataCacheEnvelope<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === "undefined" || !key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      adminDataParsedEnvelopes.delete(key);
      return null;
    }
    if (raw.length > MAX_CACHE_PAYLOAD_CHARS) {
      removeMerchantAdminDataCacheEntry(key);
      return null;
    }
    const memoized = adminDataParsedEnvelopes.get(key);
    if (memoized?.raw === raw) {
      return memoized.envelope as CacheEnvelope<T>;
    }
    const parsed = JSON.parse(raw) as Partial<CacheEnvelope<T>> | null;
    if (!parsed || typeof parsed !== "object" || parsed.data === undefined) {
      removeMerchantAdminDataCacheEntry(key);
      return null;
    }
    const envelope = parsed as CacheEnvelope<T>;
    adminDataParsedEnvelopes.set(key, {
      raw,
      envelope: envelope as CacheEnvelope<unknown>,
    });
    return envelope;
  } catch {
    adminDataParsedEnvelopes.delete(key);
    return null;
  }
}

export function readMerchantAdminDataCache<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null {
  const envelope = readMerchantAdminDataCacheEnvelope<T>(key);
  if (!envelope) return null;
  const savedAt = Number(envelope.savedAt ?? 0);
  if (!Number.isFinite(savedAt) || savedAt <= 0 || Date.now() - savedAt > maxAgeMs) {
    removeMerchantAdminDataCacheEntry(key);
    return null;
  }
  return envelope.data ?? null;
}

export function readMerchantAdminDataCacheSnapshot<T>(
  key: string,
  freshAgeMs = MERCHANT_ADMIN_DATA_CACHE_TTL_MS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): MerchantAdminDataCacheSnapshot<T> | null {
  const envelope = readMerchantAdminDataCacheEnvelope<T>(key);
  if (!envelope) return null;
  const savedAt = Number(envelope.savedAt ?? 0);
  const ageMs = Date.now() - savedAt;
  if (!Number.isFinite(savedAt) || savedAt <= 0 || ageMs > maxAgeMs) {
    removeMerchantAdminDataCacheEntry(key);
    return null;
  }
  return {
    data: envelope.data,
    savedAt,
    fresh: ageMs <= freshAgeMs,
    version: typeof envelope.version === "string" && envelope.version.trim() ? envelope.version.trim() : null,
  };
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
    const envelope = {
      savedAt: Date.now(),
      data,
      version: typeof options.version === "string" && options.version.trim() ? options.version.trim() : null,
    } satisfies CacheEnvelope<T>;
    const payload = JSON.stringify(envelope);
    if (payload.length > MAX_CACHE_PAYLOAD_CHARS) {
      removeMerchantAdminDataCacheEntry(key);
      return;
    }
    window.localStorage.setItem(key, payload);
    adminDataParsedEnvelopes.set(key, {
      raw: payload,
      envelope: envelope as CacheEnvelope<unknown>,
    });
  } catch {
    // Ignore cache quota and private-mode failures.
  }
}

export function invalidateMerchantAdminDataCache(key: string) {
  adminDataInFlightRequests.delete(key);
  adminDataRequestSerials.set(key, (adminDataRequestSerials.get(key) ?? 0) + 1);
  adminDataParsedEnvelopes.delete(key);
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
  for (const key of adminDataParsedEnvelopes.keys()) {
    if (key.startsWith(prefix)) adminDataParsedEnvelopes.delete(key);
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
