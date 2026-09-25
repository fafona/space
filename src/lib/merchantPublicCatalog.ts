import type {
  MerchantCatalogBrowsingRules,
  MerchantCatalogCategory,
  MerchantCatalogCollection,
  MerchantCatalogProduct,
} from "@/lib/merchantCatalog";

export const MAX_PUBLIC_CATALOG_BATCH_SIZE = 32;
export type PublicCatalogViewport = "desktop" | "mobile";
export type PublicRuntimeCatalog = {
  revision: number;
  updatedAt: string;
  pricePrefix: string;
  collection: Pick<MerchantCatalogCollection, "id" | "blockId" | "viewport">;
  browsingRules?: MerchantCatalogBrowsingRules;
  categories: MerchantCatalogCategory[];
  products: MerchantCatalogProduct[];
};
export type PublicCatalogState = {
  status: "loading" | "ready" | "error";
  catalog: PublicRuntimeCatalog | null;
};
export type PublicCatalogBatchShared = Pick<
  PublicRuntimeCatalog,
  "revision" | "updatedAt" | "pricePrefix" | "categories" | "products"
>;
export type PublicCatalogBatchResult =
  | {
      blockId: string;
      status: "ready";
      collection: PublicRuntimeCatalog["collection"];
      productIds: string[];
      browsingRules?: MerchantCatalogBrowsingRules;
    }
  | { blockId: string; status: "legacy" }
  | { blockId: string; status: "error"; error: string; statusCode: number };
export type PublicCatalogBatchResponse = {
  ok: true;
  siteId: string;
  viewport: PublicCatalogViewport;
  catalog: PublicCatalogBatchShared | null;
  results: PublicCatalogBatchResult[];
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function stringIds(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  for (const id of value) {
    if (typeof id !== "string" || !id) return false;
  }
  return true;
}
function browsingRules(value: unknown): value is MerchantCatalogBrowsingRules {
  return record(value) && typeof value.searchEnabled === "boolean" &&
    typeof value.searchPlaceholder === "string" &&
    typeof value.hideUnselectedCategory === "boolean" && typeof value.groupByCategory === "boolean";
}
function sharedCatalog(value: unknown): value is PublicCatalogBatchShared {
  if (!record(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
    typeof value.updatedAt !== "string" || typeof value.pricePrefix !== "string" ||
    !Array.isArray(value.products) || !Array.isArray(value.categories)) return false;
  const productIds = new Set<string>();
  for (const product of value.products) {
    if (!record(product) || typeof product.id !== "string" || !product.id || productIds.has(product.id) ||
      !["code", "name", "description", "price", "imageUrl", "thumbnailUrl", "tag"]
        .every((field) => typeof product[field] === "string") ||
      (product.availability !== "available" && product.availability !== "sold_out")) return false;
    productIds.add(product.id);
  }
  for (const category of value.categories) {
    if (!record(category) || typeof category.id !== "string" || !category.id || typeof category.name !== "string" ||
      !stringIds(category.productIds) || !category.productIds.every((id) => productIds.has(id))) return false;
  }
  return true;
}

/** Decode one response snapshot only. Never convert malformed data to the legacy fallback. */
export function decodePublicCatalogBatch(
  value: unknown,
  expected: { siteId: string; viewport: PublicCatalogViewport; blockIds: readonly string[] },
): Map<string, PublicCatalogState> {
  const states = new Map<string, PublicCatalogState>(
    expected.blockIds.map((blockId) => [blockId, { status: "error", catalog: null }]),
  );
  if (!record(value) || value.ok !== true || value.siteId !== expected.siteId ||
    value.viewport !== expected.viewport || !Array.isArray(value.results) ||
    (value.catalog !== null && !sharedCatalog(value.catalog))) return states;

  const shared = value.catalog as PublicCatalogBatchShared | null;
  const productById = new Map(shared?.products.map((product) => [product.id, product] as const) ?? []);
  const entries = new Map<string, Record<string, unknown>[]>();
  for (const entry of value.results) {
    if (!record(entry) || typeof entry.blockId !== "string" || !states.has(entry.blockId)) continue;
    const matches = entries.get(entry.blockId) ?? [];
    matches.push(entry);
    entries.set(entry.blockId, matches);
  }
  for (const [blockId, matches] of entries) {
    if (matches.length !== 1) continue;
    const entry = matches[0];
    if (entry.status === "legacy") {
      states.set(blockId, { status: "ready", catalog: null });
      continue;
    }
    if (entry.status !== "ready" || !shared || !record(entry.collection) ||
      typeof entry.collection.id !== "string" || !entry.collection.id || entry.collection.blockId !== blockId ||
      (entry.collection.viewport !== expected.viewport && entry.collection.viewport !== "shared") ||
      !stringIds(entry.productIds) || !entry.productIds.every((id) => productById.has(id)) ||
      (Object.hasOwn(entry, "browsingRules") && !browsingRules(entry.browsingRules))) continue;

    const visibleIds = new Set(entry.productIds);
    states.set(blockId, {
      status: "ready",
      catalog: {
        revision: shared.revision,
        updatedAt: shared.updatedAt,
        pricePrefix: shared.pricePrefix,
        collection: {
          id: entry.collection.id,
          blockId,
          viewport: entry.collection.viewport as PublicRuntimeCatalog["collection"]["viewport"],
        },
        ...(entry.browsingRules ? { browsingRules: { ...entry.browsingRules as MerchantCatalogBrowsingRules } } : {}),
        // Keep each collection's order and multiplicity, and the catalog's category ordering.
        products: entry.productIds.map((id) => ({ ...productById.get(id)! })),
        categories: shared.categories.map((category) => ({
          id: category.id,
          name: category.name,
          productIds: category.productIds.filter((id) => visibleIds.has(id)),
        })),
      },
    });
  }
  return states;
}
