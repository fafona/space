import { createServerSupabaseServiceClient } from "./superAdminServer";
import { loadAuthoritativeCurrentMerchantSnapshotSites } from "./publishedMerchantService";
import { fetchPublishedSiteBlocksFromSupabase } from "./publishedSiteData";
import { getMerchantServiceState } from "./merchantServiceStatus";
import { parseStrictMerchantCatalog, type MerchantCatalog } from "./merchantCatalog";
import { loadCheckoutConfiguration, parseCheckoutConfigurationSnapshot } from "./merchantCheckoutConfigurationStore.server";
import { buildCheckoutSourceChoices } from "./merchantCheckoutSources.server";
import { isMemberCheckoutPilotEnabled } from "./merchantMemberCheckoutPilot.server";
import { parseCheckoutEntryQuery, type CheckoutEntryOffer } from "./merchantCheckoutEntry";

/** Read the operating catalog only. Never use its legacy repair/bootstrap
 * loader and never read member balances, claims, stock or contact records. */
async function readEntryCatalog(siteId: string): Promise<MerchantCatalog | null> {
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("checkout_entry_unavailable");
  const response = await client.from("pages").select("merchant_id,slug,blocks").eq("merchant_id", siteId)
    .eq("slug", `__merchant_catalog__:${siteId}`).limit(2).abortSignal(AbortSignal.timeout(10_000));
  if (response.error || !Array.isArray(response.data) || response.data.length > 1) throw new Error("checkout_entry_unavailable");
  if (!response.data.length) return null;
  const row = response.data[0], value = row.blocks;
  if (row.merchant_id !== siteId || row.slug !== `__merchant_catalog__:${siteId}` || !value || value.kind !== "merchant_catalog" || value.siteId !== siteId) throw new Error("checkout_entry_unavailable");
  const catalog = parseStrictMerchantCatalog(value.catalog);
  if (!catalog) throw new Error("checkout_entry_unavailable");
  return catalog;
}
const defaults = { enabled: isMemberCheckoutPilotEnabled, sites: loadAuthoritativeCurrentMerchantSnapshotSites,
  published: (siteId: string) => fetchPublishedSiteBlocksFromSupabase(siteId, { fresh: true }),
  configuration: loadCheckoutConfiguration, catalog: readEntryCatalog, now: Date.now };
export type CheckoutEntryDependencies = typeof defaults;

/** Exact server-authored bindings only. A client block/name/viewport is a
 * lookup key, never authority, a price override or a name-based fallback. */
export async function readCheckoutEntryOffers(raw: unknown, overrides: Partial<CheckoutEntryDependencies> = {}): Promise<CheckoutEntryOffer[]> {
  const query = parseCheckoutEntryQuery(raw), deps = { ...defaults, ...overrides };
  if (!deps.enabled(query.siteId)) return [];
  const matching = (await deps.sites()).filter(site => site.id === query.siteId);
  if (matching.length !== 1) return [];
  const site = structuredClone(matching[0]), p = site.permissionConfig;
  const allowed = () => site.status === "online" && getMerchantServiceState(site.status, site.serviceExpiresAt, deps.now()).reason === null
    && p?.allowMembershipManagement === true && p.allowPointsRedemption === true
    && (query.kind === "booking" ? p.allowBookingBlock === true : p.allowProductBlock === true && p.allowOrderManagement === true);
  if (!allowed()) return [];
  const config = parseCheckoutConfigurationSnapshot(await deps.configuration(query.siteId), query.siteId);
  const candidates = config.offers.filter(o => o.enabled && o.unitPoints !== null && o.source.kind === query.kind
    && o.source.blockId === query.blockId && o.checkoutBinding.viewport === query.viewport);
  if (!candidates.length) return [];
  const [published, catalog] = await Promise.all([deps.published(query.siteId), query.kind === "order" ? deps.catalog(query.siteId) : null]);
  if (!published || published.siteId !== query.siteId) throw new Error("checkout_entry_unavailable");
  const sources = buildCheckoutSourceChoices({ siteId: query.siteId, siteName: site.name, blocks: published.blocks, catalog,
    allowBooking: query.kind === "booking", allowOrder: query.kind === "order" });
  const offers = candidates.flatMap(offer => {
    const rows = sources.filter(s => s.key === offer.checkoutBinding.sourceKey), b = offer.checkoutBinding;
    if (rows.length !== 1) return [];
    const s = rows[0];
    if (s.sourceVersion !== b.sourceVersion || s.kind !== offer.source.kind || s.blockId !== query.blockId || s.viewport !== query.viewport) return [];
    if (s.kind === "booking" ? s.store !== b.store || s.item !== b.item
      : offer.source.kind !== "order" || s.collectionId !== offer.source.collectionId || s.productId !== offer.source.productId || s.cashMinor !== offer.cash?.unitAmountMinor) return [];
    return [{ offerId: offer.id, offerRevision: offer.revision, title: offer.title, maxQuantity: offer.source.kind === "booking" ? 1 : offer.maxQuantity,
      source: s.kind === "booking" ? { kind: "booking" as const, store: s.store!, item: s.item! } : { kind: "order" as const, productId: s.productId! } }];
  });
  const after = (await deps.sites()).filter(current => current.id === query.siteId);
  if (!deps.enabled(query.siteId) || !allowed() || after.length !== 1 || JSON.stringify(after[0]) !== JSON.stringify(site)) throw new Error("checkout_entry_unavailable");
  // Ambiguous bindings are never resolved by taking the first price/title.
  if (new Set(offers.map(o => JSON.stringify(o.source))).size !== offers.length) throw new Error("checkout_entry_unavailable");
  return offers;
}
