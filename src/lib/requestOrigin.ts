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
