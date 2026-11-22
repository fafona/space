import { createHash } from "node:crypto";
import type { Block } from "@/data/homeBlocks";
import type { MerchantCatalog } from "./merchantCatalog";
import { buildMerchantBookingRulesSnapshot, resolveMerchantBookingRuleOptionSets } from "./merchantBookingRules";
import { hasPublishedProductBlockForViewport } from "./merchantOrderCatalog";
import type { CheckoutSourceChoice } from "./merchantCheckoutConfiguration";

// JSONB/HTTP may reorder object fields without changing a published source.
// Keep arrays ordered, but hash object keys canonically on BOTH config/quote
// paths. A key-order-only round trip is not a new price/rule revision.
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : entry)).digest("hex");
/** Server-produced exact choices from current published plans, never drafts or
 * free-text/name matching. Reading does not bootstrap/repair old catalog data. */
export function buildCheckoutSourceChoices(input: { siteId: string; siteName: string; blocks: Block[]; catalog: MerchantCatalog | null;
  allowBooking: boolean; allowOrder: boolean }): CheckoutSourceChoice[] {
  if (!/^\d{8}$/.test(input.siteId)) throw new Error("checkout_configuration_invalid");
  const result: CheckoutSourceChoice[] = [], sourceVersion = digest(input.blocks);
  const append = (choice: CheckoutSourceChoice) => {
    const previous = result.find(row => row.key === choice.key);
    // Legacy plan normalization can repeat an identical block in unused plan
    // slots. Collapse only exact equivalent rules; conflicting rules stop.
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(choice)) throw new Error("checkout_source_ambiguous");
      return;
    }
    result.push(choice);
    if (result.length > 1000) throw new Error("checkout_configuration_limit");
  };
  if (input.allowBooking) {
    const snapshot = buildMerchantBookingRulesSnapshot(input.siteId, input.blocks, "2000-01-01T00:00:00.000Z");
    for (const entry of snapshot.entries) {
      const options = resolveMerchantBookingRuleOptionSets(entry, input.siteName);
      for (const store of options.store) for (const item of options.item) {
        append({ key: digest([input.siteId, "booking", entry.viewport, entry.blockId, store, item]),
          sourceVersion: digest([sourceVersion, entry]), kind: "booking", viewport: entry.viewport, blockId: entry.blockId, store, item,
          title: `${store} · ${item}`, cashMinor: null });
      }
    }
  }
  if (input.allowOrder && input.catalog) {
    const catalog = input.catalog, version = digest([sourceVersion, catalog]);
    for (const collection of catalog.collections) for (const viewport of ["desktop", "mobile"] as const) {
      if (collection.viewport !== "shared" && collection.viewport !== viewport
        || !hasPublishedProductBlockForViewport(input.blocks, collection.blockId, viewport)) continue;
      for (const id of collection.productIds) {
        const products = catalog.products.filter(product => product.id === id);
        if (products.length !== 1 || products[0].availability !== "available") continue;
        const product = products[0];
        // Fail closed on ambiguous currency/price. No € or missing price is
        // silently turned into a free product or inferred from a display name.
        if (!["€", "EUR"].includes(catalog.pricePrefix.trim()) || !/^\d+(\.\d{1,2})?$/.test(product.price)) continue;
        const [whole, fraction = ""] = product.price.split(".");
        const cashMinor = Number(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")));
        if (!Number.isSafeInteger(cashMinor) || cashMinor < 1 || cashMinor > 99_999_999) continue;
        append({ key: digest([input.siteId, "order", viewport, collection.blockId, collection.id, id]), sourceVersion: version,
          kind: "order", viewport, blockId: collection.blockId, collectionId: collection.id, productId: id, title: product.name, cashMinor });
      }
    }
  }
  if (new Set(result.map(source => source.key)).size !== result.length) throw new Error("checkout_source_ambiguous");
  return result;
}
