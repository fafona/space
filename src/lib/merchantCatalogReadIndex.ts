import {
  normalizeMerchantCatalog,
  type MerchantCatalogCollection,
} from "@/lib/merchantCatalog";

// Undefined means absent; null means ambiguous. Ambiguity in an unrelated
// viewport must not invalidate a unique exact/shared choice.
type CollectionScope = MerchantCatalogCollection | null | undefined;
type CollectionBucket = {
  count: number;
  first: MerchantCatalogCollection;
  desktop?: CollectionScope;
  mobile?: CollectionScope;
  shared?: CollectionScope;
};

/** Prepare an isolated read snapshot for multiple block lookups, not a cache. */
export function createMerchantCatalogCollectionResolver(
  value: unknown,
): (blockId: unknown, viewport?: unknown) => MerchantCatalogCollection | null {
  const catalog = normalizeMerchantCatalog(value);
  const byBlockId = new Map<string, CollectionBucket>();
  for (const collection of catalog.collections) {
    let bucket = byBlockId.get(collection.blockId);
    if (!bucket) {
      bucket = { count: 0, first: collection };
      byBlockId.set(collection.blockId, bucket);
    }
    bucket.count += 1;
    bucket[collection.viewport] = bucket[collection.viewport] === undefined ? collection : null;
  }

  return (blockId, viewport) => {
    const normalizedBlockId = typeof blockId === "string" ? blockId.trim() : "";
    if (!normalizedBlockId) return null;
    const bucket = byBlockId.get(normalizedBlockId);
    if (!bucket || bucket.shared === null) return null;
    const requestedViewport = viewport === "desktop" || viewport === "mobile" ? viewport : null;
    const exact = requestedViewport ? bucket[requestedViewport] : undefined;
    if (exact === null) return null;
    const chosen = requestedViewport
      ? exact ?? bucket.shared
      : bucket.shared ?? (bucket.count === 1 ? bucket.first : undefined);
    return chosen
      ? {
          ...chosen,
          productIds: [...chosen.productIds],
          ...(chosen.browsingRules ? { browsingRules: { ...chosen.browsingRules } } : {}),
        }
      : null;
  };
}
