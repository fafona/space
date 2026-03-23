import type { PlatformUser, Site } from "@/data/platformControlStore";

type MerchantAccountSiteLinkInput = {
  merchantId?: string | null;
  email?: string | null;
  siteSlug?: string | null;
  merchantName?: string | null;
  username?: string | null;
};

function normalizeTextValue(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeMerchantIdValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return /^\d+$/.test(normalized) ? normalized : "";
}

function normalizeEmailValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePrefixValue(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "home") return "";
  return normalized;
}

function normalizeSiteNameValue(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function getShellName(site: Site) {
  const siteId = normalizeTextValue(site.id);
  if (!siteId) return "";
  return `商户 ${siteId}`;
}

function getSiteLinkScore(site: Site, owner: PlatformUser | null | undefined) {
  let score = 0;
  const merchantName = normalizeTextValue(site.merchantName);
  const siteName = normalizeTextValue(site.name);
  const prefix = normalizePrefixValue(site.domainPrefix ?? site.domainSuffix);
  const email = normalizeEmailValue(site.contactEmail) || normalizeEmailValue(owner?.email);
  if (merchantName) score += 8;
  if (siteName && siteName !== getShellName(site)) score += 6;
  if (prefix) score += 8;
  if (email) score += 5;
  if (normalizeTextValue(site.contactName)) score += 2;
  if (normalizeTextValue(site.contactPhone)) score += 2;
  if (normalizeTextValue(site.contactAddress)) score += 2;
  if (normalizeTextValue(site.industry)) score += 2;
  if (normalizeTextValue(site.location?.country)) score += 1;
  if (normalizeTextValue(site.location?.province)) score += 1;
  if (normalizeTextValue(site.location?.city)) score += 1;
  if (normalizeTextValue(site.serviceExpiresAt)) score += 1;
  if (normalizeTextValue(site.merchantCardImageUrl)) score += 1;
  if ((site.configHistory?.length ?? 0) > 0) score += 3;
  if (normalizeTextValue(site.lastPublishedAt)) score += 2;
  if ((site.publishedVersion ?? 0) > 1) score += 1;
  return score;
}

function setUniqueSiteValue(map: Map<string, Site | null>, key: string, site: Site) {
  if (!key) return;
  const current = map.get(key);
  if (!current) {
    map.set(key, site);
    return;
  }
  if (current.id !== site.id) {
    map.set(key, null);
  }
}

export function buildMerchantSiteLinker(sites: Site[], users: PlatformUser[]) {
  const ownerBySiteId = new Map<string, PlatformUser>();
  users.forEach((user) => {
    user.siteIds.forEach((siteId) => {
      if (!ownerBySiteId.has(siteId)) ownerBySiteId.set(siteId, user);
    });
  });

  const exactSiteByMerchantId = new Map<string, Site>();
  const uniqueSiteByEmail = new Map<string, Site | null>();
  const uniqueSiteByPrefix = new Map<string, Site | null>();
  const uniqueSiteByName = new Map<string, Site | null>();

  sites
    .filter((site) => site.id !== "site-main")
    .forEach((site) => {
      const merchantIdKey = normalizeMerchantIdValue(site.id);
      if (merchantIdKey) {
        const current = exactSiteByMerchantId.get(merchantIdKey);
        if (!current) {
          exactSiteByMerchantId.set(merchantIdKey, site);
        } else {
          const currentScore = getSiteLinkScore(current, ownerBySiteId.get(current.id) ?? null);
          const candidateScore = getSiteLinkScore(site, ownerBySiteId.get(site.id) ?? null);
          const currentTs = new Date(current.createdAt).getTime();
          const candidateTs = new Date(site.createdAt).getTime();
          if (candidateScore > currentScore || (candidateScore === currentScore && candidateTs > currentTs)) {
            exactSiteByMerchantId.set(merchantIdKey, site);
          }
        }
      }

      const owner = ownerBySiteId.get(site.id);
      const prefix = normalizePrefixValue(site.domainPrefix ?? site.domainSuffix);
      const names = [normalizeSiteNameValue(site.name), normalizeSiteNameValue(site.merchantName)];
      const emails = [normalizeEmailValue(site.contactEmail), normalizeEmailValue(owner?.email)];
      emails.filter(Boolean).forEach((email) => setUniqueSiteValue(uniqueSiteByEmail, email, site));
      if (prefix) {
        setUniqueSiteValue(uniqueSiteByPrefix, prefix, site);
      }
      names.filter(Boolean).forEach((name) => setUniqueSiteValue(uniqueSiteByName, name, site));
    });

  return (input: MerchantAccountSiteLinkInput) => {
    const exactSite = exactSiteByMerchantId.get(normalizeMerchantIdValue(input.merchantId));
    const candidates = new Map<string, Site>();
    const byEmail = uniqueSiteByEmail.get(normalizeEmailValue(input.email));
    if (byEmail) candidates.set(byEmail.id, byEmail);

    const byPrefix = uniqueSiteByPrefix.get(normalizePrefixValue(input.siteSlug));
    if (byPrefix) candidates.set(byPrefix.id, byPrefix);

    const merchantNames = [normalizeSiteNameValue(input.merchantName), normalizeSiteNameValue(input.username)];
    merchantNames.forEach((name) => {
      const byName = uniqueSiteByName.get(name);
      if (byName) candidates.set(byName.id, byName);
    });

    const matches = [...candidates.values()];
    if (!exactSite) return matches.length === 1 ? matches[0] : null;
    if (matches.length !== 1) return exactSite;

    const candidate = matches[0];
    if (candidate.id === exactSite.id) return exactSite;

    const exactScore = getSiteLinkScore(exactSite, ownerBySiteId.get(exactSite.id) ?? null);
    const candidateScore = getSiteLinkScore(candidate, ownerBySiteId.get(candidate.id) ?? null);
    return candidateScore > exactScore ? candidate : exactSite;
  };
}
