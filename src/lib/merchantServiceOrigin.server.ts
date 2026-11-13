import { isCanonicalPortalRequest, resolveCanonicalPortalOrigin } from "@/lib/canonicalPortalRequest";
import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";
import { normalizeDomainPrefix } from "@/lib/merchantIdentity";

type ServiceSite = { id: string; domain?: string; domainPrefix?: string; domainSuffix?: string };
export function merchantServiceTenantOrigin(site: ServiceSite, canonicalOrigin = resolveCanonicalPortalOrigin()) {
  try {
    const root = new URL(canonicalOrigin).hostname.replace(/^(?:www|launch)\./, "");
    const prefix = normalizeDomainPrefix(site.domainPrefix || site.domainSuffix || "");
    return prefix ? `https://${prefix}.${root}` : "";
  } catch { return ""; }
}
export function isBoundMerchantServiceOrigin(origin: string, site: ServiceSite, canonicalOrigin = resolveCanonicalPortalOrigin()) {
  try {
    const url = new URL(origin), canonical = new URL(canonicalOrigin);
    if (url.origin !== origin || url.username || url.password || url.protocol !== "https:" || url.port) return false;
    if (url.origin === canonical.origin) return true;
    const root = canonical.hostname.replace(/^(?:www|launch)\./, "");
    if (url.hostname === root || url.hostname === `www.${root}`) return true;
    return url.origin === merchantServiceTenantOrigin(site, canonicalOrigin);
  } catch { return false; }
}

export async function authorizeMerchantServiceOrigin(request: Request, origin: string, siteId: string,
  loadSite = loadCurrentMerchantSnapshotSiteBySiteId) {
  if (!isCanonicalPortalRequest(request) || !/^\d{8}$/.test(siteId)) return false;
  const site = await loadSite(siteId);
  if (!site) return false;
  return isBoundMerchantServiceOrigin(origin, site);
}
