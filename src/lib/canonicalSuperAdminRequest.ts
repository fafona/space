import { isLocalLikeHostname, normalizeOrigin } from "@/lib/requestOrigin";
import {
  resolveCanonicalPortalHostname,
  resolvePublicRequestHostname,
} from "@/lib/canonicalPortalRequest";

function defaultConsoleHostname() {
  const portalHostname = resolveCanonicalPortalHostname();
  const rootHostname = portalHostname.startsWith("www.")
    ? portalHostname.slice(4)
    : portalHostname;
  return rootHostname ? `console.${rootHostname}` : "console.faolla.com";
}

export function resolveCanonicalSuperAdminOrigin() {
  return (
    normalizeOrigin(process.env.FAOLLA_SUPER_ADMIN_ORIGIN) ||
    `https://${defaultConsoleHostname()}`
  );
}

export function resolveCanonicalSuperAdminHostname() {
  try {
    return new URL(resolveCanonicalSuperAdminOrigin()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isCanonicalSuperAdminRequest(request: Request) {
  const hostname = resolvePublicRequestHostname(request);
  if (!hostname) return false;
  if (isLocalLikeHostname(hostname)) return process.env.NODE_ENV !== "production";
  return hostname === resolveCanonicalSuperAdminHostname();
}
