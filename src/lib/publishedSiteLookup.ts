import { normalizeDomainPrefix } from "@/lib/merchantIdentity";

export type ResolvedPublishedSite = {
  siteId: string;
  prefix: string;
};

const PUBLISHED_SITE_LOOKUP_CACHE_TTL_MS = 60_000;
const PUBLISHED_SITE_LOOKUP_MISS_CACHE_TTL_MS = 5_000;

const publishedSiteLookupCache = new Map<
  string,
  {
    expiresAt: number;
    pending?: Promise<ResolvedPublishedSite | null>;
    value?: ResolvedPublishedSite | null;
  }
>();

export function __clearPublishedSiteLookupCacheForTests() {
  publishedSiteLookupCache.clear();
}

function readPublishedSiteLookupCache(prefix: string) {
  const cached = publishedSiteLookupCache.get(prefix);
  if (!cached || cached.expiresAt <= Date.now()) {
    if (cached) publishedSiteLookupCache.delete(prefix);
    return null;
  }
  return cached;
}

function writePublishedSiteLookupCache(prefix: string, value: ResolvedPublishedSite | null) {
  publishedSiteLookupCache.set(prefix, {
    expiresAt: Date.now() + (value ? PUBLISHED_SITE_LOOKUP_CACHE_TTL_MS : PUBLISHED_SITE_LOOKUP_MISS_CACHE_TTL_MS),
    value,
  });
}

export async function resolvePublishedSiteByPrefix(
  prefix: string,
  timeoutMs = 1800,
): Promise<ResolvedPublishedSite | null> {
  const normalizedPrefix = normalizeDomainPrefix(prefix);
  if (!normalizedPrefix) return null;

  const cached = readPublishedSiteLookupCache(normalizedPrefix);
  if (cached?.pending) return cached.pending;
  if ("value" in (cached ?? {})) return cached?.value ?? null;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(500, timeoutMs));

  const pending = (async () => {
    const response = await fetch(`/api/site-resolve?prefix=${encodeURIComponent(normalizedPrefix)}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;

    const data = (await response.json().catch(() => null)) as { siteId?: unknown } | null;
    const siteId = typeof data?.siteId === "string" ? data.siteId.trim() : "";
    if (!siteId) return null;

    return {
      siteId,
      prefix: normalizedPrefix,
    };
  })();

  publishedSiteLookupCache.set(normalizedPrefix, {
    expiresAt: Date.now() + Math.max(500, timeoutMs),
    pending,
  });

  try {
    const resolved = await pending;
    writePublishedSiteLookupCache(normalizedPrefix, resolved);
    return resolved;
  } catch {
    publishedSiteLookupCache.delete(normalizedPrefix);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
