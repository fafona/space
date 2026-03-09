export function buildSiteStoreScope(siteId: string) {
  return `site-${siteId}`;
}

export const PLATFORM_HOME_PATH = "/portal";
export const PLATFORM_EDITOR_SCOPE = "portal";

export function buildSiteHref(siteId: string) {
  return `/site/${encodeURIComponent(siteId)}`;
}

const RESERVED_PLATFORM_SUBDOMAINS = new Set(["www", "main", "portal"]);

function normalizeDomainPrefix(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

function normalizeHost(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/g, "")
    .split("/")[0]
    ?.trim()
    .toLowerCase() ?? "";
}

function splitHostAndPort(host: string) {
  const normalized = normalizeHost(host);
  if (!normalized) return { hostname: "", port: "" };
  if (normalized.startsWith("[") && normalized.includes("]")) {
    const end = normalized.indexOf("]");
    const hostname = normalized.slice(0, end + 1);
    const rest = normalized.slice(end + 1);
    return { hostname, port: rest.startsWith(":") ? rest.slice(1) : "" };
  }
  const parts = normalized.split(":");
  if (parts.length <= 2) {
    return { hostname: parts[0] ?? "", port: parts[1] ?? "" };
  }
  return { hostname: normalized, port: "" };
}

function isLocalDevelopmentHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

function isIpv4Hostname(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

export function resolveMerchantRootHost(baseDomain?: string | null) {
  const { hostname, port } = splitHostAndPort(baseDomain ?? "");
  if (!hostname || isLocalDevelopmentHostname(hostname) || isIpv4Hostname(hostname)) return "";
  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) return port ? `${hostname}:${port}` : hostname;
  const rootLabels = RESERVED_PLATFORM_SUBDOMAINS.has(labels[0] ?? "") && labels.length > 2 ? labels.slice(1) : labels;
  const rootHost = rootLabels.join(".");
  return port ? `${rootHost}:${port}` : rootHost;
}

export function buildMerchantDomain(baseDomain: string | null | undefined, domainPrefix?: string | null, protocol?: string | null) {
  const prefix = normalizeDomainPrefix(domainPrefix);
  if (!prefix) return "";
  const rootHost = resolveMerchantRootHost(baseDomain);
  if (!rootHost) return "";
  const { hostname, port } = splitHostAndPort(rootHost);
  const resolvedProtocol =
    String(protocol ?? "").trim() ||
    (typeof window !== "undefined" ? window.location.protocol.replace(/:$/, "") : "https");
  return `${resolvedProtocol}://${prefix}.${hostname}${port ? `:${port}` : ""}`;
}

export function extractMerchantPrefixFromHost(currentHost: string | null | undefined, baseDomain?: string | null) {
  const { hostname } = splitHostAndPort(currentHost ?? "");
  const { hostname: rootHostname } = splitHostAndPort(resolveMerchantRootHost(baseDomain));
  if (!hostname || !rootHostname || hostname === rootHostname) return "";
  if (!hostname.endsWith(`.${rootHostname}`)) return "";
  const prefix = hostname.slice(0, -(rootHostname.length + 1)).trim().toLowerCase();
  if (!prefix || prefix.includes(".") || RESERVED_PLATFORM_SUBDOMAINS.has(prefix)) return "";
  return normalizeDomainPrefix(prefix);
}

export function buildMerchantFrontendHref(siteId: string, domainPrefix?: string | null, baseDomain?: string | null) {
  const prefix = normalizeDomainPrefix(domainPrefix);
  if (prefix) {
    const resolvedBase =
      baseDomain ??
      process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN ??
      (typeof window !== "undefined" ? window.location.host : "");
    const subdomainHref = buildMerchantDomain(resolvedBase, prefix);
    if (subdomainHref) return subdomainHref;
    return `/${encodeURIComponent(prefix)}`;
  }
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
