export type MerchantStaffBusinessRolloutMode = "off" | "enforce";

export type MerchantStaffBusinessRolloutConfig = {
  mode: MerchantStaffBusinessRolloutMode | null;
  siteIds: string[];
  valid: boolean;
};

function trimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isExactCanonicalPortalOrigin(value: unknown) {
  const normalized = trimText(value);
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      url.origin === normalized &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      (hostname === "faolla.com" || hostname.endsWith(".faolla.com"))
    );
  } catch {
    return false;
  }
}

export function resolveMerchantStaffBusinessRolloutConfig(
  environment: Record<string, string | undefined> = process.env,
): MerchantStaffBusinessRolloutConfig {
  const rawMode = trimText(
    environment.MERCHANT_STAFF_BUSINESS_RBAC_MODE,
  ).toLowerCase();
  const mode =
    !rawMode || rawMode === "off"
      ? "off"
      : rawMode === "enforce"
        ? "enforce"
        : null;
  const rawSiteIds = trimText(
    environment.MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS,
  );
  const entries = rawSiteIds
    ? rawSiteIds.split(",").map((entry) => entry.trim())
    : [];
  const validSiteIds =
    entries.length <= 50 &&
    entries.every((entry) => /^\d{8}$/.test(entry)) &&
    new Set(entries).size === entries.length;
  const siteIds = validSiteIds ? [...entries].sort() : [];
  const canonicalPortalOriginValid =
    mode !== "enforce" ||
    isExactCanonicalPortalOrigin(
      environment.FAOLLA_CANONICAL_PORTAL_ORIGIN,
    );
  const valid =
    Boolean(mode) &&
    validSiteIds &&
    (mode !== "enforce" || siteIds.length > 0) &&
    canonicalPortalOriginValid;
  return { mode, siteIds, valid };
}

export function isMerchantStaffBusinessRolloutEnabled(
  siteId: string,
  config = resolveMerchantStaffBusinessRolloutConfig(),
) {
  return (
    config.valid &&
    config.mode === "enforce" &&
    /^\d{8}$/.test(siteId) &&
    config.siteIds.includes(siteId)
  );
}
