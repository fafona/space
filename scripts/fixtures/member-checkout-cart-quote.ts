// Synthetic data ONLY, shared by local unit and owned TEMP PostgreSQL tests.
import { randomUUID } from "node:crypto";
import type { Block } from "../../src/data/homeBlocks";
import { createDefaultMerchantPermissionConfig } from "../../src/data/platformControlStore";
import { buildPlatformMerchantSnapshotBlocks, buildPlatformMerchantSnapshotSite, normalizePlatformMerchantSnapshotPayload } from "../../src/lib/platformMerchantSnapshot";
import { buildCheckoutSourceChoices } from "../../src/lib/merchantCheckoutSources.server";
import { createEmptyMerchantMembershipSettings } from "../../src/lib/merchantMembershipSettings";
import { normalizeMerchantMembershipRecord } from "../../src/lib/merchantMemberships";
import { normalizeMerchantCouponRecord } from "../../src/lib/merchantCoupons";
import type { ConfiguredCheckoutOffer } from "../../src/lib/merchantCheckoutConfiguration";
import type { MerchantCatalog } from "../../src/lib/merchantCatalog";
import { checkoutCartQuoteIdentity } from "../../src/lib/merchantCheckoutCartQuote.server";

export function cartQuoteFixture(method: "points" | "on_site" = "points", count = 2) {
  const siteId = "10909994", principal = { accountId: "50010105", userId: "cart-synthetic-only" }, at = new Date().toISOString();
  const blockId = "cart-products", blocks = [{ id: blockId, type: "product", props: { products: [] } }] as Block[];
  const catalog: MerchantCatalog = { revision: 1, updatedAt: at, pricePrefix: "€", categories: [],
    products: Array.from({ length: count }, (_, i) => ({ id: `product-${i}`, code: `P${i}`, name: `Synthetic ${i}`, description: "", price: String(10 + i * 5), imageUrl: "", thumbnailUrl: "", tag: "Play", availability: "available" })),
    collections: [{ id: "cart-collection", blockId, viewport: "shared", productIds: Array.from({ length: count }, (_, i) => `product-${i}`) }] };
  const sources = buildCheckoutSourceChoices({ siteId, siteName: "Synthetic", blocks, catalog, allowBooking: false, allowOrder: true });
  const site = buildPlatformMerchantSnapshotSite({ id: siteId, name: "Synthetic", status: "online", serviceExpiresAt: "2099-01-01T00:00:00Z",
    permissionConfig: { ...createDefaultMerchantPermissionConfig(), allowProductBlock: true, allowOrderManagement: true, allowMembershipManagement: true, allowPointsRedemption: true, allowCouponModule: true } })!;
  const root = () => buildPlatformMerchantSnapshotBlocks(normalizePlatformMerchantSnapshotPayload({ revision: randomUUID(), snapshot: [site], defaultSortRule: "created_desc", merchantConfigHistoryBySiteId: {} }));
  const settings = createEmptyMerchantMembershipSettings(siteId);
  settings.redemptionItems = Array.from({ length: count }, (_, i) => ({ id: `stock-${i}`, categoryId: "", code: `S${i}`, barcode: "", name: "Synthetic stock", imageUrl: "", iconName: "", description: "", enabled: true,
    pointsCost: 100, referenceAmount: null, memberPrice: null, taxRate: null, stock: 5, pointProduct: true, recommended: false, sort: i }));
  const member = normalizeMerchantMembershipRecord({ id: "private-cart-member", siteId, ...principal, status: "active", pointBalance: 1000, balanceAmount: 33, growthValue: 0, joinedAt: at, updatedAt: at, transactions: [] })!;
  const coupons = [0, 1].map(i => normalizeMerchantCouponRecord({ id: `cart-coupon-${i}`, siteId, code: `PRIVATE-${i}`, title: `Synthetic voucher ${i}`, status: "active",
    discountType: method === "points" ? "points_voucher" : "amount_off", discountValue: method === "points" ? 20 : 2,
    usageScenarios: method === "points" ? ["points_redemption"] : ["order_cart"], pointsVoucherMaxPerRedemption: 0, createdAt: at, updatedAt: at,
    claimEvents: [{ id: `claim-${i}`, at, ...principal, email: "private@example.invalid", customerName: "Private", code: "", settlementCode: `PRIVATE-CLAIM-${i}`, settlementType: "qr", validUntil: null }] })!);
  const offers: ConfiguredCheckoutOffer[] = catalog.products.map((product, i) => {
    const source = sources.find(source => source.kind === "order" && source.productId === product.id && source.viewport === "desktop")!;
    if (!source) throw new Error("synthetic_source_missing");
    return { version: 1, id: randomUUID(), revision: randomUUID(), siteId, enabled: true, title: product.name, maxQuantity: 999,
      source: { kind: "order", blockId, collectionId: source.collectionId!, productId: product.id }, cash: { currency: "eur", unitAmountMinor: (10 + i * 5) * 100, initialPolicy: { mode: "full" } },
      unitPoints: 100, allowOnSite: true, couponReturnOnCancel: true,
      checkoutBinding: { sourceKey: source.key, sourceVersion: source.sourceVersion, viewport: source.viewport, stockItemId: `stock-${i}`, voucherCouponIds: [], durationMinutes: null,
        pointsReturnOnCancel: true, cancellationAdvanceMinutes: 60 } };
  });
  const row = (slug: string, merchant_id: string | null, value: unknown) => ({ id: randomUUID(), slug, merchant_id, blocks: value, updated_at: at });
  const request = { siteId, method, lines: offers.map(offer => ({ offerId: offer.id, offerRevision: offer.revision, quantity: 1, couponClaims: [] as Array<{ couponId: string; claimEventId: string }> })) };
  const identity = () => checkoutCartQuoteIdentity(request, principal);
  const snapshot = { version: 1 as const, purpose: "product_cart_quote" as const, siteId, principalKey: identity().principalKey, requestHash: identity().requestHash, databaseNow: at,
    offers, sourceRows: [row("__platform_merchant_snapshot__", null, root()), row("synthetic-cart-public", siteId, blocks), row(`__merchant_catalog__:${siteId}`, siteId, { kind: "merchant_catalog", siteId, catalog })],
    domainRows: [row(`__merchant_memberships__:${siteId}`, siteId, [member]), row(`__merchant_membership_settings__:${siteId}`, siteId, settings), row(`__merchant_coupons__:${siteId}`, siteId, coupons)] };
  return { request, identity, snapshot, principal, siteId, member, settings, coupons, offers, catalog, blocks, site, root,
    refresh: () => { snapshot.requestHash = identity().requestHash; return snapshot; } };
}
