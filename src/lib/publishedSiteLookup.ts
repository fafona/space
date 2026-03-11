import { normalizeDomainPrefix } from "@/lib/merchantIdentity";

export type ResolvedPublishedSite = {
  siteId: string;
  prefix: string;
};

export async function resolvePublishedSiteByPrefix(
  prefix: string,
  timeoutMs = 4500,
): Promise<ResolvedPublishedSite | null> {
  const normalizedPrefix = normalizeDomainPrefix(prefix);
  if (!normalizedPrefix) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(500, timeoutMs));

  try {
    const response = await fetch(`/api/site-resolve?prefix=${encodeURIComponent(normalizedPrefix)}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const data = (await response.json().catch(() => null)) as { siteId?: unknown } | null;
    const siteId = typeof data?.siteId === "string" ? data.siteId.trim() : "";
    if (!siteId) return null;

    return {
      siteId,
      prefix: normalizedPrefix,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
