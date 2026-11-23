import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getPagePlanConfigFromBlocks } from "./pagePlans";
import type { Block, MerchantListPublishedSite } from "@/data/homeBlocks";
import type { MerchantCatalog } from "./merchantCatalog";
import { buildConfiguredCheckoutOffer, type CheckoutConfigurationSnapshot } from "./merchantCheckoutConfiguration";
import { buildCheckoutSourceChoices } from "./merchantCheckoutSources.server";
import { readCheckoutEntryOffers, type CheckoutEntryDependencies } from "./merchantCheckoutEntry.server";

function fixture(kind: "booking" | "order" = "booking", viewport: "desktop" | "mobile" = "desktop") {
  const query = { siteId: "10909095", kind, blockId: kind === "booking" ? "booking-test" : "product-test", viewport };
  const blocks = [{ id: "booking-test", type: "booking", props: { bookingStoreOptions: ["Store"], bookingItemOptions: ["Play", "Party"], bookingTitleOptions: ["Mx"] } },
    { id: "product-test", type: "product", props: { products: [] } }] as unknown as Block[];
  (blocks[0].props as { pagePlanConfigMobile?: unknown }).pagePlanConfigMobile = getPagePlanConfigFromBlocks([structuredClone(blocks[0])]);
  const catalog: MerchantCatalog = { revision: 1, updatedAt: "2026-11-23T00:00:00Z", pricePrefix: "€", categories: [],
    products: [{ id: "p1", code: "P", name: "Product", description: "", price: "12.50", imageUrl: "", thumbnailUrl: "", tag: "", availability: "available" }],
    collections: [{ id: "c1", blockId: "product-test", viewport: "shared", productIds: ["p1"] }] };
  const sources = buildCheckoutSourceChoices({ siteId: query.siteId, siteName: "Synthetic", blocks, catalog, allowBooking: true, allowOrder: true });
  const source = sources.find(s => s.kind === kind && s.viewport === viewport)!;
  const offer = buildConfiguredCheckoutOffer({ siteId: query.siteId, current: { version: null, offers: [] }, newId: randomUUID(), newRevision: randomUUID(),
    options: { sources, stockItems: [], vouchers: [] }, edit: { offerId: null, sourceKey: source.key, sourceVersion: source.sourceVersion, title: "Configured play", enabled: true,
      cashMinor: kind === "order" ? 1250 : null, unitPoints: 100, allowOnSite: false, maxQuantity: 3, timeZone: "Europe/Madrid", stockItemId: null, voucherCouponIds: [], durationMinutes: null,
      pointsReturnOnCancel: true, couponReturnOnCancel: false, cancellationAdvanceMinutes: 60 } });
  const config: CheckoutConfigurationSnapshot = { version: randomUUID(), offers: [offer] };
  const site = { id: query.siteId, name: "Synthetic", status: "online", serviceExpiresAt: "2099-01-01T00:00:00Z", permissionConfig: {
    allowBookingBlock: true, allowProductBlock: true, allowOrderManagement: true, allowMembershipManagement: true, allowPointsRedemption: true } } as unknown as MerchantListPublishedSite;
  const calls: string[] = [];
  const deps: CheckoutEntryDependencies = { enabled: () => true, cashEnabled: () => false, sites: async () => { calls.push("site"); return [site]; },
    published: async () => { calls.push("published"); return { siteId: query.siteId, blocks } as Awaited<ReturnType<CheckoutEntryDependencies["published"]>>; },
    configuration: async () => { calls.push("config"); return config; }, catalog: async () => { calls.push("catalog"); return catalog; }, now: () => Date.parse("2026-11-23T12:00:00Z") };
  return { query, blocks, catalog, site, config, offer, calls, deps };
}
test("entry resolves actual configured IDs for exact published sources, separating product viewports without financial IO", async () => {
  for (const [kind, viewport] of [["booking", "desktop"], ["booking", "mobile"], ["order", "desktop"], ["order", "mobile"]] as const) {
    const f = fixture(kind, viewport), before = structuredClone({ blocks: f.blocks, catalog: f.catalog, config: f.config });
    const entries = await readCheckoutEntryOffers(f.query, f.deps);
    assert.equal(entries.length, 1); assert.equal(entries[0].offerId, f.offer.id); assert.equal(entries[0].offerRevision, f.offer.revision);
    assert.equal(entries[0].maxQuantity, kind === "booking" ? 1 : 3); assert.ok(!/cash|unitPoints|checkoutBinding|stock|voucherCouponIds/.test(JSON.stringify(entries)));
    assert.deepEqual({ blocks: f.blocks, catalog: f.catalog, config: f.config }, before);
    assert.equal(f.calls.includes("catalog"), kind === "order");
  }
});
test("disabled gate, absent/paused merchant, missing permissions and unconfigured blocks make no catalog/source reads", async () => {
  const off = fixture(); off.deps.enabled = () => false; assert.deepEqual(await readCheckoutEntryOffers(off.query, off.deps), []); assert.deepEqual(off.calls, []);
  for (const mode of ["paused", "expired", "points", "booking", "missing", "duplicate", "unconfigured"] as const) {
    const f = fixture();
    if (mode === "paused") f.site.status = "offline";
    if (mode === "expired") f.site.serviceExpiresAt = "2020-01-01T00:00:00Z";
    if (mode === "points") f.site.permissionConfig!.allowPointsRedemption = false;
    if (mode === "booking") f.site.permissionConfig!.allowBookingBlock = false;
    if (mode === "missing") f.deps.sites = async () => [];
    if (mode === "duplicate") f.deps.sites = async () => [f.site, f.site];
    if (mode === "unconfigured") f.config.offers = [];
    assert.deepEqual(await readCheckoutEntryOffers(f.query, f.deps), []); assert.equal(f.calls.includes("published"), false); assert.equal(f.calls.includes("catalog"), false);
  }
});
test("removed, hidden, repriced and changed sources never get a guessed/fallback redemption entry", async () => {
  for (const mode of ["removed", "hidden", "price", "currency", "revision", "disabled", "wrong-viewport", "wrong-block"] as const) {
    const f = fixture("order");
    if (mode === "removed") f.blocks = []; // replace through dependency, not production
    if (mode === "removed") f.deps.published = async () => ({ siteId: f.query.siteId, slug: "synthetic", orderManagementEnabled: true, blocks: [] });
    if (mode === "hidden") f.catalog.products[0].availability = "hidden";
    if (mode === "price") f.catalog.products[0].price = "15.00";
    if (mode === "currency") f.catalog.pricePrefix = "$";
    if (mode === "revision") f.catalog.revision++;
    if (mode === "disabled") f.offer.enabled = false;
    const q = { ...f.query, ...(mode === "wrong-viewport" ? { viewport: "mobile" as const } : {}), ...(mode === "wrong-block" ? { blockId: "other" } : {}) };
    assert.deepEqual(await readCheckoutEntryOffers(q, f.deps), []);
  }
});
test("duplicate source bindings, foreign publication, late permission revocation and errors fail closed", async () => {
  for (const mode of ["duplicate", "foreign", "revoked", "error"] as const) {
    const f = fixture();
    if (mode === "duplicate") f.config.offers.push({ ...f.offer, id: randomUUID() });
    if (mode === "foreign") f.deps.published = async () => ({ siteId: "10909096", blocks: f.blocks } as Awaited<ReturnType<CheckoutEntryDependencies["published"]>>);
    if (mode === "revoked") { let n = 0; f.deps.sites = async () => { if (++n > 1) f.site.permissionConfig!.allowPointsRedemption = false; return [f.site]; }; }
    if (mode === "error") f.deps.configuration = async () => { throw new Error("PRIVATE SQL"); };
    await assert.rejects(readCheckoutEntryOffers(f.query, f.deps));
  }
});
test("cash-only source discovery requires the separate cash gate, not points entitlement, and preserves exact price/source checks", async () => {
  const f = fixture("order"); f.offer.allowOnSite = true; f.offer.unitPoints = null; f.site.permissionConfig!.allowPointsRedemption = false;
  assert.deepEqual(await readCheckoutEntryOffers(f.query, f.deps), []); f.deps.cashEnabled = () => true;
  const offers = await readCheckoutEntryOffers(f.query, f.deps); assert.equal(offers.length, 1); assert.equal(offers[0].onSiteOnly, true);
  assert.ok(!/cashMinor|unitPoints|stock|voucher/.test(JSON.stringify(offers)));
  f.catalog.products[0].price = "15.00"; assert.deepEqual(await readCheckoutEntryOffers(f.query, f.deps), []);
});
