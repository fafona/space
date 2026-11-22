import { createServerSupabaseServiceClient } from "./superAdminServer";
import { fetchPublishedSiteBlocksFromSupabase } from "./publishedSiteData";
import { parseStrictMerchantCatalog, type MerchantCatalog } from "./merchantCatalog";
import { buildCheckoutSourceChoices } from "./merchantCheckoutSources.server";
import { getMerchantMembershipSettings } from "./merchantMembershipSettings.server";
import { getMerchantCouponsSnapshot } from "./merchantCoupons.server";
import type { MerchantListPublishedSite } from "@/data/homeBlocks";
import type { CheckoutConfigurationOptions } from "./merchantCheckoutConfiguration";
import { resolveMerchantBookingTimeZoneDefault } from "./merchantBookingTimeZoneLocation.server";

/** Deliberately NOT loadStoredMerchantCatalog: its recovery path repairs rows.
 * A settings/options GET must be strictly read-only and fail closed on corrupt
 * operating catalog data instead of repairing or bootstrapping it. */
export async function loadCheckoutConfigurationOptions(site: MerchantListPublishedSite): Promise<CheckoutConfigurationOptions> {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("checkout_configuration_unavailable");
  const published = await fetchPublishedSiteBlocksFromSupabase(site.id, { fresh: true });
  if (!published || published.siteId !== site.id) throw new Error("checkout_source_unavailable");
  const permissions = site.permissionConfig;
  let catalog: MerchantCatalog | null = null;
  if (permissions?.allowProductBlock && permissions.allowOrderManagement) {
    const read = await client.from("pages").select("blocks,updated_at").eq("merchant_id", site.id).eq("slug", `__merchant_catalog__:${site.id}`).limit(2);
    if (read.error || (read.data?.length ?? 0) > 1) throw new Error("checkout_source_unavailable");
    if (read.data?.length) {
      const envelope = read.data[0].blocks;
      if (!envelope || envelope.kind !== "merchant_catalog" || envelope.siteId !== site.id) throw new Error("checkout_source_unavailable");
      catalog = parseStrictMerchantCatalog(envelope.catalog);
      if (!catalog) throw new Error("checkout_source_unavailable");
    }
  }
  const [settings, coupons] = await Promise.all([
    permissions?.allowMembershipManagement && permissions.allowPointsRedemption ? getMerchantMembershipSettings(site.id) : null,
    permissions?.allowMembershipManagement && permissions.allowCouponModule ? getMerchantCouponsSnapshot(site.id) : null,
  ]);
  const timeZoneDefault = resolveMerchantBookingTimeZoneDefault(site.location);
  return { defaultTimeZone: timeZoneDefault.timeZone, countryCode: timeZoneDefault.countryCode,
    canPoints: permissions?.allowMembershipManagement === true && permissions.allowPointsRedemption === true,
    canCoupons: permissions?.allowMembershipManagement === true && permissions.allowCouponModule === true,
    sources: buildCheckoutSourceChoices({ siteId: site.id, siteName: site.name, blocks: published.blocks, catalog,
    allowBooking: permissions?.allowBookingBlock === true, allowOrder: permissions?.allowProductBlock === true && permissions.allowOrderManagement === true }),
    stockItems: (settings?.redemptionItems ?? []).filter(item => item.enabled).map(item => ({ id: item.id, title: item.name, points: item.pointsCost })),
    vouchers: (coupons?.coupons ?? []).flatMap(coupon => coupon.status === "active"
      && ["product_voucher", "exchange_voucher", "ticket_voucher"].includes(coupon.discountType)
      ? [{ id: coupon.id, title: coupon.displayTitle || coupon.title, kind: coupon.discountType as CheckoutConfigurationOptions["vouchers"][number]["kind"] }] : []) };
}
