import { loadCurrentMerchantSnapshotSiteBySiteId } from "@/lib/publishedMerchantService";

const COUPON_PERMISSION_ENABLED_CACHE_TTL_MS = 30_000;
const COUPON_PERMISSION_DISABLED_CACHE_TTL_MS = 5_000;

type CouponWebsitePermissionCacheEntry = {
  enabled: boolean;
  expiresAt: number;
};

const couponWebsitePermissionCache = new Map<string, CouponWebsitePermissionCacheEntry>();

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function isCouponWebsiteBlockEnabled(siteId: string) {
  const normalizedSiteId = normalizeText(siteId);
  if (!normalizedSiteId) return false;
  const cached = couponWebsitePermissionCache.get(normalizedSiteId);
  if (cached && cached.expiresAt > Date.now()) return cached.enabled;
  const site = await loadCurrentMerchantSnapshotSiteBySiteId(normalizedSiteId).catch(() => null);
  const enabled = Boolean(site?.permissionConfig?.allowCouponModule && site?.permissionConfig?.allowCouponBlock);
  couponWebsitePermissionCache.set(normalizedSiteId, {
    enabled,
    expiresAt: Date.now() + (enabled ? COUPON_PERMISSION_ENABLED_CACHE_TTL_MS : COUPON_PERMISSION_DISABLED_CACHE_TTL_MS),
  });
  return enabled;
}
