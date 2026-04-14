function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
  if (configuredOrigin) return configuredOrigin;
  return resolveRequestOrigin(request);
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
