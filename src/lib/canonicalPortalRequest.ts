import {
  isLocalLikeHostname,
  normalizeOrigin,
  resolveConfiguredPublicOrigin,
} from "@/lib/requestOrigin";

const DEFAULT_CANONICAL_PORTAL_ORIGIN = "https://www.faolla.com";

function firstHeaderValue(value: string | null) {
  return String(value ?? "")
    .split(",")[0]
    ?.trim() ?? "";
}

function hostnameFromHost(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  try {
    return new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)
        ? normalized
        : `https://${normalized}`,
    ).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function resolveCanonicalPortalOrigin() {
  return (
    normalizeOrigin(process.env.FAOLLA_CANONICAL_PORTAL_ORIGIN) ||
    resolveConfiguredPublicOrigin() ||
    DEFAULT_CANONICAL_PORTAL_ORIGIN
  );
}

export function resolveCanonicalPortalHostname() {
  try {
    return new URL(resolveCanonicalPortalOrigin()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function resolvePublicRequestHostname(request: Request) {
  const hostHostname = hostnameFromHost(firstHeaderValue(request.headers.get("host")));
  if (hostHostname && !isLocalLikeHostname(hostHostname)) return hostHostname;
  const forwardedHostname = hostnameFromHost(
    firstHeaderValue(request.headers.get("x-forwarded-host")),
  );
  if (forwardedHostname) return forwardedHostname;
  if (hostHostname) return hostHostname;
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isCanonicalPortalRequest(request: Request) {
  const requestHostname = resolvePublicRequestHostname(request);
  if (!requestHostname) return false;
  if (isLocalLikeHostname(requestHostname)) {
    return process.env.NODE_ENV !== "production";
  }
  return requestHostname === resolveCanonicalPortalHostname();
}
