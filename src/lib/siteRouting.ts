export function buildSiteStoreScope(siteId: string) {
  return `site-${siteId}`;
}

export const PLATFORM_HOME_PATH = "/portal";
export const PLATFORM_EDITOR_SCOPE = "portal";

export function buildSiteHref(siteId: string) {
  return `/site/${encodeURIComponent(siteId)}`;
}

function normalizeDomainSuffix(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

export function buildMerchantFrontendHref(siteId: string, domainSuffix?: string | null) {
  const suffix = normalizeDomainSuffix(domainSuffix);
  if (suffix) return `/${encodeURIComponent(suffix)}`;
  return buildSiteHref(siteId);
}

export function buildMerchantBackendHref(merchantId: string) {
  const normalized = String(merchantId ?? "").trim();
  if (!normalized) return "/admin";
  return `/${encodeURIComponent(normalized)}`;
}

export function buildIndustryHref(slug: string) {
  return `/industry/${encodeURIComponent(slug)}`;
}

export function buildPlatformHomeHref() {
  return PLATFORM_HOME_PATH;
}
