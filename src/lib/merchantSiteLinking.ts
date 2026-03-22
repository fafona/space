import type { PlatformUser, Site } from "@/data/platformControlStore";

type MerchantAccountSiteLinkInput = {
  merchantId?: string | null;
  email?: string | null;
  siteSlug?: string | null;
};

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

  sites
    .filter((site) => site.id !== "site-main")
    .forEach((site) => {
      const merchantIdKey = normalizeMerchantIdValue(site.id);
      if (merchantIdKey) {
        const current = exactSiteByMerchantId.get(merchantIdKey);
        if (!current) {
          exactSiteByMerchantId.set(merchantIdKey, site);
        } else {
          const currentTs = new Date(current.createdAt).getTime();
          const candidateTs = new Date(site.createdAt).getTime();
          if (candidateTs > currentTs) {
            exactSiteByMerchantId.set(merchantIdKey, site);
          }
        }
      }

      const owner = ownerBySiteId.get(site.id);
      const prefix = normalizePrefixValue(site.domainPrefix ?? site.domainSuffix);
      const emails = [normalizeEmailValue(site.contactEmail), normalizeEmailValue(owner?.email)];
      emails.filter(Boolean).forEach((email) => setUniqueSiteValue(uniqueSiteByEmail, email, site));
      if (prefix) {
        setUniqueSiteValue(uniqueSiteByPrefix, prefix, site);
      }
    });

  return (input: MerchantAccountSiteLinkInput) => {
    const exactSite = exactSiteByMerchantId.get(normalizeMerchantIdValue(input.merchantId));
    if (exactSite) return exactSite;

    const candidates = new Map<string, Site>();
    const byEmail = uniqueSiteByEmail.get(normalizeEmailValue(input.email));
    if (byEmail) candidates.set(byEmail.id, byEmail);

    const byPrefix = uniqueSiteByPrefix.get(normalizePrefixValue(input.siteSlug));
    if (byPrefix) candidates.set(byPrefix.id, byPrefix);

    const matches = [...candidates.values()];
    return matches.length === 1 ? matches[0] : null;
  };
}
