function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHostname(value: string | null | undefined) {
  return trimText(value).toLowerCase().replace(/^\.+/, "");
}

function resolveBaseDomain(hostname: string | null | undefined) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return "";
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length >= 3 && labels[0] === "www") {
    return labels.slice(-2).join(".");
  }
  if (labels.length >= 2) {
    return labels.slice(-2).join(".");
  }
  return normalized;
}

export function isLocalLikeHostname(value: string | null | undefined) {
  const hostname = trimText(value).toLowerCase();
  return (
    !hostname ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

export function normalizeOrigin(value: string | null | undefined, fallbackProtocol = "https") {
  const trimmed = trimText(value);
  if (!trimmed) return "";
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${fallbackProtocol}://${trimmed}`;
    const url = new URL(candidate);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function readFirstHeaderValue(value: string | null | undefined) {
  return trimText(value).split(",")[0]?.trim() ?? "";
}

function readHostnameFromHost(value: string | null | undefined) {
  const host = readFirstHeaderValue(value);
  if (!host || /[\\/@?#\s]/.test(host)) return "";
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

export function resolvePublicOriginFromHeaders(
  requestHeaders: Headers,
  fallbackOrigin: string | null | undefined = "",
) {
  const normalizedFallbackOrigin = normalizeOrigin(fallbackOrigin, "http");
  let fallbackUrl: URL | null = null;
  try {
    fallbackUrl = normalizedFallbackOrigin ? new URL(normalizedFallbackOrigin) : null;
  } catch {
    fallbackUrl = null;
  }

  const headerHost = readFirstHeaderValue(requestHeaders.get("host"));
  const directHost = headerHost || fallbackUrl?.host || "";
  const directHostname = readHostnameFromHost(directHost);
  const mayUseForwardedHost = Boolean(directHostname && isLocalLikeHostname(directHostname));
  const forwardedHost = mayUseForwardedHost
    ? readFirstHeaderValue(requestHeaders.get("x-forwarded-host"))
    : "";
  const forwardedHostname = readHostnameFromHost(forwardedHost);
  const selectedHost = forwardedHostname ? forwardedHost : directHostname ? directHost : "";
  const selectedHostname = forwardedHostname || directHostname;
  if (!selectedHost || !selectedHostname) return normalizedFallbackOrigin;

  const selectedIsLocal = isLocalLikeHostname(selectedHostname);
  const forwardedProtocol = mayUseForwardedHost
    ? readFirstHeaderValue(requestHeaders.get("x-forwarded-proto")).toLowerCase()
    : "";
  const fallbackProtocol = fallbackUrl?.protocol.replace(/:$/, "") || "http";
  const protocol = selectedIsLocal
    ? forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : fallbackProtocol
    : "https";
  return normalizeOrigin(`${protocol}://${selectedHost}`, protocol) || normalizedFallbackOrigin;
}

export function buildOriginScopedCacheKey(
  key: string | null | undefined,
  origin: string | null | undefined,
) {
  const normalizedKey = trimText(key);
  const normalizedOrigin = normalizeOrigin(origin);
  return normalizedKey && normalizedOrigin ? `${normalizedKey}|${normalizedOrigin}` : "";
}

export function resolveConfiguredPublicOrigin() {
  return normalizeOrigin(process.env.NEXT_PUBLIC_PORTAL_BASE_DOMAIN);
}

export function resolveRequestOrigin(request: Request | URL | string) {
  try {
    const url =
      request instanceof URL
        ? request
        : typeof request === "string"
          ? new URL(request)
          : new URL(request.url);
    return url.origin;
  } catch {
    return "";
  }
}

export function resolveForwardedRequestOrigin(request: Request) {
  const requestOrigin = resolveRequestOrigin(request);
  return resolvePublicOriginFromHeaders(request.headers, requestOrigin) || requestOrigin;
}

export function resolveConfiguredPublicOriginFromHeaders(
  requestHeaders: Headers,
  fallbackOrigin: string | null | undefined = "",
) {
  const requestOrigin = resolvePublicOriginFromHeaders(requestHeaders, fallbackOrigin);
  const configuredOrigin = resolveConfiguredPublicOrigin();
  if (!configuredOrigin) return requestOrigin;
  if (!requestOrigin) return configuredOrigin;

  try {
    const configuredHostname = new URL(configuredOrigin).hostname;
    const requestHostname = new URL(requestOrigin).hostname;
    return resolveBaseDomain(configuredHostname) === resolveBaseDomain(requestHostname)
      ? requestOrigin
      : configuredOrigin;
  } catch {
    return configuredOrigin;
  }
}

export function resolveConfiguredPublicRequestOrigin(request: Request) {
  return resolveConfiguredPublicOriginFromHeaders(request.headers, resolveRequestOrigin(request));
}

export function resolveTrustedPublicOrigin(request: Request | URL | string) {
  const configuredOrigin = resolveConfiguredPublicOrigin();
  const requestOrigin = resolveRequestOrigin(request);
  if (!configuredOrigin) return requestOrigin;
  if (!requestOrigin) return configuredOrigin;

  try {
    const configuredHost = new URL(configuredOrigin).hostname;
    const requestHost = new URL(requestOrigin).hostname;
    if (isLocalLikeHostname(requestHost)) {
      return configuredOrigin;
    }
    if (resolveBaseDomain(configuredHost) === resolveBaseDomain(requestHost)) {
      return configuredOrigin;
    }
  } catch {
    return requestOrigin || configuredOrigin;
  }

  return requestOrigin;
}

export function resolveSecureCookieFlag(request?: Request | URL | string) {
  if (!request) return false;
  try {
    const url =
      request instanceof URL
        ? request
        : typeof request === "string"
          ? new URL(request)
          : new URL(request.url);
    return !isLocalLikeHostname(url.hostname);
  } catch {
    return false;
  }
}

export function readOriginFromReferer(value: string | null | undefined) {
  const normalized = trimText(value);
  if (!normalized) return "";
  try {
    return new URL(normalized).origin;
  } catch {
    return "";
  }
}
